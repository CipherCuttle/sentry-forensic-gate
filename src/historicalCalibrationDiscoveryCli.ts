import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  http,
  type Address,
  type Hex as ViemHex
} from 'viem';
import fs from 'node:fs';
import type { Hex } from './domain.js';
import {
  DEFAULT_INK_RPC_URL,
  DEFAULT_SENTRY_LAUNCH_FACTORY,
  INK_CHAIN_ID
} from './sentry/contracts.js';
import {
  erc20DecimalsAbi,
  sentryBaselineReadAbi,
  tsunamiFactoryReadAbi,
  tsunamiPoolReadAbi,
  tsunamiQuoterV2Abi,
  TSUNAMI_FEE_TIERS,
  USDT0,
  ZERO_ADDRESS
} from './tsunami/contracts.js';

const TARGET_BLOCK = envBigInt('HISTORICAL_CALIBRATION_BLOCK', 39_943_478n);
const TARGET_USD_MICROS = 250_000n;
const FIXTURE_PATH = 'fixtures/historical-compatibility-r1.json';

// Discovery candidates only. Presence here is NOT authority. The live historical
// chain state decides whether a token/pool existed and whether the frozen quoter
// could price the exact-output $0.25 calibration at TARGET_BLOCK.
const USD_CANDIDATES: readonly { label: string; address: Hex }[] = [
  { label: 'USDT0', address: USDT0 },
  { label: 'USDC_E', address: '0xF1815bd50389c46847f0Bda824eC8da914045D14' },
  { label: 'USDC_NATIVE', address: '0x2D270e6886d130D724215A266106e6832161EAEd' },
  { label: 'CRVUSD', address: '0x39fec550CC6DDCEd810eCCfA9B2931b4B5f2344D' },
  { label: 'FRXUSD', address: '0x80eede496655fb9047dd39d9f418d5483ed600df' }
] as const;

const erc20MetadataAbi = [
  ...erc20DecimalsAbi,
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] }
] as const;

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_INK_RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } }
});

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const client = createPublicClient({ chain: ink, transport: http(rpcUrl) });
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as {
  historical_executable_tuple: { factory: Hex; quoterV2: Hex; weth: Hex };
};
const tuple = fixture.historical_executable_tuple;

const [chainId, block, supportedBaseTokens] = await Promise.all([
  client.getChainId(),
  client.getBlock({ blockNumber: TARGET_BLOCK }),
  readSupportedBaseTokens(TARGET_BLOCK)
]);
if (chainId !== INK_CHAIN_ID) throw new Error(`INK_CHAIN_ID_DRIFT:expected=${INK_CHAIN_ID}:actual=${chainId}`);

const candidateResults = [];
for (const candidate of USD_CANDIDATES) {
  candidateResults.push(await probeCandidate(candidate.label, candidate.address));
}

const extraSupported = supportedBaseTokens
  .filter((address) => !sameAddress(address, tuple.weth))
  .filter((address) => !USD_CANDIDATES.some((candidate) => sameAddress(candidate.address, address)));
const extraSupportedResults = [];
for (const address of extraSupported) {
  extraSupportedResults.push(await probeCandidate('SENTRY_SUPPORTED_BASE_UNKNOWN', address as Hex));
}

console.log(JSON.stringify(jsonSafe({
  schema: 'historical-calibration-discovery-r1/v1',
  status: 'DISCOVERY_ONLY_NO_AUTHORITY_CHANGE',
  providerOrigin: providerOrigin(rpcUrl),
  chainId,
  targetBlock: TARGET_BLOCK,
  targetBlockHash: block.hash,
  targetTimestamp: block.timestamp,
  targetUsdMicros: TARGET_USD_MICROS,
  sentryFactory: DEFAULT_SENTRY_LAUNCH_FACTORY,
  historicalTuple: tuple,
  sentrySupportedBaseTokens: supportedBaseTokens,
  candidateResults,
  extraSupportedResults
}), null, 2));

async function probeCandidate(label: string, token: Hex) {
  const code = await client.getBytecode({ address: token as Address, blockNumber: TARGET_BLOCK });
  const hasCode = Boolean(code && code !== '0x');
  if (!hasCode) {
    return { label, token, hasCode, decimals: null, symbol: null, pools: [] };
  }

  const [decimalsResult, symbolResult] = await Promise.all([
    safeRead(async () => Number(await client.readContract({
      address: token as Address,
      abi: erc20MetadataAbi,
      functionName: 'decimals',
      blockNumber: TARGET_BLOCK
    }))),
    safeRead(async () => String(await client.readContract({
      address: token as Address,
      abi: erc20MetadataAbi,
      functionName: 'symbol',
      blockNumber: TARGET_BLOCK
    })))
  ]);
  const decimals = decimalsResult.ok ? decimalsResult.value : null;
  const symbol = symbolResult.ok ? symbolResult.value : null;
  const targetAmountOut = decimals === null ? null : scaleUsdMicrosToTokenUnits(TARGET_USD_MICROS, decimals);

  const pools = [];
  for (const fee of TSUNAMI_FEE_TIERS) {
    const poolResult = await safeRead(async () => client.readContract({
      address: tuple.factory as Address,
      abi: tsunamiFactoryReadAbi,
      functionName: 'getPool',
      args: [tuple.weth as Address, token as Address, fee],
      blockNumber: TARGET_BLOCK
    }) as Promise<Address>);
    if (!poolResult.ok) {
      pools.push({ fee, pool: null, poolLookupError: poolResult.error, hasCode: false, liquidity: null, exactOutputQuote: null });
      continue;
    }
    const pool = poolResult.value;
    if (sameAddress(pool, ZERO_ADDRESS)) {
      pools.push({ fee, pool, hasCode: false, liquidity: null, exactOutputQuote: null });
      continue;
    }
    const [poolCode, liquidityResult] = await Promise.all([
      client.getBytecode({ address: pool, blockNumber: TARGET_BLOCK }),
      safeRead(async () => client.readContract({
        address: pool,
        abi: tsunamiPoolReadAbi,
        functionName: 'liquidity',
        blockNumber: TARGET_BLOCK
      }) as Promise<bigint>)
    ]);
    const poolHasCode = Boolean(poolCode && poolCode !== '0x');
    const exactOutputQuote = targetAmountOut === null
      ? null
      : await quoteExactOutput(token, targetAmountOut, fee);
    pools.push({
      fee,
      pool,
      hasCode: poolHasCode,
      liquidity: liquidityResult.ok ? liquidityResult.value : null,
      liquidityError: liquidityResult.ok ? null : liquidityResult.error,
      exactOutputQuote
    });
  }

  return {
    label,
    token,
    hasCode,
    decimals,
    decimalsError: decimalsResult.ok ? null : decimalsResult.error,
    symbol,
    symbolError: symbolResult.ok ? null : symbolResult.error,
    targetAmountOut,
    pools
  };
}

async function quoteExactOutput(tokenOut: Hex, amountOut: bigint, fee: number) {
  const data = encodeFunctionData({
    abi: tsunamiQuoterV2Abi,
    functionName: 'quoteExactOutputSingle',
    args: [{
      tokenIn: tuple.weth as Address,
      tokenOut: tokenOut as Address,
      amount: amountOut,
      fee,
      sqrtPriceLimitX96: 0n
    }]
  });
  try {
    const result = await client.call({
      to: tuple.quoterV2 as Address,
      data,
      blockNumber: TARGET_BLOCK
    });
    if (!result.data) return { ok: false, error: 'QUOTER_EMPTY_RETURN_DATA' };
    const decoded = decodeFunctionResult({
      abi: tsunamiQuoterV2Abi,
      functionName: 'quoteExactOutputSingle',
      data: result.data as ViemHex
    }) as readonly [bigint, bigint, number, bigint];
    return {
      ok: decoded[0] > 0n,
      amountIn: decoded[0],
      amountOut,
      sqrtPriceX96After: decoded[1],
      initializedTicksCrossed: decoded[2],
      gasEstimate: decoded[3]
    };
  } catch (error) {
    return { ok: false, error: stableError(error) };
  }
}

async function readSupportedBaseTokens(blockNumber: bigint): Promise<Address[]> {
  const result = await safeRead(async () => client.readContract({
    address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
    abi: sentryBaselineReadAbi,
    functionName: 'getSupportedBaseTokens',
    blockNumber
  }) as Promise<readonly Address[]>);
  if (!result.ok) return [];
  return [...result.value];
}

async function safeRead<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: stableError(error) };
  }
}

function scaleUsdMicrosToTokenUnits(usdMicros: bigint, decimals: number): bigint {
  return (usdMicros * (10n ** BigInt(decimals))) / 1_000_000n;
}

function stableError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 512);
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  return raw ? BigInt(raw) : fallback;
}

function providerOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
