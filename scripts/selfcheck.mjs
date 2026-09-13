import assert from 'node:assert/strict';
import { canonicalJson, evaluateHardGate, MemoryStore, policyDigest } from '../dist/index.js';

assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');

assert.deepEqual(evaluateHardGate({
  canonicalLaunch: true,
  poolResolved: true,
  infrastructureMatches: true,
  entryExecutable: true,
  reverseExitExecutable: true,
  contradictoryChainState: false
}), { state: 'PASS', reasons: [] });

assert.equal(evaluateHardGate({
  canonicalLaunch: true,
  poolResolved: true,
  infrastructureMatches: true,
  entryExecutable: true,
  reverseExitExecutable: false,
  contradictoryChainState: false
}).state, 'REJECT');

assert.equal(evaluateHardGate({
  canonicalLaunch: true,
  poolResolved: null,
  infrastructureMatches: true,
  entryExecutable: true,
  reverseExitExecutable: true,
  contradictoryChainState: false
}).state, 'UNVERIFIED');

const store = new MemoryStore();
const launch = {
  chainId: 57073,
  blockNumber: 1n,
  blockHash: '0x01',
  observedAtMs: 1,
  launchId: 'launch-1',
  eventId: 'event-1',
  factory: '0x01',
  txHash: '0x02',
  logIndex: 0,
  token: '0x03',
  creator: '0x04',
  tokenId: 1n,
  name: 'Test',
  symbol: 'TEST',
  launchType: 'STANDARD',
  sourceEvent: 'TokenDeployed'
};
assert.equal(await store.putLaunch(launch), 'INSERTED');
assert.equal(await store.putLaunch(launch), 'DUPLICATE');
assert.equal((await policyDigest()).length, 64);

console.log('selfcheck: PASS');
