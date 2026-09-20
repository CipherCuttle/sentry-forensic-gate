import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex
} from 'viem';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL
} from '../adapters/robinhood/ponsV2/contracts.js';
import { ponsE0CurveTradeAbi, ponsE0TokenAbi } from './ponsE0Contracts.js';
import {
  decidePonsE3BRuntimeFailover,
  type PonsE3BRuntimeDecision
} from './ponsE3BRuntimeFailover.js';
import {
  assertPonsE3BStateMayStart,
  readPonsE3BRuntimeState,
  reservePonsE3BRuntimeState,
  transitionPonsE3BRuntimeState
} from './ponsE3BRuntimeState.js';
import { verifyPonsE1V4Recovery } from './viemPonsE1V4RecoveryVerifier.js';

if (process.env.PONS_E3B_ENABLED !== 'true') {
  throw new Error('PONS_E3B_REQUIRES_EXPLICIT_ENABLE');
}

for (const name of [
  'PONS_E0_LIVE',
  'PONS_E0_PRIVATE_KEY',
  'PONS_E2_LIVE',
  'PONS_E2_PRIVATE_KEY',
  'PONS_E2_BROADCAST_AUTHORITY',
  'PONS_E3_LIVE',
  'PONS_E3_PRIVATE_KEY',
  'PONS_E3_BROADCAST_AUTHORITY',
  'PONS_E3B_LIVE',
  'PONS_E3B_PRIVATE_KEY',
  'PONS_E3B_BROADCAST_AUTHORITY'
]) {
  if (process.env[name]) {
    throw new Error(`PONS_E3B_DRY_MODE_LIVE_AUTHORITY_FORBIDDEN:${name}`);
  }
}

const e0StatePath = path.resolve(
  process.env.PONS_E3B_E0_STATE_PATH ?? './data/pons-e0-canary.json'
);
const statePath = path.resolve(
  process.env.PONS_E3B_STATE_PATH ?? './data/pons-e3b-runtime.json'
);
const rpcUrl = process.env.PONS_E3B_RPC_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
const e0 = readE0PostBuyState(e0StatePath);

assertPonsE3BStateMayStart(readPonsE3BRuntimeState(statePath));

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});
const client = createPublicClient({
  chain: robinhood,
  transport: http(rpcUrl, { retryCount: 2, retryDelay: 1_000 })
});
if (await client.getChainId() !== ROBINHOOD_CHAIN_ID) {
  throw new Error('PONS_E3B_CHAIN_ID_MISMATCH');
}

let runtimeState = reservePonsE3BRuntimeState(statePath, {
  token: e0.token,
  wallet: e0.wallet,
  curve: e0.curve,
  tokenAmount: e0.tokensOwned.toString(),
  e0Status: e0.status,
  e0TransactionHash: e0.transactionHash
});

const head = await client.getBlockNumber();
const block = await client.getBlock({ blockNumber: head });
if (!block.hash) throw new Error('PONS_E3B_BLOCK_HASH_MISSING');

const [tokenBalance, graduated, readyToGraduate, curveAllowance] = await Promise.all([
  client.readContract({
    address: e0.token,
    abi: ponsE0TokenAbi,
    functionName: 'balanceOf',
    args: [e0.wallet],
    blockNumber: head
  }),
  client.readContract({
    address: e0.curve,
    abi: ponsE0CurveTradeAbi,
    functionName: 'graduated',
    blockNumber: head
  }),
  client.readContract({
    address: e0.curve,
    abi: ponsE0CurveTradeAbi,
    functionName: 'readyToGraduate',
    blockNumber: head
  }),
  client.readContract({
    address: e0.token,
    abi: ponsE0TokenAbi,
    functionName: 'allowance',
    args: [e0.wallet, e0.curve],
    blockNumber: head
  })
]);

if (tokenBalance !== e0.tokensOwned) {
  runtimeState = transitionPonsE3BRuntimeState(
    statePath,
    runtimeState,
    'STOPPED',
    { reason: `PONS_E3B_POST_BUY_BALANCE_DRIFT:${tokenBalance}:${e0.tokensOwned}` }
  );
  printAndExit({
    route: 'STOP',
    reason: runtimeState.reason ?? 'PONS_E3B_POST_BUY_BALANCE_DRIFT'
  }, 2);
}

let decision: PonsE3BRuntimeDecision;

if (!graduated) {
  decision = decidePonsE3BRuntimeFailover({
    token: e0.token,
    owner: e0.wallet,
    curve: e0.curve,
    postBuyTokenBalance: tokenBalance,
    e0Status: e0.status,
    curveGraduated: graduated,
    curveReadyToGraduate: readyToGraduate,
    currentCurveAllowance: curveAllowance
  });
} else if (curveAllowance !== 0n) {
  decision = decidePonsE3BRuntimeFailover({
    token: e0.token,
    owner: e0.wallet,
    curve: e0.curve,
    postBuyTokenBalance: tokenBalance,
    e0Status: e0.status,
    curveGraduated: true,
    curveReadyToGraduate: readyToGraduate,
    currentCurveAllowance: curveAllowance
  });
  if (decision.route !== 'CURVE_REVOKE_REQUIRED') {
    throw new Error('PONS_E3B_CURVE_REVOKE_DECISION_EXPECTED');
  }
  const simulated = await client.call({
    account: e0.wallet,
    to: decision.cleanup.target,
    data: decision.cleanup.calldata,
    value: 0n,
    blockNumber: head
  });
  if (!simulated.data || simulated.data === '0x') {
    throw new Error('PONS_E3B_CURVE_REVOKE_SIMULATION_RESULT_MISSING');
  }
  const approved = decodeFunctionResult({
    abi: ponsE0TokenAbi,
    functionName: 'approve',
    data: simulated.data
  });
  if (approved !== true) {
    throw new Error('PONS_E3B_CURVE_REVOKE_SIMULATION_FALSE');
  }
  const blockAfterSimulation = await client.getBlock({ blockNumber: head });
  if (
    !blockAfterSimulation.hash ||
    blockAfterSimulation.hash.toLowerCase() !== block.hash.toLowerCase()
  ) {
    throw new Error('PONS_E3B_CURVE_REVOKE_REORG_DURING_SIMULATION');
  }
} else {
  const verification = await verifyPonsE1V4Recovery({
    token: e0.token,
    owner: e0.wallet,
    slippageBps: envInt('PONS_E3B_SLIPPAGE_BPS', 500),
    client
  });
  if (getAddress(verification.curve) !== e0.curve) {
    throw new Error('PONS_E3B_E1_CURVE_MISMATCH');
  }

  const allowanceAtVerification = await client.readContract({
    address: e0.token,
    abi: ponsE0TokenAbi,
    functionName: 'allowance',
    args: [e0.wallet, e0.curve],
    blockNumber: verification.blockNumber
  });
  const blockAfterAllowance = await client.getBlock({
    blockNumber: verification.blockNumber
  });
  if (!blockAfterAllowance.hash) {
    throw new Error('PONS_E3B_ALLOWANCE_BLOCK_HASH_MISSING');
  }

  decision = decidePonsE3BRuntimeFailover({
    token: e0.token,
    owner: e0.wallet,
    curve: e0.curve,
    postBuyTokenBalance: tokenBalance,
    e0Status: e0.status,
    curveGraduated: true,
    curveReadyToGraduate: readyToGraduate,
    currentCurveAllowance: allowanceAtVerification,
    allowanceBlockHash: blockAfterAllowance.hash,
    v4RecoveryCurve: verification.curve,
    v4Recovery: {
      verdict: verification.verdict,
      token: verification.token,
      owner: verification.owner,
      tokenBalance: verification.tokenBalance,
      blockNumber: verification.blockNumber,
      blockHash: verification.blockHash,
      curveAllowanceBlockHash: blockAfterAllowance.hash,
      poolId: verification.poolId,
      currentTokenAllowanceToPermit2: verification.currentTokenAllowanceToPermit2,
      currentPermit2AllowanceToRouter: verification.currentPermit2AllowanceToRouter,
      plan: verification.plan
    }
  });
}

if (decision.route === 'CURVE_PATH_ACTIVE') {
  runtimeState = transitionPonsE3BRuntimeState(
    statePath,
    runtimeState,
    'CURVE_PATH_ACTIVE'
  );
} else if (decision.route === 'CURVE_REVOKE_REQUIRED') {
  runtimeState = transitionPonsE3BRuntimeState(
    statePath,
    runtimeState,
    'CURVE_REVOKE_REQUIRED'
  );
} else if (decision.route === 'V4_HANDOFF_READY') {
  runtimeState = transitionPonsE3BRuntimeState(
    statePath,
    runtimeState,
    'V4_HANDOFF_READY'
  );
} else {
  runtimeState = transitionPonsE3BRuntimeState(
    statePath,
    runtimeState,
    'STOPPED',
    { reason: decision.reason }
  );
}

console.log(JSON.stringify(jsonSafe({
  verdict:
    decision.route === 'V4_HANDOFF_READY'
      ? 'PONS_E3B_V4_HANDOFF_DRY_READY'
      : decision.route === 'CURVE_REVOKE_REQUIRED'
        ? 'PONS_E3B_CURVE_REVOKE_DRY_REQUIRED'
        : decision.route === 'CURVE_PATH_ACTIVE'
          ? 'PONS_E3B_RETURN_TO_E0_CURVE_PATH'
          : 'PONS_E3B_STOPPED',
  mode: 'DRY_RUN_NO_SIGNER',
  e0StatePath,
  statePath,
  observationBlock: head,
  observationBlockHash: block.hash,
  decision,
  stateStatus: runtimeState.status,
  signerAvailable: false,
  broadcastAvailable: false,
  liveMoneyAuthority: false,
  autoRetryAllowed: false
}), null, 2));

if (decision.route === 'STOP') process.exitCode = 2;

function readE0PostBuyState(file: string): {
  status: 'BUY_INCLUDED' | 'APPROVAL_INCLUDED';
  token: Address;
  wallet: Address;
  curve: Address;
  tokensOwned: bigint;
  transactionHash: Hex;
} {
  if (!fs.existsSync(file)) {
    throw new Error('PONS_E3B_E0_STATE_MISSING');
  }
  const state = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (state.version !== 'PONS_E0_LIVE_CANARY_R0') {
    throw new Error('PONS_E3B_E0_STATE_VERSION_INVALID');
  }
  if (state.status !== 'BUY_INCLUDED' && state.status !== 'APPROVAL_INCLUDED') {
    throw new Error(`PONS_E3B_E0_STATE_NOT_HANDOFFABLE:${String(state.status)}`);
  }
  if (
    typeof state.token !== 'string' ||
    typeof state.wallet !== 'string' ||
    typeof state.curve !== 'string' ||
    typeof state.tokensOwned !== 'string' ||
    !/^[0-9]+$/.test(state.tokensOwned) ||
    BigInt(state.tokensOwned) <= 0n ||
    typeof state.transactionHash !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(state.transactionHash)
  ) {
    throw new Error('PONS_E3B_E0_STATE_SHAPE_INVALID');
  }
  return {
    status: state.status,
    token: getAddress(state.token),
    wallet: getAddress(state.wallet),
    curve: getAddress(state.curve),
    tokensOwned: BigInt(state.tokensOwned),
    transactionHash: state.transactionHash as Hex
  };
}

function printAndExit(payload: Record<string, unknown>, code: number): never {
  console.log(JSON.stringify(jsonSafe({
    verdict: 'PONS_E3B_STOPPED',
    mode: 'DRY_RUN_NO_SIGNER',
    ...payload,
    signerAvailable: false,
    broadcastAvailable: false,
    liveMoneyAuthority: false,
    autoRetryAllowed: false
  }), null, 2));
  process.exit(code);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000) {
    throw new Error(`PONS_E3B_ENV_INTEGER_INVALID:${name}`);
  }
  return value;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        jsonSafe(item)
      ])
    );
  }
  return value;
}
