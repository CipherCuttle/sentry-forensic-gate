import fs from 'node:fs';
import { createPublicClient, defineChain, http } from 'viem';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from '../dist/sentry/contracts.js';

const FIXTURE_PATH = 'fixtures/historical-compatibility-r1.json';
const DECISION_DELAY_BLOCKS = 2n;
const EXPECTED_REPRESENTATIVES = 9;
const ORACLE_CANDIDATES = [
  {
    id: 'EORACLE_ETH_USD',
    address: '0xdFc720E1ef024bfc768ed9E6F0e7Fc80E28f8CFA',
    documentedDecimals: 8,
  },
  {
    id: 'REDSTONE_ETH_USD',
    address: '0xe5867B1d421f0b52697F16e2ac437e87d66D5fbF',
    documentedDecimals: null,
  },
];

const aggregatorV3Abi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
];

if (process.env.SHADOW_ONLY !== 'true') {
  throw new Error('HISTORICAL_ORACLE_DISCOVERY_REQUIRES_SHADOW_ONLY_TRUE');
}

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain: ink, transport: http(rpcUrl) });
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
if (!Array.isArray(fixture.representatives) || fixture.representatives.length !== EXPECTED_REPRESENTATIVES) {
  throw new Error(`HISTORICAL_ORACLE_DISCOVERY_REPRESENTATIVE_COUNT:${fixture.representatives?.length ?? 'INVALID'}`);
}

const chainId = await client.getChainId();
if (chainId !== INK_CHAIN_ID) throw new Error(`INK_CHAIN_ID_DRIFT:expected=${INK_CHAIN_ID}:actual=${chainId}`);

const rows = [];
for (const representative of fixture.representatives) {
  const launchBlock = BigInt(representative.blockNumber);
  const decisionBlock = launchBlock + DECISION_DELAY_BLOCKS;
  const block = await client.getBlock({ blockNumber: decisionBlock });
  if (!block.hash) throw new Error(`HISTORICAL_ORACLE_DISCOVERY_BLOCK_HASH_MISSING:${decisionBlock}`);

  const candidates = [];
  for (const candidate of ORACLE_CANDIDATES) {
    const code = await client.getBytecode({ address: candidate.address, blockNumber: decisionBlock });
    const codePresent = Boolean(code && code !== '0x');
    if (!codePresent) {
      candidates.push({
        id: candidate.id,
        address: candidate.address,
        documentedDecimals: candidate.documentedDecimals,
        codePresent: false,
        decimals: null,
        description: null,
        version: null,
        latestRoundData: null,
        structurallyPointInTimeUsable: false,
        unusableReason: 'CODE_ABSENT_AT_DECISION_BLOCK',
      });
      continue;
    }

    const decimalsResult = await optionalEvmRead(() => client.readContract({
      address: candidate.address,
      abi: aggregatorV3Abi,
      functionName: 'decimals',
      blockNumber: decisionBlock,
    }));
    const descriptionResult = await optionalEvmRead(() => client.readContract({
      address: candidate.address,
      abi: aggregatorV3Abi,
      functionName: 'description',
      blockNumber: decisionBlock,
    }));
    const versionResult = await optionalEvmRead(() => client.readContract({
      address: candidate.address,
      abi: aggregatorV3Abi,
      functionName: 'version',
      blockNumber: decisionBlock,
    }));
    const roundResult = await optionalEvmRead(() => client.readContract({
      address: candidate.address,
      abi: aggregatorV3Abi,
      functionName: 'latestRoundData',
      blockNumber: decisionBlock,
    }));

    let latestRoundData = null;
    let structurallyPointInTimeUsable = false;
    let unusableReason = null;
    if (!roundResult.ok) {
      unusableReason = `LATEST_ROUND_DATA_UNAVAILABLE:${roundResult.error}`;
    } else {
      const [roundId, answer, startedAt, updatedAt, answeredInRound] = roundResult.value;
      const blockTimestamp = block.timestamp;
      const positiveAnswer = answer > 0n;
      const nonzeroUpdatedAt = updatedAt > 0n;
      const notFromFuture = updatedAt <= blockTimestamp;
      const ageSeconds = nonzeroUpdatedAt && notFromFuture ? blockTimestamp - updatedAt : null;
      structurallyPointInTimeUsable = positiveAnswer && nonzeroUpdatedAt && notFromFuture;
      if (!positiveAnswer) unusableReason = 'NON_POSITIVE_ANSWER';
      else if (!nonzeroUpdatedAt) unusableReason = 'UPDATED_AT_ZERO';
      else if (!notFromFuture) unusableReason = 'UPDATED_AT_AFTER_DECISION_BLOCK';
      latestRoundData = {
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
        decisionBlockTimestamp: blockTimestamp,
        ageSeconds,
        positiveAnswer,
        nonzeroUpdatedAt,
        notFromFuture,
      };
    }

    candidates.push({
      id: candidate.id,
      address: candidate.address,
      documentedDecimals: candidate.documentedDecimals,
      codePresent: true,
      decimals: decimalsResult.ok ? Number(decimalsResult.value) : null,
      decimalsError: decimalsResult.ok ? null : decimalsResult.error,
      description: descriptionResult.ok ? String(descriptionResult.value) : null,
      descriptionError: descriptionResult.ok ? null : descriptionResult.error,
      version: versionResult.ok ? versionResult.value : null,
      versionError: versionResult.ok ? null : versionResult.error,
      latestRoundData,
      structurallyPointInTimeUsable,
      unusableReason,
    });
  }

  rows.push({
    implementation: representative.implementation,
    launchBlock,
    tokenId: representative.tokenId,
    decisionBlock,
    decisionBlockHash: block.hash,
    decisionBlockTimestamp: block.timestamp,
    candidates,
  });
}

const coverage = Object.fromEntries(ORACLE_CANDIDATES.map((candidate) => {
  const candidateRows = rows.map((row) => row.candidates.find((item) => item.id === candidate.id));
  return [candidate.id, {
    codePresent: candidateRows.filter((item) => item?.codePresent).length,
    structurallyPointInTimeUsable: candidateRows.filter((item) => item?.structurallyPointInTimeUsable).length,
    agesSeconds: candidateRows
      .map((item) => item?.latestRoundData?.ageSeconds ?? null)
      .filter((value) => value !== null),
  }];
}));

const receipt = {
  schema: 'historical-baseline-policy-r1-oracle-discovery/v1',
  phase: 'HISTORICAL_BASELINE_POLICY_R1',
  stage: 'POINT_IN_TIME_ETH_USD_ORACLE_AVAILABILITY',
  sourceMode: 'LIVE_ARCHIVE_RPC_POINT_IN_TIME',
  shadowOnly: true,
  freshnessThresholdSelected: false,
  policyCandidateSelected: false,
  representativesAttempted: rows.length,
  decisionDelayBlocks: DECISION_DELAY_BLOCKS,
  candidates: ORACLE_CANDIDATES,
  coverage,
  rows,
  verdict: rows.length === EXPECTED_REPRESENTATIVES ? 'DISCOVERY_COMPLETE' : 'DISCOVERY_INCOMPLETE',
};

console.log(JSON.stringify(jsonSafe(receipt), null, 2));
if (rows.length !== EXPECTED_REPRESENTATIVES) process.exitCode = 1;

async function optionalEvmRead(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (isEvmRevert(error)) return { ok: false, error: stableError(error) };
    throw error;
  }
}

function isEvmRevert(error) {
  let current = error;
  for (let depth = 0; depth < 10 && current && typeof current === 'object'; depth += 1) {
    const name = typeof current.name === 'string' ? current.name : '';
    const message = typeof current.message === 'string' ? current.message.toLowerCase() : '';
    if (
      name === 'ExecutionRevertedError' ||
      name === 'ContractFunctionRevertedError' ||
      message.includes('execution reverted') ||
      message.includes('reverted')
    ) return true;
    current = current.cause;
  }
  return false;
}

function stableError(error) {
  return (error instanceof Error ? `${error.name}:${error.message}` : String(error)).replace(/\s+/g, ' ').slice(0, 512);
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
