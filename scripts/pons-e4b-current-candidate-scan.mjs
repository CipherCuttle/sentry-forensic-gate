import {
  createPublicClient,
  defineChain,
  getAddress,
  http
} from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY
} from '../dist/adapters/robinhood/ponsV2/authority.js';
import {
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY
} from '../dist/adapters/robinhood/ponsV2/curveTemplateAuthority.js';
import {
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY
} from '../dist/adapters/robinhood/ponsV2/v4UsdCalibrationAuthority.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ponsV2TokenLaunchedEvent
} from '../dist/adapters/robinhood/ponsV2/contracts.js';
import {
  ViemPonsV2LaunchAdapter
} from '../dist/adapters/robinhood/ponsV2/viemLaunchAdapter.js';
import {
  ViemPonsV2CurveQuoteAdapter
} from '../dist/adapters/robinhood/ponsV2/viemCurveQuoteAdapter.js';
import {
  ViemRobinhoodUsdCalibrationAdapter
} from '../dist/adapters/robinhood/ponsV2/viemUsdCalibrationAdapter.js';
import {
  buildPonsE0BuyIntent,
  PONS_E0_NOTIONAL_USD_MICROS
} from '../dist/canary/ponsE0Intent.js';
import {
  ponsE0CurveTradeAbi
} from '../dist/canary/ponsE0Contracts.js';

const WALLET = getAddress(
  process.env.PONS_E4B_WALLET ??
    '0x9343835Fe138FFfF68293B361b3C69FEbd83C031'
);
const rpcUrl = process.env.PONS_E4B_RPC_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
const scanBlocks = envInt('PONS_E4B_SCAN_BLOCKS', 5_000, 100, 30_000);
const maxLaunches = envInt('PONS_E4B_MAX_LAUNCHES', 20, 1, 100);
const slippageBps = envInt('PONS_E4B_SLIPPAGE_BPS', 500, 0, 1_000);

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
  throw new Error('PONS_E4B_CHAIN_ID_MISMATCH');
}

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

const head = await client.getBlockNumber();
const fromBlock =
  head > BigInt(scanBlocks)
    ? head - BigInt(scanBlocks)
    : CURRENT_PONS_V2_AUTHORITY.fromBlock;
const clampedFrom =
  fromBlock < CURRENT_PONS_V2_AUTHORITY.fromBlock
    ? CURRENT_PONS_V2_AUTHORITY.fromBlock
    : fromBlock;

const launchLogs = [];
const chunkSize = 1_000n;
for (let start = clampedFrom; start <= head; start += chunkSize) {
  const end = start + chunkSize - 1n < head ? start + chunkSize - 1n : head;
  const logs = await client.getLogs({
    address: CURRENT_PONS_V2_AUTHORITY.factory,
    event: ponsV2TokenLaunchedEvent,
    fromBlock: start,
    toBlock: end,
    strict: true
  });
  launchLogs.push(...logs);
}

launchLogs.sort((a, b) => {
  const blockA = a.blockNumber ?? 0n;
  const blockB = b.blockNumber ?? 0n;
  if (blockA !== blockB) return blockA > blockB ? -1 : 1;
  const indexA = a.logIndex ?? 0;
  const indexB = b.logIndex ?? 0;
  return indexB - indexA;
});

const recent = launchLogs.slice(0, maxLaunches);
const eligible = [];
const rejected = [];

for (const log of recent) {
  if (
    log.blockNumber === null ||
    log.logIndex === null ||
    typeof log.args.token !== 'string'
  ) {
    rejected.push({
      token: typeof log.args.token === 'string' ? log.args.token : null,
      reason: 'INCOMPLETE_LAUNCH_LOG'
    });
    continue;
  }

  const token = getAddress(log.args.token);
  try {
    const launches = await launchAdapter.catchUp(log.blockNumber, log.blockNumber);
    const launch = launches.find(
      (item) =>
        getAddress(item.token) === token &&
        item.logIndex === log.logIndex
    );
    if (!launch) throw new Error('LAUNCH_MATERIALIZATION_MISSING');

    const decisionBlock = await client.getBlockNumber();
    const decision = await client.getBlock({ blockNumber: decisionBlock });
    if (!decision.hash) throw new Error('DECISION_BLOCK_HASH_MISSING');

    const market = await quoteAdapter.resolveMarket(launch, decisionBlock);
    const curve = requireCurve(market);
    if (getAddress(market.baseAsset) !== getAddress(PONS_V2_NATIVE_PAIR_TOKEN)) {
      throw new Error('NON_NATIVE_ETH_PAIR');
    }

    const [graduated, readyToGraduate, walletSnipeTaxBps] = await Promise.all([
      client.readContract({
        address: curve,
        abi: ponsE0CurveTradeAbi,
        functionName: 'graduated',
        blockNumber: decisionBlock
      }),
      client.readContract({
        address: curve,
        abi: ponsE0CurveTradeAbi,
        functionName: 'readyToGraduate',
        blockNumber: decisionBlock
      }),
      client.readContract({
        address: curve,
        abi: ponsE0CurveTradeAbi,
        functionName: 'currentSnipeTaxBps',
        args: [WALLET],
        blockNumber: decisionBlock
      })
    ]);
    if (graduated) throw new Error('CURVE_ALREADY_GRADUATED');
    if (readyToGraduate) throw new Error('CURVE_READY_TO_GRADUATE');
    if (walletSnipeTaxBps !== 0n) {
      throw new Error(`WALLET_SNIPE_TAX_NONZERO:${walletSnipeTaxBps}`);
    }

    const calibration = await usdAdapter.calibrateUsd({
      launch,
      market,
      decisionBlock,
      decisionBlockHash: decision.hash,
      notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS
    });
    const entry = await quoteAdapter.quoteEntry({
      launch,
      market,
      decisionBlock,
      decisionBlockHash: decision.hash,
      notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
      amountIn: calibration.baseAmount
    });
    if (!entry.executable || entry.amountOut <= 0n) {
      throw new Error(
        `ENTRY_NOT_EXECUTABLE:${entry.failureReason ?? 'UNKNOWN'}`
      );
    }
    if (entry.amountIn !== calibration.baseAmount) {
      throw new Error('ENTRY_SPEND_NOT_EXACT_CALIBRATION');
    }

    const shadowSnipeTaxBps = authorityBigInt(entry, 'snipeTaxBps');
    if (shadowSnipeTaxBps !== 0n) {
      throw new Error(`SHADOW_SNIPE_TAX_NONZERO:${shadowSnipeTaxBps}`);
    }
    if (authorityBoolean(entry, 'partialFill')) {
      throw new Error('PARTIAL_FILL_FORBIDDEN');
    }
    const sellableTokens = authorityBigInt(entry, 'sellableTokens');

    const buy = buildPonsE0BuyIntent({
      token,
      curve,
      recipient: WALLET,
      pairToken: market.baseAsset,
      notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
      quoteIn: entry.amountIn,
      quotedTokensOut: entry.amountOut,
      sellableTokens,
      snipeTaxBps: walletSnipeTaxBps,
      slippageBps
    });

    const reverse = await quoteAdapter.quoteIndependentReverse({
      launch,
      market,
      decisionBlock,
      decisionBlockHash: decision.hash,
      notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
      amountIn: entry.amountOut
    });
    if (!reverse.executable || reverse.amountOut <= 0n) {
      throw new Error(
        `REVERSE_NOT_EXECUTABLE:${reverse.failureReason ?? 'UNKNOWN'}`
      );
    }

    eligible.push({
      token,
      curve,
      launchBlock: launch.blockNumber.toString(),
      launchTxHash: launch.txHash,
      decisionBlock: decisionBlock.toString(),
      decisionBlockHash: decision.hash,
      quoteInWei: buy.quoteIn.toString(),
      quotedTokensOut: buy.quotedTokensOut.toString(),
      minTokensOut: buy.minTokensOut.toString(),
      sellableTokens: buy.sellableTokens.toString(),
      reverseQuoteWei: reverse.amountOut.toString(),
      slippageBps,
      walletSnipeTaxBps: walletSnipeTaxBps.toString()
    });
  } catch (error) {
    rejected.push({
      token,
      launchBlock: log.blockNumber.toString(),
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

const receipt = {
  verdict:
    eligible.length > 0
      ? 'PONS_E4B_CURRENT_CANDIDATE_AVAILABLE'
      : 'PONS_E4B_NO_CURRENT_ELIGIBLE_CANDIDATE',
  mode: 'READ_ONLY_NO_SIGNER',
  selectionPolicy:
    'NEWEST_RECENT_LAUNCH_PASSING_FROZEN_E0_MECHANICAL_GATES_NOT_INVESTMENT_RANKING',
  headBlock: head.toString(),
  scannedFromBlock: clampedFrom.toString(),
  scannedLaunchCount: launchLogs.length,
  evaluatedLaunchCount: recent.length,
  selected: eligible[0] ?? null,
  eligible,
  rejected,
  boundaries: {
    privateKey: false,
    walletClient: false,
    signing: false,
    broadcast: false,
    liveMoney: false,
    edgeStillUnproven: true
  }
};

console.log(JSON.stringify(receipt, null, 2));

function requireCurve(market) {
  const payload = market.sourceAuthority?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('MARKET_AUTHORITY_MALFORMED');
  }
  if (typeof payload.curve !== 'string') {
    throw new Error('MARKET_CURVE_MISSING');
  }
  return getAddress(payload.curve);
}

function authorityBigInt(quote, key) {
  const payload = quote.sourceAuthority?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`QUOTE_AUTHORITY_MALFORMED:${key}`);
  }
  const value = payload[key];
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new Error(`QUOTE_AUTHORITY_FIELD_INVALID:${key}`);
  }
  return BigInt(value);
}

function authorityBoolean(quote, key) {
  const payload = quote.sourceAuthority?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`QUOTE_AUTHORITY_MALFORMED:${key}`);
  }
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw new Error(`QUOTE_AUTHORITY_FIELD_INVALID:${key}`);
  }
  return value;
}

function envInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}
