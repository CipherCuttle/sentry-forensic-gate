import { encodeFunctionData, decodeFunctionResult } from 'viem';
import { ponsV2CurveQuoteReadAbi } from '../dist/index.js';

const chainId = 4663;
const priorLaunchBlock = 64_935_682n;
const decisionBlock = priorLaunchBlock + 2n;
const curve = '0x918cc3734621d966995d2663dcf587ce0d4768fc';
const blockTag = '0x' + decisionBlock.toString(16);
const getReservesData = encodeFunctionData({
  abi: ponsV2CurveQuoteReadAbi,
  functionName: 'getReserves'
});

const endpoints = [
  {
    name: 'ROBINHOOD_PUBLIC',
    url: 'https://rpc.mainnet.chain.robinhood.com'
  },
  {
    name: 'BLOCKREQ_PUBLIC',
    url: 'https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public'
  },
  {
    name: 'TRIPORT_PUBLIC',
    url: 'https://triport.io/rpc/robinhood/public'
  },
  {
    name: 'PUBLICNODE',
    url: 'https://robinhood-rpc.publicnode.com'
  },
  {
    name: 'ALCHEMY_DOCS_DEMO',
    url: 'https://robinhood-mainnet.g.alchemy.com/v2/docs-demo'
  }
];

const results = [];
for (const endpoint of endpoints) {
  const result = {
    name: endpoint.name,
    url: endpoint.url,
    chainId: null,
    blockHeader: false,
    factoryCode: false,
    curveCode: false,
    historicalCall: false,
    reserves: null,
    errors: []
  };
  try {
    const chain = await rpc(endpoint.url, 'eth_chainId', []);
    result.chainId = Number(BigInt(chain));
    if (result.chainId !== chainId) {
      throw new Error(`CHAIN_ID_MISMATCH:${result.chainId}`);
    }
  } catch (error) {
    result.errors.push(stable(error));
  }

  try {
    const block = await rpc(endpoint.url, 'eth_getBlockByNumber', [blockTag, false]);
    result.blockHeader = Boolean(
      block &&
      typeof block.hash === 'string' &&
      BigInt(block.number) === decisionBlock
    );
    if (!result.blockHeader) throw new Error('HISTORICAL_BLOCK_HEADER_INVALID');
  } catch (error) {
    result.errors.push(stable(error));
  }

  try {
    const code = await rpc(endpoint.url, 'eth_getCode', [
      '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
      blockTag
    ]);
    result.factoryCode = typeof code === 'string' && code.length > 2;
    if (!result.factoryCode) throw new Error('HISTORICAL_FACTORY_CODE_MISSING');
  } catch (error) {
    result.errors.push(stable(error));
  }

  try {
    const code = await rpc(endpoint.url, 'eth_getCode', [curve, blockTag]);
    result.curveCode = typeof code === 'string' && code.length > 2;
    if (!result.curveCode) throw new Error('HISTORICAL_CURVE_CODE_MISSING');
  } catch (error) {
    result.errors.push(stable(error));
  }

  try {
    const data = await rpc(endpoint.url, 'eth_call', [
      { to: curve, data: getReservesData },
      blockTag
    ]);
    const decoded = decodeFunctionResult({
      abi: ponsV2CurveQuoteReadAbi,
      functionName: 'getReserves',
      data
    });
    const reserves = Array.isArray(decoded) ? decoded : [decoded];
    result.reserves = reserves.map((value) => value.toString());
    result.historicalCall =
      result.reserves.length === 2 &&
      result.reserves.every((value) => BigInt(value) >= 0n);
    if (!result.historicalCall) throw new Error('HISTORICAL_GET_RESERVES_INVALID');
  } catch (error) {
    result.errors.push(stable(error));
  }

  result.pass =
    result.chainId === chainId &&
    result.blockHeader &&
    result.factoryCode &&
    result.curveCode &&
    result.historicalCall;
  results.push(result);
}

const passing = results.filter((result) => result.pass);
console.log(JSON.stringify({
  verdict: passing.length > 0
    ? 'ROBINHOOD_ARCHIVE_CAPABILITY_FOUND'
    : 'ROBINHOOD_ARCHIVE_CAPABILITY_NOT_FOUND',
  mode: 'READ_ONLY',
  priorLaunchBlock: priorLaunchBlock.toString(),
  decisionBlock: decisionBlock.toString(),
  curve,
  passing: passing.map((result) => result.name),
  results
}, null, 2));

if (passing.length === 0) process.exitCode = 1;

async function rpc(url, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'sentry-forensic-gate-m2h-archive-probe/1'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params
      }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}:${text.slice(0, 300)}`);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`INVALID_JSON:${text.slice(0, 300)}`);
    }
    if (body.error) {
      throw new Error(
        `RPC_${body.error.code}:${String(body.error.message)}:${JSON.stringify(body.error.data ?? null).slice(0, 300)}`
      );
    }
    if (!('result' in body)) throw new Error('RPC_RESULT_MISSING');
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

function stable(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
