import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PonsLaunchArrivalLedger } from './pons-speed-arrival-core.mjs';

const H1 = '0x' + '1'.repeat(64);
const H2 = '0x' + '2'.repeat(64);
const TX = '0x' + '3'.repeat(64);
const TOKEN = '0x' + '4'.repeat(40);
const mkLog = (overrides = {}) => ({
  blockNumber: 123n,
  blockHash: H1,
  transactionHash: TX,
  logIndex: 0,
  args: { token: TOKEN },
  ...overrides
});

// Same event ID across two transports, comparable only within one process clock.
const comparison = new PonsLaunchArrivalLedger();
assert.equal(comparison.observe('WS', mkLog(), 100.2, 1_000).type, 'FIRST');
const matched = comparison.observe('HTTP', mkLog(), 112.7, 1_012);
assert.equal(matched.type, 'MATCHED');
assert.ok(Math.abs(matched.wsLeadMs - 12.5) < 0.01);
assert.equal(comparison.observe('WS', mkLog(), 119, 1_019).type, 'DUPLICATE');
const result = comparison.summary();
assert.equal(result.uniqueEventIds, 1);
assert.equal(result.pairedSameBlockHash, 1);
assert.equal(result.wsLeadMs.median, 12.5);
assert.equal(result.httpOnly, 0);
assert.equal(result.wsOnly, 0);

// No fake comparison when only one feed is configured or observed.
const lone = new PonsLaunchArrivalLedger();
lone.observe('HTTP', mkLog(), 10, 100);
assert.equal(lone.summary().wsLeadMs, null);
assert.equal(lone.summary().httpOnly, 1);

// Reorg evidence must not become a "faster" provider signal.
const fork = new PonsLaunchArrivalLedger();
fork.observe('WS', mkLog(), 10, 100);
assert.equal(fork.observe('HTTP', mkLog({ blockHash: H2 }), 12, 102).type, 'CONFLICT');
assert.equal(fork.summary().pairedSameBlockHash, 0);
assert.equal(fork.summary().conflictingForkEventIds, 2);
assert.equal(fork.summary().wsLeadMs, null);

// Removed notifications invalidate affected comparisons, including duplicates.
const removed = new PonsLaunchArrivalLedger();
removed.observe('WS', mkLog(), 10, 100);
removed.observe('HTTP', mkLog(), 12, 102);
assert.equal(removed.observe('WS', mkLog({ removed: true }), 15, 105).type, 'REMOVED');
assert.equal(removed.summary().pairedSameBlockHash, 0);
assert.equal(removed.summary().removedEventIds, 1);

// Source/identity validation and capacity boundary fail closed.
assert.throws(() => comparison.observe('FEED', mkLog(), 1, 1), /INVALID_SOURCE/);
assert.throws(() => comparison.observe('WS', mkLog({ blockHash: null }), 1, 1), /INVALID_BLOCK_HASH/);
assert.throws(() => comparison.observe('WS', mkLog({ logIndex: -1 }), 1, 1), /INCOMPLETE_EVENT_IDENTITY/);
const capped = new PonsLaunchArrivalLedger({ maxEvents: 1 });
capped.observe('HTTP', mkLog(), 1, 1);
assert.throws(() => capped.observe('HTTP', mkLog({ logIndex: 1 }), 2, 2), /EVENT_CAPACITY_EXCEEDED/);

// Neither the CLI nor its imported pure core may gain transaction authority.
const runtime = await readFile(new URL('./pons-speed-observer-v0.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('./pons-speed-arrival-core.mjs', import.meta.url), 'utf8');
assert.match(runtime, /createPublicClient/);
assert.match(runtime, /getLogs/);
assert.match(runtime, /watchContractEvent/);
assert.match(runtime, /getBytecode/);
assert.ok(runtime.includes("process.stdout.write('', () => process.exit(process.exitCode ?? 0))"), 'finite CLI must flush and close lingering WS');
assert.match(runtime, /source === 'HTTP' && \(result\.type === 'FIRST' \|\| result\.type === 'MATCHED'\)/);
assert.doesNotMatch(runtime + core,
  /\b(?:createWalletClient|privateKeyToAccount|sendTransaction|signTransaction|writeContract|sendRawTransaction|child_process|node:net|node:tls)\b/);
assert.match(runtime, /Nitro sequencer feed is NOT an eth_subscribe RPC endpoint/);
assert.match(runtime, /URL/); // Endpoint parameters are accepted but never emitted.
console.log('PONS_SPEED_OBSERVER_V0_OFFLINE_PASS: matched, partial, duplicate, fork, removal, cap, no-write boundary');
