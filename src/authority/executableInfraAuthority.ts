import type { Hex } from '../domain.js';

export const EXECUTABLE_INFRA_AUTHORITY_MANIFEST_VERSION = 'EXECUTABLE_INFRA_AUTHORITY_R3' as const;

export type ExecutableInfraAuthorityEpoch = {
  version: typeof EXECUTABLE_INFRA_AUTHORITY_MANIFEST_VERSION;
  status: 'AUTHORIZED';
  fromBlock: bigint;
  npm: Hex;
  factory: Hex;
  quoterV2: Hex;
  weth: Hex;
  activationBlock: bigint;
  activationTx: Hex;
  evidence: string;
};

// Discovery PR #12 scanned NPMUpdated across the authorized Sentry implementation
// epoch and independently verified the final update on Ink Blockscout. The update
// occurred in block 52269352, so executable reconstruction begins one block later
// to avoid same-block transaction-order ambiguity.
export const CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH: ExecutableInfraAuthorityEpoch = Object.freeze({
  version: EXECUTABLE_INFRA_AUTHORITY_MANIFEST_VERSION,
  status: 'AUTHORIZED',
  fromBlock: 52_269_353n,
  npm: '0xC0836E5B058BBE22ae2266e1AC488A1A0fD8DCE8',
  factory: '0x640887A9ba3A9C53Ed27D0F7e8246A4F933f3424',
  quoterV2: '0x96b572D2d880cf2Fa2563651BD23ADE6f5516652',
  weth: '0x4200000000000000000000000000000000000006',
  activationBlock: 52_269_352n,
  activationTx: '0xc24618fc2b3c15ddc49272fea90589564ea17052ab459886be4bfcf305ad8755',
  evidence: 'EXECUTABLE_INFRA_DISCOVERY_R2 PASS plus independent Ink Blockscout verification; exclude NPM update block 52269352.'
});

export function resolveAuthorizedExecutableInfra(blockNumber: bigint): ExecutableInfraAuthorityEpoch {
  if (blockNumber < CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock) {
    throw new Error(
      `EXECUTABLE_INFRA_EPOCH_UNAUTHORIZED:block=${blockNumber}:earliestAuthorized=${CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock}`
    );
  }
  return CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH;
}

export function assertAuthorizedExecutableStartBlock(startBlock: bigint): void {
  resolveAuthorizedExecutableInfra(startBlock);
}
