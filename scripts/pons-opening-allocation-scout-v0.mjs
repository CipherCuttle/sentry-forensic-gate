// Manual-only, read-only opening-allocation receipt attestation for an exact known tx.
// Input via environment avoids accidental wallet/private-key surfaces. Never logs RPC URL.
import assert from 'node:assert/strict';
import {
  createPublicClient, decodeEventLog, defineChain, getAddress, http, keccak256
} from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY, DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID, ponsV2FactoryReadAbi, ponsV2TokenLaunchedEvent
} from '../dist/index.js';
import {
  attestPonsV2OpeningAllocation, PONS_V2_FACTORY_FORWARDER_ABI,
  PONS_V2_TOTAL_SUPPLY_ABI
} from './pons-opening-allocation-core-v0.mjs';

const transactionHash = process.env.PONS_OPENING_TX_HASH;
const tokenFilter = process.env.PONS_OPENING_TOKEN;
const rpcUrl = process.env.PONS_OPENING_RPC_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
assert.match(transactionHash ?? '', /^0x[0-9a-fA-F]{64}$/, 'PONS_OPENING_TX_HASH_REQUIRED');
if (tokenFilter) getAddress(tokenFilter);
assert.ok(/^https:\/\//i.test(rpcUrl), 'RPC_MUST_BE_HTTPS');

const chain = defineChain({
  id: ROBINHOOD_CHAIN_ID, name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } }
});
const client = createPublicClient({
  chain, transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 })
});
const same = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  a.toLowerCase() === b.toLowerCase();
const factory = CURRENT_PONS_V2_AUTHORITY.factory;

async function main() {
  assert.equal(await client.getChainId(), ROBINHOOD_CHAIN_ID, 'WRONG_CHAIN');
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: transactionHash }),
    client.getTransactionReceipt({ hash: transactionHash })
  ]);
  assert.equal(receipt.status, 'success', 'LAUNCH_TX_REVERTED');
  assert.equal(receipt.blockNumber, tx.blockNumber, 'TX_RECEIPT_HEIGHT_MISMATCH');
  const block = await client.getBlock({ blockNumber: tx.blockNumber });
  assert.equal(block.hash?.toLowerCase(), receipt.blockHash.toLowerCase(), 'LAUNCH_REORG');
  assert.ok(block.number >= CURRENT_PONS_V2_AUTHORITY.fromBlock, 'BEFORE_REVIEWED_FACTORY_EPOCH');
  if (CURRENT_PONS_V2_AUTHORITY.throughBlock !== undefined) {
    assert.ok(block.number <= CURRENT_PONS_V2_AUTHORITY.throughBlock, 'AFTER_REVIEWED_FACTORY_EPOCH');
  }

  const code = await client.getBytecode({ address: factory, blockNumber: block.number });
  assert.ok(code && code !== '0x', 'REVIEWED_FACTORY_CODE_MISSING');
  assert.equal(keccak256(code).toLowerCase(),
    CURRENT_PONS_V2_AUTHORITY.factoryRuntimeCodeHash.toLowerCase(), 'FACTORY_CODE_HASH_DRIFT');

  const matching = [];
  for (const log of receipt.logs) {
    if (!same(log.address, factory)) continue;
    try {
      const decoded = decodeEventLog({
        abi: [ponsV2TokenLaunchedEvent], data: log.data, topics: log.topics, strict: true
      });
      if (decoded.eventName !== 'TokenLaunched') continue;
      if (tokenFilter && !same(decoded.args.token, tokenFilter)) continue;
      matching.push({ ...log, args: decoded.args });
    } catch { /* Not TokenLaunched. */ }
  }
  assert.equal(matching.length, 1, 'NEED_EXACTLY_ONE_REVIEWED_TOKEN_LAUNCH_IN_TX');
  const launchLog = matching[0];
  const [forwarder, factoryRecord, totalSupply] = await Promise.all([
    client.readContract({
      address: factory, abi: PONS_V2_FACTORY_FORWARDER_ABI,
      functionName: 'launchForwarder', blockNumber: block.number
    }),
    client.readContract({
      address: factory, abi: ponsV2FactoryReadAbi, functionName: 'getLaunchedToken',
      args: [launchLog.args.token], blockNumber: block.number
    }),
    client.readContract({
      address: launchLog.args.token, abi: PONS_V2_TOTAL_SUPPLY_ABI,
      functionName: 'totalSupply', blockNumber: block.number
    })
  ]);
  const blockAfter = await client.getBlock({ blockNumber: block.number });
  assert.equal(blockAfter.hash?.toLowerCase(), block.hash.toLowerCase(), 'REORG_DURING_ATTESTATION');
  const result = attestPonsV2OpeningAllocation({
    transaction: tx, receipt, launchLog, factory, forwarder, factoryRecord, totalSupply
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch(error => {
  // Exception text can contain RPC credentials in transport errors. Never print it.
  process.stderr.write('PONS_OPENING_ATTESTATION_FAILED_CLOSED:' +
    (error instanceof Error ? error.name : 'UnknownError') + '\n');
  process.exitCode = 1;
});
