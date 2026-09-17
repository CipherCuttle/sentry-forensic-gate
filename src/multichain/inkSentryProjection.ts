import type { Hex, LaunchObserved } from '../domain.js';
import { INK_CHAIN_ID } from '../sentry/contracts.js';
import type { NormalizedLaunchCandidate } from './domain.js';

const INK_SENTRY_LAUNCH_AUTHORITY_SCHEMA = 'INK_SENTRY_LAUNCH_OBSERVED_V1' as const;

function normHex(value: Hex): Hex {
  return value.toLowerCase() as Hex;
}

/**
 * Pure compatibility projection. It does not replace Sentry identity/persistence;
 * it exposes the existing canonical launch to the portable research boundary while
 * retaining every field currently used by sameLaunchAuthority().
 */
export function normalizeInkSentryLaunch(launch: LaunchObserved): NormalizedLaunchCandidate {
  if (launch.chainId !== INK_CHAIN_ID) {
    throw new Error(`INK_SENTRY_CHAIN_MISMATCH:${launch.chainId}`);
  }

  const blockHash = normHex(launch.blockHash);
  const factory = normHex(launch.factory);
  const txHash = normHex(launch.txHash);
  const token = normHex(launch.token);
  const creator = normHex(launch.creator);

  return {
    chainId: launch.chainId,
    ecosystem: 'INK',
    launchProtocol: 'SENTRY',
    launchId: launch.launchId,
    eventId: launch.eventId,
    factory,
    txHash,
    blockNumber: launch.blockNumber,
    blockHash,
    logIndex: launch.logIndex,
    token,
    creator,
    name: launch.name,
    symbol: launch.symbol,
    sourceEventName: launch.sourceEvent,
    observedAtMs: launch.observedAtMs,
    sourceAuthority: {
      schema: INK_SENTRY_LAUNCH_AUTHORITY_SCHEMA,
      payload: {
        launchId: launch.launchId,
        eventId: launch.eventId,
        chainId: launch.chainId,
        blockNumber: launch.blockNumber.toString(),
        blockHash,
        factory,
        txHash,
        logIndex: launch.logIndex,
        token,
        creator,
        tokenId: launch.tokenId.toString(),
        name: launch.name,
        symbol: launch.symbol,
        launchType: launch.launchType,
        sourceEvent: launch.sourceEvent
      }
    }
  };
}
