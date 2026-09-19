import type { Hex } from '../../../domain.js';
import { ROBINHOOD_CHAIN_ID } from './contracts.js';

export const ROBINHOOD_PERMIT2: Hex =
  '0x000000000022D473030F116dDEE9F6B43aC78BA3';

export const ROBINHOOD_PERMIT2_RUNTIME_CODE_HASH: Hex =
  '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca';

export const ROBINHOOD_UNIVERSAL_ROUTER_V2_1_1: Hex =
  '0x8876789976dEcBfCbBbe364623C63652db8C0904';

export const ROBINHOOD_UNIVERSAL_ROUTER_V2_1_1_RUNTIME_CODE_HASH: Hex =
  '0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde';

export interface PonsV2V4ExitRecoveryAuthority {
  authorityId: string;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  fromBlock: bigint;
  permit2: Hex;
  permit2RuntimeCodeHash: Hex;
  universalRouter: Hex;
  universalRouterVersion: '2.1.1';
  universalRouterRuntimeCodeHash: Hex;
}

export const CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY:
Readonly<PonsV2V4ExitRecoveryAuthority> = Object.freeze({
  authorityId: 'ROBINHOOD_PONS_V2_V4_EXIT_RECOVERY_2026_09_R0',
  chainId: ROBINHOOD_CHAIN_ID,
  fromBlock: 18_127n,
  permit2: ROBINHOOD_PERMIT2,
  permit2RuntimeCodeHash: ROBINHOOD_PERMIT2_RUNTIME_CODE_HASH,
  universalRouter: ROBINHOOD_UNIVERSAL_ROUTER_V2_1_1,
  universalRouterVersion: '2.1.1',
  universalRouterRuntimeCodeHash:
    ROBINHOOD_UNIVERSAL_ROUTER_V2_1_1_RUNTIME_CODE_HASH
});

export function validatePonsV2V4ExitRecoveryAuthority(
  authority: Readonly<PonsV2V4ExitRecoveryAuthority>
): void {
  if (!authority.authorityId.trim()) {
    throw new Error('PONS_E1_V4_RECOVERY_AUTHORITY_ID_MISSING');
  }
  if (authority.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error('PONS_E1_V4_RECOVERY_CHAIN_MISMATCH');
  }
  if (authority.fromBlock < 0n) {
    throw new Error('PONS_E1_V4_RECOVERY_FROM_BLOCK_INVALID');
  }
  if (authority.universalRouterVersion !== '2.1.1') {
    throw new Error('PONS_E1_V4_RECOVERY_ROUTER_VERSION_UNPINNED');
  }
  for (const [label, value] of [
    ['PERMIT2', authority.permit2],
    ['UNIVERSAL_ROUTER', authority.universalRouter]
  ] as const) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`PONS_E1_V4_RECOVERY_${label}_ADDRESS_INVALID`);
    }
  }
  for (const [label, value] of [
    ['PERMIT2', authority.permit2RuntimeCodeHash],
    ['ROUTER', authority.universalRouterRuntimeCodeHash]
  ] as const) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
      throw new Error(`PONS_E1_V4_RECOVERY_${label}_HASH_INVALID`);
    }
  }
}
