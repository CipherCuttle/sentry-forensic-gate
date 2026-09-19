import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex
} from 'viem';
import { PONS_V2_NATIVE_PAIR_TOKEN } from '../adapters/robinhood/ponsV2/contracts.js';
import { PONS_V2_MEME_HOOK } from '../adapters/robinhood/ponsV2/forwardOutcomeAuthority.js';
import {
  CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY
} from '../adapters/robinhood/ponsV2/v4ExitRecoveryAuthority.js';

export const PONS_E1_V4_EXIT_RECOVERY_V1 = 'PONS_E1_V4_EXIT_RECOVERY_V1' as const;

const UINT128_MAX = (1n << 128n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;
const UINT48_MAX = (1n << 48n) - 1n;
const BPS = 10_000n;

const V4_SWAP_COMMAND: Hex = '0x10';
const V4_ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const V4_ACTION_SETTLE_ALL = 0x0c;
const V4_ACTION_TAKE_ALL = 0x0f;
const V4_ACTIONS: Hex = '0x060c0f';

const erc20ApproveAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' }
  ],
  outputs: [{ name: '', type: 'bool' }]
}] as const;

const permit2ApproveAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'token', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' }
  ],
  outputs: []
}] as const;

const universalRouterAbi = [{
  type: 'function',
  name: 'execute',
  stateMutability: 'payable',
  inputs: [
    { name: 'commands', type: 'bytes' },
    { name: 'inputs', type: 'bytes[]' },
    { name: 'deadline', type: 'uint256' }
  ],
  outputs: []
}] as const;

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' }
] as const;

export interface PonsE1V4PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface PonsE1V4RecoveryBuildInput {
  token: Address;
  owner: Address;
  poolKey: PonsE1V4PoolKey;
  tokenAmount: bigint;
  quotedNativeOut: bigint;
  slippageBps: number;
  deadline: bigint;
  permit2Expiration: bigint;
}

export interface PonsE1V4RecoveryCall {
  kind: 'APPROVE_PERMIT2_EXACT' | 'PERMIT2_ALLOW_ROUTER_EXACT' | 'V4_EXIT_ALL';
  target: Address;
  value: bigint;
  calldata: Hex;
}

export interface PonsE1V4RecoveryPlan {
  version: typeof PONS_E1_V4_EXIT_RECOVERY_V1;
  token: Address;
  owner: Address;
  tokenAmount: bigint;
  quotedNativeOut: bigint;
  minNativeOut: bigint;
  slippageBps: number;
  poolKey: PonsE1V4PoolKey;
  routerVersion: '2.1.1';
  permit2: Address;
  universalRouter: Address;
  deadline: bigint;
  permit2Expiration: bigint;
  actions: Hex;
  calls: readonly [
    PonsE1V4RecoveryCall,
    PonsE1V4RecoveryCall,
    PonsE1V4RecoveryCall
  ];
}

export function buildPonsE1V4RecoveryPlan(
  input: PonsE1V4RecoveryBuildInput
): PonsE1V4RecoveryPlan {
  const token = getAddress(input.token);
  const owner = getAddress(input.owner);
  const permit2 = getAddress(CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2);
  const universalRouter = getAddress(
    CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.universalRouter
  );
  const poolKey: PonsE1V4PoolKey = {
    currency0: getAddress(input.poolKey.currency0),
    currency1: getAddress(input.poolKey.currency1),
    fee: input.poolKey.fee,
    tickSpacing: input.poolKey.tickSpacing,
    hooks: getAddress(input.poolKey.hooks)
  };

  if (poolKey.currency0 !== getAddress(PONS_V2_NATIVE_PAIR_TOKEN)) {
    throw new Error('PONS_E1_V4_RECOVERY_NATIVE_CURRENCY0_REQUIRED');
  }
  if (poolKey.currency1 !== token) {
    throw new Error('PONS_E1_V4_RECOVERY_TOKEN_CURRENCY1_MISMATCH');
  }
  if (poolKey.hooks !== getAddress(PONS_V2_MEME_HOOK)) {
    throw new Error('PONS_E1_V4_RECOVERY_PONS_HOOK_REQUIRED');
  }
  if (!Number.isInteger(poolKey.fee) || poolKey.fee < 0 || poolKey.fee > 0xffffff) {
    throw new Error('PONS_E1_V4_RECOVERY_POOL_FEE_INVALID');
  }
  if (
    !Number.isInteger(poolKey.tickSpacing) ||
    poolKey.tickSpacing < -0x800000 ||
    poolKey.tickSpacing > 0x7fffff ||
    poolKey.tickSpacing === 0
  ) {
    throw new Error('PONS_E1_V4_RECOVERY_TICK_SPACING_INVALID');
  }
  if (input.tokenAmount <= 0n || input.tokenAmount > UINT128_MAX) {
    throw new Error('PONS_E1_V4_RECOVERY_TOKEN_AMOUNT_UINT128_INVALID');
  }
  if (input.tokenAmount > UINT160_MAX) {
    throw new Error('PONS_E1_V4_RECOVERY_TOKEN_AMOUNT_UINT160_INVALID');
  }
  if (input.quotedNativeOut <= 0n) {
    throw new Error('PONS_E1_V4_RECOVERY_QUOTE_INVALID');
  }
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 1_000
  ) {
    throw new Error('PONS_E1_V4_RECOVERY_SLIPPAGE_INVALID');
  }
  if (input.deadline <= 0n) {
    throw new Error('PONS_E1_V4_RECOVERY_DEADLINE_INVALID');
  }
  if (input.permit2Expiration <= 0n || input.permit2Expiration > UINT48_MAX) {
    throw new Error('PONS_E1_V4_RECOVERY_PERMIT2_EXPIRATION_INVALID');
  }
  if (input.permit2Expiration < input.deadline) {
    throw new Error('PONS_E1_V4_RECOVERY_PERMIT2_EXPIRES_BEFORE_ROUTER');
  }

  const minNativeOut =
    input.quotedNativeOut * (BPS - BigInt(input.slippageBps)) / BPS;
  if (minNativeOut <= 0n) {
    throw new Error('PONS_E1_V4_RECOVERY_MIN_NATIVE_OUT_ZERO');
  }
  if (minNativeOut > UINT128_MAX) {
    throw new Error('PONS_E1_V4_RECOVERY_MIN_NATIVE_OUT_UINT128_INVALID');
  }

  const swapParam = encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
        { name: 'zeroForOne', type: 'bool' },
        { name: 'amountIn', type: 'uint128' },
        { name: 'amountOutMinimum', type: 'uint128' },
        { name: 'minHopPriceX36', type: 'uint256' },
        { name: 'hookData', type: 'bytes' }
      ]
    }],
    [{
      poolKey,
      zeroForOne: false,
      amountIn: input.tokenAmount,
      amountOutMinimum: minNativeOut,
      minHopPriceX36: 0n,
      hookData: '0x'
    }]
  );

  const settleAllParam = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [token, input.tokenAmount]
  );
  const takeAllParam = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [getAddress(PONS_V2_NATIVE_PAIR_TOKEN), minNativeOut]
  );

  const v4SwapInput = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [V4_ACTIONS, [swapParam, settleAllParam, takeAllParam]]
  );

  const erc20Approval: PonsE1V4RecoveryCall = {
    kind: 'APPROVE_PERMIT2_EXACT',
    target: token,
    value: 0n,
    calldata: encodeFunctionData({
      abi: erc20ApproveAbi,
      functionName: 'approve',
      args: [permit2, input.tokenAmount]
    })
  };
  const permit2Approval: PonsE1V4RecoveryCall = {
    kind: 'PERMIT2_ALLOW_ROUTER_EXACT',
    target: permit2,
    value: 0n,
    calldata: encodeFunctionData({
      abi: permit2ApproveAbi,
      functionName: 'approve',
      args: [
        token,
        universalRouter,
        input.tokenAmount,
        Number(input.permit2Expiration)
      ]
    })
  };
  const exit: PonsE1V4RecoveryCall = {
    kind: 'V4_EXIT_ALL',
    target: universalRouter,
    value: 0n,
    calldata: encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [V4_SWAP_COMMAND, [v4SwapInput], input.deadline]
    })
  };

  return {
    version: PONS_E1_V4_EXIT_RECOVERY_V1,
    token,
    owner,
    tokenAmount: input.tokenAmount,
    quotedNativeOut: input.quotedNativeOut,
    minNativeOut,
    slippageBps: input.slippageBps,
    poolKey,
    routerVersion: '2.1.1',
    permit2,
    universalRouter,
    deadline: input.deadline,
    permit2Expiration: input.permit2Expiration,
    actions: V4_ACTIONS,
    calls: [erc20Approval, permit2Approval, exit]
  };
}

export const PONS_E1_V4_RECOVERY_COMMANDS = Object.freeze({
  universalRouterV4Swap: V4_SWAP_COMMAND,
  swapExactInSingle: V4_ACTION_SWAP_EXACT_IN_SINGLE,
  settleAll: V4_ACTION_SETTLE_ALL,
  takeAll: V4_ACTION_TAKE_ALL,
  actions: V4_ACTIONS
});
