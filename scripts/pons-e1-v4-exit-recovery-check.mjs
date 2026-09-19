import assert from 'node:assert/strict';
import {
  decodeAbiParameters,
  decodeFunctionData
} from 'viem';
import {
  PONS_E1_V4_EXIT_RECOVERY_V1,
  PONS_E1_V4_RECOVERY_COMMANDS,
  buildPonsE1V4RecoveryPlan
} from '../dist/canary/ponsE1V4ExitRecovery.js';
import {
  CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY
} from '../dist/adapters/robinhood/ponsV2/v4ExitRecoveryAuthority.js';
import { PONS_V2_MEME_HOOK } from '../dist/adapters/robinhood/ponsV2/forwardOutcomeAuthority.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const TOKEN = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const QUOTE = 1_000_000_000_000_000n;
const AMOUNT = 123_456_789_000_000_000_000n;
const DEADLINE = 2_000_000_000n;

const erc20ApproveAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' }
  ],
  outputs: [{ name: '', type: 'bool' }]
}];

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
}];

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
}];

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' }
];

const swapTuple = [{
  type: 'tuple',
  components: [
    { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountIn', type: 'uint128' },
    { name: 'amountOutMinimum', type: 'uint128' },
    { name: 'minHopPriceX36', type: 'uint256' },
    { name: 'hookData', type: 'bytes' }
  ]
}];

const plan = buildPonsE1V4RecoveryPlan({
  token: TOKEN,
  owner: OWNER,
  poolKey: {
    currency0: ZERO,
    currency1: TOKEN,
    fee: 10_000,
    tickSpacing: 60,
    hooks: PONS_V2_MEME_HOOK
  },
  tokenAmount: AMOUNT,
  quotedNativeOut: QUOTE,
  slippageBps: 500,
  deadline: DEADLINE,
  permit2Expiration: DEADLINE
});

assert.equal(plan.version, PONS_E1_V4_EXIT_RECOVERY_V1);
assert.equal(plan.routerVersion, '2.1.1');
assert.equal(
  plan.universalRouter.toLowerCase(),
  CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.universalRouter.toLowerCase()
);
assert.equal(
  plan.permit2.toLowerCase(),
  CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2.toLowerCase()
);
assert.equal(plan.minNativeOut, QUOTE * 9_500n / 10_000n);
assert.equal(plan.actions, '0x060c0f');
assert.equal(PONS_E1_V4_RECOVERY_COMMANDS.universalRouterV4Swap, '0x10');

const [erc20Approval, permit2Approval, exit] = plan.calls;

const erc20Decoded = decodeFunctionData({
  abi: erc20ApproveAbi,
  data: erc20Approval.calldata
});
assert.equal(erc20Decoded.functionName, 'approve');
assert.equal(erc20Decoded.args[0].toLowerCase(), plan.permit2.toLowerCase());
assert.equal(erc20Decoded.args[1], AMOUNT);
assert.equal(erc20Approval.value, 0n);

const permit2Decoded = decodeFunctionData({
  abi: permit2ApproveAbi,
  data: permit2Approval.calldata
});
assert.equal(permit2Decoded.functionName, 'approve');
assert.equal(permit2Decoded.args[0].toLowerCase(), TOKEN.toLowerCase());
assert.equal(permit2Decoded.args[1].toLowerCase(), plan.universalRouter.toLowerCase());
assert.equal(permit2Decoded.args[2], AMOUNT);
assert.equal(BigInt(permit2Decoded.args[3]), DEADLINE);
assert.equal(permit2Approval.value, 0n);

const routerDecoded = decodeFunctionData({
  abi: universalRouterAbi,
  data: exit.calldata
});
assert.equal(routerDecoded.functionName, 'execute');
assert.equal(routerDecoded.args[0], '0x10');
assert.equal(routerDecoded.args[2], DEADLINE);
assert.equal(routerDecoded.args[1].length, 1);
assert.equal(exit.value, 0n);

const [actions, actionParams] = decodeAbiParameters(
  [{ type: 'bytes' }, { type: 'bytes[]' }],
  routerDecoded.args[1][0]
);
assert.equal(actions, '0x060c0f');
assert.equal(actionParams.length, 3);

const [swap] = decodeAbiParameters(swapTuple, actionParams[0]);
assert.equal(swap.poolKey.currency0.toLowerCase(), ZERO.toLowerCase());
assert.equal(swap.poolKey.currency1.toLowerCase(), TOKEN.toLowerCase());
assert.equal(Number(swap.poolKey.fee), 10_000);
assert.equal(Number(swap.poolKey.tickSpacing), 60);
assert.equal(swap.poolKey.hooks.toLowerCase(), PONS_V2_MEME_HOOK.toLowerCase());
assert.equal(swap.zeroForOne, false);
assert.equal(swap.amountIn, AMOUNT);
assert.equal(swap.amountOutMinimum, plan.minNativeOut);
assert.equal(swap.minHopPriceX36, 0n);
assert.equal(swap.hookData, '0x');

const [settleToken, settleMax] = decodeAbiParameters(
  [{ type: 'address' }, { type: 'uint256' }],
  actionParams[1]
);
assert.equal(settleToken.toLowerCase(), TOKEN.toLowerCase());
assert.equal(settleMax, AMOUNT);

const [takeCurrency, takeMin] = decodeAbiParameters(
  [{ type: 'address' }, { type: 'uint256' }],
  actionParams[2]
);
assert.equal(takeCurrency.toLowerCase(), ZERO.toLowerCase());
assert.equal(takeMin, plan.minNativeOut);

assert.throws(
  () => buildPonsE1V4RecoveryPlan({
    token: TOKEN,
    owner: OWNER,
    poolKey: {
      currency0: OWNER,
      currency1: TOKEN,
      fee: 10_000,
      tickSpacing: 60,
      hooks: PONS_V2_MEME_HOOK
    },
    tokenAmount: AMOUNT,
    quotedNativeOut: QUOTE,
    slippageBps: 500,
    deadline: DEADLINE,
    permit2Expiration: DEADLINE
  }),
  /PONS_E1_V4_RECOVERY_NATIVE_CURRENCY0_REQUIRED/
);

assert.throws(
  () => buildPonsE1V4RecoveryPlan({
    token: TOKEN,
    owner: OWNER,
    poolKey: {
      currency0: ZERO,
      currency1: TOKEN,
      fee: 10_000,
      tickSpacing: 60,
      hooks: OWNER
    },
    tokenAmount: AMOUNT,
    quotedNativeOut: QUOTE,
    slippageBps: 500,
    deadline: DEADLINE,
    permit2Expiration: DEADLINE
  }),
  /PONS_E1_V4_RECOVERY_PONS_HOOK_REQUIRED/
);

assert.throws(
  () => buildPonsE1V4RecoveryPlan({
    token: TOKEN,
    owner: OWNER,
    poolKey: {
      currency0: ZERO,
      currency1: TOKEN,
      fee: 10_000,
      tickSpacing: 60,
      hooks: PONS_V2_MEME_HOOK
    },
    tokenAmount: 1n << 128n,
    quotedNativeOut: QUOTE,
    slippageBps: 500,
    deadline: DEADLINE,
    permit2Expiration: DEADLINE
  }),
  /PONS_E1_V4_RECOVERY_TOKEN_AMOUNT_UINT128_INVALID/
);

assert.throws(
  () => buildPonsE1V4RecoveryPlan({
    token: TOKEN,
    owner: OWNER,
    poolKey: {
      currency0: ZERO,
      currency1: TOKEN,
      fee: 10_000,
      tickSpacing: 60,
      hooks: PONS_V2_MEME_HOOK
    },
    tokenAmount: AMOUNT,
    quotedNativeOut: QUOTE,
    slippageBps: 1_001,
    deadline: DEADLINE,
    permit2Expiration: DEADLINE
  }),
  /PONS_E1_V4_RECOVERY_SLIPPAGE_INVALID/
);

assert.throws(
  () => buildPonsE1V4RecoveryPlan({
    token: TOKEN,
    owner: OWNER,
    poolKey: {
      currency0: ZERO,
      currency1: TOKEN,
      fee: 10_000,
      tickSpacing: 60,
      hooks: PONS_V2_MEME_HOOK
    },
    tokenAmount: AMOUNT,
    quotedNativeOut: QUOTE,
    slippageBps: 500,
    deadline: DEADLINE,
    permit2Expiration: DEADLINE - 1n
  }),
  /PONS_E1_V4_RECOVERY_PERMIT2_EXPIRES_BEFORE_ROUTER/
);

console.log(JSON.stringify({
  verdict: 'PONS_E1_V4_EXIT_RECOVERY_OFFLINE_PASS',
  version: PONS_E1_V4_EXIT_RECOVERY_V1,
  routerVersion: plan.routerVersion,
  universalRouter: plan.universalRouter,
  permit2: plan.permit2,
  actions: plan.actions,
  exactErc20Approval: true,
  exactPermit2Allowance: true,
  exactInputAllTokens: true,
  dualMinimumOutputFence: true,
  noSigner: true,
  noBroadcast: true
}, null, 2));
