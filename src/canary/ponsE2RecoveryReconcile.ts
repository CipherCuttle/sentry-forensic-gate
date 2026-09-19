import {
  getAddress,
  type Address,
  type Hex,
  type PublicClient
} from 'viem';
import {
  CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY
} from '../adapters/robinhood/ponsV2/v4ExitRecoveryAuthority.js';
import type { PonsE2RecoveryState } from './ponsE2RecoveryState.js';

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

const permit2Abi = [{
  type: 'function',
  name: 'allowance',
  stateMutability: 'view',
  inputs: [
    { name: 'user', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'spender', type: 'address' }
  ],
  outputs: [
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' }
  ]
}] as const;

export interface PonsE2Reconciliation {
  verdict: 'PONS_E2_MANUAL_RECONCILIATION_REQUIRED';
  stateStatus: PonsE2RecoveryState['status'];
  latestTransactionHash: Hex | null;
  transactionObservation:
    | 'NO_HASH'
    | 'NOT_OBSERVED'
    | 'PENDING_OR_INCLUDED_NO_RECEIPT'
    | 'RECEIPT_SUCCESS'
    | 'RECEIPT_REVERTED';
  receiptBlockNumber: bigint | null;
  tokenBalance: bigint;
  tokenAllowanceToPermit2: bigint;
  permit2AllowanceToRouter: bigint;
  permit2Expiration: bigint;
  permit2Nonce: bigint;
  autoRetryAllowed: false;
  nextAction: 'MANUAL_REVIEW_ONLY';
}

export async function reconcilePonsE2Recovery(params: {
  state: PonsE2RecoveryState;
  client: PublicClient;
}): Promise<PonsE2Reconciliation> {
  const token = getAddress(params.state.token);
  const wallet = getAddress(params.state.wallet);
  const permit2 = getAddress(
    CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2
  );
  const router = getAddress(
    CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.universalRouter
  );

  const [tokenBalance, tokenAllowance, permit2Allowance] = await Promise.all([
    params.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [wallet]
    }),
    params.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [wallet, permit2]
    }),
    params.client.readContract({
      address: permit2,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [wallet, token, router]
    })
  ]);

  const latestHash = params.state.latestTransactionHash
    ? params.state.latestTransactionHash as Hex
    : null;
  let transactionObservation: PonsE2Reconciliation['transactionObservation'] =
    'NO_HASH';
  let receiptBlockNumber: bigint | null = null;

  if (latestHash) {
    try {
      const receipt = await params.client.getTransactionReceipt({
        hash: latestHash
      });
      receiptBlockNumber = receipt.blockNumber;
      transactionObservation =
        receipt.status === 'success' ? 'RECEIPT_SUCCESS' : 'RECEIPT_REVERTED';
    } catch (receiptError) {
      const receiptMessage =
        receiptError instanceof Error ? receiptError.message : String(receiptError);
      if (
        !/not found|could not be found|TransactionReceiptNotFound/i.test(
          receiptMessage
        )
      ) {
        throw receiptError;
      }
      try {
        await params.client.getTransaction({ hash: latestHash });
        transactionObservation = 'PENDING_OR_INCLUDED_NO_RECEIPT';
      } catch (txError) {
        const txMessage = txError instanceof Error ? txError.message : String(txError);
        if (!/not found|could not be found|TransactionNotFound/i.test(txMessage)) {
          throw txError;
        }
        transactionObservation = 'NOT_OBSERVED';
      }
    }
  }

  return {
    verdict: 'PONS_E2_MANUAL_RECONCILIATION_REQUIRED',
    stateStatus: params.state.status,
    latestTransactionHash: latestHash,
    transactionObservation,
    receiptBlockNumber,
    tokenBalance,
    tokenAllowanceToPermit2: tokenAllowance,
    permit2AllowanceToRouter: permit2Allowance[0],
    permit2Expiration: BigInt(permit2Allowance[1]),
    permit2Nonce: BigInt(permit2Allowance[2]),
    autoRetryAllowed: false,
    nextAction: 'MANUAL_REVIEW_ONLY'
  };
}
