import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  defineChain,
  getAddress,
  http,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type WalletClient
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL
} from '../adapters/robinhood/ponsV2/contracts.js';
import {
  CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY
} from '../adapters/robinhood/ponsV2/v4ExitRecoveryAuthority.js';
import { verifyPonsE1V4Recovery } from './viemPonsE1V4RecoveryVerifier.js';
import {
  assertPonsE2RecoveryIntentCalldata,
  type PonsE2RecoveryIntent
} from './ponsE2V4RecoveryIntent.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});

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
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

const permit2Abi = [
  {
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
  }
] as const;

export interface PonsE2ExecutorCaps {
  maxGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface PonsE2Preflight {
  kind: PonsE2RecoveryIntent['kind'];
  checkedAtBlock: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface SignedPonsE2Transaction {
  kind: PonsE2RecoveryIntent['kind'];
  nonce: number;
  transactionHash: Hex;
  serializedTransaction: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface ViemPonsE2V4RecoveryExecutorOptions {
  privateKey: Hex;
  rpcUrl?: string;
  caps: PonsE2ExecutorCaps;
  publicClient?: PublicClient;
  broadcastEnabled?: boolean;
}

export class ViemPonsE2V4RecoveryExecutor {
  readonly walletAddress: Address;
  private readonly account: LocalAccount;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly caps: PonsE2ExecutorCaps;
  private readonly broadcastEnabled: boolean;
  private readonly signedIntents =
    new Map<string, Readonly<PonsE2RecoveryIntent>>();

  constructor(options: ViemPonsE2V4RecoveryExecutorOptions) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) {
      throw new Error('PONS_E2_PRIVATE_KEY_FORMAT_INVALID');
    }
    validateCaps(options.caps);
    this.account = privateKeyToAccount(options.privateKey);
    this.walletAddress = this.account.address;
    const transport = http(options.rpcUrl ?? DEFAULT_ROBINHOOD_RPC_URL);
    this.publicClient = options.publicClient ?? createPublicClient({
      chain: robinhood,
      transport
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: robinhood,
      transport
    });
    this.caps = options.caps;
    this.broadcastEnabled = options.broadcastEnabled === true;
  }

  async getTokenBalance(token: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.walletAddress]
    });
  }

  async getTokenAllowanceToPermit2(token: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [
        this.walletAddress,
        CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2 as Address
      ]
    });
  }

  async getPermit2AllowanceToRouter(token: Address): Promise<{
    amount: bigint;
    expiration: bigint;
    nonce: bigint;
  }> {
    const [amount, expiration, nonce] = await this.publicClient.readContract({
      address: CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2 as Address,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [
        this.walletAddress,
        token,
        CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.universalRouter as Address
      ]
    });
    return {
      amount,
      expiration: BigInt(expiration),
      nonce: BigInt(nonce)
    };
  }

  async preflight(intent: PonsE2RecoveryIntent): Promise<PonsE2Preflight> {
    assertPonsE2RecoveryIntentCalldata(intent);
    const checkedAtBlock = await this.assertIntentAuthority(intent);

    const simulated = await this.publicClient.call({
      account: this.walletAddress,
      to: intent.target,
      data: intent.calldata,
      value: 0n,
      blockNumber: checkedAtBlock
    });

    if (
      intent.kind === 'TOKEN_APPROVE_PERMIT2_EXACT' ||
      intent.kind === 'TOKEN_REVOKE_PERMIT2'
    ) {
      if (!simulated.data || simulated.data === '0x') {
        throw new Error('PONS_E2_TOKEN_APPROVAL_SIMULATION_RESULT_MISSING');
      }
      const approved = decodeFunctionResult({
        abi: erc20Abi,
        functionName: 'approve',
        data: simulated.data
      });
      if (approved !== true) {
        throw new Error('PONS_E2_TOKEN_APPROVAL_SIMULATION_FALSE');
      }
    }

    const [gas, fees] = await Promise.all([
      this.publicClient.estimateGas({
        account: this.walletAddress,
        to: intent.target,
        data: intent.calldata,
        value: 0n
      }),
      this.publicClient.estimateFeesPerGas({
        chain: undefined,
        type: 'eip1559'
      })
    ]);
    assertFeeAndGasCaps(
      gas,
      fees.maxFeePerGas,
      fees.maxPriorityFeePerGas,
      this.caps
    );
    return {
      kind: intent.kind,
      checkedAtBlock,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas
    };
  }

  async sign(
    intent: PonsE2RecoveryIntent,
    preflight: PonsE2Preflight
  ): Promise<SignedPonsE2Transaction> {
    if (preflight.kind !== intent.kind) {
      throw new Error('PONS_E2_PREFLIGHT_KIND_MISMATCH');
    }
    assertFeeAndGasCaps(
      preflight.gas,
      preflight.maxFeePerGas,
      preflight.maxPriorityFeePerGas,
      this.caps
    );

    const head = await this.publicClient.getBlockNumber();
    if (
      head < preflight.checkedAtBlock ||
      head - preflight.checkedAtBlock > 2n
    ) {
      throw new Error(
        `PONS_E2_PREFLIGHT_STALE:${preflight.checkedAtBlock}:${head}`
      );
    }
    await this.assertIntentAuthority(intent);

    const nonce = await this.publicClient.getTransactionCount({
      address: this.walletAddress,
      blockTag: 'pending'
    });
    const serializedTransaction = await this.account.signTransaction({
      chainId: ROBINHOOD_CHAIN_ID,
      type: 'eip1559',
      nonce,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas,
      to: intent.target,
      value: 0n,
      data: intent.calldata
    });
    const transactionHash = keccak256(serializedTransaction);
    const signed: SignedPonsE2Transaction = {
      kind: intent.kind,
      nonce,
      transactionHash,
      serializedTransaction,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas
    };
    await assertSignedPonsE2Transaction(
      intent,
      signed,
      this.walletAddress,
      this.caps
    );
    this.signedIntents.set(
      transactionHash.toLowerCase(),
      Object.freeze({ ...intent })
    );
    return signed;
  }

  async broadcastExact(signed: SignedPonsE2Transaction): Promise<Hex> {
    if (!this.broadcastEnabled) {
      throw new Error('PONS_E2_BROADCAST_AUTHORITY_DISABLED');
    }
    const key = signed.transactionHash.toLowerCase();
    const intent = this.signedIntents.get(key);
    if (!intent) {
      throw new Error('PONS_E2_BROADCAST_SIGNED_AUTHORITY_UNKNOWN');
    }
    await assertSignedPonsE2Transaction(
      intent,
      signed,
      this.walletAddress,
      this.caps
    );
    this.signedIntents.delete(key);

    const returnedHash = await this.walletClient.sendRawTransaction({
      serializedTransaction: signed.serializedTransaction
    });
    if (returnedHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
      throw new Error(
        `PONS_E2_BROADCAST_HASH_MISMATCH:${returnedHash}:${signed.transactionHash}`
      );
    }
    return returnedHash;
  }

  async getReceiptIfPresent(transactionHash: Hex) {
    try {
      return await this.publicClient.getTransactionReceipt({
        hash: transactionHash
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|could not be found|TransactionReceiptNotFound/i.test(message)) {
        return null;
      }
      throw error;
    }
  }

  private async assertIntentAuthority(
    intent: PonsE2RecoveryIntent
  ): Promise<bigint> {
    assertPonsE2RecoveryIntentCalldata(intent);
    if (getAddress(intent.owner) !== getAddress(this.walletAddress)) {
      throw new Error('PONS_E2_INTENT_OWNER_MUST_EQUAL_WALLET');
    }
    if (intent.value !== 0n) {
      throw new Error('PONS_E2_NATIVE_VALUE_FORBIDDEN');
    }
    const chainId = await this.publicClient.getChainId();
    if (chainId !== ROBINHOOD_CHAIN_ID) {
      throw new Error(`PONS_E2_CHAIN_ID_MISMATCH:${chainId}`);
    }

    if (
      intent.kind === 'TOKEN_APPROVE_PERMIT2_EXACT' ||
      intent.kind === 'PERMIT2_ALLOW_ROUTER_EXACT' ||
      intent.kind === 'V4_EXIT_ALL'
    ) {
      const fresh = await verifyPonsE1V4Recovery({
        token: intent.token,
        owner: this.walletAddress,
        slippageBps:
          intent.kind === 'V4_EXIT_ALL' ? intent.slippageBps : 500,
        client: this.publicClient
      });
      const requiredAmount =
        intent.kind === 'TOKEN_APPROVE_PERMIT2_EXACT'
          ? intent.amount
          : intent.kind === 'PERMIT2_ALLOW_ROUTER_EXACT'
            ? intent.amount
            : intent.tokenAmount;
      if (fresh.tokenBalance !== requiredAmount) {
        throw new Error(
          `PONS_E2_FULL_BALANCE_DRIFT:${fresh.tokenBalance}:${requiredAmount}`
        );
      }

      if (intent.kind === 'TOKEN_APPROVE_PERMIT2_EXACT') {
        if (fresh.currentTokenAllowanceToPermit2 !== 0n) {
          throw new Error(
            `PONS_E2_TOKEN_APPROVAL_REQUIRES_ZERO_ALLOWANCE:${fresh.currentTokenAllowanceToPermit2}`
          );
        }
      } else if (intent.kind === 'PERMIT2_ALLOW_ROUTER_EXACT') {
        if (fresh.currentTokenAllowanceToPermit2 !== intent.amount) {
          throw new Error(
            `PONS_E2_TOKEN_ALLOWANCE_NOT_EXACT:${fresh.currentTokenAllowanceToPermit2}:${intent.amount}`
          );
        }
        if (fresh.currentPermit2AllowanceToRouter !== 0n) {
          throw new Error(
            `PONS_E2_PERMIT2_APPROVAL_REQUIRES_ZERO_ALLOWANCE:${fresh.currentPermit2AllowanceToRouter}`
          );
        }
        if (intent.expiration < fresh.plan.deadline) {
          throw new Error('PONS_E2_PERMIT2_EXPIRATION_TOO_CLOSE');
        }
      } else {
        if (fresh.poolId.toLowerCase() !== intent.poolId.toLowerCase()) {
          throw new Error('PONS_E2_EXIT_POOL_ID_DRIFT');
        }
        if (
          getAddress(fresh.poolKey.currency0) !== getAddress(intent.poolKey.currency0) ||
          getAddress(fresh.poolKey.currency1) !== getAddress(intent.poolKey.currency1) ||
          fresh.poolKey.fee !== intent.poolKey.fee ||
          fresh.poolKey.tickSpacing !== intent.poolKey.tickSpacing ||
          getAddress(fresh.poolKey.hooks) !== getAddress(intent.poolKey.hooks)
        ) {
          throw new Error('PONS_E2_EXIT_POOL_KEY_DRIFT');
        }
        if (fresh.quotedNativeOut < intent.minNativeOut) {
          throw new Error(
            `PONS_E2_EXIT_FRESH_QUOTE_BELOW_FROZEN_MIN:${fresh.quotedNativeOut}:${intent.minNativeOut}`
          );
        }
        if (fresh.currentTokenAllowanceToPermit2 !== intent.tokenAmount) {
          throw new Error(
            `PONS_E2_EXIT_TOKEN_ALLOWANCE_NOT_EXACT:${fresh.currentTokenAllowanceToPermit2}:${intent.tokenAmount}`
          );
        }
        if (fresh.currentPermit2AllowanceToRouter !== intent.tokenAmount) {
          throw new Error(
            `PONS_E2_EXIT_PERMIT2_ALLOWANCE_NOT_EXACT:${fresh.currentPermit2AllowanceToRouter}:${intent.tokenAmount}`
          );
        }
        if (fresh.currentPermit2Expiration < intent.deadline) {
          throw new Error('PONS_E2_EXIT_PERMIT2_EXPIRES_BEFORE_DEADLINE');
        }
        const block = await this.publicClient.getBlock({
          blockNumber: fresh.blockNumber
        });
        if (block.timestamp > intent.deadline) {
          throw new Error('PONS_E2_EXIT_DEADLINE_EXPIRED');
        }
      }
      return fresh.blockNumber;
    }

    const head = await this.publicClient.getBlockNumber();
    const tokenBalance = await this.getTokenBalance(intent.token);
    if (tokenBalance !== 0n) {
      throw new Error(
        `PONS_E2_CLEANUP_REQUIRES_ZERO_TOKEN_BALANCE:${tokenBalance}`
      );
    }

    if (intent.kind === 'PERMIT2_REVOKE_ROUTER') {
      const permit2Code = await this.publicClient.getBytecode({
        address: CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2 as Address,
        blockNumber: head
      });
      if (
        !permit2Code ||
        permit2Code === '0x' ||
        keccak256(permit2Code).toLowerCase() !==
          CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2RuntimeCodeHash.toLowerCase()
      ) {
        throw new Error('PONS_E2_CLEANUP_PERMIT2_RUNTIME_DRIFT');
      }
      const current = await this.getPermit2AllowanceToRouter(intent.token);
      if (current.amount === 0n && current.expiration === 0n) {
        throw new Error('PONS_E2_PERMIT2_REVOKE_NOT_REQUIRED');
      }
    } else {
      const tokenCode = await this.publicClient.getBytecode({
        address: intent.token,
        blockNumber: head
      });
      if (!tokenCode || tokenCode === '0x') {
        throw new Error('PONS_E2_CLEANUP_TOKEN_CODE_MISSING');
      }
      const allowance = await this.getTokenAllowanceToPermit2(intent.token);
      if (allowance === 0n) {
        throw new Error('PONS_E2_TOKEN_REVOKE_NOT_REQUIRED');
      }
    }
    return head;
  }
}

export async function assertSignedPonsE2Transaction(
  intent: PonsE2RecoveryIntent,
  signed: SignedPonsE2Transaction,
  expectedSigner: Address,
  caps: PonsE2ExecutorCaps
): Promise<void> {
  assertPonsE2RecoveryIntentCalldata(intent);
  const actualHash = keccak256(signed.serializedTransaction);
  if (actualHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
    throw new Error('PONS_E2_SIGNED_HASH_MISMATCH');
  }
  const parsed = parseTransaction(signed.serializedTransaction);
  const recovered = await recoverTransactionAddress({
    serializedTransaction: signed.serializedTransaction as `0x02${string}`
  });
  if (getAddress(recovered) !== getAddress(expectedSigner)) {
    throw new Error('PONS_E2_SIGNED_SIGNER_MISMATCH');
  }
  if (parsed.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`PONS_E2_SIGNED_CHAIN_ID_MISMATCH:${parsed.chainId}`);
  }
  if (!parsed.to || getAddress(parsed.to) !== getAddress(intent.target)) {
    throw new Error('PONS_E2_SIGNED_TARGET_MISMATCH');
  }
  if ((parsed.value ?? 0n) !== 0n) {
    throw new Error('PONS_E2_SIGNED_NATIVE_VALUE_FORBIDDEN');
  }
  if ((parsed.data ?? '0x').toLowerCase() !== intent.calldata.toLowerCase()) {
    throw new Error('PONS_E2_SIGNED_CALLDATA_MISMATCH');
  }
  if (parsed.gas !== signed.gas) {
    throw new Error('PONS_E2_SIGNED_GAS_MISMATCH');
  }
  if (parsed.maxFeePerGas !== signed.maxFeePerGas) {
    throw new Error('PONS_E2_SIGNED_MAX_FEE_MISMATCH');
  }
  if ((parsed.maxPriorityFeePerGas ?? 0n) !== signed.maxPriorityFeePerGas) {
    throw new Error('PONS_E2_SIGNED_PRIORITY_FEE_MISMATCH');
  }
  assertFeeAndGasCaps(
    signed.gas,
    signed.maxFeePerGas,
    signed.maxPriorityFeePerGas,
    caps
  );
}

function validateCaps(caps: PonsE2ExecutorCaps): void {
  if (caps.maxGas <= 0n || caps.maxGas > 2_000_000n) {
    throw new Error('PONS_E2_MAX_GAS_INVALID');
  }
  if (caps.maxFeePerGas <= 0n || caps.maxFeePerGas > 100_000_000_000n) {
    throw new Error('PONS_E2_MAX_FEE_PER_GAS_INVALID');
  }
  if (
    caps.maxPriorityFeePerGas < 0n ||
    caps.maxPriorityFeePerGas > caps.maxFeePerGas
  ) {
    throw new Error('PONS_E2_MAX_PRIORITY_FEE_PER_GAS_INVALID');
  }
}

function assertFeeAndGasCaps(
  gas: bigint,
  maxFeePerGas: bigint,
  maxPriorityFeePerGas: bigint,
  caps: PonsE2ExecutorCaps
): void {
  if (gas <= 0n || gas > caps.maxGas) {
    throw new Error(`PONS_E2_GAS_CAP_EXCEEDED:${gas}:${caps.maxGas}`);
  }
  if (maxFeePerGas <= 0n || maxFeePerGas > caps.maxFeePerGas) {
    throw new Error(
      `PONS_E2_MAX_FEE_CAP_EXCEEDED:${maxFeePerGas}:${caps.maxFeePerGas}`
    );
  }
  if (
    maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas > caps.maxPriorityFeePerGas ||
    maxPriorityFeePerGas > maxFeePerGas
  ) {
    throw new Error(
      `PONS_E2_PRIORITY_FEE_CAP_EXCEEDED:${maxPriorityFeePerGas}:${caps.maxPriorityFeePerGas}`
    );
  }
}
