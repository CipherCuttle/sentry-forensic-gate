import type { Hex } from '../domain.js';
import { canonicalJson, sha256Hex } from '../evidence/canonical.js';
import type { ShadowPolicyComparisonReceipt } from '../evaluation/shadowPolicyReceipts.js';
import { buildShadowPolicyComparisonReceipt } from '../evaluation/shadowPolicyReceipts.js';
import type { CreatorOutcomeFeatureReceipt } from '../forensic/creatorOutcome.js';
import type { ProvenanceEdge } from '../graph/provenance.js';
import type {
  CanonicalJsonValue,
  NormalizedLaunchCandidate,
  PortableBaselineBatch,
  PortableForwardOutcome,
  SourceAuthorityEnvelope
} from '../multichain/domain.js';

export const PONS_S0_FEATURE_PACKET_V1 = 'PONS_S0_FEATURE_PACKET_V1' as const;
export const PONS_S0_OUTCOME_PACKET_V1 = 'PONS_S0_OUTCOME_PACKET_V1' as const;
export const PONS_S0_EXPORT_MANIFEST_V1 = 'PONS_S0_EXPORT_MANIFEST_V1' as const;

export const PONS_S0_CAPACITY_SEMANTICS =
  'INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL' as const;

export const PONS_S0_EXECUTION_PERSONA_PARITY =
  'SHADOW_RECIPIENT_BOUND_LIVE_WALLET_UNVERIFIED' as const;

export interface PonsS0ExecutionPersona {
  recipient: Hex;
  recipientRole: 'PONS_V2_SHADOW_QUOTE_RECIPIENT';
  parity: typeof PONS_S0_EXECUTION_PERSONA_PARITY;
  sourceQuoteSchema: 'ROBINHOOD_PONS_V2_CURVE_QUOTE_R1';
  snipeTaxBps: bigint;
  effectiveSnipeTaxBps: bigint;
  adapterInvariants: readonly [
    'RECIPIENT_HAS_NO_CODE',
    'RECIPIENT_NOT_SNIPE_TAX_EXEMPT'
  ];
}

export interface PonsS0QuoteStateFeature {
  curve: Hex;
  pairToken: Hex;
  quoteReserve: bigint;
  tokenReserve: bigint;
  trackedQuote: bigint;
  sellableTokens: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  snipeTaxBps: bigint;
  effectiveSnipeTaxBps: bigint;
  amountInRequested: bigint;
  amountInExecutable: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  creatorTaxAmount: bigint;
  snipeTaxAmount: bigint;
  partialFill: boolean;
  executable: boolean;
  failureReason: string | null;
  marketState: string;
  sourceAuthorityDigest: string;
}

export interface PonsS0BaselineLegFeature {
  notionalUsdMicros: bigint;
  baseAmount: bigint;
  entry: {
    quoteId: string;
    observedAtMs: number;
    executable: boolean;
    amountIn: bigint;
    amountOut: bigint;
    failureReason: string | null;
    gasEstimate: bigint | null;
    quoteState: PonsS0QuoteStateFeature;
  };
  reverse: {
    quoteId: string;
    observedAtMs: number;
    executable: boolean;
    amountIn: bigint;
    amountOut: bigint;
    failureReason: string | null;
    gasEstimate: bigint | null;
    sourceAuthorityDigest: string;
  } | null;
  independentReverseRecoveryBps: bigint | null;
}

export interface PonsS0FeaturePacket {
  schemaVersion: typeof PONS_S0_FEATURE_PACKET_V1;
  packetId: string;
  evidenceDigest: string;
  chainId: 4663;
  ecosystem: 'ROBINHOOD';
  launchProtocol: 'PONS';
  launch: {
    launchId: string;
    eventId: string;
    factory: Hex;
    txHash: Hex;
    blockNumber: bigint;
    blockHash: Hex;
    logIndex: number;
    token: Hex;
    creator: Hex;
    name: string;
    symbol: string;
    observedAtMs: number;
    launchConfigId: bigint;
    graduationThreshold: bigint;
    curve: Hex;
    pairToken: Hex;
    sourceAuthorityDigest: string;
  };
  baseline: {
    baselineId: string;
    authorityDigest: string;
    policyVersion: string;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    observedAtMs: number;
    status: 'COMPLETE' | 'UNVERIFIED';
    reason: string | null;
    marketId: string | null;
    venue: string | null;
    baseAsset: Hex | null;
    reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL';
    capacitySemantics: typeof PONS_S0_CAPACITY_SEMANTICS;
    legs: readonly PonsS0BaselineLegFeature[];
  };
  creatorHistory: {
    receiptId: string;
    evidenceDigest: string;
    coverage: CreatorOutcomeFeatureReceipt['coverage'];
    priorLaunchCount: number;
    classifiedOutcomeCount: number;
    unresolvedOutcomeCount: number;
    unsellableOutcomeCount: number;
    catastrophicLossCount: number;
    exitFailureCount: number;
    liquidityCollapseCount: number;
    normalLossCount: number;
    normalWinCount: number;
    fatTailWinCount: number;
    sourceFactIds: readonly string[];
    sourceOutcomeIds: readonly string[];
  } | null;
  executionPersona: PonsS0ExecutionPersona | null;
  timing: {
    clockSemantics: 'LOCAL_CAPTURE_WALL_CLOCK_NOT_CHAIN_TIMESTAMP';
    launchObservedAtMs: number;
    baselineObservedAtMs: number;
    firstQuoteObservedAtMs: number | null;
    lastQuoteObservedAtMs: number | null;
    decisionDelayBlocks: bigint;
  };
  diagnosticEntityEdges: readonly {
    edgeId: string;
    kind: ProvenanceEdge['kind'];
    from: string;
    to: string;
    evidenceClass: ProvenanceEdge['evidenceClass'];
    observedBlock: bigint;
    evidenceDigest: string;
  }[];
  policyComparison: ShadowPolicyComparisonReceipt;
  boundaries: {
    pointInTimeDecisionBlock: bigint;
    containsTargetLaunchFutureOutcome: false;
    entityEdgesAtOrBeforeDecisionOnly: true;
    mode: 'SHADOW_ONLY';
    liveMoneyAuthority: false;
    edge: 'UNPROVEN';
  };
}

export interface PonsS0OutcomePacket {
  schemaVersion: typeof PONS_S0_OUTCOME_PACKET_V1;
  packetId: string;
  evidenceDigest: string;
  chainId: 4663;
  ecosystem: 'ROBINHOOD';
  launchProtocol: 'PONS';
  launchId: string;
  baselineId: string;
  horizonMs: number;
  observedBlock: bigint;
  observedBlockHash: Hex;
  targetTimestampMs: number;
  observedTimestampMs: number;
  status: 'COMPLETE' | 'UNVERIFIED';
  reason: string | null;
  entryNotionalUsdMicros: bigint;
  exitExecutable: boolean;
  baseAsset: Hex;
  baseAmountOut: bigint;
  grossExecutableValueUsdMicros: bigint | null;
  grossExecutableReturnBps: bigint | null;
  classification: PortableForwardOutcome['classification'] | null;
  liquidityState: PortableForwardOutcome['liquidity']['state'];
  slippageBps: bigint | null;
  costProjection: {
    status: 'COMPLETE' | 'UNVERIFIED_GAS_COST' | 'UNVERIFIED_GROSS_VALUE';
    gasCostUsdMicros: bigint | null;
    netExecutableValueUsdMicros: bigint | null;
    netExecutableReturnBps: bigint | null;
    semantics: 'GROSS_EXECUTABLE_VALUE_MINUS_GAS_COST_ONLY';
  };
  outcomeAuthorityDigest: string;
  sourceAuthorityDigest: string;
  boundaries: {
    postOutcomeEvidence: true;
    forbiddenAsFeatureInput: true;
    mode: 'SHADOW_ONLY';
    liveMoneyAuthority: false;
    edge: 'UNPROVEN';
  };
}

export interface PonsS0ExportManifest {
  schemaVersion: typeof PONS_S0_EXPORT_MANIFEST_V1;
  manifestId: string;
  evidenceDigest: string;
  featureSchema: typeof PONS_S0_FEATURE_PACKET_V1;
  outcomeSchema: typeof PONS_S0_OUTCOME_PACKET_V1;
  featurePacketCount: number;
  outcomePacketCount: number;
  featureStreamSha256: string;
  outcomeStreamSha256: string;
  featurePacketDigests: readonly string[];
  outcomePacketDigests: readonly string[];
  separation: {
    featureAndOutcomeStreamsDistinct: true;
    featurePacketsContainTargetFutureOutcome: false;
    outcomePacketsForbiddenAsFeatureInput: true;
  };
  mode: 'SHADOW_ONLY';
  liveMoneyAuthority: false;
  edge: 'UNPROVEN';
}

export interface PonsS0ResearchExportBundle {
  manifest: PonsS0ExportManifest;
  featuresJsonl: string;
  outcomesJsonl: string;
}

export async function buildPonsS0FeaturePacket(input: {
  launch: NormalizedLaunchCandidate;
  baseline: PortableBaselineBatch;
  creatorFeature: CreatorOutcomeFeatureReceipt | null;
  provenanceEdges?: readonly ProvenanceEdge[];
}): Promise<PonsS0FeaturePacket> {
  assertPonsIdentity(input.launch, input.baseline);
  const launchConfig = await projectLaunchConfig(input.launch);
  const policyComparison = await buildShadowPolicyComparisonReceipt({
    launchId: input.launch.launchId,
    baseline: input.baseline,
    creatorFeature: input.creatorFeature
  });
  const legs = await Promise.all(input.baseline.legs.map(projectBaselineLeg));
  const executionPersona = projectExecutionPersona(legs);
  const diagnosticEntityEdges = projectDiagnosticEntityEdges({
    launch: input.launch,
    baseline: input.baseline,
    edges: input.provenanceEdges ?? []
  });
  const quoteTimes = legs.flatMap((leg) => [
    leg.entry.observedAtMs,
    ...(leg.reverse ? [leg.reverse.observedAtMs] : [])
  ]);

  const core = {
    chainId: 4663 as const,
    ecosystem: 'ROBINHOOD' as const,
    launchProtocol: 'PONS' as const,
    launch: {
      launchId: input.launch.launchId,
      eventId: input.launch.eventId,
      factory: normHex(input.launch.factory),
      txHash: normHex(input.launch.txHash),
      blockNumber: input.launch.blockNumber,
      blockHash: normHex(input.launch.blockHash),
      logIndex: input.launch.logIndex,
      token: normHex(input.launch.token),
      creator: normHex(input.launch.creator),
      name: input.launch.name,
      symbol: input.launch.symbol,
      observedAtMs: input.launch.observedAtMs,
      ...launchConfig
    },
    baseline: {
      baselineId: input.baseline.baselineId,
      authorityDigest: input.baseline.authorityDigest,
      policyVersion: input.baseline.policyVersion,
      decisionBlock: input.baseline.decisionBlock,
      decisionBlockHash: normHex(input.baseline.decisionBlockHash),
      observedAtMs: input.baseline.observedAtMs,
      status: input.baseline.status,
      reason: input.baseline.reason ?? null,
      marketId: input.baseline.market?.marketId ?? null,
      venue: input.baseline.market?.venue ?? null,
      baseAsset: input.baseline.market
        ? normHex(input.baseline.market.baseAsset)
        : null,
      reverseSemantics: input.baseline.reverseSemantics,
      capacitySemantics: PONS_S0_CAPACITY_SEMANTICS,
      legs
    },
    creatorHistory: input.creatorFeature
      ? projectCreatorFeature(input.creatorFeature)
      : null,
    executionPersona,
    timing: {
      clockSemantics: 'LOCAL_CAPTURE_WALL_CLOCK_NOT_CHAIN_TIMESTAMP' as const,
      launchObservedAtMs: input.launch.observedAtMs,
      baselineObservedAtMs: input.baseline.observedAtMs,
      firstQuoteObservedAtMs: quoteTimes.length > 0 ? Math.min(...quoteTimes) : null,
      lastQuoteObservedAtMs: quoteTimes.length > 0 ? Math.max(...quoteTimes) : null,
      decisionDelayBlocks: input.baseline.decisionBlock - input.launch.blockNumber
    },
    diagnosticEntityEdges,
    policyComparison,
    boundaries: {
      pointInTimeDecisionBlock: input.baseline.decisionBlock,
      containsTargetLaunchFutureOutcome: false as const,
      entityEdgesAtOrBeforeDecisionOnly: true as const,
      mode: 'SHADOW_ONLY' as const,
      liveMoneyAuthority: false as const,
      edge: 'UNPROVEN' as const
    }
  };

  const packetId = await sha256Hex({
    kind: PONS_S0_FEATURE_PACKET_V1,
    launchId: input.launch.launchId,
    baselineId: input.baseline.baselineId,
    baselineAuthorityDigest: input.baseline.authorityDigest,
    creatorEvidenceDigest: input.creatorFeature?.evidenceDigest ?? null,
    policyEvidenceDigest: policyComparison.evidenceDigest,
    entityEdgeDigests: diagnosticEntityEdges.map((edge) => edge.evidenceDigest)
  });
  const evidenceDigest = await sha256Hex({
    schemaVersion: PONS_S0_FEATURE_PACKET_V1,
    packetId,
    ...core
  });

  return {
    schemaVersion: PONS_S0_FEATURE_PACKET_V1,
    packetId,
    evidenceDigest,
    ...core
  };
}

export async function buildPonsS0OutcomePacket(input: {
  launch: NormalizedLaunchCandidate;
  baseline: PortableBaselineBatch;
  outcome: PortableForwardOutcome;
}): Promise<PonsS0OutcomePacket> {
  assertPonsIdentity(input.launch, input.baseline);
  assertOutcomeBinding(input.launch, input.baseline, input.outcome);

  const grossValue = input.outcome.executableValueUsdMicros ?? null;
  const gasCost = input.outcome.gasCostUsdMicros ?? null;
  const costProjection = projectNetCost({
    entryNotionalUsdMicros: input.outcome.entryNotionalUsdMicros,
    grossValueUsdMicros: grossValue,
    gasCostUsdMicros: gasCost
  });
  const sourceAuthorityDigest = await sha256Hex(input.outcome.sourceAuthority);

  const core = {
    chainId: 4663 as const,
    ecosystem: 'ROBINHOOD' as const,
    launchProtocol: 'PONS' as const,
    launchId: input.outcome.launchId,
    baselineId: input.outcome.baselineId,
    horizonMs: input.outcome.horizonMs,
    observedBlock: input.outcome.observedBlock,
    observedBlockHash: normHex(input.outcome.observedBlockHash),
    targetTimestampMs: input.outcome.targetTimestampMs,
    observedTimestampMs: input.outcome.observedTimestampMs,
    status: input.outcome.status,
    reason: input.outcome.reason ?? null,
    entryNotionalUsdMicros: input.outcome.entryNotionalUsdMicros,
    exitExecutable: input.outcome.exitExecutable,
    baseAsset: normHex(input.outcome.baseAsset),
    baseAmountOut: input.outcome.baseAmountOut,
    grossExecutableValueUsdMicros: grossValue,
    grossExecutableReturnBps: input.outcome.executableReturnBps ?? null,
    classification: input.outcome.classification ?? null,
    liquidityState: input.outcome.liquidity.state,
    slippageBps: input.outcome.slippageBps ?? null,
    costProjection,
    outcomeAuthorityDigest: input.outcome.authorityDigest,
    sourceAuthorityDigest,
    boundaries: {
      postOutcomeEvidence: true as const,
      forbiddenAsFeatureInput: true as const,
      mode: 'SHADOW_ONLY' as const,
      liveMoneyAuthority: false as const,
      edge: 'UNPROVEN' as const
    }
  };

  const packetId = await sha256Hex({
    kind: PONS_S0_OUTCOME_PACKET_V1,
    launchId: input.outcome.launchId,
    baselineId: input.outcome.baselineId,
    horizonMs: input.outcome.horizonMs,
    outcomeId: input.outcome.outcomeId,
    outcomeAuthorityDigest: input.outcome.authorityDigest
  });
  const evidenceDigest = await sha256Hex({
    schemaVersion: PONS_S0_OUTCOME_PACKET_V1,
    packetId,
    ...core
  });

  return {
    schemaVersion: PONS_S0_OUTCOME_PACKET_V1,
    packetId,
    evidenceDigest,
    ...core
  };
}

export async function buildPonsS0ResearchExportBundle(input: {
  featurePackets: readonly PonsS0FeaturePacket[];
  outcomePackets: readonly PonsS0OutcomePacket[];
}): Promise<PonsS0ResearchExportBundle> {
  const featurePackets = [...input.featurePackets].sort(compareFeaturePackets);
  const outcomePackets = [...input.outcomePackets].sort(compareOutcomePackets);
  assertUniqueFeaturePackets(featurePackets);
  assertUniqueOutcomePackets(outcomePackets);

  const featuresJsonl = jsonl(featurePackets);
  const outcomesJsonl = jsonl(outcomePackets);
  const featureStreamSha256 = await sha256Utf8(featuresJsonl);
  const outcomeStreamSha256 = await sha256Utf8(outcomesJsonl);

  const core = {
    featureSchema: PONS_S0_FEATURE_PACKET_V1,
    outcomeSchema: PONS_S0_OUTCOME_PACKET_V1,
    featurePacketCount: featurePackets.length,
    outcomePacketCount: outcomePackets.length,
    featureStreamSha256,
    outcomeStreamSha256,
    featurePacketDigests: featurePackets.map((packet) => packet.evidenceDigest),
    outcomePacketDigests: outcomePackets.map((packet) => packet.evidenceDigest),
    separation: {
      featureAndOutcomeStreamsDistinct: true as const,
      featurePacketsContainTargetFutureOutcome: false as const,
      outcomePacketsForbiddenAsFeatureInput: true as const
    },
    mode: 'SHADOW_ONLY' as const,
    liveMoneyAuthority: false as const,
    edge: 'UNPROVEN' as const
  };
  const manifestId = await sha256Hex({
    kind: PONS_S0_EXPORT_MANIFEST_V1,
    featureStreamSha256,
    outcomeStreamSha256,
    featurePacketCount: featurePackets.length,
    outcomePacketCount: outcomePackets.length
  });
  const evidenceDigest = await sha256Hex({
    schemaVersion: PONS_S0_EXPORT_MANIFEST_V1,
    manifestId,
    ...core
  });

  return {
    manifest: {
      schemaVersion: PONS_S0_EXPORT_MANIFEST_V1,
      manifestId,
      evidenceDigest,
      ...core
    },
    featuresJsonl,
    outcomesJsonl
  };
}

async function projectLaunchConfig(launch: NormalizedLaunchCandidate) {
  if (launch.sourceAuthority.schema !== 'ROBINHOOD_PONS_V2_TOKEN_LAUNCHED_V1') {
    throw new Error('PONS_S0_LAUNCH_AUTHORITY_SCHEMA_MISMATCH');
  }
  const payload = record(launch.sourceAuthority.payload, 'PONS_S0_LAUNCH_AUTHORITY_MALFORMED');
  const sourceAuthorityDigest = await sha256Hex(launch.sourceAuthority);
  return {
    launchConfigId: bigintString(payload, 'launchConfigId'),
    graduationThreshold: bigintString(payload, 'graduationThreshold'),
    curve: address(payload, 'curve'),
    pairToken: address(payload, 'pairToken'),
    sourceAuthorityDigest
  };
}

async function projectBaselineLeg(
  leg: PortableBaselineBatch['legs'][number]
): Promise<PonsS0BaselineLegFeature> {
  const quoteState = await projectQuoteState(leg.entry.sourceAuthority);
  return {
    notionalUsdMicros: leg.notionalUsdMicros,
    baseAmount: leg.calibration.baseAmount,
    entry: {
      quoteId: leg.entry.quoteId,
      observedAtMs: leg.entry.observedAtMs,
      executable: leg.entry.executable,
      amountIn: leg.entry.amountIn,
      amountOut: leg.entry.amountOut,
      failureReason: leg.entry.failureReason ?? null,
      gasEstimate: leg.entry.gasEstimate ?? null,
      quoteState
    },
    reverse: leg.reverse
      ? {
          quoteId: leg.reverse.quoteId,
          observedAtMs: leg.reverse.observedAtMs,
          executable: leg.reverse.executable,
          amountIn: leg.reverse.amountIn,
          amountOut: leg.reverse.amountOut,
          failureReason: leg.reverse.failureReason ?? null,
          gasEstimate: leg.reverse.gasEstimate ?? null,
          sourceAuthorityDigest: await sha256Hex(leg.reverse.sourceAuthority)
        }
      : null,
    independentReverseRecoveryBps: leg.independentReverseRecoveryBps
  };
}

async function projectQuoteState(
  authority: SourceAuthorityEnvelope
): Promise<PonsS0QuoteStateFeature> {
  if (authority.schema !== 'ROBINHOOD_PONS_V2_CURVE_QUOTE_R1') {
    throw new Error('PONS_S0_QUOTE_AUTHORITY_SCHEMA_MISMATCH');
  }
  const payload = record(authority.payload, 'PONS_S0_QUOTE_AUTHORITY_MALFORMED');
  return {
    curve: address(payload, 'curve'),
    pairToken: address(payload, 'pairToken'),
    quoteReserve: bigintString(payload, 'quoteReserve'),
    tokenReserve: bigintString(payload, 'tokenReserve'),
    trackedQuote: bigintString(payload, 'trackedQuote'),
    sellableTokens: bigintString(payload, 'sellableTokens'),
    feeBps: bigintString(payload, 'feeBps'),
    creatorTaxBps: bigintString(payload, 'creatorTaxBps'),
    snipeTaxBps: bigintString(payload, 'snipeTaxBps'),
    effectiveSnipeTaxBps: bigintString(payload, 'effectiveSnipeTaxBps'),
    amountInRequested: bigintString(payload, 'amountInRequested'),
    amountInExecutable: bigintString(payload, 'amountInExecutable'),
    amountOut: bigintString(payload, 'amountOut'),
    feeAmount: bigintString(payload, 'feeAmount'),
    creatorTaxAmount: bigintString(payload, 'creatorTaxAmount'),
    snipeTaxAmount: bigintString(payload, 'snipeTaxAmount'),
    partialFill: booleanField(payload, 'partialFill'),
    executable: booleanField(payload, 'executable'),
    failureReason: nullableString(payload, 'failureReason'),
    marketState: stringField(payload, 'marketState'),
    sourceAuthorityDigest: await sha256Hex(authority)
  };
}

function projectExecutionPersona(
  legs: readonly PonsS0BaselineLegFeature[]
): PonsS0ExecutionPersona | null {
  if (legs.length === 0) return null;
  const first = legs[0]!.entry.quoteState;
  const persona: PonsS0ExecutionPersona = {
    recipient: recipientFromEntry(legs[0]!),
    recipientRole: 'PONS_V2_SHADOW_QUOTE_RECIPIENT',
    parity: PONS_S0_EXECUTION_PERSONA_PARITY,
    sourceQuoteSchema: 'ROBINHOOD_PONS_V2_CURVE_QUOTE_R1',
    snipeTaxBps: first.snipeTaxBps,
    effectiveSnipeTaxBps: first.effectiveSnipeTaxBps,
    adapterInvariants: [
      'RECIPIENT_HAS_NO_CODE',
      'RECIPIENT_NOT_SNIPE_TAX_EXEMPT'
    ]
  };
  for (const leg of legs.slice(1)) {
    const state = leg.entry.quoteState;
    if (
      recipientFromEntry(leg).toLowerCase() !== persona.recipient.toLowerCase() ||
      state.snipeTaxBps !== persona.snipeTaxBps ||
      state.effectiveSnipeTaxBps !== persona.effectiveSnipeTaxBps
    ) {
      throw new Error('PONS_S0_EXECUTION_PERSONA_DRIFT');
    }
  }
  return persona;
}

function recipientFromEntry(leg: PonsS0BaselineLegFeature): Hex {
  // The recipient is not duplicated in quoteState to keep the feature row
  // compact. It is encoded in the entry quote authority digest and recovered
  // before this projection in projectBaselineLeg.
  const tagged = (leg as PonsS0BaselineLegFeature & { __recipient?: Hex }).__recipient;
  if (!tagged) {
    throw new Error('PONS_S0_EXECUTION_PERSONA_RECIPIENT_MISSING');
  }
  return tagged;
}

function projectCreatorFeature(feature: CreatorOutcomeFeatureReceipt) {
  return {
    receiptId: feature.receiptId,
    evidenceDigest: feature.evidenceDigest,
    coverage: feature.coverage,
    priorLaunchCount: feature.priorLaunchCount,
    classifiedOutcomeCount: feature.classifiedOutcomeCount,
    unresolvedOutcomeCount: feature.unresolvedOutcomeCount,
    unsellableOutcomeCount: feature.unsellableOutcomeCount,
    catastrophicLossCount: feature.catastrophicLossCount,
    exitFailureCount: feature.exitFailureCount,
    liquidityCollapseCount: feature.liquidityCollapseCount,
    normalLossCount: feature.normalLossCount,
    normalWinCount: feature.normalWinCount,
    fatTailWinCount: feature.fatTailWinCount,
    sourceFactIds: [...feature.sourceFactIds],
    sourceOutcomeIds: [...feature.sourceOutcomeIds]
  };
}

function projectDiagnosticEntityEdges(input: {
  launch: NormalizedLaunchCandidate;
  baseline: PortableBaselineBatch;
  edges: readonly ProvenanceEdge[];
}) {
  const launchNode = `launch:${input.launch.chainId}:${input.launch.launchId}`;
  const creatorNode = `wallet:${input.launch.chainId}:${input.launch.creator.toLowerCase()}`;
  return input.edges
    .filter((edge) =>
      edge.chainId === input.launch.chainId &&
      (edge.from === launchNode || edge.to === creatorNode)
    )
    .map((edge) => {
      if (edge.observedBlock > input.baseline.decisionBlock) {
        throw new Error(`PONS_S0_ENTITY_EDGE_LOOKAHEAD:${edge.edgeId}`);
      }
      return {
        edgeId: edge.edgeId,
        kind: edge.kind,
        from: edge.from,
        to: edge.to,
        evidenceClass: edge.evidenceClass,
        observedBlock: edge.observedBlock,
        evidenceDigest: edge.evidenceDigest
      };
    })
    .sort((a, b) =>
      a.observedBlock === b.observedBlock
        ? a.edgeId.localeCompare(b.edgeId)
        : a.observedBlock < b.observedBlock ? -1 : 1
    );
}

function projectNetCost(input: {
  entryNotionalUsdMicros: bigint;
  grossValueUsdMicros: bigint | null;
  gasCostUsdMicros: bigint | null;
}): PonsS0OutcomePacket['costProjection'] {
  if (input.grossValueUsdMicros === null) {
    return {
      status: 'UNVERIFIED_GROSS_VALUE',
      gasCostUsdMicros: input.gasCostUsdMicros,
      netExecutableValueUsdMicros: null,
      netExecutableReturnBps: null,
      semantics: 'GROSS_EXECUTABLE_VALUE_MINUS_GAS_COST_ONLY'
    };
  }
  if (input.gasCostUsdMicros === null) {
    return {
      status: 'UNVERIFIED_GAS_COST',
      gasCostUsdMicros: null,
      netExecutableValueUsdMicros: null,
      netExecutableReturnBps: null,
      semantics: 'GROSS_EXECUTABLE_VALUE_MINUS_GAS_COST_ONLY'
    };
  }
  const net = input.grossValueUsdMicros - input.gasCostUsdMicros;
  return {
    status: 'COMPLETE',
    gasCostUsdMicros: input.gasCostUsdMicros,
    netExecutableValueUsdMicros: net,
    netExecutableReturnBps:
      input.entryNotionalUsdMicros > 0n
        ? (net * 10_000n) / input.entryNotionalUsdMicros
        : null,
    semantics: 'GROSS_EXECUTABLE_VALUE_MINUS_GAS_COST_ONLY'
  };
}

function assertPonsIdentity(
  launch: NormalizedLaunchCandidate,
  baseline: PortableBaselineBatch
): void {
  if (
    launch.chainId !== 4663 ||
    launch.ecosystem !== 'ROBINHOOD' ||
    launch.launchProtocol !== 'PONS' ||
    baseline.chainId !== 4663 ||
    baseline.ecosystem !== 'ROBINHOOD' ||
    baseline.launchProtocol !== 'PONS'
  ) {
    throw new Error('PONS_S0_IDENTITY_MISMATCH');
  }
  if (baseline.launchId !== launch.launchId) {
    throw new Error('PONS_S0_BASELINE_LAUNCH_MISMATCH');
  }
  if (baseline.decisionBlock < launch.blockNumber) {
    throw new Error('PONS_S0_DECISION_BEFORE_LAUNCH');
  }
}

function assertOutcomeBinding(
  launch: NormalizedLaunchCandidate,
  baseline: PortableBaselineBatch,
  outcome: PortableForwardOutcome
): void {
  if (
    outcome.chainId !== 4663 ||
    outcome.ecosystem !== 'ROBINHOOD' ||
    outcome.launchProtocol !== 'PONS' ||
    outcome.launchId !== launch.launchId ||
    outcome.baselineId !== baseline.baselineId
  ) {
    throw new Error('PONS_S0_OUTCOME_BINDING_MISMATCH');
  }
}

function assertUniqueFeaturePackets(packets: readonly PonsS0FeaturePacket[]): void {
  const seen = new Set<string>();
  for (const packet of packets) {
    if (seen.has(packet.launch.launchId)) {
      throw new Error(`PONS_S0_DUPLICATE_FEATURE_PACKET:${packet.launch.launchId}`);
    }
    seen.add(packet.launch.launchId);
  }
}

function assertUniqueOutcomePackets(packets: readonly PonsS0OutcomePacket[]): void {
  const seen = new Set<string>();
  for (const packet of packets) {
    const key = `${packet.launchId}:${packet.baselineId}:${packet.horizonMs}`;
    if (seen.has(key)) throw new Error(`PONS_S0_DUPLICATE_OUTCOME_PACKET:${key}`);
    seen.add(key);
  }
}

function compareFeaturePackets(a: PonsS0FeaturePacket, b: PonsS0FeaturePacket): number {
  if (a.launch.blockNumber !== b.launch.blockNumber) {
    return a.launch.blockNumber < b.launch.blockNumber ? -1 : 1;
  }
  if (a.launch.logIndex !== b.launch.logIndex) return a.launch.logIndex - b.launch.logIndex;
  return a.launch.launchId.localeCompare(b.launch.launchId);
}

function compareOutcomePackets(a: PonsS0OutcomePacket, b: PonsS0OutcomePacket): number {
  const launch = a.launchId.localeCompare(b.launchId);
  if (launch !== 0) return launch;
  if (a.horizonMs !== b.horizonMs) return a.horizonMs - b.horizonMs;
  return a.packetId.localeCompare(b.packetId);
}

function jsonl(values: readonly unknown[]): string {
  return values.map((value) => canonicalJson(value)).join('\n') + (values.length > 0 ? '\n' : '');
}

async function sha256Utf8(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('');
}

function record(
  value: CanonicalJsonValue,
  errorCode: string
): Readonly<Record<string, CanonicalJsonValue>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  return value;
}

function stringField(
  value: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): string {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error(`PONS_S0_FIELD_INVALID:${key}`);
  }
  return field;
}

function nullableString(
  value: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): string | null {
  const field = value[key];
  if (field === null) return null;
  if (typeof field !== 'string') throw new Error(`PONS_S0_FIELD_INVALID:${key}`);
  return field;
}

function bigintString(
  value: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): bigint {
  const field = stringField(value, key);
  if (!/^-?[0-9]+$/.test(field)) throw new Error(`PONS_S0_FIELD_INVALID:${key}`);
  return BigInt(field);
}

function booleanField(
  value: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): boolean {
  const field = value[key];
  if (typeof field !== 'boolean') throw new Error(`PONS_S0_FIELD_INVALID:${key}`);
  return field;
}

function address(
  value: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): Hex {
  const field = stringField(value, key);
  if (!/^0x[0-9a-fA-F]{40}$/.test(field)) {
    throw new Error(`PONS_S0_FIELD_INVALID:${key}`);
  }
  return normHex(field);
}

function normHex(value: string): Hex {
  return value.toLowerCase() as Hex;
}
