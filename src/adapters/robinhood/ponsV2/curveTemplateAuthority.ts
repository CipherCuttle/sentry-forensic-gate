import type { Hex } from '../../../domain.js';
import { ROBINHOOD_CHAIN_ID } from './contracts.js';
import type { PonsV2Authority } from './authority.js';

export interface PonsV2CurveTemplateAuthority {
  authorityId: string;
  factoryAuthorityId: string;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  factory: Hex;
  launchDeployer: Hex;
  fromBlock: bigint;
  throughBlock?: bigint;
  launchDeployerRuntimeCodeHash: Hex;
}

/**
 * Pons V2's launch deployer is wired once by the reviewed factory. Its deployed
 * runtime contains the exact PonsV2BondingCurve creation code used by CREATE2.
 * Pinning this helper therefore pins the curve implementation template without
 * pretending constructor-specific immutable bytes are identical across curves.
 */
export const CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY: Readonly<PonsV2CurveTemplateAuthority> =
  Object.freeze({
    authorityId: 'ROBINHOOD_PONS_V2_CURVE_TEMPLATE_2026_08_03_R0',
    factoryAuthorityId: 'ROBINHOOD_PONS_V2_FACTORY_2026_08_03_R1',
    chainId: ROBINHOOD_CHAIN_ID,
    factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
    launchDeployer: '0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42',
    fromBlock: 26_841_846n,
    launchDeployerRuntimeCodeHash:
      '0xeade22566c766377f6adfb99534f2772251efad9568642c0704a7051418e624c'
  });

export function validatePonsV2CurveTemplateAuthority(
  template: Readonly<PonsV2CurveTemplateAuthority>,
  factory: Readonly<PonsV2Authority>
): void {
  if (!template.authorityId.trim()) throw new Error('PONS_V2_CURVE_TEMPLATE_AUTHORITY_ID_MISSING');
  if (template.chainId !== ROBINHOOD_CHAIN_ID || template.chainId !== factory.chainId) {
    throw new Error('PONS_V2_CURVE_TEMPLATE_CHAIN_MISMATCH');
  }
  if (template.factoryAuthorityId !== factory.authorityId) {
    throw new Error('PONS_V2_CURVE_TEMPLATE_FACTORY_AUTHORITY_MISMATCH');
  }
  if (norm(template.factory) !== norm(factory.factory)) {
    throw new Error('PONS_V2_CURVE_TEMPLATE_FACTORY_MISMATCH');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(template.launchDeployer)) {
    throw new Error('PONS_V2_CURVE_TEMPLATE_DEPLOYER_INVALID');
  }
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(template.launchDeployerRuntimeCodeHash) ||
    /^0x0{64}$/i.test(template.launchDeployerRuntimeCodeHash)
  ) {
    throw new Error('PONS_V2_CURVE_TEMPLATE_CODE_HASH_INVALID');
  }
  if (template.fromBlock < factory.fromBlock) {
    throw new Error('PONS_V2_CURVE_TEMPLATE_EPOCH_BEFORE_FACTORY');
  }
  if (template.throughBlock !== undefined && template.throughBlock < template.fromBlock) {
    throw new Error('PONS_V2_CURVE_TEMPLATE_BLOCK_RANGE_INVALID');
  }
}

export function assertPonsV2CurveTemplateBlock(
  template: Readonly<PonsV2CurveTemplateAuthority>,
  blockNumber: bigint
): void {
  if (blockNumber < template.fromBlock) {
    throw new Error(
      `PONS_V2_CURVE_TEMPLATE_BLOCK_BEFORE_EPOCH:block=${blockNumber}:from=${template.fromBlock}`
    );
  }
  if (template.throughBlock !== undefined && blockNumber > template.throughBlock) {
    throw new Error(
      `PONS_V2_CURVE_TEMPLATE_BLOCK_AFTER_EPOCH:block=${blockNumber}:through=${template.throughBlock}`
    );
  }
}

function norm(value: string): string {
  return value.toLowerCase();
}
