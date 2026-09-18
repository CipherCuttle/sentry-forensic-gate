import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeFunctionResult } from 'viem';
import { ponsV2CurveQuoteReadAbi } from '../dist/index.js';

const chainId = 4663;
const priorLaunchBlock = 64_935_682n;
const decisionBlock = priorLaunchBlock + 2n;
const curve = '0x918cc3734621d966995d2663dcf587ce0d4768fc';
const evidenceDir =
  process.env.PONS_ARCHIVE_PROBE_DIR ?? 'artifacts/pons-v2-archive-probe';

const manifest = await readJson(path.join(evidenceDir, 'manifest.json'));
assertManifest(manifest);

const results = [];
for (const provider of manifest.providers) {
  const result = {
    name: provider.name,
    configured: Boolean(provider.configured),
    chainId: null,
    blockHeader: false,
    factoryCode: false,
    curveCode: false,
    historicalCall: false,
    reserves: null,
    errors: []
  };

  evaluateRpcFile(
    result,
    await readJson(path.join(evidenceDir, provider.directory, 'chainId.json')),
    (value) => {
      result.chainId = Number(BigInt(value));
      if (result.chainId !== chainId) {
        throw new Error(`CHAIN_ID_MISMATCH:${result.chainId}`);
      }
    }
  );

  evaluateRpcFile(
    result,
    await readJson(path.join(evidenceDir, provider.directory, 'block.json')),
    (block) => {
      result.blockHeader = Boolean(
        block &&
        typeof block.hash === 'string' &&
        typeof block.number === 'string' &&
        BigInt(block.number) === decisionBlock
      );
      if (!result.blockHeader) throw new Error('HISTORICAL_BLOCK_HEADER_INVALID');
    }
  );

  evaluateRpcFile(
    result,
    await readJson(path.join(evidenceDir, provider.directory, 'factoryCode.json')),
    (code) => {
      result.factoryCode = typeof code === 'string' && code.length > 2;
      if (!result.factoryCode) throw new Error('HISTORICAL_FACTORY_CODE_MISSING');
    }
  );

  evaluateRpcFile(
    result,
    await readJson(path.join(evidenceDir, provider.directory, 'curveCode.json')),
    (code) => {
      result.curveCode = typeof code === 'string' && code.length > 2;
      if (!result.curveCode) throw new Error('HISTORICAL_CURVE_CODE_MISSING');
    }
  );

  evaluateRpcFile(
    result,
    await readJson(path.join(evidenceDir, provider.directory, 'getReserves.json')),
    (data) => {
      if (typeof data !== 'string' || !/^0x[0-9a-fA-F]+$/.test(data)) {
        throw new Error('HISTORICAL_GET_RESERVES_RESULT_INVALID');
      }
      const decoded = decodeFunctionResult({
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'getReserves',
        data
      });
      const values = Array.isArray(decoded) ? decoded : [decoded];
      result.reserves = values.map((value) => value.toString());
      result.historicalCall =
        result.reserves.length === 2 &&
        result.reserves.every((value) => BigInt(value) >= 0n);
      if (!result.historicalCall) {
        throw new Error('HISTORICAL_GET_RESERVES_INVALID');
      }
    }
  );

  result.pass =
    result.chainId === chainId &&
    result.blockHeader &&
    result.factoryCode &&
    result.curveCode &&
    result.historicalCall;
  results.push(result);
}

const passing = results.filter((result) => result.pass);
const output = {
  verdict: passing.length > 0
    ? 'ROBINHOOD_ARCHIVE_CAPABILITY_FOUND'
    : 'ROBINHOOD_ARCHIVE_CAPABILITY_NOT_FOUND',
  mode: 'READ_ONLY_LOCAL_EVALUATION',
  priorLaunchBlock: priorLaunchBlock.toString(),
  decisionBlock: decisionBlock.toString(),
  curve,
  configuredArchivePresent: manifest.providers.some(
    (provider) => provider.name === 'CONFIGURED_ARCHIVE' && provider.configured
  ),
  passing: passing.map((result) => result.name),
  results
};
console.log(JSON.stringify(output, null, 2));

if (passing.length === 0) process.exitCode = 1;

function evaluateRpcFile(result, envelope, inspect) {
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    typeof envelope.httpStatus !== 'number'
  ) {
    result.errors.push('ACQUISITION_ENVELOPE_INVALID');
    return;
  }
  if (envelope.httpStatus < 200 || envelope.httpStatus >= 300) {
    result.errors.push(
      `HTTP_${envelope.httpStatus}:${String(envelope.bodyText ?? '').slice(0, 300)}`
    );
    return;
  }

  const body = envelope.body;
  if (!body || typeof body !== 'object') {
    result.errors.push('RPC_BODY_INVALID');
    return;
  }
  if (body.error) {
    result.errors.push(
      `RPC_${body.error.code}:${String(body.error.message)}:${JSON.stringify(
        body.error.data ?? null
      ).slice(0, 300)}`
    );
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'result')) {
    result.errors.push('RPC_RESULT_MISSING');
    return;
  }

  try {
    inspect(body.result);
  } catch (error) {
    result.errors.push(stable(error));
  }
}

function assertManifest(manifest) {
  if (
    !manifest ||
    manifest.schema !== 'ROBINHOOD_ARCHIVE_CAPABILITY_ACQUISITION_R1' ||
    manifest.chainId !== chainId ||
    BigInt(manifest.decisionBlock) !== decisionBlock ||
    String(manifest.curve).toLowerCase() !== curve.toLowerCase() ||
    !Array.isArray(manifest.providers) ||
    manifest.providers.length < 5
  ) {
    throw new Error('ROBINHOOD_ARCHIVE_PROBE_MANIFEST_INVALID');
  }
  const names = new Set(manifest.providers.map((provider) => provider.name));
  for (const required of [
    'ROBINHOOD_PUBLIC',
    'BLOCKREQ_PUBLIC',
    'TRIPORT_PUBLIC',
    'PUBLICNODE',
    'ALCHEMY_DOCS_DEMO'
  ]) {
    if (!names.has(required)) {
      throw new Error(`ROBINHOOD_ARCHIVE_PROBE_PROVIDER_MISSING:${required}`);
    }
  }
}

async function readJson(file) {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw);
}

function stable(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
