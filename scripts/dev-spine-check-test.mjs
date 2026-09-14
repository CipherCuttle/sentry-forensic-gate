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
  mutated.authorization[key] = !mutated.authorization[key];
  assert.throws(
    () => validatePacket(mutated),
    new RegExp(`requires authorization\\.${key}=`),
    `${key} drift must fail closed in the current phase state`,
  );
}

const preImplementation = structuredClone(packet);
preImplementation.state = 'NEXT_AWAITING_IMPLEMENTATION_PROMPT';
preImplementation.authorization.historical_compatibility_implementation = false;
validatePacket(preImplementation);

const unauthorizedPreImplementation = structuredClone(preImplementation);
unauthorizedPreImplementation.authorization.historical_compatibility_implementation = true;
assert.throws(
  () => validatePacket(unauthorizedPreImplementation),
  /requires authorization\.historical_compatibility_implementation=false/,
  'pre-implementation state must reject implementation authority',
);

const unknownState = structuredClone(packet);
unknownState.state = 'FUTURE_UNREVIEWED_STATE';
assert.throws(
  () => validatePacket(unknownState),
  /unsupported phase state/,
  'unreviewed future states must fail closed',
);

console.log('DEV_SPINE_CHECK_TEST=PASS');
