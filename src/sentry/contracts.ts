import type { Hex } from '../domain.js';

// Authority snapshot:
// mavrkofficial/inkonchain-mcp @ 23261b59e1257bb3527dafaa1e689c6e6953dba0
// src/config.ts + src/abis/SentryLaunchFactory.ts, cross-checked 2026-09-13.
export const INK_CHAIN_ID = 57073;
export const DEFAULT_INK_RPC_URL = 'https://rpc-gel.inkonchain.com';
export const DEFAULT_SENTRY_LAUNCH_FACTORY: Hex = '0xDc37e11B68052d1539fa23386eE58Ac444bf5BE1';
// Latest published Sentry tooling records this implementation for the proxy.
// Runtime reads the ERC-1967 implementation slot at the confirmed target block and
// refuses to ingest if it differs.
export const EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION: Hex = '0xd5bceD4c43eef627eE0524368cABAfcb9f29CfF0';
export const EIP1967_IMPLEMENTATION_SLOT: Hex =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

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
