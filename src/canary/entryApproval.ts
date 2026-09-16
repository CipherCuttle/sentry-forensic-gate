import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { sha256Hex } from '../evidence/canonical.js';
import {
  assertCanaryApprovalCalldata,
  ERC20_MAX_UINT256,
  erc20ApprovalAbi
} from './approval.js';
import {
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  CANARY_SNIPER_R0,
  deriveCanaryActionId,
  INK_SWAP_ROUTER_02,
  type CanarySwapIntent
} from './swapIntent.js';

export const CANARY_E0_ENTRY_APPROVAL_R0 = 'CANARY_E0_ENTRY_APPROVAL_R0' as const;

export interface CanaryEntryApprovalIntent {
  version: typeof CANARY_E0_ENTRY_APPROVAL_R0;
  actionId: string;
  parentBuyActionId: string;
  launchId: string;
  baselineId: string;
  owner: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  sourceQuoteBlockNumber: bigint;
  sourceQuoteBlockHash: Hex;
  notionalUsdMicros: typeof CANARY_PRIMARY_NOTIONAL_USD_MICROS;
  calldata: Hex;
}

export async function deriveCanaryEntryApprovalActionId(params: {
  parentBuyActionId: string;
  launchId: string;
  baselineId: string;
  owner: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  sourceQuoteBlockNumber: bigint;
  sourceQuoteBlockHash: Hex;
}): Promise<string> {
  if (!params.parentBuyActionId || !params.launchId || !params.baselineId) {
    throw new Error('CANARY_ENTRY_APPROVAL_IDENTITY_REQUIRED');
  }
  assertEntryApprovalAmount(params.amount);
  if (params.sourceQuoteBlockNumber < 0n) throw new Error('CANARY_ENTRY_APPROVAL_QUOTE_BLOCK_INVALID');
  const spender = getAddress(params.spender);
  if (spender !== INK_SWAP_ROUTER_02) throw new Error(`CANARY_ENTRY_APPROVAL_SPENDER_MUST_EQUAL_ROUTER:${spender}`);
  return sha256Hex({
    kind: CANARY_E0_ENTRY_APPROVAL_R0,
    parentBuyActionId: params.parentBuyActionId,
    launchId: params.launchId,
    baselineId: params.baselineId,
    owner: getAddress(params.owner),
    token: getAddress(params.token),
    spender,
    amount: params.amount,
    sourceQuoteBlockNumber: params.sourceQuoteBlockNumber,
    sourceQuoteBlockHash: params.sourceQuoteBlockHash.toLowerCase(),
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS
  });
}

export async function buildCanaryEntryApprovalIntent(buyIntent: CanarySwapIntent): Promise<CanaryEntryApprovalIntent> {
  assertCanonicalBuy(buyIntent);
  const expectedBuyActionId = await deriveCanaryActionId(buyIntent.launchId, buyIntent.baselineId);
  if (buyIntent.actionId !== expectedBuyActionId) throw new Error('CANARY_ENTRY_APPROVAL_PARENT_BUY_IDENTITY_DRIFT');
  assertEntryApprovalAmount(buyIntent.amountIn);

  const owner = getAddress(buyIntent.recipient);
  const token = getAddress(buyIntent.tokenIn);
  const spender = getAddress(buyIntent.router);
  if (spender !== INK_SWAP_ROUTER_02) throw new Error(`CANARY_ENTRY_APPROVAL_SPENDER_MUST_EQUAL_ROUTER:${spender}`);

  const actionId = await deriveCanaryEntryApprovalActionId({
    parentBuyActionId: buyIntent.actionId,
    launchId: buyIntent.launchId,
    baselineId: buyIntent.baselineId,
    owner,
    token,
    spender,
    amount: buyIntent.amountIn,
    sourceQuoteBlockNumber: buyIntent.quoteBlockNumber,
    sourceQuoteBlockHash: buyIntent.quoteBlockHash
  });
  if (actionId === buyIntent.actionId) throw new Error('CANARY_ENTRY_APPROVAL_ACTION_ID_COLLISION');

  const calldata = encodeFunctionData({
    abi: erc20ApprovalAbi,
    functionName: 'approve',
    args: [spender, buyIntent.amountIn]
  });
  assertCanaryApprovalCalldata({ spender, amount: buyIntent.amountIn, calldata });

  return {
    version: CANARY_E0_ENTRY_APPROVAL_R0,
    actionId,
    parentBuyActionId: buyIntent.actionId,
    launchId: buyIntent.launchId,
    baselineId: buyIntent.baselineId,
    owner,
    token,
    spender,
    amount: buyIntent.amountIn,
    sourceQuoteBlockNumber: buyIntent.quoteBlockNumber,
    sourceQuoteBlockHash: buyIntent.quoteBlockHash,
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
    calldata
  };
}

export function assertCanaryEntryApprovalCalldata(
  intent: Pick<CanaryEntryApprovalIntent, 'spender' | 'amount' | 'calldata'>
): void {
  assertEntryApprovalAmount(intent.amount);
  assertCanaryApprovalCalldata(intent);
}

function assertEntryApprovalAmount(amount: bigint): void {
  if (amount <= 0n) throw new Error('CANARY_ENTRY_APPROVAL_AMOUNT_MUST_BE_POSITIVE');
  if (amount === ERC20_MAX_UINT256) throw new Error('CANARY_ENTRY_APPROVAL_INFINITE_ALLOWANCE_FORBIDDEN');
}

function assertCanonicalBuy(intent: CanarySwapIntent): void {
  if (intent.version !== CANARY_SNIPER_R0) throw new Error('CANARY_ENTRY_APPROVAL_PARENT_VERSION_INVALID');
  if (intent.notionalUsdMicros !== CANARY_PRIMARY_NOTIONAL_USD_MICROS) {
    throw new Error('CANARY_ENTRY_APPROVAL_PARENT_NOTIONAL_INVALID');
  }
  if (intent.value !== 0n) throw new Error('CANARY_ENTRY_APPROVAL_PARENT_VALUE_INVALID');
  if (getAddress(intent.router) !== INK_SWAP_ROUTER_02) throw new Error('CANARY_ENTRY_APPROVAL_PARENT_ROUTER_INVALID');
  if (!intent.actionId || !intent.launchId || !intent.baselineId) throw new Error('CANARY_ENTRY_APPROVAL_PARENT_IDENTITY_MISSING');
}
