# PONS S0 — Prospective Strategy Preregistration V1

## Status

**DESIGN / PREREGISTRATION ONLY**

- mode: `SHADOW_ONLY`
- live-money authority: **false**
- signing authority: **false**
- broadcast authority: **false**
- merge authority: **none**
- scientific state: `EDGE_UNPROVEN`

E4C proved one bounded real-money execution roundtrip. S0 asks a different
question:

> Can point-in-time evidence available before entry improve executable outcomes
> relative to a mechanically executable control without destroying positive-tail
> capture?

S0 MUST NOT infer strategy edge from the E4C live canary. E4C is execution
evidence, not alpha evidence.

---

## 1. Permanent architecture boundary

Keep four semantic owners separate:

1. **Discovery / canonical truth** — what launched, when, by whom, and under
   which reviewed runtime.
2. **Mechanical admissibility** — can a bounded entry and independent reverse
   be quoted under current authority?
3. **Strategy research** — should a mechanically admissible launch be preferred,
   rejected, or ranked given only point-in-time evidence?
4. **Execution / recovery** — if live authority is later granted, perform the
   exact bounded action and reconcile ambiguous outcomes.

No strategy feature may mutate execution semantics.
No execution result may silently redefine a research label.
No research model may construct, sign, or broadcast transactions.

### Repository ownership

To avoid turning the evidence authority into a model-development monolith:

- **SENTRY** owns canonical point-in-time facts, feature evidence, outcome
  evidence, policy-independent receipts, and live-safe deterministic guards.
- **QntyLab** owns exploratory model development, feature selection, fitting,
  ablation, calibration research, null tests, and search accounting.
- A model may cross back into SENTRY only as a **frozen content-addressed
  strategy artifact** with explicit schema/version, feature contract, training
  cutoff, model digest, calibration digest, and policy identity.
- SENTRY may evaluate that frozen artifact in shadow. It must not retrain it.
- Live execution remains a separately authorized consumer of an already-closed
  strategy policy; no training dependency enters the signing/broadcast surface.

Cross-repository handoff is by immutable artifact/receipt identity, not shared
mutable databases or implicit imports.

This follows the information-hiding principle: isolate decisions likely to
change behind stable module contracts rather than letting model choice leak into
execution machinery.

---

## 2. Ten-stack reasoning contract

S0 is designed under the repository's established ten-stack:

1. Socratic reasoning
2. Hegelian dialectic
3. Popperian falsification
4. Causal inference
5. Systems architecture
6. Cybernetics
7. Bayesian calibration
8. Information theory / MDL
9. Design of experiments
10. Adversarial testing

Operational translations:

- ask what evidence would make the thesis false;
- compare catastrophe avoidance against missed positive tails;
- keep all rejected launches observable;
- separate association from causal claims;
- isolate discovery, policy, evidence, execution, and learning;
- measure drift rather than silently retrain through it;
- prefer calibrated probabilities over opaque scores;
- prefer the smallest sufficient feature set;
- freeze hypotheses before confirmatory outcomes;
- assume scammers will adapt to visible rules.

---

## 3. Thesis, antithesis, synthesis

### Thesis

Fresh-token markets may contain usable point-in-time information in creator
lineage, funding provenance, initial distribution, early participant topology,
and liquidity trajectory. A strategy could use that evidence to avoid obvious
bad launches while retaining enough positive-tail exposure to improve net
capital versus a mechanically executable control.

### Antithesis

Fresh-token markets are adversarial, heavy-tailed, non-stationary, and easy to
manipulate. Volume, holder counts, social activity, creator addresses, and even
apparent liquidity can be manufactured. Repeated research on the same launch
history can create a convincing but false strategy through data snooping.
Historical counterfactual outcomes also become less faithful as position size
increases because the hypothetical trade itself would have changed the bonding
curve and possibly the subsequent market path.

### Synthesis

Do not promote a single “rug classifier” or one composite score.

Build a prospective, immutable comparison framework in which:

- one control buys every mechanically executable candidate;
- existing deterministic policy lanes remain frozen comparators;
- candidate S0 policies emit immutable shadow decisions from the same
  point-in-time evidence;
- every candidate, including rejections, receives the same future executable
  outcomes;
- model search is trial-accounted;
- model probabilities are calibrated;
- latency, costs, and execution-persona parity are measured;
- capital scaling remains a separate problem.

---

## 4. Current strengths that MUST remain

The existing repo already has several anti-self-deception properties that S0
must preserve:

- immutable decision receipts;
- explicit `EDGE_UNPROVEN`;
- outcomes for rejected candidates;
- missing evidence is not coerced to safety or loss;
- point-in-time creator-history joins;
- fixed baseline notionals;
- same-block/hash authority checks;
- explicit
  `INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL` reverse semantics;
- exact forward executable exit reconstruction instead of chart-price marking;
- separate strategy/control receipts;
- no live authority in research adapters.

S0 extends these contracts. It does not replace them.

---

## 5. Footguns that must be closed before model-driven live trading

### F1 — research capacity is not live sequential capacity

`FAST_VET_R1_CAPACITY_GATE.capacityUsdMicros` means the largest contiguous
notional for which same-state entry and independent reverse probes are
executable.

It MUST NOT be consumed by live position sizing.

Required semantic repair before any live sizing:

- preserve existing field for compatibility;
- add explicit interpretation
  `INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL`;
- live sizing must use a separately named sequential execution-capacity
  authority proven through state transition / live or stateful simulation.

### F2 — shadow recipient versus execution wallet

Pons shadow entry pricing currently uses
`PONS_V2_SHADOW_QUOTE_RECIPIENT`, while live E0 verifies
`currentSnipeTaxBps(actualWallet)`.

S0 must bind an **execution persona** into evidence:

- recipient identity class;
- exemption state;
- wallet-specific tax state if applicable;
- any other address-dependent launch rule.

A strategy decision is not execution-parity evidence unless the execution
persona matches the eventual live actor's relevant on-chain treatment.

### F3 — latency is part of the strategy

E4C directly demonstrated that a candidate can pass a dry plan and later lose
reverse executability before live invocation.

S0 therefore records at minimum:

- launch observed block/time;
- feature-complete block/time;
- decision block/time;
- quote block/time;
- hypothetical submission delay;
- observed inclusion delay distribution from live canaries;
- outcome under one or more **preregistered latency envelopes**.

No zero-latency backtest may be labeled executable strategy performance.

### F4 — counterfactual self-impact / interference

Portable forward outcomes currently value the token amount implied by a
hypothetical historical entry against the market path that actually occurred
without that hypothetical entry.

At very small notionals this can be a useful approximation.
It is not invariant to scale.

As size increases, the hypothetical trade may alter:

- reserves / curve state;
- graduation timing;
- later participant behavior;
- available liquidity;
- later exit price.

Therefore:

- S0 edge evidence is scoped to the frozen research notional;
- no historical result automatically authorizes larger live notionals;
- capital scaling requires a separate impact-aware / sequential-capacity stage.

### F5 — exact creator address is not durable identity

A new creator address MUST NOT automatically mean a new economic actor.

Add a versioned, point-in-time **entity-linkage evidence layer** that may include:

- funding ancestry;
- direct value-transfer relations;
- repeated withdrawal destinations;
- deployment pattern / bytecode similarity where meaningful;
- repeated fee-recipient identity;
- other canonical on-chain linkage.

Entity linkage starts diagnostic-only. It cannot become a live veto until
separately preregistered and prospectively tested.

### F6 — manipulable features

Raw volume, holder count, social mentions, comments, and apparent buyer count
must be treated as adversarial observations, not trusted bullish signals.

Before promotion, each feature family records:

- provenance;
- exact observation time;
- spoofability / manipulation class;
- whether economically linked addresses were collapsed;
- missingness;
- transformation version.

### F7 — graduation is not the target

Graduation may be useful state information but MUST NOT become the primary
success label.

Primary strategy evidence remains executable economic outcome after costs.
A model that predicts graduation but loses money is not edge.

### F8 — entry and exit research must stay separated

S0 tests **selection / entry evidence**.

It may observe the existing frozen future horizons
`1m / 5m / 30m / 2h / 24h`, but MUST NOT choose the best exit horizon after
seeing the confirmatory cohort.

A later exit-policy stage must preregister its own rule and receive a fresh
prospective witness.

### F9 — model search must be first-class evidence

Every attempted policy/model/configuration that reaches evaluation must receive
a trial ID and immutable trial receipt including:

- feature set digest;
- label definition;
- training cohort;
- validation cohort;
- hyperparameters / deterministic seed;
- objective;
- resulting metrics;
- parent hypothesis ID.

Deleting or forgetting failed trials is forbidden.

Multiple-testing / search-adjusted inference is applied to the research process,
not only to the winning model.

### F10 — drift must not become silent retraining

Fresh-token markets are adversarial and regime-dependent.

S0 uses versioned champion/challenger models.
A drift detector may raise a warning or freeze promotion, but it may not
autonomously change the live policy.

Any model update creates a new policy version and a new prospective witness.

### F11 — gross executable value is not net strategy P&L

Current forward outcomes reconstruct executable exit value. That is necessary,
but a strategy promotion metric must additionally account for the complete
transaction path.

At the intended execution policy, include:

- entry transaction gas;
- approval / Permit2 / allowance-management gas actually required by policy;
- exit transaction gas;
- protocol / creator / swap fees already embedded in execution;
- quote-to-inclusion slippage;
- recovery / cleanup gas when the path requires it.

A $1 strategy can be gross-profitable and net-negative after execution costs.

The gross outcome receipt should remain unchanged for evidence compatibility.
Net strategy economics belong in a separately versioned strategy-cost projection.

### F12 — opportunity edge is not portfolio implementability

The current per-launch hypothetical comparison effectively asks what would
happen if $1 were independently available for each opportunity.

A live wallet has finite capital and overlapping positions.

Before portfolio promotion, measure:

- capital-time occupancy;
- concurrent eligible positions;
- skipped opportunities caused by capital reservation;
- deterministic allocation priority when simultaneous candidates compete;
- realized portfolio-level terminal capital under the same capital budget.

S0 first proves opportunity-level predictive value.
A separate portfolio-routing stage proves finite-capital implementability.

### F13 — random cross-validation is forbidden for promotion evidence

Launches are time ordered, clustered, and subject to regime drift.

Random train/test shuffling can leak market regimes and near-duplicate behavior.

Model development may use time-aware walk-forward / blocked evaluation and
dependence-aware resampling. Final promotion evidence remains the untouched
prospective witness.

### F14 — multichain observations are not IID sample multiplication

Ink, Robinhood/Pons, Arc, and other venues have different launch mechanisms,
liquidity rules, participants, fees, latency, and adversaries.

Cross-chain evidence may test transportability, but it MUST NOT be pooled merely
to inflate sample size.

Any pooled model must declare chain/protocol identity and separately report
within-domain performance and calibration. Transfer learning / common features
are a hypothesis, not an assumption.

### F15 — model-development dependencies must not enter SENTRY authority code

Python notebooks, AutoML/search frameworks, gradient-boosting libraries, GNN
stacks, LLM calls, and training caches belong in the research environment
(QntyLab), not in SENTRY's canonical evidence or execution authority surface.

SENTRY consumes only frozen strategy artifacts through a narrow adapter.

This avoids:

- dependency/version drift changing historical decisions;
- training-time network/data access leaking into decision-time evidence;
- accidental retraining;
- model code gaining wallet/network authority;
- a future model migration forcing changes to chain adapters or recovery code.

---

## 6. Experimental lanes

Every eligible launch receives all applicable shadow decisions from the SAME
point-in-time evidence and the SAME decision anchor.

### C0 — mechanical control

`BUY_EVERY_EXECUTABLE_CONTROL_R1`

Purpose: estimate what happens if we participate whenever the minimum
bidirectional mechanical probe works.

### C1 — deterministic catastrophe-veto comparator

`FAST_VET_R1_CAPACITY_GATE`

Purpose: ask whether known adverse creator evidence / catastrophe vetoes improve
the control while retaining positive-tail opportunities.

### S0 — candidate strategy family

S0 candidate policies may use only registered point-in-time feature families.

No S0 candidate gets live authority.

Initially S0 should output **probabilities / distributions**, not a binary
“safe” label:

- probability of catastrophic executable outcome;
- probability of positive executable outcome at each frozen horizon;
- expected executable return distribution diagnostics;
- uncertainty / coverage.

Decision thresholds are a separate policy layer and must be frozen before
confirmatory use.

---

## 7. Feature registry

The PRD's existing seven evidence families remain the allowed top-level schema:

1. protocol integrity
2. exit executability
3. creator history
4. funding provenance
5. initial distribution
6. early participant topology
7. liquidity trajectory

Each concrete feature must additionally declare:

- availability block/time;
- evidence authority;
- transformation version;
- missing-value semantics;
- manipulation class;
- point-in-time proof;
- whether it is already represented by another feature.

Highly correlated derivatives SHOULD NOT be multiplied merely to make the model
look sophisticated.

Information-theoretic / MDL preference:

> smallest feature set that preserves out-of-sample information wins.

---

## 8. Development versus confirmatory evidence

### S0A — development / falsification

Allowed:

- historical replay;
- feature engineering;
- model comparison;
- ablation;
- permutation / null tests;
- calibration development;
- latency sensitivity;
- entity-linkage research.

Output remains exploratory.

### S0B — frozen policy preregistration

Before seeing the confirmatory cohort's outcomes, freeze:

- feature definitions;
- model family and hyperparameters;
- training cutoff;
- execution persona;
- decision anchor;
- latency envelope;
- candidate decision rule;
- primary economic endpoint;
- secondary metrics;
- stopping/sample rule derived from a pre-outcome power/simulation analysis.

### S0C — untouched prospective witness

After freeze:

- append launches prospectively;
- emit policy decisions once;
- never rewrite them;
- collect outcomes for pass AND reject;
- do not tune during the witness;
- evaluate only after the preregistered stop rule is satisfied.

If the policy changes, S0C closes and a new witness begins.

---

## 9. Metrics

No single metric is sufficient for this market.

At minimum report:

- participation / trade-retention rate;
- net executable terminal capital;
- gas + fee + slippage-adjusted return;
- catastrophic-loss exposure;
- exit-failure rate;
- liquidity-collapse rate;
- positive-tail excess capture;
- rejected positive-tail opportunity cost;
- median outcome;
- lower-tail / CVaR-style diagnostics;
- calibration metrics for predicted probabilities;
- coverage / unresolved-evidence rate;
- decision-to-execution latency sensitivity.

Arithmetic mean alone MUST NOT be the promotion metric because heavy positive
tails can dominate it.
Win rate alone MUST NOT be the promotion metric because frequent small wins can
hide catastrophic losses.

---

## 10. Statistical anti-overfit contract

S0 does not treat nominal p-values from the winning searched model as
confirmatory.

Required research accounting:

- immutable count of tried hypotheses / configurations;
- null/permutation baselines;
- dependence-aware resampling when launches cluster in time;
- search-adjusted inference when comparing many candidate strategies;
- prospective untouched witness as the final promotion evidence.

Candidate methods include, as appropriate after sample-size review:

- White Reality Check;
- Hansen SPA;
- Romano-Wolf stepdown;
- Probability of Backtest Overfitting / CSCV;
- Deflated Sharpe Ratio or an analogous search-adjusted statistic.

No method is copied mechanically when its assumptions do not match the paired,
heavy-tailed, temporally dependent launch data.

---

## 11. Calibration contract

A future strategy should not emit uncalibrated “confidence = 0.92” style scores.

For every probabilistic head:

- retain reliability / calibration bins;
- Brier or another proper scoring rule;
- log score where numerically safe;
- calibration slope/intercept or equivalent;
- cohort/time stability;
- sample count in each region.

Probabilities are research outputs until calibration is prospectively adequate.

---

## 12. Adversarial model

Assume counterparties adapt.

Explicit adversarial scenarios:

- creator rotates fresh addresses;
- funding route uses intermediate wallets;
- wash trading fabricates volume and buyer count;
- coordinated wallets mimic organic topology;
- social accounts / comments fabricate attention;
- liquidity appears sufficient until coordinated sell;
- candidate passes at decision time but degrades before inclusion;
- graduation happens between entry and exit;
- RPC/provider degradation selectively removes hard cases;
- research misses rejected outcomes and makes the gate look better;
- a model version leaks future labels through cached or reconstructed metadata.

Each S0 feature/policy acceptance test should map to at least one adversarial
scenario.

---

## 13. Promotion law

S0 may justify a live **strategy canary** only after a frozen prospective policy
beats its preregistered control under the preregistered economic objective
without violating catastrophe / evidence / calibration constraints.

Even then:

- live notional starts independently bounded;
- E4C execution invariants remain unchanged;
- live capital is not derived from `capacityUsdMicros`;
- repeated reliability is a separate stage;
- capital scaling is a separate stage;
- model retraining is a separate stage.

A favorable backtest alone can never promote S0 to live.

---

## 14. Compressed implementation plan — three PRs, not thirteen

The numbered concerns above are **not** intended to become one PR each.
Infrastructure is not research output; the implementation must minimize
coordination cost.

### PR-A — SENTRY research export + parity hardening

One bounded SENTRY PR owns all evidence-side seams required before modeling:

- emit one canonical, content-addressed **pre-outcome feature packet** per launch;
- emit outcomes separately so a feature consumer cannot accidentally see future
  labels;
- bind `ExecutionPersona` / address-dependent treatment;
- record feature/decision/quote latency fields;
- add a separately versioned net-cost projection;
- clarify R1 `capacityUsdMicros` as
  `INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL`;
- expose diagnostic entity-linkage inputs/edges without promoting them to a
  strategy veto;
- include finite-capital occupancy/concurrency fields needed later.

Do **not** add an ML framework, feature store, experiment database, notebook
service, or model dependency to SENTRY.

Output is immutable JSON/JSONL with canonical digests. Analytical columnar
materializations may be derived downstream; they are never the evidence
authority.

### PR-B — QntyLab S0 research adapter + bounded model family

One QntyLab PR consumes PR-A packets and reuses the existing QntyLab research
ledger instead of creating a new `StrategyTrialReceipt` subsystem.

Reuse directly:

- `qntylab/research_ledger.py` append-only candidates / decisions / trials;
- deterministic `variant_id` and `trial_id`;
- existing receipt/source/input SHA-256 bindings;
- registered-screen denominator fields;
- the existing `EXPLORE -> FORMULATE -> FREEZE -> TEST` research philosophy.

Borrow methodology, but do not create a runtime dependency, from Qnty:

- chronological / walk-forward evaluation discipline;
- trial-count-aware inference;
- experiment indexing / promotion-gate concepts;
- content-addressed artifact discipline.

Initial model denominator is deliberately tiny and frozen:

1. regularized logistic regression;
2. histogram gradient boosting;
3. mechanical control;
4. existing FAST_VET deterministic comparator.

No AutoML search. No unregistered hyperparameter sweep.

PR-B emits:

- append-only trial events;
- null/ablation results;
- calibration diagnostics;
- chronological holdout results;
- one content-addressed candidate strategy artifact only if earned.

### PR-C — SENTRY prospective witness adapter

Created **only if PR-B earns it**.

One small SENTRY PR:

- consumes exactly one frozen, content-addressed strategy artifact;
- performs inference only; never trains;
- emits immutable prediction/decision receipts before outcome availability;
- runs zero-capital alongside C0/C1;
- collects outcomes for accepts and rejects;
- implements the preregistered stopping rule.

PR-C grants no live-money authority.

Only after S0C closes may a separately authorized live strategy canary be
discussed.

### Explicitly rejected infrastructure for S0 V1

Do not add these merely because they are popular:

- MLflow / Weights & Biases — QntyLab already has an append-only research ledger;
- Optuna / AutoML — expands the hidden search denominator before we need it;
- Feast or another feature store — canonical SENTRY packets already define the
  point-in-time handoff;
- DVC — existing Git/content-addressed evidence is sufficient for this bounded
  dataset;
- Ray / Spark — no demonstrated scale problem;
- PyTorch / GNN stack — entity linkage starts as deterministic graph features;
- a shared cross-repo database — violates the immutable-artifact boundary.

### Reuse hierarchy

Prefer in order:

1. existing QntyLab primitive;
2. existing SENTRY primitive;
3. small standard/open-source library;
4. tiny new adapter;
5. new framework only after profiling or a blocked scientific question proves
   it necessary.

---

## 15. Literature anchors

- D. L. Parnas (1972), *On the Criteria to Be Used in Decomposing Systems into
  Modules*, Communications of the ACM. DOI: 10.1145/361598.361623.
- Halbert White (2000), *A Reality Check for Data Snooping*, Econometrica.
  DOI: 10.1111/1468-0262.00152.
- Peter R. Hansen (2005), *A Test for Superior Predictive Ability*, Journal of
  Business & Economic Statistics. DOI: 10.1198/073500105000000063.
- Joseph Romano & Michael Wolf (2005), *Stepwise Multiple Testing as Formalized
  Data Snooping*, Econometrica. DOI: 10.1111/j.1468-0262.2005.00615.x.
- Bailey, Borwein, López de Prado & Zhu, *The Probability of Backtest
  Overfitting*, Journal of Computational Finance / SSRN 2326253.
- Bailey & López de Prado (2014), *The Deflated Sharpe Ratio*, Journal of
  Portfolio Management.
- Harvey, Liu & Zhu (2016), *… and the Cross-Section of Expected Returns*,
  Review of Financial Studies 29(1), 5–68.
- Novy-Marx & Velikov (2016), *A Taxonomy of Anomalies and Their Trading
  Costs*, Review of Financial Studies 29(1), 104–147.
- Hasbrouck (1991), *Measuring the Information Content of Stock Trades*,
  Journal of Finance 46(1), 179–207.
- Almgren & Chriss (2001), *Optimal Execution of Portfolio Transactions*,
  Journal of Risk.
- Daian et al. (2020), *Flash Boys 2.0*, IEEE Symposium on Security and
  Privacy / arXiv:1904.05234.
- Angeris & Chitra (2020), *Improved Price Oracles: Constant Function Market
  Makers*, AFT 2020 / arXiv:2003.10001.
- Xia et al. (2021), *Trade or Trick? Detecting and Characterizing Scam Tokens
  on Uniswap*, arXiv:2109.00229.
- Gan, Wang & Lin (2023), *Why Trick Me: The Honeypot Traps on Decentralized
  Exchanges*, arXiv:2309.13501.
- Huynh et al. (2024), *Serial Scammers and Attack of the Clones*, arXiv:
  2412.10993.
- Gama et al. (2014), *A Survey on Concept Drift Adaptation*, ACM Computing
  Surveys 46(4).
- Gneiting & Raftery / probabilistic-forecasting literature; Waghmare & Ziegel
  (2026), *Proper Scoring Rules for Estimation and Forecast Evaluation*,
  Annual Review of Statistics and Its Application 13.
- Szwajcok et al. (2026), *Meme Coin Factories: Uncovering Large-Scale
  Manipulations on pump.fun*, arXiv:2609.10246.

---

## 16. Verdict

Proceed toward strategy research, but **do not wire FAST_VET or any learned
score into live execution yet**.

The smallest correct successor is:

`PONS_S0_PROSPECTIVE_STRATEGY_PREREG_V1`

Its first implementation deliverables are trial accounting, execution-persona
parity, latency semantics, capacity semantic hardening, and diagnostic entity
linkage.

Only after those foundations exist should feature/model experiments be treated
as promotion evidence.
