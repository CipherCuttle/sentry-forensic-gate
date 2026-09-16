import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateHistoricalSmoke } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/FAST_VET_R0_HISTORICAL_SMOKE_R1.json', 'utf8'));
validateHistoricalSmoke(packet, { verifyFiles: false });
assert.equal(packet.authorization.fast_vet_smoke, true);
for (const key of ['historical_full_replay','fast_vet','fast_vet_osint','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge']) assert.equal(packet.authorization[key], false);

const broad = structuredClone(packet); broad.authorization.fast_vet = true;
assert.throws(() => validateHistoricalSmoke(broad, { verifyFiles: false }), /authorization\.fast_vet=false/);
const canary = structuredClone(packet); canary.authorization.canary = true;
assert.throws(() => validateHistoricalSmoke(canary, { verifyFiles: false }), /authorization\.canary=false/);
const smokeOff = structuredClone(packet); smokeOff.authorization.fast_vet_smoke = false;
assert.throws(() => validateHistoricalSmoke(smokeOff, { verifyFiles: false }), /authorization\.fast_vet_smoke=true/);
const tuned = structuredClone(packet); tuned.frozen_smoke_rule.primary_notional_usd_micros = 2_000_000;
assert.throws(() => validateHistoricalSmoke(tuned, { verifyFiles: false }), /frozen rule semantics drift/);
const replay = structuredClone(packet); replay.replay_source.receipt_sha256 = 'bad';
assert.throws(() => validateHistoricalSmoke(replay, { verifyFiles: false }), /replay digest drift/);
const projection = structuredClone(packet); projection.adapter_contract.shadow_projection_is_evidence_authority = true;
assert.throws(() => validateHistoricalSmoke(projection, { verifyFiles: false }), /must not become evidence authority/);
const history = structuredClone(packet); history.adapter_contract.creator_history_order = 'RETROSPECTIVE';
assert.throws(() => validateHistoricalSmoke(history, { verifyFiles: false }), /creator history order drift/);
const closed = structuredClone(packet); closed.review_gate.status = 'CLOSED_PASS';
assert.throws(() => validateHistoricalSmoke(closed, { verifyFiles: false }), /review gate drift/);
const next = structuredClone(packet); next.next_action = 'RUN_CANARY';
assert.throws(() => validateHistoricalSmoke(next, { verifyFiles: false }), /unexpected next action/);
console.log('DEV_SPINE_CHECK_TEST=PASS');
