import type { Hex } from '../../../domain.js';
import { ROBINHOOD_CHAIN_ID, PONS_V2_NATIVE_PAIR_TOKEN } from './contracts.js';

/**
 * Reviewed Pons V2 factory epoch.
 *
 * There is intentionally no repository default. Official Pons surfaces currently
 * disagree on the V2 factory address, so a runtime may only activate after a
 * specific factory epoch and runtime-code hash have been independently pinned.
 */
export interface PonsV2Authority {
  authorityId: string;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  factory: Hex;
  fromBlock: bigint;
  throughBlock?: bigint;
  factoryRuntimeCodeHash: Hex;
}

export const CURRENT_PONS_V2_AUTHORITY: Readonly<PonsV2Authority> = Object.freeze({
  authorityId: 'ROBINHOOD_PONS_V2_FACTORY_2026_08_03_R1',
  chainId: ROBINHOOD_CHAIN_ID,
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  fromBlock: 26_841_846n,
  factoryRuntimeCodeHash: '0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84'
});

export function validatePonsV2Authority(authority: Readonly<PonsV2Authority>): void {
  if (!authority.authorityId.trim()) throw new Error('PONS_V2_AUTHORITY_ID_MISSING');
  if (authority.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`PONS_V2_AUTHORITY_CHAIN_MISMATCH:expected=${ROBINHOOD_CHAIN_ID}:actual=${authority.chainId}`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(authority.factory) || norm(authority.factory) === norm(PONS_V2_NATIVE_PAIR_TOKEN)) {
    throw new Error(`PONS_V2_AUTHORITY_FACTORY_INVALID:${authority.factory}`);
  }
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(authority.factoryRuntimeCodeHash) ||
    /^0x0{64}$/i.test(authority.factoryRuntimeCodeHash)
  ) {
    throw new Error(`PONS_V2_AUTHORITY_CODE_HASH_INVALID:${authority.factoryRuntimeCodeHash}`);
  }
  if (authority.fromBlock < 0n) throw new Error('PONS_V2_AUTHORITY_FROM_BLOCK_INVALID');
  if (authority.throughBlock !== undefined && authority.throughBlock < authority.fromBlock) {
    throw new Error('PONS_V2_AUTHORITY_BLOCK_RANGE_INVALID');
  }
}

export function assertPonsV2AuthorityBlock(
  authority: Readonly<PonsV2Authority>,
  blockNumber: bigint
): void {
  if (blockNumber < authority.fromBlock) {
    throw new Error(
      `PONS_V2_AUTHORITY_BLOCK_BEFORE_EPOCH:block=${blockNumber}:from=${authority.fromBlock}`
    );
  }
  if (authority.throughBlock !== undefined && blockNumber > authority.throughBlock) {
    throw new Error(
      `PONS_V2_AUTHORITY_BLOCK_AFTER_EPOCH:block=${blockNumber}:through=${authority.throughBlock}`
    );
  }
}

function norm(value: string): string {
  return value.toLowerCase();
}
