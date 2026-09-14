import fs from 'node:fs';
import { createPublicClient, http } from 'viem';

const INK_CHAIN_ID = 57073;
const RPC_URL = process.env.INK_RPC_URL ?? 'https://rpc-qnd.inkonchain.com';
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'historical-outcome-policy-r1-oracle-discovery.json';
const REDSTONE_ETH_USD = '0xe5867B1d421f0b52697F16e2ac437e87d66D5fbF';
const EXPECTED_DECIMALS = 8;
const EXPECTED_DESCRIPTION = 'RedStone Price Feed for ETH';
const EXPECTED_VERSION = 1n;
const OBSERVED_BLOCKS = [
  40029876n,
  40118660n,
  42146879n,
  44224383n,
  45720972n,
  45900260n,
  46697772n,
  46723560n,
  46753934n,
];

if (process.env.SHADOW_ONLY !== 'true') {
  throw new Error('HISTORICAL_OUTCOME_POLICY_REQUIRES_SHADOW_ONLY_TRUE');
}

const aggregatorV3Abi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
];

const client = createPublicClient({ transport: http(RPC_URL) });
const chainId = await client.getChainId();
if (chainId !== INK_CHAIN_ID) throw new Error(`INK_CHAIN_ID_DRIFT:expected=${INK_CHAIN_ID}:actual=${chainId}`);

const rows = [];
for (const blockNumber of OBSERVED_BLOCKS) {
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) throw new Error(`MISSING_BLOCK_HASH:${blockNumber}`);

  const code = await client.getBytecode({ address: REDSTONE_ETH_USD, blockNumber });
  if (!code || code === '0x') {
    rows.push({
      blockNumber,
      blockHash: block.hash,
      blockTimestamp: block.timestamp,
      codePresent: false,
      structurallyPointInTimeUsable: false,
      unusableReason: 'REDSTONE_CODE_MISSING',
    });
    continue;
  }

  // Read failures escape intentionally. A provider/transport/ABI failure is not
  // allowed to masquerade as historical market evidence.
  const [decimalsRaw, description, version, roundData] = await Promise.all([
    client.readContract({ address: REDSTONE_ETH_USD, abi: aggregatorV3Abi, functionName: 'decimals', blockNumber }),
    client.readContract({ address: REDSTONE_ETH_USD, abi: aggregatorV3Abi, functionName: 'description', blockNumber }),
    client.readContract({ address: REDSTONE_ETH_USD, abi: aggregatorV3Abi, functionName: 'version', blockNumber }),
    client.readContract({ address: REDSTONE_ETH_USD, abi: aggregatorV3Abi, functionName: 'latestRoundData', blockNumber }),
  ]);

  const decimals = Number(decimalsRaw);
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = roundData;
  const metadataOk = decimals === EXPECTED_DECIMALS
    && description === EXPECTED_DESCRIPTION
    && version === EXPECTED_VERSION;
  const timeOk = answer > 0n && updatedAt > 0n && updatedAt <= block.timestamp;
  const usable = metadataOk && timeOk;

  rows.push({
    blockNumber,
    blockHash: block.hash,
    blockTimestamp: block.timestamp,
    codePresent: true,
    decimals,
    description,
    version,
    latestRoundData: {
      roundId,
      answer,
      startedAt,
      updatedAt,
      answeredInRound,
      ageSeconds: updatedAt <= block.timestamp ? block.timestamp - updatedAt : null,
      positiveAnswer: answer > 0n,
      nonzeroUpdatedAt: updatedAt > 0n,
      notFromFuture: updatedAt <= block.timestamp,
    },
    structurallyPointInTimeUsable: usable,
    ...(usable ? {} : { unusableReason: structuralReason(decimals, description, version, answer, updatedAt, block.timestamp) }),
  });
}

const usableCount = rows.filter((row) => row.structurallyPointInTimeUsable).length;
const receipt = {
  schema: 'historical-outcome-policy-r1-oracle-discovery/v1',
  phase: 'HISTORICAL_OUTCOME_POLICY_R1',
  stage: 'POINT_IN_TIME_REDSTONE_AT_EXACT_24H_BLOCKS',
  sourceMode: 'LIVE_ARCHIVE_RPC_POINT_IN_TIME',
  shadowOnly: true,
  freshnessThresholdSelected: false,
  outcomePolicySelected: false,
  representativesAttempted: rows.length,
  outcomeHorizonMs: 86_400_000,
  candidate: {
    id: 'REDSTONE_ETH_USD',
    address: REDSTONE_ETH_USD,
    requiredDecimals: EXPECTED_DECIMALS,
    requiredDescription: EXPECTED_DESCRIPTION,
    requiredVersion: EXPECTED_VERSION,
  },
  coverage: {
    codePresent: rows.filter((row) => row.codePresent).length,
    structurallyPointInTimeUsable: usableCount,
    agesSeconds: rows
      .map((row) => row.latestRoundData?.ageSeconds)
      .filter((age) => age !== undefined && age !== null),
  },
  rows,
  verdict: 'DISCOVERY_COMPLETE',
};

const serialized = `${JSON.stringify(jsonSafe(receipt), null, 2)}\n`;
fs.writeFileSync(OUTPUT_PATH, serialized, 'utf8');
process.stdout.write(serialized);
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
if (rows.length !== OBSERVED_BLOCKS.length) process.exitCode = 1;

function structuralReason(decimals, description, version, answer, updatedAt, blockTimestamp) {
  if (decimals !== EXPECTED_DECIMALS) return `REDSTONE_DECIMALS_DRIFT:${decimals}`;
  if (description !== EXPECTED_DESCRIPTION) return `REDSTONE_DESCRIPTION_DRIFT:${description}`;
  if (version !== EXPECTED_VERSION) return `REDSTONE_VERSION_DRIFT:${version}`;
  if (answer <= 0n) return 'REDSTONE_NONPOSITIVE_ANSWER';
  if (updatedAt <= 0n) return 'REDSTONE_ZERO_UPDATED_AT';
  if (updatedAt > blockTimestamp) return 'REDSTONE_FUTURE_UPDATE';
  return 'REDSTONE_STRUCTURAL_FAILURE';
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
