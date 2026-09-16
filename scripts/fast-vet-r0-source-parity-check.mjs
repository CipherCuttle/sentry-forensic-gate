import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SOURCE_HEAD = '22fcce4c301e791a59c68b19b198bd1bea104138';
const FIXTURE_PATH = 'fixtures/fast-vet-r0-authorization-r1.json';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function show(path) {
  return execFileSync('git', ['show', `${SOURCE_HEAD}:${path}`], { encoding: 'utf8' });
}
function blob(path) {
  return execFileSync('git', ['rev-parse', `${SOURCE_HEAD}:${path}`], { encoding: 'utf8' }).trim();
}
function compact(value) {
  return value.replace(/\s+/g, ' ').trim();
}
function requireIncludes(source, fragment, label) {
  invariant(compact(source).includes(compact(fragment)), `source semantic mismatch:${label}`);
}
function parseNumericConst(source, name) {
  const match = source.match(new RegExp(`export const ${name} = ([0-9_]+)(?:n| as const)?;`));
  invariant(match, `missing source constant:${name}`);
  return Number(match[1].replaceAll('_', ''));
}
function parseStringConst(source, name) {
  const match = source.match(new RegExp(`export const ${name} = '([^']+)' as const;`));
  invariant(match, `missing source string constant:${name}`);
  return match[1];
}

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
for (const path of Object.keys(fixture.source.blobs)) invariant(blob(path) === fixture.source.blobs[path], `source blob drift:${path}`);

const decisionSource = show('src/evaluation/fastVet.ts');
const shadowSource = show('src/evaluation/fastVetShadow.ts');
const creatorSource = show('src/forensic/creatorOutcome.ts');
const forwardSource = show('src/outcome/forwardTypes.ts');
const docSource = show('docs/FAST_VET_R0.md');
const testSource = show('scripts/fast-vet-check.mjs');

const decision = fixture.decision_semantics;
invariant(parseStringConst(decisionSource, 'FAST_VET_R0') === decision.policy_version, 'decision policy version parity');
invariant(parseNumericConst(decisionSource, 'FAST_VET_PRIMARY_NOTIONAL_USD_MICROS') === decision.primary_notional_usd_micros, 'decision primary notional parity');
requireIncludes(decisionSource, "export type FastVetDecision = 'PASS' | 'REJECT' | 'UNKNOWN';", 'decision set');
requireIncludes(decisionSource, "export type FastVetAction = 'BUY_ELIGIBLE' | 'SKIP';", 'action set');
requireIncludes(decisionSource, "action: decision === 'PASS' ? 'BUY_ELIGIBLE' : 'SKIP'", 'PASS maps to BUY_ELIGIBLE, others SKIP');
requireIncludes(decisionSource, "if (!baseline) { return result('UNKNOWN', ['BASELINE_MISSING']", 'missing baseline UNKNOWN');
requireIncludes(decisionSource, "if (baseline.status !== 'COMPLETE') { return result('UNKNOWN', ['BASELINE_UNVERIFIED']", 'unverified baseline UNKNOWN');
requireIncludes(decisionSource, "if (!primaryLeg) { return result('UNKNOWN', ['PRIMARY_LEG_MISSING']", 'missing primary leg UNKNOWN');
requireIncludes(decisionSource, "if (!primaryLeg.entry.executable) { return result('REJECT', ['PRIMARY_ENTRY_NOT_EXECUTABLE']", 'entry non-executable REJECT');
requireIncludes(decisionSource, "if (!primaryLeg.reverse?.executable || primaryLeg.independentReverseRecoveryBps === null) { return result('REJECT', ['PRIMARY_REVERSE_NOT_EXECUTABLE']", 'reverse non-executable REJECT');
requireIncludes(decisionSource, "if (!feature) { return result('UNKNOWN', ['CREATOR_FEATURE_MISSING']", 'missing creator feature UNKNOWN');
requireIncludes(decisionSource, "if (adverseCreatorCount(feature) > 0) { return result('REJECT', ['KNOWN_PRIOR_ADVERSE_CREATOR']", 'known adverse creator REJECT');
requireIncludes(decisionSource, "if (feature.coverage === 'UNKNOWN' || feature.coverage === 'PARTIAL') { return result('UNKNOWN', ['CREATOR_HISTORY_INCOMPLETE']", 'incomplete creator history UNKNOWN');
requireIncludes(decisionSource, "return result('PASS', [], evidenceFrom(baseline, feature));", 'fallthrough PASS');
requireIncludes(decisionSource, "return feature.catastrophicLossCount + feature.exitFailureCount + feature.liquidityCollapseCount;", 'adverse creator class sum');
requireIncludes(decisionSource, "if (feature && (feature.launchId !== baseline.launchId || feature.baselineId !== baseline.baselineId))", 'feature binding');

invariant(JSON.stringify(decision.reject_reasons) === JSON.stringify(['PRIMARY_ENTRY_NOT_EXECUTABLE','PRIMARY_REVERSE_NOT_EXECUTABLE','KNOWN_PRIOR_ADVERSE_CREATOR']), 'fixture reject reasons drift');
invariant(JSON.stringify(decision.unknown_reasons) === JSON.stringify(['BASELINE_MISSING','BASELINE_UNVERIFIED','PRIMARY_LEG_MISSING','CREATOR_FEATURE_MISSING','CREATOR_HISTORY_INCOMPLETE']), 'fixture unknown reasons drift');
invariant(JSON.stringify(decision.known_prior_adverse_classes) === JSON.stringify(['CATASTROPHIC_LOSS','EXIT_FAILURE','LIQUIDITY_COLLAPSE']), 'fixture adverse creator classes drift');
requireIncludes(creatorSource, "export type CreatorOutcomeCoverage = 'NO_HISTORY' | 'UNKNOWN' | 'PARTIAL' | 'COMPLETE';", 'creator coverage universe');
invariant(JSON.stringify(decision.pass_creator_coverage) === JSON.stringify(['NO_HISTORY','COMPLETE']), 'fixture PASS creator coverage drift');
invariant(decision.independent_reverse_semantics === 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL', 'fixture reverse semantics drift');
requireIncludes(docSource, 'same-state sellability diagnostic', 'documented reverse semantics');
requireIncludes(docSource, 'deliberately adds no recovery-BPS threshold', 'documented no recovery threshold');
invariant(decision.recovery_bps_threshold === null, 'fixture recovery threshold must be null');
invariant(!/independentReverseRecoveryBps\s*[<>]=?/.test(decisionSource), 'source contains forbidden recovery-BPS threshold comparison');

const shadow = fixture.shadow_semantics;
invariant(parseStringConst(shadowSource, 'FAST_VET_SHADOW_R0') === shadow.receipt_version, 'shadow receipt version parity');
invariant(parseStringConst(shadowSource, 'FAST_VET_SHADOW_STRATEGY_LABEL') === shadow.strategy_label, 'shadow strategy parity');
requireIncludes(shadowSource, "status: 'SMOKE_ONLY'", 'SMOKE_ONLY status');
requireIncludes(shadowSource, "const rows = suppliedRows.filter((row) => row.baseline?.status === 'COMPLETE');", 'COMPLETE baseline control cohort');
requireIncludes(shadowSource, "if (vet.decision === 'PASS')", 'PASS-only candidate exposure');
requireIncludes(shadowSource, "if (outcome.policyVersion !== FORWARD_OUTCOMES_R1) return null;", 'canonical source outcome policy');
requireIncludes(shadowSource, "if (outcome.horizonMs !== CREATOR_OUTCOME_HORIZON_MS) return null;", 'exact horizon enforcement');
requireIncludes(shadowSource, "outcome.entryNotionalUsdMicros !== PRIMARY_OUTCOME_NOTIONAL_USD_MICROS", 'primary outcome notional enforcement');
requireIncludes(shadowSource, "return classification === 'CATASTROPHIC_LOSS' || classification === 'EXIT_FAILURE' || classification === 'LIQUIDITY_COLLAPSE';", 'shadow adverse classes');
requireIncludes(shadowSource, "const win = target.classification === 'NORMAL_WIN';", 'ordinary win class');
for (const metric of ['tradeRetentionBps','outcomeCoverageBps','adverseExposureReductionBps','winRetentionBps','upsideCaptureBps']) requireIncludes(shadowSource, `${metric}:`, `shadow metric ${metric}`);

const sourceHorizon = parseNumericConst(creatorSource, 'CREATOR_OUTCOME_HORIZON_MS');
const sourceOutcomeNotional = parseNumericConst(forwardSource, 'PRIMARY_OUTCOME_NOTIONAL_USD_MICROS');
const sourceOutcomePolicy = parseStringConst(forwardSource, 'FORWARD_OUTCOMES_R1');
invariant(sourceHorizon === shadow.target_horizon_ms, '24h source constant parity');
invariant(sourceOutcomeNotional === shadow.primary_outcome_notional_usd_micros, '$1 outcome notional source constant parity');
invariant(sourceOutcomePolicy === shadow.source_outcome_policy, 'source outcome policy parity');
invariant(shadow.control_cohort === 'COMPLETE_BASELINE_ONLY' && shadow.candidate_exposure === 'PASS_ONLY', 'fixture shadow cohort drift');
invariant(JSON.stringify(shadow.adverse_classes) === JSON.stringify(['CATASTROPHIC_LOSS','EXIT_FAILURE','LIQUIDITY_COLLAPSE']), 'fixture shadow adverse classes drift');
invariant(shadow.win_class === 'NORMAL_WIN', 'fixture win class drift');

requireIncludes(testSource, "assert.equal(evaluateFastVet({ baseline: baseline('clean'), creatorFeature: feature('clean') }).decision, 'PASS');", 'source PASS regression');
requireIncludes(testSource, "assert.equal(evaluateFastVet({ baseline: baseline('bad'), creatorFeature: feature('bad', { coverage: 'COMPLETE', adverse: 1 }) }).decision, 'REJECT');", 'source REJECT regression');
requireIncludes(testSource, "assert.equal(evaluateFastVet({ baseline: baseline('partial'), creatorFeature: feature('partial', { coverage: 'PARTIAL' }) }).decision, 'UNKNOWN');", 'source UNKNOWN regression');
requireIncludes(testSource, "assert.equal(evaluateFastVet({ baseline: null, creatorFeature: null }).action, 'SKIP');", 'source UNKNOWN->SKIP regression');
requireIncludes(testSource, 'assert.deepEqual(withOutsideControl.metrics, first.metrics);', 'COMPLETE denominator regression');
requireIncludes(testSource, 'assert.equal(wrongHorizon.metrics.resolvedOutcomeCount, 0);', '24h horizon regression');

requireIncludes(docSource, 'There is deliberately no sample-adequacy claim, probability, p-value, confidence interval, ML model, tuned threshold, or promotion decision.', 'non-promotion scientific boundary');
invariant(shadow.no_sample_adequacy_claim === true && shadow.no_probability_or_p_value === true && shadow.no_threshold_tuning === true, 'fixture scientific non-promotion boundary drift');

console.log(`FAST_VET_R0_SOURCE_PARITY=PASS source_head=${SOURCE_HEAD} fixture=${FIXTURE_PATH}`);
