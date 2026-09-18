import type { Hex } from '../../../domain.js';

export const ROBINHOOD_CHAIN_ID = 4663 as const;
export const DEFAULT_ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
export const ROBINHOOD_EXPLORER_URL = 'https://robinhoodchain.blockscout.com';
export const PONS_V2_NATIVE_PAIR_TOKEN: Hex = '0x0000000000000000000000000000000000000000';

export const ponsV2TokenLaunchedEvent = {
  type: 'event',
  name: 'TokenLaunched',
  anonymous: false,
  inputs: [
    { name: 'token', type: 'address', indexed: true },
    { name: 'curve', type: 'address', indexed: true },
    { name: 'deployer', type: 'address', indexed: true },
    { name: 'pairToken', type: 'address', indexed: false },
    { name: 'launchConfigId', type: 'uint256', indexed: false },
    { name: 'graduationThreshold', type: 'uint256', indexed: false }
  ]
} as const;

export const ponsV2FactoryReadAbi = [
  {
    type: 'function',
    name: 'launchDeployer',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'getLaunchedToken',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'token', type: 'address' },
        { name: 'curve', type: 'address' },
        { name: 'deployer', type: 'address' },
        { name: 'creatorFeeRecipient', type: 'address' },
        { name: 'pairToken', type: 'address' },
        { name: 'graduationThreshold', type: 'uint256' },
        { name: 'poolFee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'creatorTaxBps', type: 'uint16' },
        { name: 'buybackEnabled', type: 'bool' },
        { name: 'phase', type: 'uint8' },
        { name: 'sweptQuote', type: 'uint256' },
        { name: 'sweptTokens', type: 'uint256' },
        { name: 'sweptAt', type: 'uint256' },
        { name: 'exists', type: 'bool' }
      ]
    }]
  }
] as const;

export const erc20MetadataReadAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }]
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }]
  }
] as const;

export const ponsV2CurveStateReadAbi = [
  {
    type: 'function',
    name: 'graduated',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'readyToGraduate',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;


export const ponsV2LaunchDeployerReadAbi = [
  {
    type: 'function',
    name: 'factory',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;

export const ponsV2CurveQuoteReadAbi = [
  ...ponsV2CurveStateReadAbi,
  {
    type: 'function',
    name: 'factory',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'pairToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'quoteReserve_', type: 'uint256' },
      { name: 'tokenReserve_', type: 'uint256' }
    ]
  },
  {
    type: 'function',
    name: 'trackedQuote',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'sellableTokens',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'feeBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'creatorTaxBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'snipeTaxExempt',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'currentSnipeTaxBps',
    stateMutability: 'view',
    inputs: [{ name: 'recipient', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;
