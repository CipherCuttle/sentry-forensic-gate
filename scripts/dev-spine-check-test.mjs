import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_BASELINE_POLICY_R1.json';
const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));

validatePacket(packet);

for (const key of [
  'historical_compatibility_implementation',
  'historical_baseline_policy_discovery',
  'historical_baseline_policy_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'merge',
]) {
  const mutated = structuredClone(packet);
  mutated.authorization[key] = !mutated.authorization[key];
  assert.throws(
    () => validatePacket(mutated),
    new RegExp(`requires authorization\\.${key}=`),
    `${key} drift must fail closed in the active discovery state`,
  );
}

const unknownState = structuredClone(packet);
unknownState.state = 'FUTURE_UNREVIEWED_STATE';
assert.throws(
  () => validatePacket(unknownState),
  /unsupported phase state/,
  'unreviewed future states must fail closed',
);

const weakenedR3 = structuredClone(packet);
weakenedR3.authority.current_r3_behavior_must_remain_unchanged = false;
assert.throws(
  () => validatePacket(weakenedR3),
  /current R3 default invariant/,
  'current R3 default must remain frozen',
);

const changedNotionals = structuredClone(packet);
changedNotionals.acceptance.notionals_usd_micros = [100000, 250000, 500000, 1000000, 2000000];
assert.throws(
  () => validatePacket(changedNotionals),
  /frozen R1 notionals must remain exactly/,
  'discovery must not silently change the frozen R1 notional set',
);

console.log('DEV_SPINE_CHECK_TEST=PASS');
