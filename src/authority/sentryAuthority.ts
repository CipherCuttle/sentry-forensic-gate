import type { Hex } from '../domain.js';

export const SENTRY_AUTHORITY_MANIFEST_VERSION = 'SENTRY_AUTHORITY_EPOCHS_R1' as const;

export type SentryAuthorityEpoch = {
  version: typeof SENTRY_AUTHORITY_MANIFEST_VERSION;
  status: 'AUTHORIZED';
  fromBlock: bigint;
  implementation: Hex;
  implementationDeploymentTx: Hex;
  upgradeTx: Hex;
  evidence: string;
};

// First epoch authorized for runtime activation. Earlier proxy implementations
// are intentionally not authorized by this module yet: their upgrade logs are
// recorded as evidence, but their collector/baseline semantics have not been
// compatibility-reviewed under the frozen research contracts.
export const CURRENT_SENTRY_AUTHORITY_EPOCH: SentryAuthorityEpoch = Object.freeze({
  version: SENTRY_AUTHORITY_MANIFEST_VERSION,
  status: 'AUTHORIZED',
  fromBlock: 52_267_792n,
  implementation: '0x94b22ce6A3dB42e09685D12c3D4330296dc4cE73',
  implementationDeploymentTx: '0x430a1e2083d098e6b763808ce6958cd9701e5cf0d7467678673bad7f9f7ee79f',
  upgradeTx: '0x4fd4bb9f9c8db9beaddd7aa6cbf2aaa0cb872587ce2d7b20313b3828f4fbb693',
  evidence: 'Block 52267792: implementation deployed at tx position 3; ProxyAdmin upgrade at position 4; no Sentry launch transaction in the block.'
});

export function resolveAuthorizedSentryAuthority(blockNumber: bigint): SentryAuthorityEpoch {
  if (blockNumber < CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock) {
    throw new Error(
      `SENTRY_AUTHORITY_EPOCH_UNAUTHORIZED:block=${blockNumber}:earliestAuthorized=${CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock}`
    );
  }
  return CURRENT_SENTRY_AUTHORITY_EPOCH;
}

export function assertAuthorizedSentryStartBlock(startBlock: bigint): void {
  resolveAuthorizedSentryAuthority(startBlock);
}
