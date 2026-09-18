import type { Hex } from '../../../domain.js';
import { ROBINHOOD_CHAIN_ID } from './contracts.js';

export const PONS_V2_MEME_HOOK: Hex =
  '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';
export const PONS_V2_MEME_HOOK_RUNTIME_CODE_HASH: Hex =
  '0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db';

export interface PonsV2ForwardOutcomeAuthority {
  authorityId: string;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  fromBlock: bigint;
  throughBlock?: bigint;
  memeHook: Hex;
  memeHookRuntimeCodeHash: Hex;
}

export const CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY:
Readonly<PonsV2ForwardOutcomeAuthority> = Object.freeze({
  authorityId: 'ROBINHOOD_PONS_V2_FORWARD_OUTCOME_2026_09_R0',
  chainId: ROBINHOOD_CHAIN_ID,
  fromBlock: 26_841_846n,
  memeHook: PONS_V2_MEME_HOOK,
  memeHookRuntimeCodeHash: PONS_V2_MEME_HOOK_RUNTIME_CODE_HASH
});

export function validatePonsV2ForwardOutcomeAuthority(
  authority: Readonly<PonsV2ForwardOutcomeAuthority>
): void {
  if (!authority.authorityId.trim()) {
    throw new Error('PONS_V2_FORWARD_AUTHORITY_ID_MISSING');
  }
  if (authority.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error('PONS_V2_FORWARD_AUTHORITY_CHAIN_MISMATCH');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(authority.memeHook)) {
    throw new Error('PONS_V2_FORWARD_MEME_HOOK_INVALID');
  }
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(authority.memeHookRuntimeCodeHash) ||
    /^0x0{64}$/i.test(authority.memeHookRuntimeCodeHash)
  ) {
    throw new Error('PONS_V2_FORWARD_MEME_HOOK_HASH_INVALID');
  }
  if (authority.fromBlock < 0n) {
    throw new Error('PONS_V2_FORWARD_FROM_BLOCK_INVALID');
  }
  if (
    authority.throughBlock !== undefined &&
    authority.throughBlock < authority.fromBlock
  ) {
    throw new Error('PONS_V2_FORWARD_BLOCK_RANGE_INVALID');
  }
}

export function assertPonsV2ForwardOutcomeBlock(
  authority: Readonly<PonsV2ForwardOutcomeAuthority>,
  blockNumber: bigint
): void {
  if (blockNumber < authority.fromBlock) {
    throw new Error(
      `PONS_V2_FORWARD_BLOCK_BEFORE_EPOCH:block=${blockNumber}:from=${authority.fromBlock}`
    );
  }
  if (
    authority.throughBlock !== undefined &&
    blockNumber > authority.throughBlock
  ) {
    throw new Error(
      `PONS_V2_FORWARD_BLOCK_AFTER_EPOCH:block=${blockNumber}:through=${authority.throughBlock}`
    );
  }
}
