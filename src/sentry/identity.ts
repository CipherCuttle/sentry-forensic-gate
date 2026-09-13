import type { Hex, LaunchObserved } from '../domain.js';
import { canonicalJson, sha256Hex } from '../evidence/canonical.js';

function normHex(value: Hex): Hex {
  return value.toLowerCase() as Hex;
}

/**
 * Canonical launch identity intentionally excludes logIndex because a specialized
 * Sentry launch may surface both a generic and specialized deployment event.
 */
export async function deriveLaunchId(input: {
  chainId: number;
  factory: Hex;
  txHash: Hex;
  token: Hex;
}): Promise<string> {
  return sha256Hex({
    kind: 'SENTRY_LAUNCH_V1',
    chainId: input.chainId,
    factory: normHex(input.factory),
    txHash: normHex(input.txHash),
    token: normHex(input.token)
  });
}

export async function deriveEventId(input: {
  chainId: number;
  factory: Hex;
  txHash: Hex;
  logIndex: number;
}): Promise<string> {
  return sha256Hex({
    kind: 'SENTRY_EVENT_V1',
    chainId: input.chainId,
    factory: normHex(input.factory),
    txHash: normHex(input.txHash),
    logIndex: input.logIndex
  });
}

/** Normalize address/hash casing before persistence so SQLite uniqueness is not case-sensitive. */
export function normalizeLaunchHex(launch: LaunchObserved): LaunchObserved {
  return {
    ...launch,
    blockHash: normHex(launch.blockHash),
    factory: normHex(launch.factory),
    txHash: normHex(launch.txHash),
    token: normHex(launch.token),
    creator: normHex(launch.creator)
  };
}

/**
 * Observation time is intentionally excluded: replay may observe the same canonical
 * launch later. Every chain-authoritative field must otherwise agree.
 */
export function sameLaunchAuthority(a: LaunchObserved, b: LaunchObserved): boolean {
  return canonicalJson(launchAuthority(a)) === canonicalJson(launchAuthority(b));
}

function launchAuthority(launch: LaunchObserved) {
  const v = normalizeLaunchHex(launch);
  return {
    launchId: v.launchId,
    eventId: v.eventId,
    chainId: v.chainId,
    blockNumber: v.blockNumber,
    blockHash: v.blockHash,
    factory: v.factory,
    txHash: v.txHash,
    logIndex: v.logIndex,
    token: v.token,
    creator: v.creator,
    tokenId: v.tokenId,
    name: v.name,
    symbol: v.symbol,
    launchType: v.launchType,
    sourceEvent: v.sourceEvent
  };
}
