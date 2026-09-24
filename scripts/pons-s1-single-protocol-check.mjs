#!/usr/bin/env node
// Offline, no-provider qualification of an INERT S1 design candidate.
// This does not activate prospective collection, validate market performance
// or grant permission to merge, sign or broadcast.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const path = new URL('../docs/experiments/pons-s1-single-protocol-decision-v1.json', import.meta.url);
const manuscript = new URL('../docs/PONS_S1_SHORT_EXIT_PREREG_V1.md', import.meta.url);
const body = JSON.parse(await readFile(path, 'utf8'));
const primary = await readFile(manuscript, 'utf8');

function valid(p) {
  assert.equal(p.schemaVersion, 'PONS_S1_SINGLE_PROTOCOL_DECISION_V1');
  assert.equal(p.status, 'DRAFT_RECONCILED_NOT_ACTIVE');
  assert.equal(p.basis.primaryDraftPr, 76);
  assert.equal(p.basis.primaryDraftHead, '9ca036b2ac109cd16ade8a74647734801b949f11');
  assert.deepEqual(p.basis.supersededIncompatibleDraftPrs, [73, 74, 75]);
  assert.equal(p.basis.independentSpeedObserverPr, 77);
  assert.equal(p.basis.s0Usage, 'HISTORICAL_CONTEXT_ONLY_NO_S1_VALIDATION');
  assert.equal(p.basis.legacy96In24hCollectorCompatible, false);
  assert.equal(p.basis.legacyLaunchAnchoredExitCompatible, false);

  assert.equal(p.population.chainId, 4663);
  assert.equal(p.population.launchAuthority, 'REVIEWED_PONS_V2_FACTORY_NATIVE_ETH_ONLY');
  assert.equal(p.population.fullFactoryCensusIncludingNonNative, true);
  assert.equal(p.population.decision, 'C0_WOULD_TRADE_AT_LAUNCH_PLUS_2');
  assert.equal(p.population.maxConsecutiveEligibleDecisions, 200);
  assert.equal(p.population.maxWindowSeconds, 7 * 24 * 60 * 60);
  assert.equal(p.population.stopRule, 'FIRST_200_ELIGIBLE_DECISIONS_OR_7D_WHICHEVER_FIRST');
  for (const k of ['retainAllSkipsAndLaterFailures', 'neverReplaceFailedEntry',
    'eligibilityObservedBeforeOutcomes', 'preOutcomeC0EligibilityMustBeSealed',
    'unknownEligibilityMustRemainInCensus', 'unknownEligibilityInvalidatesCompleteDenominator']) assert.equal(p.population[k], true, k);

  assert.equal(p.timing.origin, 'AFTER_SEPARATE_CANONICAL_ACTIVATION_RECEIPT_AND_BLOCK_HASH');
  assert.equal(p.timing.minimumFinalityConfirmations, 12);
  assert.equal(p.timing.selectionWitnessBeforeEarliestFiveMinuteOutcome, true);
  assert.equal(p.timing.syntheticInclusionRule, 'QUALIFY_AND_FREEZE_BEFORE_ACTIVATION_OUTCOME_BLIND');
  assert.equal(p.timing.sameModeledEntryForBothArms, true);
  assert.equal(p.timing.targetAnchor, 'ACTUAL_TIMESTAMP_OF_PREDETERMINED_SYNTHETIC_INCLUSION_BLOCK');
  assert.equal(p.timing.syntheticInclusionIsNotRealFill, true);
  assert.equal(p.timing.lagNotAssumedZero, true);
  assert.equal(p.entry.notionalUsdMicros, 1_000_000);
  assert.equal(p.entry.mechanicalEntry, 'FROZEN_C0_AT_LAUNCH_PLUS_2');
  assert.equal(p.entry.sequentialPostBuyExitCapacityRequired, true);
  assert.equal(p.entry.liveWalletPersonaParityUnverified, true);
  assert.deepEqual(p.arms, [
    { name: 'S1_5M_R1', fixedHorizonMs: 300000,
      action: 'FULL_BALANCE_EXIT_FIRST_CANONICAL_BLOCK_AT_OR_AFTER_ANCHOR_PLUS_HORIZON' },
    { name: 'CONTROL_24H_R1', fixedHorizonMs: 86400000,
      action: 'FULL_BALANCE_EXIT_FIRST_CANONICAL_BLOCK_AT_OR_AFTER_ANCHOR_PLUS_HORIZON' }
  ]);

  for (const k of ['independentFactorySourceAgreementRequired',
    'immutableExternalBatchSealBeforeOutcomeRequired', 'fullCurveOrV4PhaseAndRouteRequired',
    'entryGasRequired', 'conditionalApprovalAndPermit2GasRequired',
    'exitAndRecoveryGasRequired', 'gasPriceAndUsdCalibrationRequired',
    'slippageAndAdverseMovementRequired', 'preventQuoteFeeDoubleCount',
    'preOutcomeC0DecisionReceiptsInImmutableBatchRequired']) {
    assert.equal(p.evidence[k], true, k);
  }
  assert.equal(p.evidence.missingCostOrRoute, 'UNVERIFIED_NEVER_ZERO');
  assert.equal(p.evidence.shadowNetReturn, 'MODELED_ONLY_NOT_REALIZED');

  for (const k of ['preOutcomePowerReviewRequired', 'fullDenominatorUnresolvedBoundsRequired',
    'pairedPositiveNetVersus24hRequired', 'absolutePositiveNetVersus1UsdRequired',
    'timeClusteredUncertaintyRequired', 'noInterimOutcomePeek', 'noHorizonTuning']) {
    assert.equal(p.assessment[k], true, k);
  }
  assert.equal(p.assessment.ifBelow200Within7d, 'INSUFFICIENT_PROSPECTIVE_COHORT');
  assert.equal(p.assessment.ifUnderpoweredBeforeActivation,
    'DO_NOT_ACTIVATE_VERSION_NEW_OUTCOME_UNSEEN_SPEC_REQUIRED');
  assert.equal(p.assessment.ifDataIntegrityIncomplete, 'INCONCLUSIVE_NOT_AN_ECONOMIC_RESULT');
  assert.equal(p.assessment.ifBothPositiveGatesPass,
    'REQUEST_SEPARATE_VALIDATION_NOT_LIVE_PROMOTION');

  assert.match(p.reuse.pr74, /MUST_ADAPT_AND_REQUALIFY$/);
  assert.match(p.reuse.pr75, /MUST_ADAPT_AND_REQUALIFY$/);
  assert.match(p.reuse.pr77, /NOT_AN_EDGE_ESTIMATE$/);
  assert.deepEqual(Object.keys(p.authority).sort(), [
    'broadcastAuthorized', 'liveMoneyAuthorized', 'mergeAuthorized',
    'modelPromotionAuthorized', 'prospectiveCollectionAuthorized', 'signingAuthorized',
    'unattendedTradingAuthorized'
  ].sort());
  for (const [k, v] of Object.entries(p.authority)) assert.equal(v, false, k);
}

// Ensure the declared decision actually builds on the separate, currently
// reviewed inclusion-anchored #76 design, not a silent launch-anchored rewrite.
assert.match(primary, /first \*\*200 consecutive native-pair C0/);
assert.match(primary, /seven days after activation/);
assert.match(primary, /identical fixed modeled entry-inclusion block/);
assert.match(primary, /verified net \$1 terminal capital/);
valid(body);

const negatives = [
  ['legacy 96 population', p => { p.population.maxConsecutiveEligibleDecisions = 96; }],
  ['legacy 24h window', p => { p.population.maxWindowSeconds = 86400; }],
  ['legacy launch clock', p => { p.timing.targetAnchor = 'LAUNCH_TIMESTAMP'; }],
  ['old collector compatibility', p => { p.basis.legacy96In24hCollectorCompatible = true; }],
  ['hidden failed-entry exclusion', p => { p.population.neverReplaceFailedEntry = false; }],
  ['post-outcome enrollment', p => { p.population.eligibilityObservedBeforeOutcomes = false; }],
  ['seal only event IDs, not C0', p => { p.population.preOutcomeC0EligibilityMustBeSealed = false; }],
  ['omit unknown C0 decisions from census', p => { p.population.unknownEligibilityMustRemainInCensus = false; }],
  ['count unknown eligibility as a complete cohort', p => { p.population.unknownEligibilityInvalidatesCompleteDenominator = false; }],
  ['late C0 reconstruction permitted', p => { p.evidence.preOutcomeC0DecisionReceiptsInImmutableBatchRequired = false; }],
  ['no pre-outcome seal', p => { p.timing.selectionWitnessBeforeEarliestFiveMinuteOutcome = false; }],
  ['zero-latency shortcut', p => { p.timing.lagNotAssumedZero = false; }],
  ['different arm entry blocks', p => { p.timing.sameModeledEntryForBothArms = false; }],
  ['drop 24h control', p => { p.arms.pop(); }],
  ['skip V4 attribution', p => { p.evidence.fullCurveOrV4PhaseAndRouteRequired = false; }],
  ['missing gas treated free', p => { p.evidence.missingCostOrRoute = 'ASSUME_ZERO'; }],
  ['no full-population bounds', p => { p.assessment.fullDenominatorUnresolvedBoundsRequired = false; }],
  ['no power review', p => { p.assessment.preOutcomePowerReviewRequired = false; }],
  ['live authority creep', p => { p.authority.liveMoneyAuthorized = true; }],
  ['collection activated', p => { p.status = 'ACTIVE'; }],
  ['merge authority creep', p => { p.authority.mergeAuthorized = true; }]
];
for (const [name, mutate] of negatives) {
  const corrupted = structuredClone(body);
  mutate(corrupted);
  assert.throws(() => valid(corrupted), undefined, name);
}

console.log(JSON.stringify({schemaVersion:body.schemaVersion,
  verdict:'PASS_OFFLINE_INERT_PROTOCOL_GUARD',negativeCases:negatives.length,
  studyState:body.status,prospectiveCollectionAuthorized:false,
  liveMoneyAuthorized:false}));
