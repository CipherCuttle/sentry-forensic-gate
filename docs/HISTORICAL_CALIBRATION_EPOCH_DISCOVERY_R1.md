# HISTORICAL_CALIBRATION_EPOCH_DISCOVERY_R1

## Objective

Identify when the frozen `EXECUTABLE_BASELINE_R1` USD-sizing contract is actually defined for the reviewed 147-launch historical cohort.

This is a discovery-only successor to blocked `HISTORICAL_COMPATIBILITY_R1` (PR #16). It does not modify that phase's verdict and does not authorize replay.

## Frozen semantics under test

For each canonical historical launch:

- decision block = `launch_block + 2`;
- preserve the historical executable tuple:
  - NPM `0x98b6267DA27c5A21Bd6e3edfBC2DA6b0428Fa9F7`;
  - factory `0xD8B0826150B7686D1F56d6F10E31E58e1BCF1193`;
  - QuoterV2 `0x547D43a6F83A28720908537Aa25179ff8c6A6411`;
  - WETH `0x4200000000000000000000000000000000000006`;
  - USDT0 `0x0200c29006150606b650577bbe7b6248f58470c1`;
- target notionals remain `$0.25`, `$0.50`, `$1`, `$2`, `$5`;
- WETH bases require exact-output WETH→USDT0 calibration;
- fee tiers remain `500`, `3000`, `10000`;
- a notional is executable when at least one frozen fee tier quotes successfully;
- the full ladder is executable only when all five notionals are executable at that exact decision block;
- USDT0-base launches use the already-frozen nominal peg convention and do not require WETH→USDT0 calibration;
- other bases are not promoted to comparable by this discovery.

## Cohort

The scanner reconstructs canonical launch events from the Sentry proxy over blocks `39943476..49271598` and fails closed unless the deduplicated cohort contains exactly **147** launches.

It then recovers each launch's base token from the historical position manager at the launch block and evaluates the frozen USD-sizing contract at the deterministic decision block.

## Output

The receipt reports:

- all 147 launch decision points;
- calibration-comparable vs not-comparable classification;
- the first comparable decision point, if one exists;
- whether availability remains monotonic after the first comparable point;
- every contiguous comparable window;
- per-notional and per-fee-tier quote evidence.

A single epoch boundary is valid only if the observed evidence supports monotonic availability. If later launch points fail after an earlier pass, the result must remain multiple availability windows rather than being collapsed into a false epoch.

## Boundaries

This phase is read-only and discovery-only.

It does **not** authorize:

- historical replay;
- FAST_VET;
- canary;
- signing or private keys;
- transaction construction or broadcast;
- baseline semantic changes;
- treating missing historical calibration as synthetic price evidence;
- merging this PR without explicit merge authority.

## Acceptance

Discovery passes when:

1. exactly 147 historical launches are reconstructed;
2. every launch receives a deterministic decision-block calibration classification or the run fails closed on an unexpected provider/structural error;
3. a SHA-bound JSON receipt is uploaded by GitHub Actions;
4. ordinary repository CI remains green.

The discovery result may legitimately show no single monotonic epoch. That is evidence, not a test failure.
