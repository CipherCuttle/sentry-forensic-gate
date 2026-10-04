# BINRAT x Pons Executor — Kill-Fast V1

Status: **EXPERIMENT / OFFLINE DIAGNOSTIC ONLY / NO LIVE AUTHORITY**

Branch: `experiment/binrat-kill-fast-v1`

## Decision we are making

Not “can a clever backtest be made to look profitable?”

The bounded question is:

> Does point-in-time BINRAT memory remove enough bad $1 Pons opportunities, without deleting the useful positive tail, to justify ONE short-horizon shadow experiment?

This experiment cannot authorize signing, broadcast, live money, model promotion, token marketing, or a merge.

## Ten-stack compression

1. **Socratic:** the decision is whether memory adds actionable separation, not whether BINRAT is “good”.
2. **Dialectic:** avoid both six-month evidence theater and one-evening overfitting; use a brutal retrospective kill screen, then at most one tiny shadow confirmation.
3. **Popper:** thresholds are frozen before the short-horizon result. Failure kills the selector.
4. **Causal:** only facts knowable before the launch/decision may enter the signal. Funding recurrence is strictly prior-source recurrence; the first occurrence cannot inherit knowledge from the future.
5. **Systems:** BINRAT remains evidence/intelligence; SENTRY remains mechanical execution/outcome authority. No shared signer or mutable database.
6. **Cybernetics:** fixed policy, fixed horizon, fixed stop rule. No self-tuning from wins/losses.
7. **Bayesian:** prior probability of tradable edge is low; strong negative evidence should kill quickly.
8. **MDL:** V1 uses simple exact-address / exact-funding-source recurrence, not an AI score or feature search.
9. **DoE:** same mechanically eligible launch universe, control vs deterministic veto, identical future outcome.
10. **Adversarial:** funder spoofing, sparse history, latency, taxes, graduation, costs and survivor bias remain explicit failure modes.

## Stage A — existing cohort kill screen

Inputs are the already-committed, separated Pons S0 feature/outcome streams:

- `docs/evidence/pons-s0-real-cohort-v1/features.jsonl`
- `docs/evidence/pons-s0-real-cohort-v1/outcomes.jsonl`

The evaluator consumes only complete outcomes at one explicit horizon and the existing
`BUY_EVERY_EXECUTABLE_CONTROL_R1` control.

Current exact-creator memory is represented by the already-frozen R1 action. If that policy does not actually veto enough control trades, it is killed for lack of discrimination rather than rescued by changing thresholds.

Run:

```bash
node scripts/binrat-kill-fast-v1.mjs
```

The expected *type* of answer is machine-readable and bounded:
- `KILL_CURRENT_AUTOBUY_POLICY_TEST_FUNDER_AT_5M_ONLY`
- `PROMOTE_ONE_SHORT_HORIZON_SHADOW_TEST`
- `KILL_INTELLIGENCE_TO_EXECUTION_SELECTOR_V0`
- or an explicit `INCONCLUSIVE_*`.

## Stage B — funder recurrence diagnostic

Optional input is JSONL using schema `BINRAT_KILL_FAST_FUNDING_OBSERVATION_V1`.

Each row binds:
- launch ID;
- deployer;
- launch block;
- latest verified pre-launch native funding source or null;
- `postOutcomeEvidence=false`;
- `liveMoneyAuthority=false`.

The evaluator sorts by launch block and gives recurrence credit only when the same exact funding source had already appeared against a distinct deployer on an earlier supplied launch. Future recurrence cannot flow backward.

For production-quality evidence, these rows should come from BINRAT's canonical
`BINRAT_PONS_PRELAUNCH_NATIVE_INBOUND_V1` receipts, not a hand-built list.

## Frozen short-horizon promotion gate

These constants are frozen in `binrat-kill-fast-core-v1.mjs` before a 5-minute funding result is admitted:

- at least 20 control rows;
- at least 5 funder-recurrence veto rows;
- at least 5 retained rows;
- vetoed adverse rate must exceed retained adverse rate by **>=15 percentage points**;
- retained trades must preserve **>=80% of gross positive-tail gain**;
- retained mean terminal value must improve by **>=10%** versus control.

Failure is `KILL_VETO_NO_MATERIAL_SEPARATION`.

Passing this gate promotes only to **one short-horizon shadow test**. It does not prove alpha and cannot grant live money.

## Why 24h does not settle the whole question

The committed S0 cohort has a 24h outcome stream. A market where nearly every mechanically eligible $1 launch is already destroyed by 24h cannot distinguish a useful fast-entry/fast-exit policy well. Stage A is therefore excellent for killing weak memory policies and exposing coverage gaps, but not sufficient to rescue a short-horizon trading thesis.

The next allowed engineering step after this offline harness is narrowly scoped:
reuse the reviewed Pons forward-outcome adapter to materialize a fixed 5-minute outcome for the same frozen control universe and rerun this exact evaluator. No new model, no parameter search, no signer.

## Stop rule

After 5m evaluation:
- **KILL** -> stop integrating BINRAT with execution. Keep BINRAT intelligence product only.
- **PROMOTE** -> at most a tiny fresh shadow confirmation using the same frozen rule.
- **INCONCLUSIVE** -> do not expand scope. Fix only a concrete evidence-coverage defect if it is cheap; otherwise stop.

No “try 1m, 3m, 8m, 15m until something works.”
