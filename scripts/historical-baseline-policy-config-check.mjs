import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EXECUTABLE_BASELINE_R1,
  HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1,
  deriveBaselineId,
  deriveBaselineQuoteId
} from '../dist/shadow/baselineTypes.js';
import { sha256Hex } from '../dist/evidence/canonical.js';
import { scaleUsdMicrosByOracleCeil } from '../dist/tsunami/historicalRedstoneBaselineSource.js';

const launchId = 'historical-policy-config-check-launch';
const decisionBlock = 123n;
const decisionBlockHash = `0x${'12'.repeat(32)}`;
const notionalUsdMicros = 1_000_000n;

const legacyBaselineId = await sha256Hex({
  kind: EXECUTABLE_BASELINE_R1,
  launchId,
  decisionBlock,
  decisionBlockHash
});
assert.equal(
  await deriveBaselineId({ launchId, decisionBlock, decisionBlockHash }),
  legacyBaselineId,
  'default R1 baseline ID changed'
);

const legacyQuoteId = await sha256Hex({
  kind: 'BASELINE_QUOTE_R1',
  launchId,
  decisionBlockHash,
  quoteKind: 'ENTRY',
  notionalUsdMicros
});
assert.equal(
  await deriveBaselineQuoteId({ launchId, decisionBlockHash, kind: 'ENTRY', notionalUsdMicros }),
  legacyQuoteId,
  'default R1 quote ID changed'
);

const historicalBaselineId = await deriveBaselineId({
  launchId,
  decisionBlock,
  decisionBlockHash,
  policyVersion: HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1
});
assert.notEqual(historicalBaselineId, legacyBaselineId, 'historical baseline ID aliases current R1');

const historicalQuoteId = await deriveBaselineQuoteId({
  launchId,
  decisionBlockHash,
  kind: 'ENTRY',
  notionalUsdMicros,
  policyVersion: HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1
});
assert.notEqual(historicalQuoteId, legacyQuoteId, 'historical quote ID aliases current R1');

assert.equal(
  scaleUsdMicrosByOracleCeil(1_000_000n, 18, 8, 200_000_000_000n),
  500_000_000_000_000n,
  '$1 at $2000/ETH should size to 0.0005 WETH'
);
assert.equal(
  scaleUsdMicrosByOracleCeil(1_000_000n, 18, 8, 300_000_000n),
  333_333_333_333_333_334n,
  'historical sizing must use ceiling division'
);

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_BASELINE_POLICY_R1.json', 'utf8'));
assert.equal(packet.state, 'HISTORICAL_BASELINE_POLICY_IMPLEMENTATION_AUTHORIZED');
assert.equal(packet.authorization.historical_baseline_policy_implementation, true);
assert.equal(packet.authorization.full_147_replay, false);
assert.equal(packet.authorization.fast_vet, false);
assert.equal(packet.authorization.canary, false);
assert.equal(packet.authorization.merge, false);
assert.equal(packet.historical_policy.policy_version, HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1);
assert.equal(packet.historical_policy.weth_calibration_kind, 'WETH_REDSTONE_ETH_USD_ASOF_V1');

console.log('historical baseline policy config check: PASS');
