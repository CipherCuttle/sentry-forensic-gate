import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_COMPATIBILITY_R1.json';
const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));

validatePacket(packet);

for (const key of [
  'historical_compatibility_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'merge',
]) {
  const mutated = structuredClone(packet);
  mutated.authorization[key] = true;
  assert.throws(
    () => validatePacket(mutated),
    new RegExp(`cannot authorize ${key}`),
    `${key}=true must fail closed in the current phase state`,
  );
}

const unknownState = structuredClone(packet);
unknownState.state = 'FUTURE_UNREVIEWED_STATE';
assert.throws(
  () => validatePacket(unknownState),
  /unsupported phase state/,
  'unreviewed future states must fail closed',
);

console.log('DEV_SPINE_CHECK_TEST=PASS');
