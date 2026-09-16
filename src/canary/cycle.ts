import type { Address, Hex } from 'viem';
import type { SqliteStore } from '../db/sqliteStore.js';
import { evaluateFastVet } from '../evaluation/fastVet.js';
import { projectCreatorOutcomeFeatures } from '../forensic/creatorOutcome.js';
import type { ViemExecutableBaselineSource } from '../tsunami/viemBaselineSource.js';
import { buildCanarySwapIntent, CANARY_PRIMARY_NOTIONAL_USD_MICROS, deriveCanaryActionId } from './swapIntent.js';
import { CanaryStore } from './store.js';
import type { CanaryActionRecord } from './types.js';
import type { ViemCanaryExecutor } from './viemCanaryExecutor.js';

export interface CanaryCycleOptions {
  live: boolean;
  candidateMaxAgeBlocks: bigint;
  candidateScanLimit: number;
  buyLimit: number;
  slippageBps: number;
  deadlineSeconds: number;
}

export interface CanaryCycleReport {
  headBlock: bigint;
  candidatesConsidered: number;
  pass: number;
  reject: number;
  unknown: number;
  action: 'NONE' | 'DRY_PASS' | 'SUBMITTED' | 'INCLUDED' | 'BLOCKED_UNRESOLVED' | 'BLOCKED_SETUP';
  launchId?: string;
  transactionHash?: Hex;
  reason?: string;
}

export async function syncCanarySniper(params: {
  store: SqliteStore;
  canaryStore: CanaryStore;
  baselineSource: ViemExecutableBaselineSource;
  executor: ViemCanaryExecutor | null;
  options: CanaryCycleOptions;
}): Promise<CanaryCycleReport> {
  validateOptions(params.options);
  const headBlock = await params.baselineSource.getHeadBlockNumber();
  const unresolved = params.canaryStore.listUnresolvedActions();
  if (unresolved.length) {
    const result = await reconcileOne(unresolved[0]!, params.canaryStore, params.executor);
    return { headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0, ...result };
  }

  const minDecisionBlock = headBlock > params.options.candidateMaxAgeBlocks
    ? headBlock - params.options.candidateMaxAgeBlocks
    : 0n;
  const baselines = params.canaryStore.listPendingBaselines(minDecisionBlock, params.options.candidateScanLimit);
  if (!baselines.length) return { headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0, action: 'NONE' };

  const features = await projectCreatorOutcomeFeatures(
    await params.store.listBaselineDecisionPoints(),
    await params.store.listProvenanceFacts(),
    await params.store.listOutcomes()
  );
  const featureByBaseline = new Map(features.map((feature) => [feature.baselineId, feature]));
  let pass = 0;
  let reject = 0;
  let unknown = 0;
  let considered = 0;

  for (const baseline of baselines) {
    const launch = await params.store.getLaunch(baseline.launchId);
    if (!launch) continue;
    considered += 1;
    const vet = evaluateFastVet({ baseline, creatorFeature: featureByBaseline.get(baseline.baselineId) ?? null });
    if (vet.decision === 'PASS') pass += 1;
    else if (vet.decision === 'REJECT') reject += 1;
    else unknown += 1;
    const actionId = await deriveCanaryActionId(baseline.launchId, baseline.baselineId);

    if (vet.decision !== 'PASS') {
      params.canaryStore.insert(makeRecord({
        actionId, baseline, decision: vet.decision, reasons: vet.reasons, state: 'SKIPPED'
      }));
      continue;
    }

    if (!params.options.live) {
      params.canaryStore.insert(makeRecord({
        actionId, baseline, decision: 'PASS', reasons: ['CANARY_DRY_RUN_PASS'], state: 'SKIPPED'
      }));
      return { headBlock, candidatesConsidered: considered, pass, reject, unknown, action: 'DRY_PASS', launchId: baseline.launchId };
    }
    if (!params.executor) throw new Error('CANARY_LIVE_REQUIRES_EXECUTOR');
    if (params.canaryStore.countCommittedBuys() >= params.options.buyLimit) {
      params.canaryStore.insert(makeRecord({
        actionId, baseline, decision: 'PASS', reasons: ['CANARY_BUY_LIMIT_REACHED'], state: 'SKIPPED'
      }));
      continue;
    }

    try {
      const quoteBlockNumber = await params.baselineSource.getHeadBlockNumber();
      if (quoteBlockNumber < minDecisionBlock) throw new Error('CANARY_QUOTE_HEAD_TOO_OLD');
      const quoteBlockHash = await params.baselineSource.getBlockHash(quoteBlockNumber);
      await params.baselineSource.assertAuthority(quoteBlockNumber);
      const market = await params.baselineSource.resolveMarket(launch, quoteBlockNumber);
      const calibration = await params.baselineSource.calibrateUsd({
        launch, market, decisionBlock: quoteBlockNumber, decisionBlockHash: quoteBlockHash,
        notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS
      });
      const entry = await params.baselineSource.quoteEntry({
        launch, market, decisionBlock: quoteBlockNumber, decisionBlockHash: quoteBlockHash,
        notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS, amountIn: calibration.baseAmount
      });
      if (!entry.executable || entry.amountOut <= 0n) throw new Error('CANARY_FRESH_ENTRY_NOT_EXECUTABLE');
      const reverse = await params.baselineSource.quoteIndependentReverse({
        launch, market, decisionBlock: quoteBlockNumber, decisionBlockHash: quoteBlockHash,
        notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS, amountIn: entry.amountOut
      });
      if (!reverse.executable || reverse.amountOut <= 0n) throw new Error('CANARY_FRESH_REVERSE_NOT_EXECUTABLE');

      const intent = await buildCanarySwapIntent({
        launchId: baseline.launchId,
        baselineId: baseline.baselineId,
        quoteBlockNumber,
        quoteBlockHash,
        tokenIn: market.baseToken as Address,
        tokenOut: market.launchedToken as Address,
        fee: market.fee,
        recipient: params.executor.account.address,
        notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
        amountIn: calibration.baseAmount,
        quotedAmountOut: entry.amountOut,
        slippageBps: params.options.slippageBps,
        nowEpochSeconds: Math.floor(Date.now() / 1000),
        deadlineSeconds: params.options.deadlineSeconds
      });
      const preflight = await params.executor.preflight(intent);
      const now = Date.now();
      params.canaryStore.insert(makeRecord({
        actionId: intent.actionId,
        baseline,
        decision: 'PASS',
        reasons: [],
        state: 'RESERVED',
        intent,
        outputBalanceBefore: preflight.outputBalanceBefore,
        now
      }));
      const signed = await params.executor.sign(intent, preflight);
      params.canaryStore.markSigned(intent.actionId, signed);
      try {
        const transactionHash = await params.executor.broadcastExact(signed);
        params.canaryStore.markSubmitted(intent.actionId);
        const receipt = await params.executor.getReceiptIfPresent(transactionHash);
        if (receipt) {
          if (receipt.status === 'success') {
            const balance = await params.executor.getTokenBalance(intent.tokenOut);
            params.canaryStore.markIncluded(intent.actionId, balance);
            return { headBlock, candidatesConsidered: considered, pass, reject, unknown, action: 'INCLUDED', launchId: baseline.launchId, transactionHash };
          }
          params.canaryStore.markReverted(intent.actionId);
          return { headBlock, candidatesConsidered: considered, pass, reject, unknown, action: 'BLOCKED_SETUP', launchId: baseline.launchId, transactionHash, reason: 'CANARY_TRANSACTION_REVERTED' };
        }
        return { headBlock, candidatesConsidered: considered, pass, reject, unknown, action: 'SUBMITTED', launchId: baseline.launchId, transactionHash };
      } catch (error) {
        params.canaryStore.markSafeHalt(intent.actionId, stableError(error));
        return { headBlock, candidatesConsidered: considered, pass, reject, unknown, action: 'BLOCKED_UNRESOLVED', launchId: baseline.launchId, transactionHash: signed.transactionHash, reason: stableError(error) };
      }
    } catch (error) {
      return { headBlock, candidatesConsidered: considered, pass, reject, unknown, action: 'BLOCKED_SETUP', launchId: baseline.launchId, reason: stableError(error) };
    }
  }

  return { headBlock, candidatesConsidered: considered, pass, reject, unknown, action: 'NONE' };
}

async function reconcileOne(action: CanaryActionRecord, store: CanaryStore, executor: ViemCanaryExecutor | null): Promise<Pick<CanaryCycleReport, 'action' | 'launchId' | 'transactionHash' | 'reason'>> {
  if (!executor) {
    const base = { action: 'BLOCKED_UNRESOLVED' as const, launchId: action.launchId, reason: 'CANARY_UNRESOLVED_REQUIRES_EXECUTOR' };
    return action.transactionHash ? { ...base, transactionHash: action.transactionHash } : base;
  }
  if (action.state === 'RESERVED' && !action.transactionHash) {
    store.markSafeHalt(action.actionId, 'CANARY_RESTART_AFTER_RESERVATION_NO_RETRY');
    return { action: 'BLOCKED_UNRESOLVED', launchId: action.launchId, reason: 'CANARY_RESTART_AFTER_RESERVATION_NO_RETRY' };
  }
  if (!action.transactionHash || !action.intent) {
    store.markSafeHalt(action.actionId, 'CANARY_UNRESOLVED_IDENTITY_INCOMPLETE');
    return { action: 'BLOCKED_UNRESOLVED', launchId: action.launchId, reason: 'CANARY_UNRESOLVED_IDENTITY_INCOMPLETE' };
  }
  const receipt = await executor.getReceiptIfPresent(action.transactionHash);
  if (!receipt) return { action: 'BLOCKED_UNRESOLVED', launchId: action.launchId, transactionHash: action.transactionHash, reason: 'CANARY_TX_NOT_YET_OBSERVED_NO_RETRY' };
  if (receipt.status === 'success') {
    const balance = await executor.getTokenBalance(action.intent.tokenOut);
    store.markIncluded(action.actionId, balance);
    return { action: 'INCLUDED', launchId: action.launchId, transactionHash: action.transactionHash };
  }
  store.markReverted(action.actionId);
  return { action: 'BLOCKED_SETUP', launchId: action.launchId, transactionHash: action.transactionHash, reason: 'CANARY_TRANSACTION_REVERTED' };
}

function makeRecord(params: {
  actionId: string;
  baseline: { launchId: string; baselineId: string; decisionBlock: bigint; decisionBlockHash: Hex };
  decision: CanaryActionRecord['decision'];
  reasons: readonly string[];
  state: CanaryActionRecord['state'];
  intent?: CanaryActionRecord['intent'];
  outputBalanceBefore?: bigint;
  now?: number;
}): CanaryActionRecord {
  const now = params.now ?? Date.now();
  return {
    actionId: params.actionId,
    launchId: params.baseline.launchId,
    baselineId: params.baseline.baselineId,
    decision: params.decision,
    reasons: [...params.reasons],
    state: params.state,
    originDecisionBlock: params.baseline.decisionBlock,
    originDecisionBlockHash: params.baseline.decisionBlockHash,
    intent: params.intent ?? null,
    nonce: null,
    transactionHash: null,
    serializedTransaction: null,
    lastError: null,
    outputBalanceBefore: params.outputBalanceBefore ?? null,
    outputBalanceAfter: null,
    createdAtMs: now,
    updatedAtMs: now
  };
}

function stableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

function validateOptions(options: CanaryCycleOptions): void {
  if (options.candidateMaxAgeBlocks < 0n || options.candidateMaxAgeBlocks > 30n) throw new Error('CANARY_CANDIDATE_MAX_AGE_INVALID');
  if (!Number.isInteger(options.candidateScanLimit) || options.candidateScanLimit < 1 || options.candidateScanLimit > 100) throw new Error('CANARY_CANDIDATE_SCAN_LIMIT_INVALID');
  if (!Number.isInteger(options.buyLimit) || options.buyLimit !== 1) throw new Error('CANARY_R0_BUY_LIMIT_MUST_EQUAL_ONE');
}
