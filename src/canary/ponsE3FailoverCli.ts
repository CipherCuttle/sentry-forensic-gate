import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Address
} from 'viem';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL
} from '../adapters/robinhood/ponsV2/contracts.js';
import { decidePonsE3PostBuyExit, type PonsE3CurveExitObservation } from './ponsE3Failover.js';
import { verifyPonsE1V4Recovery } from './viemPonsE1V4RecoveryVerifier.js';

if (process.env.PONS_E3_ENABLED !== 'true') {
  throw new Error('PONS_E3_REQUIRES_EXPLICIT_ENABLE');
}

for (const name of [
  'PONS_E0_LIVE',
  'PONS_E0_PRIVATE_KEY',
  'PONS_E2_LIVE',
  'PONS_E2_PRIVATE_KEY',
  'PONS_E2_BROADCAST_AUTHORITY',
  'PONS_E3_LIVE',
  'PONS_E3_PRIVATE_KEY',
  'PONS_E3_BROADCAST_AUTHORITY'
]) {
  if (process.env[name]) {
    throw new Error(`PONS_E3_DRY_MODE_LIVE_AUTHORITY_FORBIDDEN:${name}`);
  }
}

const tokenRaw = process.env.PONS_E3_TOKEN;
const ownerRaw = process.env.PONS_E3_OWNER;
if (!tokenRaw) throw new Error('PONS_E3_TOKEN_REQUIRED');
if (!ownerRaw) throw new Error('PONS_E3_OWNER_REQUIRED');

const token = getAddress(tokenRaw);
const owner = getAddress(ownerRaw);
const rpcUrl = process.env.PONS_E3_RPC_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
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
const postBuyTokenBalance = envBigInt('PONS_E3_POST_BUY_TOKEN_BALANCE');
if (postBuyTokenBalance <= 0n) {
  throw new Error('PONS_E3_POST_BUY_TOKEN_BALANCE_NOT_POSITIVE');
}

const status = process.env.PONS_E3_CURVE_EXIT_STATUS;
const curveExit = parseCurveExit(status, postBuyTokenBalance);

let v4Recovery;
let e0CurveAllowance = 0n;
if (status === 'CURVE_INACTIVE' || status === 'NOT_EXECUTABLE') {
  const verification = await verifyPonsE1V4Recovery({
    token,
    owner,
    slippageBps: envInt('PONS_E3_SLIPPAGE_BPS', 500),
    client
  });
  e0CurveAllowance = await client.readContract({
    address: token,
    abi: erc20AllowanceAbi,
    functionName: 'allowance',
    args: [owner, verification.curve],
    blockNumber: verification.blockNumber
  });
  v4Recovery = {
    verdict: verification.verdict,
    token: verification.token,
    owner: verification.owner,
    tokenBalance: verification.tokenBalance,
    poolId: verification.poolId,
    currentTokenAllowanceToPermit2: verification.currentTokenAllowanceToPermit2,
    currentPermit2AllowanceToRouter: verification.currentPermit2AllowanceToRouter,
    plan: verification.plan
  } as const;
}

if (curveExit.status === 'EXECUTABLE') {
  e0CurveAllowance = await client.readContract({
    address: token,
    abi: erc20AllowanceAbi,
    functionName: 'allowance',
    args: [owner, curveExit.curve]
  });
}

const decision = decidePonsE3PostBuyExit({
  token,
  owner,
  postBuyTokenBalance,
  e0CurveAllowance,
  curveExit,
  v4Recovery
});

console.log(JSON.stringify(jsonSafe({
  verdict: decision.route === 'STOP'
    ? 'PONS_E3_FAILOVER_STOPPED'
    : 'PONS_E3_FAILOVER_DRY_READY',
  mode: 'DRY_RUN_NO_SIGNER',
  decision,
  signerAvailable: false,
  broadcastAvailable: false,
  liveMoneyAuthority: false
}), null, 2));

if (decision.route === 'STOP') {
  process.exitCode = 2;
}

const erc20AllowanceAbi = [{
  type: 'function',
  name: 'allowance',
  stateMutability: 'view',
  inputs: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' }
  ],
  outputs: [{ name: '', type: 'uint256' }]
}] as const;

function parseCurveExit(
  status: string | undefined,
  tokenAmount: bigint
): PonsE3CurveExitObservation {
  if (status === 'EXECUTABLE') {
    const curveRaw = process.env.PONS_E3_CURVE;
    if (!curveRaw) throw new Error('PONS_E3_CURVE_REQUIRED');
    return {
      status,
      curve: getAddress(curveRaw) as Address,
      tokensIn: tokenAmount,
      quotedNativeOut: envBigInt('PONS_E3_CURVE_QUOTED_NATIVE_OUT_WEI'),
      minNativeOut: envBigInt('PONS_E3_CURVE_MIN_NATIVE_OUT_WEI')
    };
  }
  if (
    status === 'CURVE_INACTIVE' ||
    status === 'NOT_EXECUTABLE' ||
    status === 'ERROR'
  ) {
    return {
      status,
      reason: process.env.PONS_E3_CURVE_EXIT_REASON ?? status
    };
  }
  throw new Error('PONS_E3_CURVE_EXIT_STATUS_INVALID');
}

function envBigInt(name: string): bigint {
  const raw = process.env[name];
  if (!raw || !/^[0-9]+$/.test(raw)) {
    throw new Error(`PONS_E3_ENV_BIGINT_INVALID:${name}`);
  }
  return BigInt(raw);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000) {
    throw new Error(`PONS_E3_ENV_INTEGER_INVALID:${name}`);
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
