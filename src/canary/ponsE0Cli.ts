import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient
} from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY
} from '../adapters/robinhood/ponsV2/authority.js';
import {
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY
} from '../adapters/robinhood/ponsV2/curveTemplateAuthority.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ponsV2TokenLaunchedEvent
} from '../adapters/robinhood/ponsV2/contracts.js';
import {
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY
} from '../adapters/robinhood/ponsV2/v4UsdCalibrationAuthority.js';
import { ViemPonsV2CurveQuoteAdapter } from '../adapters/robinhood/ponsV2/viemCurveQuoteAdapter.js';
import { ViemPonsV2LaunchAdapter } from '../adapters/robinhood/ponsV2/viemLaunchAdapter.js';
import { ViemRobinhoodUsdCalibrationAdapter } from '../adapters/robinhood/ponsV2/viemUsdCalibrationAdapter.js';
import type {
  NormalizedLaunchCandidate,
  NormalizedMarket,
  PortableQuoteObservation
} from '../multichain/domain.js';
import {
  PONS_E0_NOTIONAL_USD_MICROS,
  buildPonsE0ApprovalIntent,
  buildPonsE0BuyIntent,
  buildPonsE0SellIntent
} from './ponsE0Intent.js';
import {
  ViemPonsE0CanaryExecutor,
  type SignedPonsE0Transaction
} from './viemPonsE0CanaryExecutor.js';

if (process.env.PONS_E0_CANARY_ENABLED !== 'true') {
  throw new Error('PONS_E0_CANARY_REQUIRES_EXPLICIT_ENABLE');
}

const live = process.env.PONS_E0_LIVE === 'true';
const tokenRaw = process.env.PONS_E0_TOKEN;
if (!tokenRaw) throw new Error('PONS_E0_TOKEN_REQUIRED');
const token = getAddress(tokenRaw);
const rpcUrl = process.env.PONS_E0_RPC_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
const slippageBps = envInt('PONS_E0_SLIPPAGE_BPS', 500);
if (slippageBps < 0 || slippageBps > 1_000) throw new Error('PONS_E0_SLIPPAGE_INVALID');

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

const executor = live
  ? new ViemPonsE0CanaryExecutor({
      privateKey: requirePrivateKey(process.env.PONS_E0_PRIVATE_KEY as Hex | undefined),
      rpcUrl,
      publicClient: client,
      caps: {
        maxNativeValueWei: envBigInt('PONS_E0_MAX_NATIVE_VALUE_WEI', 10_000_000_000_000_000n),
        maxGas: envBigInt('PONS_E0_MAX_GAS', 750_000n),
        maxFeePerGas: envBigInt('PONS_E0_MAX_FEE_PER_GAS_WEI', 20_000_000_000n),
        maxPriorityFeePerGas: envBigInt('PONS_E0_MAX_PRIORITY_FEE_PER_GAS_WEI', 2_000_000_000n)
      }
    })
  : null;
const wallet = executor?.walletAddress ?? requireWallet(process.env.PONS_E0_WALLET);
const statePath = path.resolve(process.env.PONS_E0_STATE_PATH ?? './data/pons-e0-canary.json');

const launchAdapter = new ViemPonsV2LaunchAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  client
});
const quoteAdapter = new ViemPonsV2CurveQuoteAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  templateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  client
});
const usdAdapter = new ViemRobinhoodUsdCalibrationAdapter({
  authority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  client
});

const existing = readState(statePath);
if (existing && existing.status !== 'COMPLETED') {
  throw new Error(
    `PONS_E0_NONTERMINAL_STATE_REQUIRES_MANUAL_RECONCILIATION:${existing.status}:${existing.transactionHash ?? 'NO_HASH'}`
  );
}
if (existing?.status === 'COMPLETED') {
  throw new Error('PONS_E0_ALREADY_COMPLETED_USE_NEW_STATE_PATH');
}

const launch = await findRecentLaunch(client, launchAdapter, token);
const plan = await buildFreshEntryPlan({
  client,
  launch,
  wallet,
  quoteAdapter,
  usdAdapter,
  slippageBps
});
executor?.authorizeExactBuyValue(plan.buy.quoteIn);

if (!live) {
  console.log(JSON.stringify(jsonSafe({
    verdict: 'PONS_E0_DRY_RUN_READY',
    mode: 'DRY_RUN',
    token,
    wallet,
    curve: plan.marketCurve,
    quoteBlock: plan.blockNumber,
    quoteBlockHash: plan.blockHash,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
    quoteInWei: plan.buy.quoteIn,
    quotedTokensOut: plan.buy.quotedTokensOut,
    minTokensOut: plan.buy.minTokensOut,
    reverseQuoteWei: plan.reverse.amountOut,
    slippageBps,
    walletSnipeTaxBps: plan.walletSnipeTaxBps,
    liveMoneyAuthority: false
  }), null, 2));
  process.exit(0);
}

if (!executor) throw new Error('PONS_E0_LIVE_EXECUTOR_MISSING');
const tokenBefore = await executor.getTokenBalance(token);
if (tokenBefore !== 0n) {
  throw new Error(`PONS_E0_DEDICATED_WALLET_TOKEN_BALANCE_MUST_BE_ZERO:${tokenBefore}`);
}

const buyPreflight = await executor.preflight(plan.buy);
const signedBuy = await executor.sign(plan.buy, buyPreflight);
writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'BUY_SIGNED',
  token,
  curve: plan.marketCurve,
  wallet,
  transactionHash: signedBuy.transactionHash
});
const buyHash = await executor.broadcastExact(signedBuy);
writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'BUY_SUBMITTED',
  token,
  curve: plan.marketCurve,
  wallet,
  transactionHash: buyHash
});
const buyReceipt = await waitForReceipt(executor, buyHash, 120_000);
if (buyReceipt.status !== 'success') {
  writeState(statePath, {
    version: 'PONS_E0_LIVE_CANARY_R0',
    status: 'FAILED',
    token,
    curve: plan.marketCurve,
    wallet,
    transactionHash: buyHash,
    reason: 'BUY_REVERTED'
  });
  throw new Error(`PONS_E0_BUY_REVERTED:${buyHash}`);
}

const tokensOwned = await executor.getTokenBalance(token);
if (tokensOwned <= 0n) {
  throw new Error('PONS_E0_BUY_INCLUDED_WITHOUT_TOKEN_BALANCE');
}
writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'BUY_INCLUDED',
  token,
  curve: plan.marketCurve,
  wallet,
  transactionHash: buyHash,
  tokensOwned: tokensOwned.toString()
});

const exitPlan = await buildFreshExitPlan({
  client,
  launch,
  expectedCurve: plan.marketCurve,
  tokenAmount: tokensOwned,
  quoteAdapter,
  slippageBps
});

const approval = buildPonsE0ApprovalIntent({
  token,
  curve: exitPlan.curve,
  owner: wallet,
  amount: tokensOwned
});
const approvalPreflight = await executor.preflight(approval);
const signedApproval = await executor.sign(approval, approvalPreflight);
writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'APPROVAL_SIGNED',
  token,
  curve: exitPlan.curve,
  wallet,
  transactionHash: signedApproval.transactionHash,
  tokensOwned: tokensOwned.toString()
});
const approvalHash = await executor.broadcastExact(signedApproval);
writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'APPROVAL_SUBMITTED',
  token,
  curve: exitPlan.curve,
  wallet,
  transactionHash: approvalHash,
  tokensOwned: tokensOwned.toString()
});
const approvalReceipt = await waitForReceipt(executor, approvalHash, 120_000);
if (approvalReceipt.status !== 'success') {
  throw new Error(`PONS_E0_APPROVAL_REVERTED:${approvalHash}`);
}
writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'APPROVAL_INCLUDED',
  token,
  curve: exitPlan.curve,
  wallet,
  transactionHash: approvalHash,
  tokensOwned: tokensOwned.toString()
});

const refreshedExit = await buildFreshExitPlan({
  client,
  launch,
  expectedCurve: plan.marketCurve,
  tokenAmount: tokensOwned,
  quoteAdapter,
  slippageBps
});
const sell = buildPonsE0SellIntent({
  token,
  curve: refreshedExit.curve,
  recipient: wallet,
  tokensIn: tokensOwned,
  quotedQuoteOut: refreshedExit.reverse.amountOut,
  slippageBps
});
const sellPreflight = await executor.preflight(sell);
const signedSell = await executor.sign(sell, sellPreflight);
writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'SELL_SIGNED',
  token,
  curve: refreshedExit.curve,
  wallet,
  transactionHash: signedSell.transactionHash,
  tokensOwned: tokensOwned.toString()
});
const sellHash = await executor.broadcastExact(signedSell);
writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'SELL_SUBMITTED',
  token,
  curve: refreshedExit.curve,
  wallet,
  transactionHash: sellHash,
  tokensOwned: tokensOwned.toString()
});
const sellReceipt = await waitForReceipt(executor, sellHash, 120_000);
if (sellReceipt.status !== 'success') {
  throw new Error(`PONS_E0_SELL_REVERTED:${sellHash}`);
}

const [tokenAfter, allowanceAfter] = await Promise.all([
  executor.getTokenBalance(token),
  executor.getTokenAllowance(token, refreshedExit.curve)
]);
if (tokenAfter !== 0n) {
  throw new Error(`PONS_E0_EXIT_TOKEN_BALANCE_NOT_ZERO:${tokenAfter}`);
}
if (allowanceAfter !== 0n) {
  throw new Error(`PONS_E0_EXIT_ALLOWANCE_NOT_ZERO:${allowanceAfter}`);
}

writeState(statePath, {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'COMPLETED',
  token,
  curve: refreshedExit.curve,
  wallet,
  transactionHash: sellHash,
  buyTransactionHash: buyHash,
  approvalTransactionHash: approvalHash,
  sellTransactionHash: sellHash,
  tokensOwned: tokensOwned.toString()
});

console.log(JSON.stringify({
  verdict: 'PONS_E0_REAL_MONEY_ROUNDTRIP_COMPLETE',
  token,
  curve: refreshedExit.curve,
  wallet,
  buyTransactionHash: buyHash,
  approvalTransactionHash: approvalHash,
  sellTransactionHash: sellHash,
  notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS.toString(),
  stoppedAfterOneRoundTrip: true
}, null, 2));

async function buildFreshEntryPlan(params: {
  client: PublicClient;
  launch: NormalizedLaunchCandidate;
  wallet: Address;
  quoteAdapter: ViemPonsV2CurveQuoteAdapter;
  usdAdapter: ViemRobinhoodUsdCalibrationAdapter;
  slippageBps: number;
}) {
  const blockNumber = await params.client.getBlockNumber();
  const block = await params.client.getBlock({ blockNumber });
  if (!block.hash) throw new Error('PONS_E0_QUOTE_BLOCK_HASH_MISSING');
  await launchAdapter.assertAuthority(blockNumber);
  const market = await params.quoteAdapter.resolveMarket(params.launch, blockNumber);
  const curve = requireCurve(market);
  const walletSnipeTaxBps = await params.client.readContract({
    address: curve,
    abi: (await import('./ponsE0Contracts.js')).ponsE0CurveTradeAbi,
    functionName: 'currentSnipeTaxBps',
    args: [params.wallet],
    blockNumber
  });
  if (walletSnipeTaxBps !== 0n) {
    throw new Error(`PONS_E0_SNIPE_TAX_MUST_BE_ZERO:${walletSnipeTaxBps}`);
  }
  const calibration = await params.usdAdapter.calibrateUsd({
    launch: params.launch,
    market,
    decisionBlock: blockNumber,
    decisionBlockHash: block.hash,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS
  });
  const entry = await params.quoteAdapter.quoteEntry({
    launch: params.launch,
    market,
    decisionBlock: blockNumber,
    decisionBlockHash: block.hash,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
    amountIn: calibration.baseAmount
  });
  if (!entry.executable || entry.amountOut <= 0n) throw new Error('PONS_E0_FRESH_ENTRY_NOT_EXECUTABLE');
  if (entry.amountIn !== calibration.baseAmount) {
    throw new Error(`PONS_E0_ENTRY_SPEND_NOT_EXACT_CALIBRATED_DOLLAR:${entry.amountIn}:${calibration.baseAmount}`);
  }
  const shadowSnipeTax = authorityBigInt(entry, 'snipeTaxBps');
  if (shadowSnipeTax !== 0n) {
    throw new Error(`PONS_E0_SHADOW_RECIPIENT_TAX_NOT_ZERO:${shadowSnipeTax}`);
  }
  if (authorityBoolean(entry, 'partialFill')) {
    throw new Error('PONS_E0_PARTIAL_FILL_FORBIDDEN');
  }
  const sellableTokens = authorityBigInt(entry, 'sellableTokens');
  const reverse = await params.quoteAdapter.quoteIndependentReverse({
    launch: params.launch,
    market,
    decisionBlock: blockNumber,
    decisionBlockHash: block.hash,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
    amountIn: entry.amountOut
  });
  if (!reverse.executable || reverse.amountOut <= 0n) {
    throw new Error('PONS_E0_FRESH_REVERSE_NOT_EXECUTABLE');
  }
  const buy = buildPonsE0BuyIntent({
    token: params.launch.token as Address,
    curve,
    recipient: params.wallet,
    pairToken: market.baseAsset as Address,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
    quoteIn: entry.amountIn,
    quotedTokensOut: entry.amountOut,
    sellableTokens,
    snipeTaxBps: walletSnipeTaxBps,
    slippageBps: params.slippageBps
  });
  return {
    blockNumber,
    blockHash: block.hash,
    market,
    marketCurve: curve,
    walletSnipeTaxBps,
    buy,
    reverse
  };
}

async function buildFreshExitPlan(params: {
  client: PublicClient;
  launch: NormalizedLaunchCandidate;
  expectedCurve: Address;
  tokenAmount: bigint;
  quoteAdapter: ViemPonsV2CurveQuoteAdapter;
  slippageBps: number;
}) {
  const blockNumber = await params.client.getBlockNumber();
  const block = await params.client.getBlock({ blockNumber });
  if (!block.hash) throw new Error('PONS_E0_EXIT_BLOCK_HASH_MISSING');
  const market = await params.quoteAdapter.resolveMarket(params.launch, blockNumber);
  const curve = requireCurve(market);
  if (getAddress(curve) !== getAddress(params.expectedCurve)) {
    throw new Error('PONS_E0_EXIT_CURVE_DRIFT');
  }
  const reverse = await params.quoteAdapter.quoteIndependentReverse({
    launch: params.launch,
    market,
    decisionBlock: blockNumber,
    decisionBlockHash: block.hash,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
    amountIn: params.tokenAmount
  });
  if (!reverse.executable || reverse.amountOut <= 0n) {
    throw new Error('PONS_E0_FRESH_EXIT_NOT_EXECUTABLE');
  }
  return { blockNumber, blockHash: block.hash, market, curve, reverse };
}

async function findRecentLaunch(
  client: PublicClient,
  adapter: ViemPonsV2LaunchAdapter,
  expectedToken: Address
): Promise<NormalizedLaunchCandidate> {
  const head = await client.getBlockNumber();
  const from = head > 30_000n ? head - 30_000n : CURRENT_PONS_V2_AUTHORITY.fromBlock;
  const logs = await client.getLogs({
    address: CURRENT_PONS_V2_AUTHORITY.factory as Address,
    event: ponsV2TokenLaunchedEvent,
    args: { token: expectedToken },
    fromBlock: from < CURRENT_PONS_V2_AUTHORITY.fromBlock ? CURRENT_PONS_V2_AUTHORITY.fromBlock : from,
    toBlock: head,
    strict: true
  });
  if (logs.length !== 1 || logs[0]?.blockNumber === null || logs[0]?.logIndex === null) {
    throw new Error(`PONS_E0_RECENT_LAUNCH_CARDINALITY:${logs.length}`);
  }
  const log = logs[0];
  const launches = await adapter.catchUp(log.blockNumber, log.blockNumber);
  const launch = launches.find((candidate) =>
    getAddress(candidate.token) === expectedToken &&
    candidate.logIndex === log.logIndex
  );
  if (!launch) throw new Error('PONS_E0_LAUNCH_MATERIALIZATION_FAILED');
  return launch;
}

function requireCurve(market: NormalizedMarket): Address {
  if (market.sourceAuthority.schema !== 'ROBINHOOD_PONS_V2_MARKET_STATE_R1') {
    throw new Error('PONS_E0_MARKET_SCHEMA_MISMATCH');
  }
  const payload = market.sourceAuthority.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('PONS_E0_MARKET_AUTHORITY_MALFORMED');
  }
  const curve = payload.curve;
  if (typeof curve !== 'string') throw new Error('PONS_E0_MARKET_CURVE_MISSING');
  return getAddress(curve);
}

function authorityBigInt(quote: PortableQuoteObservation, key: string): bigint {
  const payload = quote.sourceAuthority.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`PONS_E0_QUOTE_AUTHORITY_MALFORMED:${key}`);
  }
  const value = payload[key];
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new Error(`PONS_E0_QUOTE_AUTHORITY_FIELD_INVALID:${key}`);
  }
  return BigInt(value);
}

function authorityBoolean(quote: PortableQuoteObservation, key: string): boolean {
  const payload = quote.sourceAuthority.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`PONS_E0_QUOTE_AUTHORITY_MALFORMED:${key}`);
  }
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw new Error(`PONS_E0_QUOTE_AUTHORITY_FIELD_INVALID:${key}`);
  }
  return value;
}

async function waitForReceipt(
  executor: ViemPonsE0CanaryExecutor,
  hash: Hex,
  timeoutMs: number
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await executor.getReceiptIfPresent(hash);
    if (receipt) return receipt;
    await sleep(500);
  }
  throw new Error(`PONS_E0_RECEIPT_TIMEOUT_NO_RETRY:${hash}`);
}

function readState(file: string): Record<string, string> | null {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
  if (parsed.version !== 'PONS_E0_LIVE_CANARY_R0') {
    throw new Error('PONS_E0_STATE_VERSION_INVALID');
  }
  return parsed;
}

function writeState(file: string, state: Record<string, string>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function requirePrivateKey(value: Hex | undefined): Hex {
  if (!value) throw new Error('PONS_E0_LIVE_REQUIRES_PRIVATE_KEY');
  return value;
}

function requireWallet(value: string | undefined): Address {
  if (!value) throw new Error('PONS_E0_DRY_RUN_REQUIRES_WALLET');
  return getAddress(value);
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  return raw ? BigInt(raw) : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name}_MUST_BE_INTEGER`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)])
    );
  }
  return value;
}
