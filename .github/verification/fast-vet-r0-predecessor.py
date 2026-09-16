#!/usr/bin/env python3
import hashlib
import json
import sys
from pathlib import Path

RUN_ID = 35001582697
EXPECTED_HEAD = "75588056de53b94f92b5cf3b40e89e2b5521031a"
ARTIFACT_ID = 10410898359
ARTIFACT_NAME = "historical-full-replay-r1-evidence"
ARTIFACT_DIGEST = "sha256:ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a"
RECEIPT_NAME = "historical-full-replay-r1-live-receipt.json"
RECEIPT_SHA256 = "916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825"
SCOPE_SHA256 = "b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211"
MAP_SHA256 = "c5346e572255385acd1744552633d5ad533d86d3821a8d857a432471e6022275"
BASELINE_POLICY = "HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1"
OUTCOME_POLICY = "HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1"
EXPECTED_HORIZONS = [60_000, 300_000, 1_800_000, 7_200_000, 86_400_000]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAST_VET_AUTH_PREDECESSOR_PROVENANCE=FAIL {message}")


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".fast-vet-auth/predecessor")
    run = json.loads((root / "run.json").read_text())
    artifact = json.loads((root / "artifact.json").read_text())
    receipt_path = root / "unzipped" / RECEIPT_NAME

    require(run.get("id") == RUN_ID, "run id drift")
    require(run.get("head_sha") == EXPECTED_HEAD, f"run head drift:{run.get('head_sha')}")
    require(run.get("status") == "completed" and run.get("conclusion") == "success", "run not successful")
    require(run.get("name") == "historical-full-replay-r1-stage-b", f"workflow name drift:{run.get('name')}")

    require(artifact.get("id") == ARTIFACT_ID, "artifact id drift")
    require(artifact.get("name") == ARTIFACT_NAME, f"artifact name drift:{artifact.get('name')}")
    require(artifact.get("expired") is False, "artifact expired")
    require(artifact.get("digest") == ARTIFACT_DIGEST, f"artifact digest drift:{artifact.get('digest')}")
    workflow_run = artifact.get("workflow_run") or {}
    require(workflow_run.get("id") == RUN_ID, "artifact run binding drift")
    require(workflow_run.get("head_sha") == EXPECTED_HEAD, "artifact head binding drift")

    files = sorted(str(p.relative_to(root / "unzipped")) for p in (root / "unzipped").rglob("*") if p.is_file())
    require(files == [RECEIPT_NAME], f"unexpected artifact contents:{files}")
    receipt_bytes = receipt_path.read_bytes()
    require(hashlib.sha256(receipt_bytes).hexdigest() == RECEIPT_SHA256, "receipt SHA-256 drift")
    receipt = json.loads(receipt_bytes)

    require(receipt.get("schema") == "historical-full-replay-r1-live-receipt/v1", "receipt schema drift")
    require(receipt.get("phase") == "HISTORICAL_FULL_REPLAY_R1", "receipt phase drift")
    require(receipt.get("stage") == "STAGE_B_FULL_147_X_5_REPLAY", "receipt stage drift")
    require(receipt.get("verdict") == "HISTORICAL_FULL_REPLAY_R1_ACCOUNTING_PASS", "receipt verdict drift")
    require(receipt.get("shadowOnly") is True, "receipt not shadow-only")
    require(receipt.get("sourceMode") == "LIVE_ARCHIVE_RPC_REVIEWED_HISTORICAL_PIPELINES", "receipt source mode drift")
    require(receipt.get("sourceScopeIdentitySha256") == SCOPE_SHA256, "scope identity drift")
    require(receipt.get("authorityMapSha256") == MAP_SHA256, "authority map drift")
    require(receipt.get("baselinePolicyVersion") == BASELINE_POLICY, "baseline policy drift")
    require(receipt.get("outcomePolicyVersion") == OUTCOME_POLICY, "outcome policy drift")
    require(receipt.get("expectedLaunches") == 147 and receipt.get("launchesAccounted") == 147, "launch accounting drift")
    require(receipt.get("baselineComplete") == 147 and receipt.get("baselineUnverified") == 0, "baseline accounting drift")
    require(receipt.get("expectedHorizonCells") == 735 and receipt.get("horizonCellsAccounted") == 735, "horizon accounting drift")
    require(receipt.get("outcomesComplete") == 735 and receipt.get("outcomesUnverified") == 0 and receipt.get("outcomesNotAttemptedBaselineUnverified") == 0, "outcome accounting drift")

    rows = receipt.get("rows")
    require(isinstance(rows, list) and len(rows) == 147, "row count drift")
    for index, row in enumerate(rows, start=1):
        baseline = row.get("baseline") or {}
        require(baseline.get("status") == "COMPLETE", f"row {index} baseline not COMPLETE")
        require(isinstance(baseline.get("legs"), list) and len(baseline["legs"]) == 5, f"row {index} baseline leg count drift")
        outcomes = row.get("outcomes")
        require(isinstance(outcomes, list) and len(outcomes) == 5, f"row {index} outcome count drift")
        require(sorted(item.get("horizonMs") for item in outcomes) == EXPECTED_HORIZONS, f"row {index} horizons drift")
        require(all(item.get("status") == "COMPLETE" for item in outcomes), f"row {index} outcome not COMPLETE")

    print(f"FAST_VET_AUTH_PREDECESSOR_PROVENANCE=PASS run={RUN_ID} head={EXPECTED_HEAD} artifact={ARTIFACT_ID} receipt_sha256={RECEIPT_SHA256}")


if __name__ == "__main__":
    main()
