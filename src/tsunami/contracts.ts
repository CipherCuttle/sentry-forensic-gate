import type { Hex } from '../domain.js';
import { CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH } from '../authority/executableInfraAuthority.js';

// Legacy exported names retained to avoid widening the adapter surface. Values are
// now sourced from the reviewed current executable-infrastructure authority epoch.
export const TSUNAMI_V3_FACTORY: Hex = CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.factory;
export const TSUNAMI_POSITION_MANAGER: Hex = CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.npm;
export const TSUNAMI_QUOTER_V2: Hex = CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.quoterV2;
export const WETH9: Hex = CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.weth;
export const USDT0: Hex = '0x0200c29006150606b650577bbe7b6248f58470c1';
export const TSUNAMI_FEE_TIERS = [500, 3000, 10000] as const;
export const ZERO_ADDRESS: Hex = '0x0000000000000000000000000000000000000000';

export const positionManagerReadAbi = [
  {
    type: 'function',
    name: 'positions',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' }
    ]
  },
  {
    type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function', name: 'WETH9', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }]
  }
] as const;

export const tsunamiFactoryReadAbi = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' }
    ],
    outputs: [{ name: 'pool', type: 'address' }]
  }
] as const;

export const tsunamiPoolReadAbi = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'fee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint24' }] },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint128' }] },
  {
    type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' }
    ]
  }
] as const;

export const tsunamiQuoterV2Abi = [
  {
    type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' }
    ] }],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' }
    ]
  },
  {
    type: 'function', name: 'quoteExactOutputSingle', stateMutability: 'nonpayable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' }
    ] }],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' }
    ]
  },
  { type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'WETH9', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }
] as const;

export const sentryBaselineReadAbi = [
  { type: 'function', name: 'npm', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'getSupportedBaseTokens', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address[]' }] }
] as const;

export const erc20DecimalsAbi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] }
] as const;
