import assert from 'node:assert/strict';
import {
  DEFAULT_BASELINE_NOTIONALS_USD_MICROS,
  EXECUTABLE_BASELINE_R1
} from '../dist/shadow/baselineTypes.js';
import {
  FAST_VET_R1_CAPACITY_GATE_CONFIGURATION,
  FAST_VET_R1_CAPACITY_SEMANTICS
} from '../dist/evaluation/fastVetR1CapacityGate.js';
import {
  PONS_S0_CAPACITY_SEMANTICS,
  PONS_S0_EXECUTION_PERSONA_PARITY,
  PONS_S0_FEATURE_PACKET_V1,
  PONS_S0_OUTCOME_PACKET_V1,
  buildPonsS0ExecutionCostEvidence,
  buildPonsS0FeaturePacket,
  buildPonsS0OutcomePacket,
  buildPonsS0ResearchExportBundle
} from '../dist/research/ponsS0ResearchExport.js';

const chainId = 4663;
const launchBlock = 100n;
const decisionBlock = 102n;
const token = '0x1111111111111111111111111111111111111111';
const factory = '0x2222222222222222222222222222222222222222';
const creator = '0x3333333333333333333333333333333333333333';
const curve = '0x4444444444444444444444444444444444444444';
const native = '0x0000000000000000000000000000000000000000';
const shadowRecipient = '0x5555555555555555555555555555555555555555';

function hash(block) {
  return `0x${block.toString(16).padStart(64, '0')}`;
}

const launch = {
  chainId,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchId: 'pons-s0-launch-1',
  eventId: 'pons-s0-event-1',
  factory,
  txHash: `0x${'ab'.repeat(32)}`,
  blockNumber: launchBlock,
  blockHash: hash(launchBlock),
  logIndex: 1,
  token,
  creator,
  name: 'S0 Candidate',
  symbol: 'S0',
  sourceEventName: 'TokenLaunched',
  observedAtMs: 1_000,
  sourceAuthority: {
    schema: 'ROBINHOOD_PONS_V2_TOKEN_LAUNCHED_V1',
    payload: {
      authorityId: 'test-authority',
      authorityFromBlock: '1',
      authorityThroughBlock: null,
      factoryRuntimeCodeHash: `0x${'11'.repeat(32)}`,
      launchId: 'pons-s0-launch-1',
      eventId: 'pons-s0-event-1',
      chainId,
      factory,
      blockNumber: launchBlock.toString(),
      blockHash: hash(launchBlock),
      txHash: `0x${'ab'.repeat(32)}`,
      logIndex: 1,
      token,
      curve,
      deployer: creator,
      pairToken: native,
      launchConfigId: '7',
      graduationThreshold: '1000000000000000000',
      sourceEvent: 'TokenLaunched',
      recordVerifiedAtBlockEnd: true,
      tokenCodePresent: true,
      curveCodePresent: true
    }
  }
};

const market = {
  marketId: 'pons-s0-market-1',
  launchId: launch.launchId,
  chainId,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchedToken: token,
  baseAsset: native,
  venue: 'PONS_V2_BONDING_CURVE',
  sourceAuthority: {
    schema: 'ROBINHOOD_PONS_V2_MARKET_STATE_R1',
    payload: {
      state: 'CURVE_ACTIVE'
    }
  }
};

function quoteAuthority({ kind, notional, amountIn, amountOut }) {
  return {
    schema: 'ROBINHOOD_PONS_V2_CURVE_QUOTE_R1',
    payload: {
      policyVersion: 'PONS_V2_CURVE_QUOTE_R1',
      kind,
      authorityId: 'test-authority',
      factoryRuntimeCodeHash: `0x${'11'.repeat(32)}`,
      curveTemplateAuthorityId: 'template',
      launchDeployer: '0x6666666666666666666666666666666666666666',
      launchDeployerRuntimeCodeHash: `0x${'22'.repeat(32)}`,
      launchId: launch.launchId,
      marketId: market.marketId,
      decisionBlock: decisionBlock.toString(),
      decisionBlockHash: hash(decisionBlock),
      curve,
      pairToken: native,
      shadowRecipient,
      quoteReserve: '10000000000000000000',
      tokenReserve: '1000000000000000000000000',
      trackedQuote: '5000000000000000000',
      sellableTokens: '700000000000000000000000',
      feeBps: '100',
      creatorTaxBps: '50',
      snipeTaxBps: '25',
      effectiveSnipeTaxBps: '25',
      amountInRequested: amountIn.toString(),
      amountInExecutable: amountIn.toString(),
      amountOut: amountOut.toString(),
      grossAmountOut: amountOut.toString(),
      feeAmount: '10',
      creatorTaxAmount: '5',
      snipeTaxAmount: kind === 'ENTRY' ? '2' : '0',
      partialFill: false,
      executable: true,
      failureReason: null,
      reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
      marketState: 'CURVE_ACTIVE'
    }
  };
}

function baseline() {
  return {
    baselineId: 'pons-s0-baseline-1',
    authorityDigest: 'baseline-authority-digest',
    launchId: launch.launchId,
    policyVersion: EXECUTABLE_BASELINE_R1,
    decisionBlock,
    decisionBlockHash: hash(decisionBlock),
    observedAtMs: 2_000,
    status: 'COMPLETE',
    market,
    legs: DEFAULT_BASELINE_NOTIONALS_USD_MICROS.map((notional, index) => {
      const baseAmount = notional * 1_000n;
      const tokens = notional * 10n;
      const reverseOut = (baseAmount * 9n) / 10n;
      return {
        notionalUsdMicros: notional,
        calibration: {
          notionalUsdMicros: notional,
          baseAsset: native,
          baseAmount,
          baseDecimals: 18,
          sourceAuthority: {
            schema: 'TEST_USD_CALIBRATION',
            payload: { notional: notional.toString() }
          }
        },
        entry: {
          quoteId: `entry-${notional}`,
          launchId: launch.launchId,
          marketId: market.marketId,
          blockNumber: decisionBlock,
          blockHash: hash(decisionBlock),
          observedAtMs: 2_100 + index * 2,
          kind: 'ENTRY',
          notionalUsdMicros: notional,
          tokenIn: native,
          tokenOut: token,
          amountIn: baseAmount,
          amountOut: tokens,
          executable: true,
          gasEstimate: 100_000n,
          sourceAuthority: quoteAuthority({
            kind: 'ENTRY',
            notional,
            amountIn: baseAmount,
            amountOut: tokens
          })
        },
        reverse: {
          quoteId: `reverse-${notional}`,
          launchId: launch.launchId,
          marketId: market.marketId,
          blockNumber: decisionBlock,
          blockHash: hash(decisionBlock),
          observedAtMs: 2_101 + index * 2,
          kind: 'INDEPENDENT_REVERSE_EXIT',
          notionalUsdMicros: notional,
          tokenIn: token,
          tokenOut: native,
          amountIn: tokens,
          amountOut: reverseOut,
          executable: true,
          gasEstimate: 120_000n,
          sourceAuthority: quoteAuthority({
            kind: 'INDEPENDENT_REVERSE_EXIT',
            notional,
            amountIn: tokens,
            amountOut: reverseOut
          })
        },
        independentReverseRecoveryBps: 9_000n
      };
    }),
    reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
    chainId,
    ecosystem: 'ROBINHOOD',
    launchProtocol: 'PONS',
    sourceAuthority: {
      schema: 'TEST_PORTABLE_BASELINE',
      payload: { baselineId: 'pons-s0-baseline-1' }
    }
  };
}

const creatorFeature = {
  receiptId: 'creator-feature-s0',
  derivationVersion: 'CREATOR_OUTCOME_JOIN_V0',
  chainId,
  launchId: launch.launchId,
  creator,
  baselineId: baseline().baselineId,
  decisionBlock,
  decisionBlockHash: hash(decisionBlock),
  horizonMs: 86_400_000,
  coverage: 'COMPLETE',
  priorLaunchCount: 2,
  outcomeReceiptCount: 2,
  classifiedOutcomeCount: 2,
  unresolvedOutcomeCount: 0,
  unsellableOutcomeCount: 0,
  catastrophicLossCount: 0,
  exitFailureCount: 0,
  liquidityCollapseCount: 0,
  normalLossCount: 1,
  normalWinCount: 1,
  fatTailWinCount: 0,
  sourceFactIds: ['fact-current', 'fact-prior'],
  sourceOutcomeIds: ['prior-outcome-1', 'prior-outcome-2'],
  inputDigest: 'creator-input',
  outputDigest: 'creator-output',
  evidenceDigest: 'creator-evidence'
};

const currentLaunchNode = `launch:${chainId}:${launch.launchId}`;
const creatorNode = `wallet:${chainId}:${creator}`;

const provenanceEdges = [
  {
    edgeId: 'edge-deployed-by',
    kind: 'DEPLOYED_BY',
    chainId,
    from: currentLaunchNode,
    to: creatorNode,
    evidenceClass: 'DIRECT_ONCHAIN',
    observedBlock: launchBlock,
    observedBlockHash: hash(launchBlock),
    sourceFactIds: ['fact-current'],
    derivationVersion: 'PROVENANCE_FACTS_R1',
    evidenceDigest: 'edge-evidence-1'
  },
  {
    edgeId: 'edge-previous',
    kind: 'PREVIOUS_LAUNCH',
    chainId,
    from: currentLaunchNode,
    to: `launch:${chainId}:previous-launch`,
    evidenceClass: 'DERIVED_JOIN',
    observedBlock: decisionBlock,
    observedBlockHash: hash(decisionBlock),
    sourceFactIds: ['fact-current', 'fact-prior'],
    derivationVersion: 'PROVENANCE_FACTS_R1',
    evidenceDigest: 'edge-evidence-2'
  }
];

assert.equal(
  FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.capacitySemantics,
  FAST_VET_R1_CAPACITY_SEMANTICS
);
assert.equal(
  FAST_VET_R1_CAPACITY_SEMANTICS,
  PONS_S0_CAPACITY_SEMANTICS
);

const feature = await buildPonsS0FeaturePacket({
  launch,
  baseline: baseline(),
  creatorFeature,
  provenanceEdges
});
assert.equal(feature.schemaVersion, PONS_S0_FEATURE_PACKET_V1);
assert.equal(feature.boundaries.containsTargetLaunchFutureOutcome, false);
assert.equal(feature.boundaries.liveMoneyAuthority, false);
assert.equal(feature.baseline.capacitySemantics, PONS_S0_CAPACITY_SEMANTICS);
assert.equal(feature.executionPersona.recipient, shadowRecipient);
assert.equal(feature.executionPersona.parity, PONS_S0_EXECUTION_PERSONA_PARITY);
assert.equal(feature.executionPersona.effectiveSnipeTaxBps, 25n);
assert.equal(feature.baseline.legs.length, 5);
assert.equal(feature.baseline.legs[0].entry.quoteState.quoteReserve, 10_000_000_000_000_000_000n);
assert.equal(feature.creatorHistory.priorLaunchCount, 2);
assert.deepEqual(
  feature.diagnosticEntityEdges.map((edge) => edge.edgeId),
  ['edge-deployed-by', 'edge-previous']
);
assert.equal(feature.policyComparison.receipts.r1.decision, 'ELIGIBLE');
assert.equal(
  feature.policyComparison.receipts.r1.capacityUsdMicros,
  5_000_000n
);

const featureAgain = await buildPonsS0FeaturePacket({
  launch,
  baseline: baseline(),
  creatorFeature,
  provenanceEdges: [...provenanceEdges].reverse()
});
assert.equal(featureAgain.packetId, feature.packetId);
assert.equal(featureAgain.evidenceDigest, feature.evidenceDigest);

await assert.rejects(
  () => buildPonsS0FeaturePacket({
    launch,
    baseline: baseline(),
    creatorFeature: { ...creatorFeature, decisionBlock: decisionBlock + 1n },
    provenanceEdges
  }),
  /PONS_S0_CREATOR_POINT_IN_TIME_MISMATCH/
);

const badQuoteBaseline = baseline();
badQuoteBaseline.legs[0].entry.blockNumber = decisionBlock + 1n;
await assert.rejects(
  () => buildPonsS0FeaturePacket({
    launch,
    baseline: badQuoteBaseline,
    creatorFeature,
    provenanceEdges
  }),
  /PONS_S0_ENTRY_POINT_IN_TIME_MISMATCH/
);

const badAuthorityBaseline = baseline();
badAuthorityBaseline.legs[0].entry.sourceAuthority = {
  ...badAuthorityBaseline.legs[0].entry.sourceAuthority,
  payload: {
    ...badAuthorityBaseline.legs[0].entry.sourceAuthority.payload,
    launchId: 'other-launch'
  }
};
await assert.rejects(
  () => buildPonsS0FeaturePacket({
    launch,
    baseline: badAuthorityBaseline,
    creatorFeature,
    provenanceEdges
  }),
  /PONS_S0_QUOTE_AUTHORITY_BINDING_MISMATCH/
);

await assert.rejects(
  () => buildPonsS0FeaturePacket({
    launch,
    baseline: baseline(),
    creatorFeature,
    provenanceEdges: [
      ...provenanceEdges,
      {
        ...provenanceEdges[1],
        edgeId: 'edge-future',
        observedBlock: decisionBlock + 1n,
        observedBlockHash: hash(decisionBlock + 1n),
        evidenceDigest: 'future-edge'
      }
    ]
  }),
  /PONS_S0_ENTITY_EDGE_LOOKAHEAD/
);

function outcome(horizonMs, overrides = {}) {
  return {
    outcomeId: `outcome-${horizonMs}`,
    authorityDigest: `outcome-authority-${horizonMs}`,
    chainId,
    ecosystem: 'ROBINHOOD',
    launchProtocol: 'PONS',
    launchId: launch.launchId,
    baselineId: baseline().baselineId,
    horizonMs,
    status: 'COMPLETE',
    observedBlock: 200n + BigInt(horizonMs),
    observedBlockHash: hash(200n + BigInt(horizonMs)),
    targetTimestampMs: 10_000 + horizonMs,
    observedTimestampMs: 10_100 + horizonMs,
    entryNotionalUsdMicros: 1_000_000n,
    exitExecutable: true,
    baseAsset: native,
    baseAmountOut: 1_200_000n,
    executableValueUsdMicros: 1_200_000n,
    executableReturnBps: 12_000n,
    slippageBps: 25n,
    classification: 'NORMAL_WIN',
    liquidity: {
      state: 'SURVIVED',
      sourceAuthority: {
        schema: 'TEST_LIQUIDITY',
        payload: { state: 'SURVIVED' }
      }
    },
    sourceAuthority: {
      schema: 'TEST_FORWARD_OUTCOME',
      payload: { horizonMs }
    },
    ...overrides
  };
}

const oneMinuteCost = await buildPonsS0ExecutionCostEvidence({
  launchId: launch.launchId,
  baselineId: baseline().baselineId,
  horizonMs: 60_000,
  componentsUsdMicros: {
    entryTransaction: 20_000n,
    approvalTransactions: 10_000n,
    exitTransaction: 20_000n,
    recoveryTransactions: 0n,
    otherExecution: 0n
  }
});
const oneMinute = await buildPonsS0OutcomePacket({
  launch,
  baseline: baseline(),
  outcome: outcome(60_000),
  executionCost: oneMinuteCost
});
assert.equal(oneMinute.schemaVersion, PONS_S0_OUTCOME_PACKET_V1);
assert.equal(oneMinute.costProjection.status, 'COMPLETE');
assert.equal(oneMinute.costProjection.executionCostUsdMicros, 50_000n);
assert.equal(oneMinute.costProjection.executionCostEvidenceDigest, oneMinuteCost.evidenceDigest);
assert.equal(oneMinute.costProjection.netExecutableValueUsdMicros, 1_150_000n);
assert.equal(oneMinute.costProjection.netExecutableReturnBps, 11_500n);
assert.equal(oneMinute.boundaries.forbiddenAsFeatureInput, true);
assert.equal(oneMinute.boundaries.liveMoneyAuthority, false);

const fiveMinute = await buildPonsS0OutcomePacket({
  launch,
  baseline: baseline(),
  outcome: outcome(300_000)
});
assert.equal(fiveMinute.costProjection.status, 'UNVERIFIED_EXECUTION_COST');
assert.equal(fiveMinute.costProjection.netExecutableValueUsdMicros, null);

await assert.rejects(
  () => buildPonsS0OutcomePacket({
    launch,
    baseline: baseline(),
    outcome: outcome(60_000, { baselineId: 'wrong-baseline' })
  }),
  /PONS_S0_OUTCOME_BINDING_MISMATCH/
);

await assert.rejects(
  () => buildPonsS0OutcomePacket({
    launch,
    baseline: baseline(),
    outcome: outcome(60_000),
    executionCost: { ...oneMinuteCost, launchId: 'wrong-launch' }
  }),
  /PONS_S0_EXECUTION_COST_BINDING_MISMATCH/
);

await assert.rejects(
  () => buildPonsS0OutcomePacket({
    launch,
    baseline: baseline(),
    outcome: outcome(60_000),
    executionCost: { ...oneMinuteCost, totalUsdMicros: oneMinuteCost.totalUsdMicros + 1n }
  }),
  /PONS_S0_EXECUTION_COST_EVIDENCE_MISMATCH/
);

const bundle = await buildPonsS0ResearchExportBundle({
  featurePackets: [feature],
  outcomePackets: [fiveMinute, oneMinute]
});
const bundleReordered = await buildPonsS0ResearchExportBundle({
  featurePackets: [feature],
  outcomePackets: [oneMinute, fiveMinute]
});
assert.equal(bundle.manifest.manifestId, bundleReordered.manifest.manifestId);
assert.equal(bundle.manifest.evidenceDigest, bundleReordered.manifest.evidenceDigest);
assert.equal(bundle.manifest.featurePacketCount, 1);
assert.equal(bundle.manifest.outcomePacketCount, 2);
assert.notEqual(
  bundle.manifest.featureStreamSha256,
  bundle.manifest.outcomeStreamSha256
);
assert.equal(
  bundle.featuresJsonl.includes('outcome-60000'),
  false,
  'target future outcome identity must not leak into feature stream'
);
assert.equal(
  bundle.outcomesJsonl.includes('outcome-60000'),
  true
);

await assert.rejects(
  () => buildPonsS0ResearchExportBundle({
    featurePackets: [feature, feature],
    outcomePackets: []
  }),
  /PONS_S0_DUPLICATE_FEATURE_PACKET/
);

await assert.rejects(
  () => buildPonsS0ResearchExportBundle({
    featurePackets: [],
    outcomePackets: [oneMinute]
  }),
  /PONS_S0_EMPTY_FEATURE_EXPORT/
);

const orphanOutcome = { ...oneMinute, launchId: 'other-launch' };
await assert.rejects(
  () => buildPonsS0ResearchExportBundle({
    featurePackets: [feature],
    outcomePackets: [orphanOutcome]
  }),
  /PONS_S0_OUTCOME_WITHOUT_FEATURE_PACKET/
);

await assert.rejects(
  () => buildPonsS0ResearchExportBundle({
    featurePackets: [],
    outcomePackets: [oneMinute, oneMinute]
  }),
  /PONS_S0_DUPLICATE_OUTCOME_PACKET/
);

console.log(JSON.stringify({
  verdict: 'PONS_S0_RESEARCH_EXPORT_V1_PASS',
  schemas: {
    feature: feature.schemaVersion,
    outcome: oneMinute.schemaVersion
  },
  featurePacketDeterministic: true,
  outcomeStreamSeparated: true,
  executionPersonaBound: true,
  executionPersonaParity: feature.executionPersona.parity,
  capacitySemantics: feature.baseline.capacitySemantics,
  netCostProjection: oneMinute.costProjection.status,
  entityLookaheadFailsClosed: true,
  manifestContentAddressed: true,
  liveMoneyAuthority: false,
  edge: 'UNPROVEN'
}, null, 2));
