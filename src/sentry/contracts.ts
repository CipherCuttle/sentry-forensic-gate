import type { Hex } from '../domain.js';

// Authority snapshot:
// mavrkofficial/inkonchain-mcp @ 23261b59e1257bb3527dafaa1e689c6e6953dba0
// src/config.ts + src/abis/SentryLaunchFactory.ts, cross-checked 2026-09-13.
export const INK_CHAIN_ID = 57073;
export const DEFAULT_INK_RPC_URL = 'https://rpc-gel.inkonchain.com';
export const DEFAULT_SENTRY_LAUNCH_FACTORY: Hex = '0xDc37e11B68052d1539fa23386eE58Ac444bf5BE1';

const deploymentInputs = [
  { name: 'token', type: 'address', indexed: true },
  { name: 'name', type: 'string', indexed: false },
  { name: 'symbol', type: 'string', indexed: false },
  { name: 'creator', type: 'address', indexed: true },
  { name: 'tokenId', type: 'uint256', indexed: false }
] as const;

export const tokenDeployedEvent = {
  type: 'event',
  name: 'TokenDeployed',
  anonymous: false,
  inputs: deploymentInputs
} as const;

export const krakenVerifiedTokenDeployedEvent = {
  type: 'event',
  name: 'KrakenVerifiedTokenDeployed',
  anonymous: false,
  inputs: deploymentInputs
} as const;

export const goPumpMeTokenDeployedEvent = {
  type: 'event',
  name: 'GoPumpMeTokenDeployed',
  anonymous: false,
  inputs: deploymentInputs
} as const;

export const sentryLaunchFactoryReadAbi = [
  {
    type: 'function',
    name: 'isAgentPosition',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'isKrakenVerifiedPosition',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'isGoPumpMePosition',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;
