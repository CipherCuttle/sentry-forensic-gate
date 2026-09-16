import { getAddress, type Address, type Hex } from 'viem';
import type { SqliteStore } from '../db/sqliteStore.js';
import { evaluateFastVet } from '../evaluation/fastVet.js';
import { projectCreatorOutcomeFeatures } from '../forensic/creatorOutcome.js';
import type { ViemExecutableBaselineSource } from '../tsunami/viemBaselineSource.js';
import { advanceCanaryE0EntryApproval, reconcileCanaryE0EntryApproval } from './entryApprovalRuntime.js';
import { CanaryEntryApprovalStore, type CanaryEntryApprovalActionRecord } from './entryApprovalStore.js';
import { reconcileCanaryE0EntryApprovalRevoke } from './entryApprovalRevokeRuntime.js';
import { CanaryEntryApprovalRevokeStore } from './entryApprovalRevokeStore.js';
import {
  cleanupCanaryE0EntryApproval,
  type CanaryEntryApprovalCleanupAction,
  type CanaryEntryApprovalCleanupTrigger
} from './entryApprovalRevokeWiring.js';
import { applyHistoricalCreatorSeed } from './historicalCreatorSeed.js';
import { buildCanarySwapIntent, CANARY_PRIMARY_NOTIONAL_USD_MICROS, deriveCanaryActionId, INK_SWAP_ROUTER_02 } from './swapIntent.js';
import { CanaryStore } from './store.js';
import type { CanaryActionRecord } from './types.js';
import { assertCanaryQuoteBlockHash, type ViemCanaryExecutor } from './viemCanaryExecutor.js';

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
  action:
    | 'NONE'
    | 'DRY_PASS'
    | 'ENTRY_APPROVAL_SUBMITTED'
    | 'ENTRY_APPROVAL_INCLUDED'
    | 'ENTRY_APPROVAL_CLEANED'
    | 'ENTRY_APPROVAL_REVOKE_SUBMITTED'
    | 'ENTRY_APPROVAL_REVOKE_INCLUDED'
    | 'SUBMITTED'
    | 'INCLUDED'
    | 'BLOCKED_UNRESOLVED'
    | 'BLOCKED_SETUP';
  launchId?: string | undefined;
  transactionHash?: Hex | undefined;
  reason?: string | undefined;
}

export async function syncCanarySniper(params: {
  store: SqliteStore;
  canaryStore: CanaryStore;
  entryApprovalStore?: CanaryEntryApprovalStore | null;
  entryApprovalRevokeStore?: CanaryEntryApprovalRevokeStore | null;
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

  if (params.options.live && params.entryApprovalRevokeStore) {
    const unresolvedRevokes = params.entryApprovalRevokeStore.listUnresolved();
    if (unresolvedRevokes.length) {
      if (!params.executor) {
        return {
          headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
          action: 'BLOCKED_UNRESOLVED', launchId: unresolvedRevokes[0]!.launchId,
          reason: 'CANARY_E0_ENTRY_APPROVAL_REVOKE_UNRESOLVED_REQUIRES_EXECUTOR'
        };
      }
      if (!params.entryApprovalStore) {
        return {
          headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
          action: 'BLOCKED_SETUP', launchId: unresolvedRevokes[0]!.launchId,
          reason: 'CANARY_E0_ENTRY_APPROVAL_REVOKE_PARENT_STORE_REQUIRED'
        };
      }
      const reconciled = await reconcileCanaryE0EntryApprovalRevoke({
        store: params.entryApprovalRevokeStore,
        executor: params.executor
      });
      if (reconciled?.action === 'ENTRY_APPROVAL_REVOKE_INCLUDED') {
        const parent = params.entryApprovalStore.getCommitted();
        if (!parent || parent.actionId !== reconciled.parentEntryApprovalActionId) {
          return {
            headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
            action: 'BLOCKED_SETUP', launchId: unresolvedRevokes[0]!.launchId,
            transactionHash: reconciled.transactionHash,
            reason: 'CANARY_E0_ENTRY_APPROVAL_REVOKE_RECONCILE_PARENT_IDENTITY_MISMATCH'
          };
        }
        const finalized = await cleanupCanaryE0EntryApproval({
          trigger: 'REVOKE_RECOVERY',
          parentApproval: parent,
          entryApprovalStore: params.entryApprovalStore,
          revokeStore: params.entryApprovalRevokeStore,
          executor: params.executor
        });
        return cleanupReport(headBlock, 0, 0, 0, 0, parent.launchId, finalized);
      }
      if (reconciled) {
        return {
          headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
          action: mapCleanupAction(reconciled.action),
          launchId: unresolvedRevokes[0]!.launchId,
          transactionHash: reconciled.transactionHash,
          reason: reconciled.reason
        };
      }
    }
  }

  if (params.options.live && params.entryApprovalStore) {
    const unresolvedEntryApprovals = params.entryApprovalStore.listUnresolved();
    if (unresolvedEntryApprovals.length) {
      if (!params.executor) {
        return {
          headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
          action: 'BLOCKED_UNRESOLVED', launchId: unresolvedEntryApprovals[0]!.launchId,
          reason: 'CANARY_E0_ENTRY_APPROVAL_UNRESOLVED_REQUIRES_EXECUTOR'
        };
      }
      const reconciled = await reconcileCanaryE0EntryApproval({ store: params.entryApprovalStore, executor: params.executor });
      if (reconciled) {
        return {
          headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
          action: mapEntryApprovalAction(reconciled.action),
          launchId: unresolvedEntryApprovals[0]!.launchId,
          transactionHash: reconciled.transactionHash,
          reason: reconciled.reason
        };
      }
    }
  }

  const minDecisionBlock = headBlock > params.options.candidateMaxAgeBlocks
    ? headBlock - params.options.candidateMaxAgeBlocks
    : 0n;
  const committedEntry = params.options.live && params.entryApprovalStore
    ? params.entryApprovalStore.getCommitted()
    : null;
  if (committedEntry?.state === 'REVERTED' || committedEntry?.state === 'SKIPPED') {
    return {
      headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
      action: 'BLOCKED_SETUP', launchId: committedEntry.launchId,
      reason: `CANARY_E0_ENTRY_APPROVAL_TERMINAL_STATE:${committedEntry.state}`
    };
  }

  if (committedEntry?.state === 'INCLUDED') {
    const committedRevoke = params.entryApprovalRevokeStore?.getCommitted() ?? null;
    if (committedRevoke?.state === 'INCLUDED') {
      const recovery = await runCleanup({
        trigger: 'REVOKE_RECOVERY', committedEntry, params, headBlock,
        candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0
      });
      return recovery;
    }

    const parentBuy = params.canaryStore.getAction(committedEntry.parentBuyActionId);
    if (parentBuy && ['INCLUDED', 'REVERTED', 'SKIPPED'].includes(parentBuy.state)) {
      const trigger: CanaryEntryApprovalCleanupTrigger = parentBuy.state === 'INCLUDED'
        ? 'PARENT_BUY_INCLUDED'
        : parentBuy.state === 'REVERTED'
          ? 'PARENT_BUY_REVERTED'
          : 'PARENT_BUY_SKIPPED';
      return runCleanup({
        trigger, committedEntry, params, headBlock,
        candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0
      });
    }
  }

  let baselines;
  if (committedEntry) {
    const frozen = params.canaryStore.getCompleteBaseline(committedEntry.launchId, committedEntry.baselineId);
    if (!frozen) {
      return {
        headBlock, candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
        action: 'BLOCKED_SETUP', launchId: committedEntry.launchId,
        reason: 'CANARY_E0_ENTRY_APPROVAL_BASELINE_MISSING'
      };
    }
    if (frozen.decisionBlock < minDecisionBlock) {
      return runCleanup({
        trigger: 'CANDIDATE_EXPIRED', committedEntry, params, headBlock,
        candidatesConsidered: 0, pass: 0, reject: 0, unknown: 0,
        terminalParent: {
          baseline: frozen,
          decision: 'PASS',
          reasons: ['CANARY_E0_ENTRY_APPROVAL_CANDIDATE_EXPIRED']
        }
      });
    }
    baselines = [frozen];
  } else {
    baselines = params.canaryStore.listPendingBaselines(minDecisionBlock, params.options.candidateScanLimit);
  }
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
    const liveFeature = featureByBaseline.get(baseline.baselineId) ?? null;
    const creatorFeature = liveFeature ? applyHistoricalCreatorSeed(liveFeature, launch.creator) : null;
    const vet = evaluateFastVet({ baseline, creatorFeature });
    if (vet.decision === 'PASS') pass += 1;
    else if (vet.decision === 'REJECT') reject += 1;
    else unknown += 1;
    const actionId = await deriveCanaryActionId(baseline.launchId, baseline.baselineId);

    if (committedEntry && committedEntry.parentBuyActionId !== actionId) {
      return {
        headBlock, candidatesConsidered: considered, pass, reject, unknown,
        action: 'BLOCKED_SETUP', launchId: baseline.launchId,
        reason: 'CANARY_E0_ENTRY_APPROVAL_PARENT_BUY_IDENTITY_DRIFT'
      };
    }

    if (vet.decision !== 'PASS') {
      if (committedEntry) {
        if (vet.decision === 'REJECT') {
          return runCleanup({
            trigger: 'CANDIDATE_REJECTED', committedEntry, params, headBlock,
            candidatesConsidered: considered, pass, reject, unknown,
            terminalParent: { baseline, decision: 'REJECT', reasons: vet.reasons }
          });
        }
        return {
          headBlock, candidatesConsidered: considered, pass, reject, unknown,
          action: 'BLOCKED_SETUP', launchId: baseline.launchId,
          reason: 'CANARY_E0_ENTRY_APPROVAL_CANDIDATE_NO_LONGER_PASS:UNKNOWN'
        };
      }
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

    // Advisory fast path only. The database partial UNIQUE index is the actual
    // one-buy authority and closes count/insert races across processes.
    if (params.canaryStore.countCommittedBuys() >= params.options.buyLimit) {
      if (committedEntry) {
        return {
          headBlock, candidatesConsidered: considered, pass, reject, unknown,
          action: 'BLOCKED_SETUP', launchId: baseline.launchId,
          reason: 'CANARY_E0_ENTRY_APPROVAL_BUY_SLOT_ALREADY_CONSUMED'
        };
      }
      params.canaryStore.insert(makeRecord({
        actionId, baseline, decision: 'PASS', reasons: ['CANARY_BUY_LIMIT_REACHED'], state: 'SKIPPED'
      }));
      continue;
    }

    // Cleanup is intentionally forbidden inside this quote/execution try block. RPC,
    // authority, market, calibration and quote failures fail closed without signing revoke.
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

      let amountIn = calibration.baseAmount;
      if (committedEntry) {
        if (getAddress(committedEntry.intent.owner) !== getAddress(params.executor.walletAddress)) {
          throw new Error('CANARY_E0_ENTRY_APPROVAL_OWNER_DRIFT');
        }
        if (getAddress(committedEntry.intent.token) !== getAddress(market.baseToken as Address)) {
          throw new Error('CANARY_E0_ENTRY_APPROVAL_BASE_TOKEN_DRIFT');
        }
        if (getAddress(committedEntry.intent.buyTokenOut) !== getAddress(market.launchedToken as Address)) {
          throw new Error('CANARY_E0_ENTRY_APPROVAL_LAUNCHED_TOKEN_DRIFT');
        }
        if (committedEntry.intent.buyFee !== market.fee) throw new Error('CANARY_E0_ENTRY_APPROVAL_FEE_DRIFT');
        if (getAddress(committedEntry.intent.spender) !== INK_SWAP_ROUTER_02) throw new Error('CANARY_E0_ENTRY_APPROVAL_ROUTER_DRIFT');
        if (committedEntry.intent.amount > calibration.baseAmount) {
          throw new Error(`CANARY_E0_ENTRY_APPROVAL_EXCEEDS_FRESH_DOLLAR_CAP:${committedEntry.intent.amount}:${calibration.baseAmount}`);
        }
        amountIn = committedEntry.intent.amount;
      }

      const entry = await params.baselineSource.quoteEntry({
        launch, market, decisionBlock: quoteBlockNumber, decisionBlockHash: quoteBlockHash,
        notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS, amountIn
      });
      if (!entry.executable || entry.amountOut <= 0n) throw new Error('CANARY_FRESH_ENTRY_NOT_EXECUTABLE');
      const reverse = await params.baselineSource.quoteIndependentReverse({
        launch, market, decisionBlock: quoteBlockNumber, decisionBlockHash: quoteBlockHash,
        notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS, amountIn: entry.amountOut
      });
      if (!reverse.executable || reverse.amountOut <= 0n) throw new Error('CANARY_FRESH_REVERSE_NOT_EXECUTABLE');

      const quoteBlockHashAfter = await params.baselineSource.getBlockHash(quoteBlockNumber);
      assertCanaryQuoteBlockHash(quoteBlockHash, quoteBlockHashAfter);

      const chainClock = await params.executor.getChainClock();
      const intent = await buildCanarySwapIntent({
        launchId: baseline.launchId,
        baselineId: baseline.baselineId,
        quoteBlockNumber,
        quoteBlockHash,
        tokenIn: market.baseToken as Address,
        tokenOut: market.launchedToken as Address,
        fee: market.fee,
        recipient: params.executor.walletAddress,
        notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
        amountIn,
        quotedAmountOut: entry.amountOut,
        slippageBps: params.options.slippageBps,
        chainTimestampSeconds: chainClock.timestampSeconds,
        deadlineSeconds: params.options.deadlineSeconds
      });

      if (params.entryApprovalStore) {
        const entryApproval = await advanceCanaryE0EntryApproval({
          plannedBuy: intent,
          store: params.entryApprovalStore,
          executor: params.executor
        });
        if (entryApproval.action !== 'READY_TO_BUY') {
          return {
            headBlock, candidatesConsidered: considered, pass, reject, unknown,
            action: mapEntryApprovalAction(entryApproval.action),
            launchId: baseline.launchId,
            transactionHash: entryApproval.transactionHash,
            reason: entryApproval.reason
          };
        }
      }

      const preflight = await params.executor.preflight(intent);
      if (params.entryApprovalStore && preflight.inputAllowance !== intent.amountIn) {
        throw new Error(`CANARY_E0_ENTRY_APPROVAL_BUY_ALLOWANCE_NOT_EXACT:${preflight.inputAllowance}:${intent.amountIn}`);
      }
      const now = Date.now();
      const reservation = params.canaryStore.insert(makeRecord({
        actionId: intent.actionId,
        baseline,
        decision: 'PASS',
        reasons: [],
        state: 'RESERVED',
        intent,
        outputBalanceBefore: preflight.outputBalanceBefore,
        now
      }));
      if (reservation === 'DUPLICATE') {
        return {
          headBlock, candidatesConsidered: considered, pass, reject, unknown,
          action: 'BLOCKED_UNRESOLVED', launchId: baseline.launchId,
          reason: 'CANARY_RESERVATION_DUPLICATE_NO_SIGN'
        };
      }
      if (reservation === 'BUY_LIMIT') {
        return {
          headBlock, candidatesConsidered: considered, pass, reject, unknown,
          action: 'BLOCKED_UNRESOLVED', launchId: baseline.launchId,
          reason: 'CANARY_GLOBAL_BUY_SLOT_ALREADY_RESERVED'
        };
      }

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

async function runCleanup(params: {
  trigger: CanaryEntryApprovalCleanupTrigger;
  committedEntry: CanaryEntryApprovalActionRecord;
  params: Parameters<typeof syncCanarySniper>[0];
  headBlock: bigint;
  candidatesConsidered: number;
  pass: number;
  reject: number;
  unknown: number;
  terminalParent?: {
    baseline: { launchId: string; baselineId: string; decisionBlock: bigint; decisionBlockHash: Hex };
    decision: CanaryActionRecord['decision'];
    reasons: readonly string[];
  };
}): Promise<CanaryCycleReport> {
  const context = params.params;
  if (params.terminalParent && !context.canaryStore.getAction(params.committedEntry.parentBuyActionId)) {
    context.canaryStore.insert(makeRecord({
      actionId: params.committedEntry.parentBuyActionId,
      baseline: params.terminalParent.baseline,
      decision: params.terminalParent.decision,
      reasons: [...params.terminalParent.reasons, `CANARY_E0_ENTRY_APPROVAL_CLEANUP_TRIGGER:${params.trigger}`],
      state: 'SKIPPED'
    }));
  }

  if (!context.entryApprovalStore || !context.entryApprovalRevokeStore) {
    return {
      headBlock: params.headBlock,
      candidatesConsidered: params.candidatesConsidered,
      pass: params.pass,
      reject: params.reject,
      unknown: params.unknown,
      action: 'BLOCKED_SETUP',
      launchId: params.committedEntry.launchId,
      reason: `CANARY_E0_ENTRY_APPROVAL_REVOKE_WIRING_REQUIRED:${params.trigger}`
    };
  }
  if (!context.executor) {
    return {
      headBlock: params.headBlock,
      candidatesConsidered: params.candidatesConsidered,
      pass: params.pass,
      reject: params.reject,
      unknown: params.unknown,
      action: 'BLOCKED_UNRESOLVED',
      launchId: params.committedEntry.launchId,
      reason: `CANARY_E0_ENTRY_APPROVAL_REVOKE_EXECUTOR_REQUIRED:${params.trigger}`
    };
  }

  const cleanup = await cleanupCanaryE0EntryApproval({
    trigger: params.trigger,
    parentApproval: params.committedEntry,
    entryApprovalStore: context.entryApprovalStore,
    revokeStore: context.entryApprovalRevokeStore,
    executor: context.executor
  });
  return cleanupReport(
    params.headBlock,
    params.candidatesConsidered,
    params.pass,
    params.reject,
    params.unknown,
    params.committedEntry.launchId,
    cleanup
  );
}

function cleanupReport(
  headBlock: bigint,
  candidatesConsidered: number,
  pass: number,
  reject: number,
  unknown: number,
  launchId: string,
  cleanup: { action: CanaryEntryApprovalCleanupAction; trigger: CanaryEntryApprovalCleanupTrigger; transactionHash?: Hex | undefined; reason?: string | undefined }
): CanaryCycleReport {
  return {
    headBlock,
    candidatesConsidered,
    pass,
    reject,
    unknown,
    action: cleanup.action,
    launchId,
    transactionHash: cleanup.transactionHash,
    reason: cleanup.reason ?? `CANARY_E0_ENTRY_APPROVAL_CLEANUP_TRIGGER:${cleanup.trigger}`
  };
}

function mapCleanupAction(action: 'ENTRY_APPROVAL_REVOKE_INCLUDED' | 'ENTRY_APPROVAL_REVOKE_SUBMITTED' | 'BLOCKED_UNRESOLVED' | 'BLOCKED_SETUP'): CanaryCycleReport['action'] {
  return action;
}

function mapEntryApprovalAction(action: 'ENTRY_APPROVAL_INCLUDED' | 'ENTRY_APPROVAL_SUBMITTED' | 'READY_TO_BUY' | 'BLOCKED_UNRESOLVED' | 'BLOCKED_SETUP'): CanaryCycleReport['action'] {
  if (action === 'READY_TO_BUY') throw new Error('CANARY_E0_ENTRY_APPROVAL_READY_MAPPING_INVALID');
  return action;
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
