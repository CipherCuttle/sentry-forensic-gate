import { writeFileSync } from 'node:fs';
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  parseAbiItem
} from 'viem';

const RPC_URL = process.env.INK_RPC_URL ?? 'https://rpc-gel.inkonchain.com';
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'historical-calibration-epoch-discovery-r1.json';

const CHAIN = {
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } }
};

const SENTRY_PROXY = '0xDc37e11B68052d1539fa23386eE58Ac444bf5BE1';
const HISTORICAL_NPM = '0x98b6267DA27c5A21Bd6e3edfBC2DA6b0428Fa9F7';
const HISTORICAL_FACTORY = '0xD8B0826150B7686D1F56d6F10E31E58e1BCF1193';
const HISTORICAL_QUOTER = '0x547D43a6F83A28720908537Aa25179ff8c6A6411';
const WETH = '0x4200000000000000000000000000000000000006';
const USDT0 = '0x0200c29006150606b650577bbe7b6248f58470c1';
const ZERO = '0x0000000000000000000000000000000000000000';
const FEE_TIERS = [500, 3000, 10000];
const FROM_BLOCK = 39_943_476n;
const TO_BLOCK = 49_271_598n;
const EXPECTED_LAUNCHES = 147;
const DECISION_DELAY_BLOCKS = 2n;
const MAX_LOG_SPAN = 200_000n;
const MIN_LOG_SPAN = 1_000n;

const deploymentEvents = [
  parseAbiItem('event TokenDeployed(address indexed token, string name, string symbol, address indexed creator, uint256 tokenId)'),
  parseAbiItem('event KrakenVerifiedTokenDeployed(address indexed token, string name, string symbol, address indexed creator, uint256 tokenId)'),
  parseAbiItem('event GoPumpMeTokenDeployed(address indexed token, string name, string symbol, address indexed creator, uint256 tokenId)')
];

const positionAbi = [{
  type: 'function', name: 'positions', stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [
    { name: 'nonce', type: 'uint96' }, { name: 'operator', type: 'address' },
    { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' },
    { name: 'tickUpper', type: 'int24' }, { name: 'liquidity', type: 'uint128' },
    { name: 'feeGrowthInside0LastX128', type: 'uint256' },
    { name: 'feeGrowthInside1LastX128', type: 'uint256' },
    { name: 'tokensOwed0', type: 'uint128' }, { name: 'tokensOwed1', type: 'uint128' }
  ]
}];

const factoryAbi = [{
  type: 'function', name: 'getPool', stateMutability: 'view',
  inputs: [
    { name: 'tokenA', type: 'address' },
    { name: 'tokenB', type: 'address' },
    { name: 'fee', type: 'uint24' }
  ],
  outputs: [{ name: 'pool', type: 'address' }]
}];

const erc20DecimalsAbi = [{
  type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }]
}];

const quoterAbi = [{
  type: 'function', name: 'quoteExactOutputSingle', stateMutability: 'nonpayable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'amount', type: 'uint256' }, { name: 'fee', type: 'uint24' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' }
  ] }],
  outputs: [
    { name: 'amountIn', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' },
    { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' }
  ]
}];

const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL, { retryCount: 2, timeout: 20_000 }) });
const lower = (value) => value.toLowerCase();
const json = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

function errorText(error) {
  return [error?.shortMessage, error?.message, error?.cause?.shortMessage, error?.cause?.message]
    .filter(Boolean).join(' | ');
}

function isEconomicRevert(error) {
  return /revert|execution reverted|invalid opcode|returned no data|contract function.*reverted/i.test(errorText(error));
}

async function getEventLogsAdaptive(event) {
  const rows = [];
  let cursor = FROM_BLOCK;
  let span = MAX_LOG_SPAN;
  while (cursor <= TO_BLOCK) {
    const end = cursor + span - 1n > TO_BLOCK ? TO_BLOCK : cursor + span - 1n;
    try {
      const chunk = await client.getLogs({ address: SENTRY_PROXY, event, fromBlock: cursor, toBlock: end });
      rows.push(...chunk);
      cursor = end + 1n;
      if (span < MAX_LOG_SPAN) span = span * 2n > MAX_LOG_SPAN ? MAX_LOG_SPAN : span * 2n;
    } catch (error) {
      if (span <= MIN_LOG_SPAN) throw error;
      span = span / 2n < MIN_LOG_SPAN ? MIN_LOG_SPAN : span / 2n;
    }
  }
  return rows;
}

async function discoverLaunches() {
  const all = [];
  for (const event of deploymentEvents) {
    const logs = await getEventLogsAdaptive(event);
    for (const log of logs) {
      all.push({
        event: event.name,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: Number(log.logIndex),
        token: log.args.token,
        creator: log.args.creator,
        tokenId: log.args.tokenId,
        name: log.args.name,
        symbol: log.args.symbol
      });
    }
  }

  const dedup = new Map();
  for (const row of all) {
    const key = `${row.blockNumber}:${row.tokenId}:${lower(row.token)}`;
    const prior = dedup.get(key);
    if (!prior || row.logIndex < prior.logIndex) dedup.set(key, row);
  }
  const launches = [...dedup.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1
  );
  if (launches.length !== EXPECTED_LAUNCHES) {
    throw new Error(`HISTORICAL_LAUNCH_COUNT_MISMATCH:expected=${EXPECTED_LAUNCHES}:actual=${launches.length}`);
  }
  return launches;
}

async function positionBase(launch) {
  const p = await client.readContract({
    address: HISTORICAL_NPM,
    abi: positionAbi,
    functionName: 'positions',
    args: [launch.tokenId],
    blockNumber: launch.blockNumber
  });
  const token0 = p[2];
  const token1 = p[3];
  const token = lower(launch.token);
  if (lower(token0) === token) return { baseToken: token1, poolFee: Number(p[4]) };
  if (lower(token1) === token) return { baseToken: token0, poolFee: Number(p[4]) };
  return { baseToken: null, poolFee: Number(p[4]), structuralError: 'LAUNCHED_TOKEN_NOT_IN_POSITION' };
}

async function quoteTier({ blockNumber, fee, amountOut }) {
  const pool = await client.readContract({
    address: HISTORICAL_FACTORY,
    abi: factoryAbi,
    functionName: 'getPool',
    args: [WETH, USDT0, fee],
    blockNumber
  });
  if (lower(pool) === ZERO) return { fee, pool, executable: false, reason: 'POOL_ABSENT' };

  const data = encodeFunctionData({
    abi: quoterAbi,
    functionName: 'quoteExactOutputSingle',
    args: [{ tokenIn: WETH, tokenOut: USDT0, amount: amountOut, fee, sqrtPriceLimitX96: 0n }]
  });
  try {
    const result = await client.call({ to: HISTORICAL_QUOTER, data, blockNumber });
    if (!result.data) return { fee, pool, executable: false, reason: 'EMPTY_RETURN_DATA' };
    const decoded = decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactOutputSingle', data: result.data });
    const amountIn = decoded[0];
    if (amountIn <= 0n) return { fee, pool, executable: false, reason: 'ZERO_AMOUNT_IN' };
    return { fee, pool, executable: true, amountIn };
  } catch (error) {
    if (isEconomicRevert(error)) return { fee, pool, executable: false, reason: 'EVM_REVERT' };
    throw error;
  }
}

async function testCalibration(blockNumber, notionals) {
  const rows = [];
  for (const amountOut of notionals) {
    const tierResults = [];
    for (const fee of FEE_TIERS) tierResults.push(await quoteTier({ blockNumber, fee, amountOut }));
    const executable = tierResults.filter((r) => r.executable).sort((a, b) => a.amountIn < b.amountIn ? -1 : a.amountIn > b.amountIn ? 1 : 0);
    rows.push({
      usdt0AmountOut: amountOut,
      executable: executable.length > 0,
      best: executable[0] ?? null,
      tiers: tierResults
    });
  }
  return { fullLadderExecutable: rows.every((r) => r.executable), notionals: rows };
}

const chainId = await client.getChainId();
if (chainId !== 57073) throw new Error(`CHAIN_ID_MISMATCH:${chainId}`);

const launches = await discoverLaunches();
const usdt0Decimals = Number(await client.readContract({
  address: USDT0,
  abi: erc20DecimalsAbi,
  functionName: 'decimals',
  blockNumber: FROM_BLOCK
}));
const unit = 10n ** BigInt(usdt0Decimals);
const notionals = [unit / 4n, unit / 2n, unit, unit * 2n, unit * 5n];

const results = [];
for (let i = 0; i < launches.length; i += 1) {
  const launch = launches[i];
  const decisionBlock = launch.blockNumber + DECISION_DELAY_BLOCKS;
  const market = await positionBase(launch);
  let calibration;
  let calibrationComparable;
  let classificationReason;

  if (market.structuralError) {
    calibration = null;
    calibrationComparable = false;
    classificationReason = market.structuralError;
  } else if (lower(market.baseToken) === lower(USDT0)) {
    calibration = { fullLadderExecutable: true, mode: 'USDT0_NOMINAL_PEG_V0', notionals: [] };
    calibrationComparable = true;
    classificationReason = 'USDT0_BASE_NO_WETH_CALIBRATION_REQUIRED';
  } else if (lower(market.baseToken) === lower(WETH)) {
    calibration = await testCalibration(decisionBlock, notionals);
    calibrationComparable = calibration.fullLadderExecutable;
    classificationReason = calibrationComparable ? 'WETH_USDT0_FULL_LADDER_EXECUTABLE' : 'WETH_USDT0_FULL_LADDER_UNAVAILABLE';
  } else {
    calibration = null;
    calibrationComparable = false;
    classificationReason = 'OTHER_BASE_UNSUPPORTED_BY_FROZEN_CALIBRATION_CONTRACT';
  }

  results.push({
    ordinal: i + 1,
    event: launch.event,
    launchBlock: launch.blockNumber,
    decisionBlock,
    transactionHash: launch.transactionHash,
    logIndex: launch.logIndex,
    tokenId: launch.tokenId,
    token: launch.token,
    symbol: launch.symbol,
    baseToken: market.baseToken,
    launchPoolFee: market.poolFee,
    calibrationComparable,
    classificationReason,
    calibration
  });
}

const comparable = results.filter((r) => r.calibrationComparable);
const firstComparable = comparable[0] ?? null;
const postBoundaryFailures = firstComparable
  ? results.filter((r) => r.decisionBlock >= firstComparable.decisionBlock && !r.calibrationComparable)
  : [];

const windows = [];
let active = null;
for (const row of results) {
  if (row.calibrationComparable && !active) active = { startOrdinal: row.ordinal, startDecisionBlock: row.decisionBlock, endOrdinal: row.ordinal, endDecisionBlock: row.decisionBlock, count: 1 };
  else if (row.calibrationComparable && active) { active.endOrdinal = row.ordinal; active.endDecisionBlock = row.decisionBlock; active.count += 1; }
  else if (!row.calibrationComparable && active) { windows.push(active); active = null; }
}
if (active) windows.push(active);

const receipt = {
  schema: 'historical-calibration-epoch-discovery-r1/v1',
  status: 'DISCOVERY_ONLY_NO_REPLAY_AUTHORITY',
  providerOrigin: new URL(RPC_URL).origin,
  chainId,
  sourceRange: { fromBlock: FROM_BLOCK, toBlock: TO_BLOCK, expectedLaunches: EXPECTED_LAUNCHES, observedLaunches: launches.length },
  frozenContract: {
    decisionDelayBlocks: DECISION_DELAY_BLOCKS,
    weth: WETH,
    usdt0: USDT0,
    usdt0Decimals,
    feeTiers: FEE_TIERS,
    usdNotionalLabels: ['$0.25', '$0.50', '$1', '$2', '$5'],
    usdt0ExactOutputAmounts: notionals,
    historicalNpm: HISTORICAL_NPM,
    historicalFactory: HISTORICAL_FACTORY,
    historicalQuoterV2: HISTORICAL_QUOTER
  },
  summary: {
    launchesTested: results.length,
    calibrationComparable: comparable.length,
    calibrationNotComparable: results.length - comparable.length,
    firstComparable: firstComparable ? {
      ordinal: firstComparable.ordinal,
      launchBlock: firstComparable.launchBlock,
      decisionBlock: firstComparable.decisionBlock,
      tokenId: firstComparable.tokenId,
      token: firstComparable.token
    } : null,
    monotonicFromFirstComparable: firstComparable ? postBoundaryFailures.length === 0 : false,
    postBoundaryFailureCount: postBoundaryFailures.length,
    comparableWindows: windows
  },
  results
};

writeFileSync(OUTPUT_PATH, `${json(receipt)}\n`);
console.log(json(receipt.summary));
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
