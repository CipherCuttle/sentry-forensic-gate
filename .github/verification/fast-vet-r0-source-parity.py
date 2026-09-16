#!/usr/bin/env python3
import hashlib
import json
import re
import sys
from pathlib import Path

SOURCE_HEAD = "22fcce4c301e791a59c68b19b198bd1bea104138"
FIXTURE_PATH = Path("fixtures/fast-vet-r0-authorization-r1.json")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAST_VET_R0_SOURCE_PARITY=FAIL {message}")


def compact(value: str) -> str:
    return " ".join(value.split())


def includes(source: str, fragment: str, label: str) -> None:
    require(compact(fragment) in compact(source), f"source semantic mismatch:{label}")


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def numeric_const(source: str, name: str) -> int:
    match = re.search(rf"export const {re.escape(name)} = ([0-9_]+)(?:n| as const)?;", source)
    require(match is not None, f"missing source constant:{name}")
    return int(match.group(1).replace("_", ""))


def string_const(source: str, name: str) -> str:
    match = re.search(rf"export const {re.escape(name)} = '([^']+)' as const;", source)
    require(match is not None, f"missing source string constant:{name}")
    return match.group(1)


def main() -> None:
    source_root = Path(sys.argv[1] if len(sys.argv) > 1 else ".fast-vet-auth/pr13")
    fixture = json.loads(FIXTURE_PATH.read_text())
    require(fixture["source"]["head"] == SOURCE_HEAD, "fixture source head drift")

    sources: dict[str, str] = {}
    for rel, expected_blob in fixture["source"]["blobs"].items():
        data = (source_root / rel).read_bytes()
        require(git_blob_sha1(data) == expected_blob, f"source blob drift:{rel}")
        sources[rel] = data.decode()

    decision_source = sources["src/evaluation/fastVet.ts"]
    shadow_source = sources["src/evaluation/fastVetShadow.ts"]
    creator_source = sources["src/forensic/creatorOutcome.ts"]
    forward_source = sources["src/outcome/forwardTypes.ts"]
    doc_source = sources["docs/FAST_VET_R0.md"]
    test_source = sources["scripts/fast-vet-check.mjs"]

    decision = fixture["decision_semantics"]
    require(string_const(decision_source, "FAST_VET_R0") == decision["policy_version"], "decision policy version parity")
    require(numeric_const(decision_source, "FAST_VET_PRIMARY_NOTIONAL_USD_MICROS") == decision["primary_notional_usd_micros"], "decision primary notional parity")
    includes(decision_source, "export type FastVetDecision = 'PASS' | 'REJECT' | 'UNKNOWN';", "decision set")
    includes(decision_source, "export type FastVetAction = 'BUY_ELIGIBLE' | 'SKIP';", "action set")
    includes(decision_source, "action: decision === 'PASS' ? 'BUY_ELIGIBLE' : 'SKIP'", "PASS maps to BUY_ELIGIBLE, others SKIP")
    includes(decision_source, "if (!baseline) { return result('UNKNOWN', ['BASELINE_MISSING']", "missing baseline UNKNOWN")
    includes(decision_source, "if (baseline.status !== 'COMPLETE') { return result('UNKNOWN', ['BASELINE_UNVERIFIED']", "unverified baseline UNKNOWN")
    includes(decision_source, "if (!primaryLeg) { return result('UNKNOWN', ['PRIMARY_LEG_MISSING']", "missing primary leg UNKNOWN")
    includes(decision_source, "if (!primaryLeg.entry.executable) { return result('REJECT', ['PRIMARY_ENTRY_NOT_EXECUTABLE']", "entry non-executable REJECT")
    includes(decision_source, "if (!primaryLeg.reverse?.executable || primaryLeg.independentReverseRecoveryBps === null) { return result('REJECT', ['PRIMARY_REVERSE_NOT_EXECUTABLE']", "reverse non-executable REJECT")
    includes(decision_source, "if (!feature) { return result('UNKNOWN', ['CREATOR_FEATURE_MISSING']", "missing creator feature UNKNOWN")
    includes(decision_source, "if (adverseCreatorCount(feature) > 0) { return result('REJECT', ['KNOWN_PRIOR_ADVERSE_CREATOR']", "known adverse creator REJECT")
    includes(decision_source, "if (feature.coverage === 'UNKNOWN' || feature.coverage === 'PARTIAL') { return result('UNKNOWN', ['CREATOR_HISTORY_INCOMPLETE']", "incomplete creator history UNKNOWN")
    includes(decision_source, "return result('PASS', [], evidenceFrom(baseline, feature));", "fallthrough PASS")
    includes(decision_source, "return feature.catastrophicLossCount + feature.exitFailureCount + feature.liquidityCollapseCount;", "adverse creator class sum")
    includes(decision_source, "if (feature && (feature.launchId !== baseline.launchId || feature.baselineId !== baseline.baselineId))", "feature binding")

    require(decision["reject_reasons"] == ["PRIMARY_ENTRY_NOT_EXECUTABLE", "PRIMARY_REVERSE_NOT_EXECUTABLE", "KNOWN_PRIOR_ADVERSE_CREATOR"], "fixture reject reasons drift")
    require(decision["unknown_reasons"] == ["BASELINE_MISSING", "BASELINE_UNVERIFIED", "PRIMARY_LEG_MISSING", "CREATOR_FEATURE_MISSING", "CREATOR_HISTORY_INCOMPLETE"], "fixture unknown reasons drift")
    require(decision["known_prior_adverse_classes"] == ["CATASTROPHIC_LOSS", "EXIT_FAILURE", "LIQUIDITY_COLLAPSE"], "fixture adverse creator classes drift")
    includes(creator_source, "export type CreatorOutcomeCoverage = 'NO_HISTORY' | 'UNKNOWN' | 'PARTIAL' | 'COMPLETE';", "creator coverage universe")
    require(decision["pass_creator_coverage"] == ["NO_HISTORY", "COMPLETE"], "fixture PASS creator coverage drift")
    require(decision["independent_reverse_semantics"] == "INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL", "fixture reverse semantics drift")
    includes(doc_source, "same-state sellability diagnostic", "documented reverse semantics")
    includes(doc_source, "deliberately adds no recovery-BPS threshold", "documented no recovery threshold")
    require(decision["recovery_bps_threshold"] is None, "fixture recovery threshold must be null")
    require(re.search(r"independentReverseRecoveryBps\s*[<>]=?", decision_source) is None, "source contains forbidden recovery-BPS threshold comparison")

    shadow = fixture["shadow_semantics"]
    require(string_const(shadow_source, "FAST_VET_SHADOW_R0") == shadow["receipt_version"], "shadow receipt version parity")
    require(string_const(shadow_source, "FAST_VET_SHADOW_STRATEGY_LABEL") == shadow["strategy_label"], "shadow strategy parity")
    includes(shadow_source, "status: 'SMOKE_ONLY'", "SMOKE_ONLY status")
    includes(shadow_source, "const rows = suppliedRows.filter((row) => row.baseline?.status === 'COMPLETE');", "COMPLETE baseline control cohort")
    includes(shadow_source, "if (vet.decision === 'PASS')", "PASS-only candidate exposure")
    includes(shadow_source, "if (outcome.policyVersion !== FORWARD_OUTCOMES_R1) return null;", "canonical source outcome policy")
    includes(shadow_source, "if (outcome.horizonMs !== CREATOR_OUTCOME_HORIZON_MS) return null;", "exact horizon enforcement")
    includes(shadow_source, "outcome.entryNotionalUsdMicros !== PRIMARY_OUTCOME_NOTIONAL_USD_MICROS", "primary outcome notional enforcement")
    includes(shadow_source, "return classification === 'CATASTROPHIC_LOSS' || classification === 'EXIT_FAILURE' || classification === 'LIQUIDITY_COLLAPSE';", "shadow adverse classes")
    includes(shadow_source, "const win = target.classification === 'NORMAL_WIN';", "ordinary win class")
    for metric in ["tradeRetentionBps", "outcomeCoverageBps", "adverseExposureReductionBps", "winRetentionBps", "upsideCaptureBps"]:
        includes(shadow_source, f"{metric}:", f"shadow metric {metric}")

    require(numeric_const(creator_source, "CREATOR_OUTCOME_HORIZON_MS") == shadow["target_horizon_ms"], "24h source constant parity")
    require(numeric_const(forward_source, "PRIMARY_OUTCOME_NOTIONAL_USD_MICROS") == shadow["primary_outcome_notional_usd_micros"], "$1 outcome notional source constant parity")
    require(string_const(forward_source, "FORWARD_OUTCOMES_R1") == shadow["source_outcome_policy"], "source outcome policy parity")
    require(shadow["control_cohort"] == "COMPLETE_BASELINE_ONLY" and shadow["candidate_exposure"] == "PASS_ONLY", "fixture shadow cohort drift")
    require(shadow["adverse_classes"] == ["CATASTROPHIC_LOSS", "EXIT_FAILURE", "LIQUIDITY_COLLAPSE"], "fixture shadow adverse classes drift")
    require(shadow["win_class"] == "NORMAL_WIN", "fixture win class drift")

    includes(test_source, "assert.equal(evaluateFastVet({ baseline: baseline('clean'), creatorFeature: feature('clean') }).decision, 'PASS');", "source PASS regression")
    includes(test_source, "assert.equal(evaluateFastVet({ baseline: baseline('bad'), creatorFeature: feature('bad', { coverage: 'COMPLETE', adverse: 1 }) }).decision, 'REJECT');", "source REJECT regression")
    includes(test_source, "assert.equal(evaluateFastVet({ baseline: baseline('partial'), creatorFeature: feature('partial', { coverage: 'PARTIAL' }) }).decision, 'UNKNOWN');", "source UNKNOWN regression")
    includes(test_source, "assert.equal(evaluateFastVet({ baseline: null, creatorFeature: null }).action, 'SKIP');", "source UNKNOWN->SKIP regression")
    includes(test_source, "assert.deepEqual(withOutsideControl.metrics, first.metrics);", "COMPLETE denominator regression")
    includes(test_source, "assert.equal(wrongHorizon.metrics.resolvedOutcomeCount, 0);", "24h horizon regression")
    includes(doc_source, "There is deliberately no sample-adequacy claim, probability, p-value, confidence interval, ML model, tuned threshold, or promotion decision.", "non-promotion scientific boundary")
    require(shadow["no_sample_adequacy_claim"] is True and shadow["no_probability_or_p_value"] is True and shadow["no_threshold_tuning"] is True, "fixture scientific non-promotion boundary drift")

    print(f"FAST_VET_R0_SOURCE_PARITY=PASS source_head={SOURCE_HEAD} fixture={FIXTURE_PATH}")


if __name__ == "__main__":
    main()
