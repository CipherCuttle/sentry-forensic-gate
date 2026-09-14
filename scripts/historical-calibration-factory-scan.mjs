import fs from 'node:fs';
import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  http,
} from 'viem';

const INK_CHAIN_ID = 57073;
const RPC_URL = process.env.INK_RPC_URL ?? 'https://rpc-gel.inkonchain.com';
const TARGET_BLOCK = BigInt(process.env.HISTORICAL_CALIBRATION_BLOCK ?? '39943478');
const BATCH_BLOCKS = BigInt(process.env.HISTORICAL_POOL_SCAN_BATCH_BLOCKS ?? '10000');
const BATCH_DELAY_MS = Number(process.env.HISTORICAL_POOL_SCAN_BATCH_DELAY_MS ?? '100');
const RETRIES = Number(process.env.HISTORICAL_POOL_SCAN_RETRIES ?? '4');
const FIXTURE = JSON.parse(fs.readFileSync('fixtures/historical-compatibility-r1.json', 'utf8'));
const { factory, quoterV2, weth } = FIXTURE.historical_executable_tuple;

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const client = createPublicClient({ chain: ink, transport: http(RPC_URL) });

const poolCreatedEvent = {
  type: 'event',
  name: 'PoolCreated',
  anonymous: false,
  inputs: [
    { indexed: true, name: 'token0', type: 'address' },
    { indexed: true, name: 'token1', type: 'address' },
    { indexed: true, name: 'fee', type: 'uint24' },
    { indexed: false, name: 'tickSpacing', type: 'int24' },
    { indexed: false, name: 'pool', type: 'address' },
  ],
};

const poolAbi = [
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint128' }] },
];
const erc20MetadataAbi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
];
const quoterAbi = [
  {
    type: 'function', name: 'quoteExactOutputSingle', stateMutability: 'nonpayable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ] }],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
];

const chainId = await client.getChainId();
if (chainId !== INK_CHAIN_ID) throw new Error(`CHAIN_ID_DRIFT:${chainId}`);
const targetPoint = await client.getBlock({ blockNumber: TARGET_BLOCK });
const factoryDeploymentBlock = await findDeploymentBlock(factory, TARGET_BLOCK);
const poolLogs = await scanPoolCreated(factoryDeploymentBlock, TARGET_BLOCK);
const wethLogs = poolLogs.filter((log) => same(log.args.token0, weth) || same(log.args.token1, weth));

const pairs = [];
for (const log of wethLogs) {
  const token0 = log.args.token0;
  const token1 = log.args.token1;
  const pool = log.args.pool;
  const fee = Number(log.args.fee);
  if (!token0 || !token1 || !pool || !Number.isInteger(fee)) continue;
  const counterToken = same(token0, weth) ? token1 : token0;
  const [code, poolCode, decimals, symbol, name, liquidity] = await Promise.all([
    client.getBytecode({ address: counterToken, blockNumber: TARGET_BLOCK }),
    client.getBytecode({ address: pool, blockNumber: TARGET_BLOCK }),
    safeRead(() => client.readContract({ address: counterToken, abi: erc20MetadataAbi, functionName: 'decimals', blockNumber: TARGET_BLOCK })),
    safeRead(() => client.readContract({ address: counterToken, abi: erc20MetadataAbi, functionName: 'symbol', blockNumber: TARGET_BLOCK })),
    safeRead(() => client.readContract({ address: counterToken, abi: erc20MetadataAbi, functionName: 'name', blockNumber: TARGET_BLOCK })),
    safeRead(() => client.readContract({ address: pool, abi: poolAbi, functionName: 'liquidity', blockNumber: TARGET_BLOCK })),
  ]);
  const symbolValue = symbol.ok ? String(symbol.value) : null;
  const decimalsValue = decimals.ok ? Number(decimals.value) : null;
  const usdLikeBySymbol = symbolValue ? /(?:USD|DAI|USDS|FRAX)/i.test(symbolValue) : false;
  const exactOutputQuarterUnit = usdLikeBySymbol && decimalsValue !== null
    ? await quoteExactOutput(counterToken, scaleQuarterUnit(decimalsValue), fee)
    : null;

  pairs.push({
    createdBlock: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
    pool,
    fee,
    token0,
    token1,
    counterToken,
    counterTokenHasCode: Boolean(code && code !== '0x'),
    poolHasCode: Boolean(poolCode && poolCode !== '0x'),
    decimals: decimalsValue,
    decimalsError: decimals.ok ? null : decimals.error,
    symbol: symbolValue,
    symbolError: symbol.ok ? null : symbol.error,
    name: name.ok ? String(name.value) : null,
    nameError: name.ok ? null : name.error,
    liquidity: liquidity.ok ? liquidity.value : null,
    liquidityError: liquidity.ok ? null : liquidity.error,
    usdLikeBySymbol,
    exactOutputQuarterUnit,
  });
}

pairs.sort((a, b) => {
  if (a.createdBlock < b.createdBlock) return -1;
  if (a.createdBlock > b.createdBlock) return 1;
  return Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0);
});

console.log(JSON.stringify(jsonSafe({
  schema: 'historical-calibration-factory-scan-r1/v1',
  status: 'DISCOVERY_ONLY_NO_AUTHORITY_CHANGE',
  providerOrigin: providerOrigin(RPC_URL),
  chainId,
  targetBlock: TARGET_BLOCK,
  targetBlockHash: targetPoint.hash,
  targetTimestamp: targetPoint.timestamp,
  historicalTuple: { factory, quoterV2, weth },
  factoryDeploymentBlock,
  poolCreatedEventsScanned: poolLogs.length,
  wethPairCount: pairs.length,
  usdLikeWethPairCount: pairs.filter((pair) => pair.usdLikeBySymbol).length,
  wethPairs: pairs,
}), null, 2));

async function findDeploymentBlock(address, high) {
  const highCode = await client.getBytecode({ address, blockNumber: high });
  if (!highCode || highCode === '0x') throw new Error(`FACTORY_CODE_MISSING_AT_TARGET:${address}:${high}`);
  let low = 0n;
  let hi = high;
  while (low < hi) {
    const mid = low + ((hi - low) / 2n);
    const code = await client.getBytecode({ address, blockNumber: mid });
    if (code && code !== '0x') hi = mid;
    else low = mid + 1n;
  }
  return low;
}

async function scanPoolCreated(fromBlock, toBlock) {
  const logs = [];
  let batch = 0;
  for (let from = fromBlock; from <= toBlock; from += BATCH_BLOCKS) {
    const to = min(toBlock, from + BATCH_BLOCKS - 1n);
    if (batch > 0 && BATCH_DELAY_MS > 0) await sleep(BATCH_DELAY_MS);
    const chunk = await withRetry(() => client.getLogs({
      address: factory,
      event: poolCreatedEvent,
      fromBlock: from,
      toBlock: to,
      strict: true,
    }), `PoolCreated:${from}-${to}`);
    logs.push(...chunk);
    batch += 1;
  }
  return logs;
}

async function quoteExactOutput(tokenOut, amountOut, fee) {
  const data = encodeFunctionData({
    abi: quoterAbi,
    functionName: 'quoteExactOutputSingle',
    args: [{ tokenIn: weth, tokenOut, amount: amountOut, fee, sqrtPriceLimitX96: 0n }],
  });
  try {
    const result = await client.call({ to: quoterV2, data, blockNumber: TARGET_BLOCK });
    if (!result.data) return { ok: false, error: 'QUOTER_EMPTY_RETURN_DATA' };
    const decoded = decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactOutputSingle', data: result.data });
    return {
      ok: decoded[0] > 0n,
      amountIn: decoded[0],
      amountOut,
      sqrtPriceX96After: decoded[1],
      initializedTicksCrossed: Number(decoded[2]),
      gasEstimate: decoded[3],
    };
  } catch (error) {
    return { ok: false, error: stableError(error) };
  }
}

async function safeRead(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (error) { return { ok: false, error: stableError(error) }; }
}

async function withRetry(fn, label) {
  let attempt = 0;
  while (true) {
    try { return await fn(); }
    catch (error) {
      if (attempt >= RETRIES || !isRetryable(error)) throw error;
      const delay = Math.min(10_000, 500 * (2 ** attempt));
      console.error(JSON.stringify({ event: 'HISTORICAL_FACTORY_SCAN_RETRY', label, attempt: attempt + 1, delay }));
      await sleep(delay);
      attempt += 1;
    }
  }
}

function scaleQuarterUnit(decimals) {
  return (250_000n * (10n ** BigInt(decimals))) / 1_000_000n;
}
function stableError(error) {
  return (error instanceof Error ? `${error.name}:${error.message}` : String(error)).replace(/\s+/g, ' ').slice(0, 512);
}
function isRetryable(error) {
  return /429|rate limit|too many requests|timeout|timed out|-32016/i.test(stableError(error));
}
function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function min(a, b) { return a < b ? a : b; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function providerOrigin(url) { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}`; }
function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}
