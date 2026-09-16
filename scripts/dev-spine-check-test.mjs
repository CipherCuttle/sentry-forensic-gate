import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateFastVetAuthorization } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/FAST_VET_R0_AUTHORIZATION_R1.json', 'utf8'));
validateFastVetAuthorization(packet);

assert.equal(packet.state, 'FAST_VET_R0_AUTHORIZATION_PENDING_REVIEW');
assert.equal(packet.next_action, 'RUN_ONE_INDEPENDENT_HOSTILE_REVIEW');
for (const value of Object.values(packet.authorization)) assert.equal(value, false);
assert.equal(packet.frozen_smoke_rule.unknown_action, 'SKIP');
assert.equal(packet.frozen_smoke_rule.primary_notional_usd_micros, 1_000_000);
assert.equal(packet.frozen_smoke_rule.target_horizon_ms, 86_400_000);
assert.equal(packet.adapter_contract.old_sqlite_runner_authorized, false);
assert.equal(packet.acceptance.predecessor_github_provenance_must_be_runtime_verified, true);
assert.equal(packet.acceptance.normalized_rule_must_match_fetched_source_semantics, true);

const smoke = structuredClone(packet); smoke.authorization.fast_vet_smoke = true;
assert.throws(() => validateFastVetAuthorization(smoke), /authorization\.fast_vet_smoke=false/);
const broad = structuredClone(packet); broad.authorization.fast_vet = true;
assert.throws(() => validateFastVetAuthorization(broad), /authorization\.fast_vet=false/);
const live = structuredClone(packet); live.authorization.live_execution = true;
assert.throws(() => validateFastVetAuthorization(live), /authorization\.live_execution=false/);
const extra = structuredClone(packet); extra.authorization.fast_vet_magic = false;
assert.throws(() => validateFastVetAuthorization(extra), /authorization keyset drift/);
const source = structuredClone(packet); source.frozen_smoke_rule.source_head = '0'.repeat(40);
assert.throws(() => validateFastVetAuthorization(source), /frozen smoke source drift/);
const tuned = structuredClone(packet); tuned.frozen_smoke_rule.primary_notional_usd_micros = 2_000_000;
assert.throws(() => validateFastVetAuthorization(tuned), /smoke notional\/horizon drift/);
const horizon = structuredClone(packet); horizon.adapter_contract.target_horizon_ms = 7_200_000;
assert.throws(() => validateFastVetAuthorization(horizon), /adapter semantic boundary drift/);
const sqlite = structuredClone(packet); sqlite.adapter_contract.old_sqlite_runner_authorized = true;
assert.throws(() => validateFastVetAuthorization(sqlite), /SQLite runner must remain unauthorized/);
const prefilled = structuredClone(packet); prefilled.review_gate.initial_review_id = 1;
assert.throws(() => validateFastVetAuthorization(prefilled), /review evidence cannot be pre-filled/);
const premature = structuredClone(packet); premature.decision_result.status = 'AUTHORIZE_SMOKE';
assert.throws(() => validateFastVetAuthorization(premature), /decision result drift/);

console.log('DEV_SPINE_CHECK_TEST=PASS');
