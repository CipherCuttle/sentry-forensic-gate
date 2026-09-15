import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadFrozenScopeManifest } from './historical-full-replay-scope-fixture.mjs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_FULL_REPLAY_R1.json';
const AUTHORIZATION_CLOSURE_HEAD = 'efade9f625aeffc3f6e88494e13ac058c9ffb1ae';
const SCOPE_DIGEST = 'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211';
const SCOPE_PAYLOAD_SHA = 'c8188726b28e72a72ffc5c8233a416c2fb531d2e6e3229f8906969d9dc1609a0';
const SCOPE_COMPRESSED_SHA = '72a2b881c88ed1219b35406b129e5ea58968b0466cafcbe10a4a42468cd85813';
const BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
const EXPECTED_HORIZONS = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '24h', ms: 86_400_000 },
];
const EXPECTED_NOTIONALS = [250_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
const EXPECTED_COUNTS = [2, 5, 22, 29, 4, 22, 2, 2, 59];
const EXPECTED_START_ORDINALS = [1, 3, 8, 30, 59, 63, 85, 87, 89];
const EXPECTED_COHORTS = [
  ['0xf6b81e4a431aa5c459b7502802bab306ce465146', '39943476', '1'],
  ['0x3f01f1e0d8b76e0a7bf476335a9ebcb6755df536', '40032260', '5'],
  ['0x6f269786695fcd8cc684ebf37604dd2fb1797fcc', '42060479', '24'],
  ['0x71b2296124ce438bf2d0fef01e0adbd14a020282', '44137983', '49'],
  ['0xfab1d73e877947fabe2d0966f9832541b6f82750', '45634572', '82'],
  ['0xbe0e8f5d351b6acb0ec5c4ce6d2ba6c602bbb80f', '45813860', '86'],
  ['0x28ed07daba4ca9025819b64e1abb98d6c15ba069', '46611372', '108'],
  ['0x3515ce96c5c6fb8e73ebe04756f2227d035d6334', '46637160', '110'],
  ['0xd5bced4c43eef627ee0524368cabafcb9f29cff0', '46667534', '112'],
];
const AUTHORIZATION_KEYS = [
  'historical_compatibility_implementation',
  'historical_baseline_policy_discovery',
  'historical_baseline_policy_implementation',
  'historical_outcome_policy_discovery',
  'historical_outcome_policy_implementation',
  'historical_all_horizon_compatibility_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'signing',
  'transaction_construction',
  'transaction_broadcast',
  'live_execution',
  'merge',
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  invariant(JSON.stringify(actual) === JSON.stringify(wanted), `${label} keyset drift`);
}

function validateReviewedCohorts(packet) {
  const gate = packet.authority_map_gate;
  invariant(gate?.required === true, 'authority map gate must be required');
  invariant(gate?.status === 'PENDING_VERIFICATION', 'preregistered authority map gate must remain PENDING_VERIFICATION');
  invariant(gate?.output_path === 'fixtures/historical-full-replay-authority-map-r1.json', 'authority map output path drift');
  invariant(gate?.authority_map_sha256 === null, 'pending authority map must not predeclare digest');
  invariant(gate?.mapping_rule === 'PARTITION_FROZEN_LAUNCH_ORDER_BY_REVIEWED_CHRONOLOGICAL_COHORT_COUNTS_AND_VERIFY_EACH_PARTITION_START_AGAINST_REVIEWED_REPRESENTATIVE', 'authority mapping rule drift');
  invariant(JSON.stringify(gate?.expected_cohort_counts) === JSON.stringify(EXPECTED_COUNTS), 'historical cohort count vector drift');
  invariant(JSON.stringify(gate?.expected_start_ordinals) === JSON.stringify(EXPECTED_START_ORDINALS), 'historical cohort start ordinals drift');
  invariant(EXPECTED_COUNTS.reduce((a, b) => a + b, 0) === 147, 'reviewed historical cohort counts must sum to 147');
  invariant(Array.isArray(gate?.cohorts) && gate.cohorts.length === 9, 'authority map gate must contain nine reviewed cohorts');

  gate.cohorts.forEach((cohort, index) => {
    const [implementation, blockNumber, tokenId] = EXPECTED_COHORTS[index];
    invariant(cohort.ordinal === index + 1, `cohort ordinal drift:${index + 1}`);
    invariant(cohort.implementation === implementation, `cohort implementation drift:${index + 1}`);
    invariant(cohort.launches === EXPECTED_COUNTS[index], `cohort launch count drift:${index + 1}`);
    invariant(cohort.first_launch_block === blockNumber, `cohort first launch block drift:${index + 1}`);
    invariant(cohort.first_token_id === tokenId, `cohort first token id drift:${index + 1}`);
  });

  const fixture = JSON.parse(fs.readFileSync('fixtures/historical-compatibility-r1.json', 'utf8'));
  invariant(fixture.schema === 'historical-compatibility-r1-fixtures/v1', 'reviewed historical representative fixture schema drift');
  invariant(Array.isArray(fixture.representatives) && fixture.representatives.length === 9, 'reviewed representative fixture must contain nine rows');
  fixture.representatives.forEach((representative, index) => {
    const [implementation, blockNumber, tokenId] = EXPECTED_COHORTS[index];
    invariant(representative.implementation === implementation, `reviewed representative implementation drift:${index + 1}`);
    invariant(representative.blockNumber === blockNumber, `reviewed representative block drift:${index + 1}`);
    invariant(representative.tokenId === tokenId, `reviewed representative token id drift:${index + 1}`);
  });

  invariant(!fs.existsSync(gate.output_path), 'pending Stage A must not already contain an unpinned authority map fixture');
}

export function validatePacket(packet) {
  invariant(packet.schema === 'dev-spine-phase/v1', 'unexpected packet schema');
  invariant(packet.repo === 'CipherCuttle/sentry-forensic-gate', 'unexpected repo');
  invariant(packet.phase === 'HISTORICAL_FULL_REPLAY_R1', 'unexpected phase');
  invariant(packet.state === 'HISTORICAL_FULL_REPLAY_IMPLEMENTATION_AUTHORIZED', 'unexpected phase state');
  invariant(packet.next_action === 'BUILD_AND_VERIFY_147_LAUNCH_AUTHORITY_MAP', 'Stage A authority map must be next');
  invariant(Array.isArray(packet.authority_docs) && packet.authority_docs.length > 0, 'authority_docs required');
  invariant(Array.isArray(packet.context_files) && packet.context_files.length > 0, 'context_files required');
  for (const path of new Set([...packet.authority_docs, ...packet.context_files])) {
    invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `authority/context file missing: ${path}`);
  }

  exactKeys(packet.authorization, AUTHORIZATION_KEYS, 'authorization');
  for (const key of AUTHORIZATION_KEYS) {
    invariant(typeof packet.authorization[key] === 'boolean', `authorization.${key} must be boolean`);
    const expected = key === 'full_147_replay';
    invariant(packet.authorization[key] === expected, `implementation state requires authorization.${key}=${expected}`);
  }

  invariant(packet.authority?.current_default === 'R3', 'current default authority drift');
  invariant(packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 invariant drift');
  invariant(packet.authority?.historical_full_replay_authorized === true, 'historical full replay authorization missing');
  invariant(packet.authority?.research_only === true, 'full replay must remain research only');

  const predecessor = packet.predecessor;
  invariant(predecessor?.phase === 'HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1', 'authorization predecessor phase drift');
  invariant(predecessor?.pr === 22, 'authorization predecessor PR drift');
  invariant(predecessor?.closure_head === AUTHORIZATION_CLOSURE_HEAD, 'authorization predecessor closure head drift');
  invariant(predecessor?.verdict === 'CLOSED_AUTHORIZE', 'authorization predecessor verdict drift');
  invariant(predecessor?.scope_identity_sha256 === SCOPE_DIGEST, 'authorization predecessor scope digest drift');
  invariant(predecessor?.hostile_review?.id === 5204327465 && predecessor.hostile_review.reviewed_head === 'be0259b1845787b651ad8ffdad32b693bc2c76ce', 'initial hostile review evidence drift');
  invariant(predecessor?.targeted_rereview?.id === 5204380099 && predecessor.targeted_rereview.reviewed_head === 'e527255949ffd72409284a379cf4428c48aa855f', 'targeted re-review evidence drift');
  const exactRuns = {
    ci: 34914934591,
    historical_baseline_policy: 34914934649,
    historical_outcome_policy: 34914934625,
    historical_all_horizon_compatibility: 34914934604,
    historical_full_replay_authorization: 34914934640,
  };
  for (const [name, id] of Object.entries(exactRuns)) {
    invariant(predecessor?.exact_head_runs?.[name]?.id === id && predecessor.exact_head_runs[name].status === 'SUCCESS', `authorization closure workflow drift:${name}`);
  }

  const scope = packet.frozen_scope;
  invariant(scope?.manifest_path === 'fixtures/historical-full-replay-scope-r1.json', 'frozen scope path drift');
  invariant(scope?.expected_launches === 147 && scope?.first_launch_block === 39943476 && scope?.final_launch_block === 49271598, 'frozen scope range/count drift');
  invariant(scope?.launch_identity_sha256 === SCOPE_DIGEST, 'frozen scope identity digest drift');
  invariant(scope?.payload_sha256 === SCOPE_PAYLOAD_SHA, 'frozen scope payload digest drift');
  invariant(scope?.compressed_payload_sha256 === SCOPE_COMPRESSED_SHA, 'frozen scope compressed digest drift');
  const frozen = loadFrozenScopeManifest(scope.manifest_path);
  invariant(frozen.manifest.launches.length === 147, 'frozen scope manifest must contain 147 launches');
  invariant(frozen.index.launchIdentitySha256 === SCOPE_DIGEST, 'committed frozen scope identity digest drift');

  const policy = packet.frozen_policies;
  invariant(policy?.baseline_policy_version === BASELINE_POLICY, 'historical baseline policy drift');
  invariant(policy?.outcome_policy_version === OUTCOME_POLICY, 'historical outcome policy drift');
  invariant(policy?.decision_delay_blocks === 2, 'decision delay drift');
  invariant(JSON.stringify(policy?.baseline_notionals_usd_micros) === JSON.stringify(EXPECTED_NOTIONALS), 'baseline notional vector drift');
  invariant(JSON.stringify(policy?.horizons) === JSON.stringify(EXPECTED_HORIZONS), 'frozen horizon set drift');
  invariant(policy?.weth_valuation_kind === 'WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1', 'historical WETH valuation kind drift');
  invariant(policy?.freshness_rejection_threshold_seconds === null, 'historical freshness semantics drift');

  validateReviewedCohorts(packet);

  const replay = packet.replay_contract;
  invariant(replay?.expected_launch_receipts === 147, 'full replay launch receipt count drift');
  invariant(replay?.expected_horizon_cells === 735, 'full replay horizon-cell count drift');
  invariant(replay?.economic_complete_required_for_phase_pass === false, 'phase PASS must not require all economic cells COMPLETE');
  for (const key of [
    'accounting_complete_required_for_phase_pass',
    'baseline_unverified_is_valid_evidence',
    'outcome_unverified_is_valid_evidence',
    'provider_transport_failure_is_not_market_evidence',
    'per_launch_per_horizon_receipts_required',
    'no_policy_mutation_after_observing_results',
  ]) invariant(replay?.[key] === true, `replay_contract.${key} must remain true`);

  for (const key of [
    'authority_map_must_be_frozen_before_replay',
    'scope_must_equal_frozen_147',
    'point_in_time_inputs_only',
    'reuse_reviewed_baseline_pipeline',
    'reuse_reviewed_outcome_pipeline',
    'all_147_launches_accounted',
    'all_735_horizon_cells_accounted',
    'unverified_remains_explicit',
    'current_r3_must_remain_unchanged',
  ]) invariant(packet.acceptance?.[key] === true, `acceptance.${key} must remain true`);
}

function main() {
  try {
    const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
    validatePacket(packet);
    console.log(`DEV_SPINE_CHECK=PASS phase=${packet.phase} state=${packet.state}`);
  } catch (error) {
    console.error(`DEV_SPINE_CHECK=FAIL ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
