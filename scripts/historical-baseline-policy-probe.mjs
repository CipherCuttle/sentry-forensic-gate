import fs from 'node:fs';
import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  http,
} from 'viem';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from '../dist/sentry/contracts.js';
import { ViemSentryLaunchSource } from '../dist/sentry/viemSource.js';
import { ViemExecutableBaselineSource } from '../dist/tsunami/viemBaselineSource.js';
import {
  erc20DecimalsAbi,
  tsunamiFactoryReadAbi,
  tsunamiPoolReadAbi,
  tsunamiQuoterV2Abi,
  USDT0,
  ZERO_ADDRESS,
} from '../dist/tsunami/contracts.js';
import { scaleUsdMicrosToTokenUnits } from '../dist/shadow/baselineTypes.js';

const FIXTURE_PATH = 'fixtures/historical-compatibility-r1.json';
const NOTIONALS = [250_000n, 500_000n, 1_000_000n, 2_000_000n, 5_000_000n];
const FEE_TIERS = [500, 3000, 10000];
const DECISION_DELAY_BLOCKS = 2n;
const EXPECTED_REPRESENTATIVES = 9;

if (process.env.SHADOW_ONLY !== 'true') {
  throw new Error('HISTORICAL_BASELINE_POLICY_REQUIRES_SHADOW_ONLY_TRUE');
}

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
if (!Array.isArray(fixture.representatives) || fixture.representatives.length !== EXPECTED_REPRESENTATIVES) {
  throw new Error(`HISTORICAL_BASELINE_POLICY_REPRESENTATIVE_COUNT:${fixture.representatives?.length ?? 'INVALID'}`);
}

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain: ink, transport: http(rpcUrl) });

const rows = [];
for (const representative of fixture.representatives) {
  const launchBlock = BigInt(representative.blockNumber);
  const tokenId = BigInt(representative.tokenId);
  const decisionBlock = launchBlock + DECISION_DELAY_BLOCKS;
  const authority = {
    sentryImplementation: representative.implementation,
    ...fixture.historical_executable_tuple,
  };

  const baselineSource = new ViemExecutableBaselineSource({ rpcUrl, authority });
  await baselineSource.assertAuthority(launchBlock);
  await baselineSource.assertAuthority(decisionBlock);

  const launchSource = new ViemSentryLaunchSource({
    rpcUrl,
    allowUnavailableGenericLaunchTypeFlags: true,
  });
  const launches = await launchSource.catchUp(launchBlock, launchBlock);
  const matches = launches.filter((launch) => launch.tokenId === tokenId);
  if (matches.length !== 1) {
    throw new Error(`HISTORICAL_BASELINE_POLICY_LAUNCH_IDENTITY_COUNT:block=${launchBlock}:tokenId=${tokenId}:count=${matches.length}`);
  }
  const launch = matches[0];
  const decisionBlockHash = await baselineSource.getBlockHash(decisionBlock);
  const block = await client.getBlock({ blockNumber: decisionBlock });
  const market = await baselineSource.resolveMarket(launch, decisionBlock);

  const calibrationResults = [];
  for (const notionalUsdMicros of NOTIONALS) {
    try {
      const calibration = await baselineSource.calibrateUsd({
        launch,
        market,
        decisionBlock,
        decisionBlockHash,
        notionalUsdMicros,
      });
      calibrationResults.push({
        notionalUsdMicros,
        status: 'COMPLETE',
        kind: calibration.kind,
        baseAmount: calibration.baseAmount,
        quoteFee: calibration.quote?.fee ?? null,
        quotePool: calibration.quote?.pool ?? null,
      });
    } catch (error) {
      calibrationResults.push({
        notionalUsdMicros,
        status: 'UNVERIFIED',
        reason: stableError(error),
      });
    }
  }

  const poolDiagnostics = [];
  if (norm(market.baseToken) === norm(authority.weth)) {
    const [wethCode, usdtCode, wethDecimalsRaw, usdtDecimalsRaw] = await Promise.all([
      client.getBytecode({ address: authority.weth, blockNumber: decisionBlock }),
      client.getBytecode({ address: USDT0, blockNumber: decisionBlock }),
      client.readContract({ address: authority.weth, abi: erc20DecimalsAbi, functionName: 'decimals', blockNumber: decisionBlock }),
      client.readContract({ address: USDT0, abi: erc20DecimalsAbi, functionName: 'decimals', blockNumber: decisionBlock }),
    ]);
    const wethDecimals = Number(wethDecimalsRaw);
    const usdtDecimals = Number(usdtDecimalsRaw);

    for (const fee of FEE_TIERS) {
      const pool = await client.readContract({
        address: authority.factory,
        abi: tsunamiFactoryReadAbi,
        functionName: 'getPool',
        args: [authority.weth, USDT0, fee],
        blockNumber: decisionBlock,
      });
      if (norm(pool) === norm(ZERO_ADDRESS)) {
        poolDiagnostics.push({ fee, pool: ZERO_ADDRESS, exists: false, quotes: [] });
        continue;
      }

      const [poolCode, token0, token1, poolFee, liquidity] = await Promise.all([
        client.getBytecode({ address: pool, blockNumber: decisionBlock }),
        client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'token0', blockNumber: decisionBlock }),
        client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'token1', blockNumber: decisionBlock }),
        client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'fee', blockNumber: decisionBlock }),
        client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'liquidity', blockNumber: decisionBlock }),
      ]);

      const quotes = [];
      for (const notionalUsdMicros of NOTIONALS) {
        const targetUsdt = scaleUsdMicrosToTokenUnits(notionalUsdMicros, usdtDecimals);
        try {
          const data = encodeFunctionData({
            abi: tsunamiQuoterV2Abi,
            functionName: 'quoteExactOutputSingle',
            args: [{
              tokenIn: authority.weth,
              tokenOut: USDT0,
              amount: targetUsdt,
              fee,
              sqrtPriceLimitX96: 0n,
            }],
          });
          const result = await client.call({ to: authority.quoterV2, data, blockNumber: decisionBlock });
          if (!result.data) throw new Error('QUOTER_EMPTY_RETURN_DATA');
          const decoded = decodeFunctionResult({
            abi: tsunamiQuoterV2Abi,
            functionName: 'quoteExactOutputSingle',
            data: result.data,
          });
          const amountIn = decoded[0];
          quotes.push({
            notionalUsdMicros,
            executable: amountIn > 0n,
            amountIn,
            targetUsdt,
          });
        } catch (error) {
          quotes.push({
            notionalUsdMicros,
            executable: false,
            targetUsdt,
            failureReason: isEvmRevert(error) ? 'EVM_REVERT' : stableError(error),
          });
        }
      }

      poolDiagnostics.push({
        fee,
        pool,
        exists: true,
        codePresent: Boolean(poolCode && poolCode !== '0x'),
        token0,
        token1,
        poolFee: Number(poolFee),
        liquidity,
        wethCodePresent: Boolean(wethCode && wethCode !== '0x'),
        usdtCodePresent: Boolean(usdtCode && usdtCode !== '0x'),
        wethDecimals,
        usdtDecimals,
        quotes,
      });
    }
  }

  rows.push({
    implementation: representative.implementation,
    launchBlock,
    tokenId,
    launchId: launch.launchId,
    token: launch.token,
    decisionBlock,
    decisionBlockHash,
    decisionTimestampMs: Number(block.timestamp) * 1000,
    marketBaseToken: market.baseToken,
    marketPool: market.pool,
    marketFee: market.fee,
    marketActiveLiquidity: market.activeLiquidity,
    baseKind: norm(market.baseToken) === norm(authority.weth) ? 'WETH' : norm(market.baseToken) === norm(USDT0) ? 'USDT0' : 'OTHER',
    calibrationResults,
    fullFrozenR1Calibration: calibrationResults.every((item) => item.status === 'COMPLETE'),
    poolDiagnostics,
  });
}

const receipt = {
  schema: 'historical-baseline-policy-r1-discovery/v1',
  phase: 'HISTORICAL_BASELINE_POLICY_R1',
  sourceMode: 'LIVE_ARCHIVE_RPC_POINT_IN_TIME',
  shadowOnly: true,
  representativesAttempted: rows.length,
  decisionDelayBlocks: DECISION_DELAY_BLOCKS,
  frozenNotionalsUsdMicros: NOTIONALS,
  representativesWithFullFrozenR1Calibration: rows.filter((row) => row.fullFrozenR1Calibration).length,
  baseKinds: Object.fromEntries([...new Set(rows.map((row) => row.baseKind))].map((kind) => [kind, rows.filter((row) => row.baseKind === kind).length])),
  rows,
  verdict: rows.length === EXPECTED_REPRESENTATIVES ? 'DISCOVERY_COMPLETE' : 'DISCOVERY_INCOMPLETE',
};

console.log(JSON.stringify(jsonSafe(receipt), null, 2));
if (rows.length !== EXPECTED_REPRESENTATIVES) process.exitCode = 1;

function norm(value) {
  return String(value).toLowerCase();
}

function stableError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

function isEvmRevert(error) {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    const name = typeof current.name === 'string' ? current.name : '';
    const message = typeof current.message === 'string' ? current.message.toLowerCase() : '';
    if (name === 'ExecutionRevertedError' || name === 'ContractFunctionRevertedError' || message.includes('execution reverted') || message.includes('reverted')) return true;
    current = current.cause;
  }
  return false;
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
