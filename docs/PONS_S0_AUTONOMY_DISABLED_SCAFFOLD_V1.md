# Pons S0 Autonomy Disabled Scaffold V1

## Status

**DISABLED ENGINEERING ONLY / EDGE_UNPROVEN / NO LIVE AUTHORITY**

This branch prepares family-agnostic contracts that can be reused after the real
S0 screen without changing or influencing that screen.

It does **not** choose C0, C1, M1 or M2 and contains no concrete model evaluator.

## Scope

The scaffold provides:

- a content-addressed frozen-strategy artifact envelope that must bind an exact
  QntyLab freeze commit and freeze-receipt digest;
- immutable one-shot prospective decision receipts;
- a prospective witness contract whose stop-rule values must be supplied
  explicitly (there are no default success thresholds);
- a separately named sequential-capacity evidence envelope;
- a deterministic finite-capital shadow reservation governor;
- fail-closed health / reconciliation states.

The SENTRY-side artifact helper is a deterministic codec/verifier only. A
production artifact is not authoritative unless its QntyLab freeze commit and
freeze-receipt digest are externally frozen and matched by the prospective
witness contract.

The governor explicitly rejects
`INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL` as sizing authority.

Position size is a fixed governor parameter, not a model output.

## Explicit non-scope

This branch does not:

- train or evaluate a model;
- serialize sklearn models;
- pick a winner;
- instantiate a prospective stop rule;
- sign transactions;
- broadcast transactions;
- read private keys;
- move money;
- grant live authority;
- merge into a scientific branch.

PR-C remains conditional on the real historical screen earning a frozen
prospective policy.

## Authority

- MERGE AUTHORITY: NONE
- LIVE-MONEY AUTHORITY: NONE
- SIGNING AUTHORITY: NONE
- BROADCAST AUTHORITY: NONE
- MODEL PROMOTION AUTHORITY: NONE

The strongest state this scaffold can represent is
`LIVE_READY_BUT_DISABLED`; it cannot produce live authority.
