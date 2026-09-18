import type { Hex } from '../../../domain.js';
import { PONS_V2_NATIVE_PAIR_TOKEN, ROBINHOOD_CHAIN_ID } from './contracts.js';

export const ROBINHOOD_USDG: Hex = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const ROBINHOOD_USDG_IMPLEMENTATION: Hex = '0x68184C449E1a8f34fA18d289737129FD27B66f8F';
export const ROBINHOOD_V4_POOL_MANAGER: Hex = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const ROBINHOOD_V4_STATE_VIEW: Hex = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b';
export const ROBINHOOD_V4_QUOTER: Hex = '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94';

export const ROBINHOOD_ETH_USDG_V4_POOL_ID: Hex =
  '0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982';
export const ROBINHOOD_ETH_USDG_V4_POOL_KEY = Object.freeze({
  currency0: PONS_V2_NATIVE_PAIR_TOKEN,
  currency1: ROBINHOOD_USDG,
  fee: 500,
  tickSpacing: 10,
  hooks: PONS_V2_NATIVE_PAIR_TOKEN
});

export const EIP1967_IMPLEMENTATION_SLOT: Hex =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

export interface RobinhoodUsdCalibrationAuthority {
  authorityId: string;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  fromBlock: bigint;
  throughBlock?: bigint;
  poolManager: Hex;
  poolManagerRuntimeCodeHash: Hex;
  stateView: Hex;
  stateViewRuntimeCodeHash: Hex;
  quoter: Hex;
  quoterRuntimeCodeHash: Hex;
  usdg: Hex;
  usdgProxyRuntimeCodeHash: Hex;
  usdgImplementation: Hex;
  usdgImplementationRuntimeCodeHash: Hex;
  poolId: Hex;
}

export const CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY:
Readonly<RobinhoodUsdCalibrationAuthority> = Object.freeze({
  authorityId: 'ROBINHOOD_NATIVE_USDG_V4_CALIBRATION_2026_06_R0',
  chainId: ROBINHOOD_CHAIN_ID,
  fromBlock: 169_464n,
  poolManager: ROBINHOOD_V4_POOL_MANAGER,
  poolManagerRuntimeCodeHash: '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626',
  stateView: ROBINHOOD_V4_STATE_VIEW,
  stateViewRuntimeCodeHash: '0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6',
  quoter: ROBINHOOD_V4_QUOTER,
  quoterRuntimeCodeHash: '0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6',
  usdg: ROBINHOOD_USDG,
  usdgProxyRuntimeCodeHash: '0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6',
  usdgImplementation: ROBINHOOD_USDG_IMPLEMENTATION,
  usdgImplementationRuntimeCodeHash:
    '0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf',
  poolId: ROBINHOOD_ETH_USDG_V4_POOL_ID
});

export function validateRobinhoodUsdCalibrationAuthority(
  authority: Readonly<RobinhoodUsdCalibrationAuthority>
): void {
  if (!authority.authorityId.trim()) throw new Error('ROBINHOOD_USD_CALIBRATION_AUTHORITY_ID_MISSING');
  if (authority.chainId !== ROBINHOOD_CHAIN_ID) throw new Error('ROBINHOOD_USD_CALIBRATION_CHAIN_MISMATCH');
  if (authority.fromBlock < 0n) throw new Error('ROBINHOOD_USD_CALIBRATION_FROM_BLOCK_INVALID');
  if (authority.throughBlock !== undefined && authority.throughBlock < authority.fromBlock) {
    throw new Error('ROBINHOOD_USD_CALIBRATION_BLOCK_RANGE_INVALID');
  }
  for (const [label, value] of [
    ['POOL_MANAGER', authority.poolManager],
    ['STATE_VIEW', authority.stateView],
    ['QUOTER', authority.quoter],
    ['USDG', authority.usdg],
    ['USDG_IMPLEMENTATION', authority.usdgImplementation]
  ] as const) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`ROBINHOOD_USD_CALIBRATION_${label}_ADDRESS_INVALID`);
    }
  }
  for (const [label, value] of [
    ['POOL_MANAGER', authority.poolManagerRuntimeCodeHash],
    ['STATE_VIEW', authority.stateViewRuntimeCodeHash],
    ['QUOTER', authority.quoterRuntimeCodeHash],
    ['USDG_PROXY', authority.usdgProxyRuntimeCodeHash],
    ['USDG_IMPLEMENTATION', authority.usdgImplementationRuntimeCodeHash],
    ['POOL_ID', authority.poolId]
  ] as const) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
      throw new Error(`ROBINHOOD_USD_CALIBRATION_${label}_HASH_INVALID`);
    }
  }
}

export function assertRobinhoodUsdCalibrationBlock(
  authority: Readonly<RobinhoodUsdCalibrationAuthority>,
  blockNumber: bigint
): void {
  if (blockNumber < authority.fromBlock) {
    throw new Error(
      `ROBINHOOD_USD_CALIBRATION_BLOCK_BEFORE_EPOCH:block=${blockNumber}:from=${authority.fromBlock}`
    );
  }
  if (authority.throughBlock !== undefined && blockNumber > authority.throughBlock) {
    throw new Error(
      `ROBINHOOD_USD_CALIBRATION_BLOCK_AFTER_EPOCH:block=${blockNumber}:through=${authority.throughBlock}`
    );
  }
}
