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
import { CURRENT_PONS_V2_AUTHORITY } from '../adapters/robinhood/ponsV2/authority.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL
} from '../adapters/robinhood/ponsV2/contracts.js';
import { ponsE0CurveTradeAbi, ponsE0TokenAbi } from './ponsE0Contracts.js';
import {
  assertPonsE3BCurveRevokeIntent,
  type PonsE3BCurveRevokeIntent
} from './ponsE3BRuntimeFailover.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});

export interface PonsE3BCleanupExecutorCaps {
  maxGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface PonsE3BCleanupPreflight {
  checkedAtBlock: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface SignedPonsE3BCleanupTransaction {
  nonce: number;
  transactionHash: Hex;
  serializedTransaction: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface ViemPonsE3BCurveCleanupExecutorOptions {
  privateKey: Hex;
  rpcUrl?: string;
  caps: PonsE3BCleanupExecutorCaps;
  publicClient?: PublicClient;
  broadcastEnabled?: boolean;
}

export class ViemPonsE3BCurveCleanupExecutor {
  readonly walletAddress: Address;
  private readonly account: LocalAccount;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly caps: PonsE3BCleanupExecutorCaps;
  private readonly broadcastEnabled: boolean;
  private readonly signedIntents =
    new Map<string, Readonly<PonsE3BCurveRevokeIntent>>();

  constructor(options: ViemPonsE3BCurveCleanupExecutorOptions) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) {
      throw new Error('PONS_E3B_PRIVATE_KEY_FORMAT_INVALID');
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

  async getCurveAllowance(token: Address, curve: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: token,
      abi: ponsE0TokenAbi,
      functionName: 'allowance',
      args: [this.walletAddress, curve]
    });
  }

  async preflight(
    intent: PonsE3BCurveRevokeIntent
  ): Promise<PonsE3BCleanupPreflight> {
    const checkedAtBlock = await this.assertIntentAuthority(intent);

    const simulated = await this.publicClient.call({
      account: this.walletAddress,
      to: intent.target,
      data: intent.calldata,
      value: 0n,
      blockNumber: checkedAtBlock
    });
    if (!simulated.data || simulated.data === '0x') {
      throw new Error('PONS_E3B_CURVE_REVOKE_SIMULATION_RESULT_MISSING');
    }
    const approved = decodeFunctionResult({
      abi: ponsE0TokenAbi,
      functionName: 'approve',
      data: simulated.data
    });
    if (approved !== true) {
      throw new Error('PONS_E3B_CURVE_REVOKE_SIMULATION_FALSE');
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
      checkedAtBlock,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas
    };
  }

  async sign(
    intent: PonsE3BCurveRevokeIntent,
    preflight: PonsE3BCleanupPreflight
  ): Promise<SignedPonsE3BCleanupTransaction> {
    assertPonsE3BCurveRevokeIntent(intent);
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
        `PONS_E3B_PREFLIGHT_STALE:${preflight.checkedAtBlock}:${head}`
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
    const signed: SignedPonsE3BCleanupTransaction = {
      nonce,
      transactionHash,
      serializedTransaction,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas
    };
    await assertSignedPonsE3BCleanupTransaction(
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

  async broadcastExact(
    signed: SignedPonsE3BCleanupTransaction
  ): Promise<Hex> {
    if (!this.broadcastEnabled) {
      throw new Error('PONS_E3B_BROADCAST_AUTHORITY_DISABLED');
    }
    const key = signed.transactionHash.toLowerCase();
    const intent = this.signedIntents.get(key);
    if (!intent) {
      throw new Error('PONS_E3B_BROADCAST_SIGNED_AUTHORITY_UNKNOWN');
    }
    await assertSignedPonsE3BCleanupTransaction(
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
        `PONS_E3B_BROADCAST_HASH_MISMATCH:${returnedHash}:${signed.transactionHash}`
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
    intent: PonsE3BCurveRevokeIntent
  ): Promise<bigint> {
    assertPonsE3BCurveRevokeIntent(intent);
    if (getAddress(intent.owner) !== getAddress(this.walletAddress)) {
      throw new Error('PONS_E3B_INTENT_OWNER_MUST_EQUAL_WALLET');
    }

    const blockNumber = await this.publicClient.getBlockNumber();
    const [
      chainId,
      factoryCode,
      tokenCode,
      curveFactory,
      curveToken,
      curvePairToken,
      graduated,
      allowance
    ] = await Promise.all([
      this.publicClient.getChainId(),
      this.publicClient.getBytecode({
        address: CURRENT_PONS_V2_AUTHORITY.factory as Address,
        blockNumber
      }),
      this.publicClient.getBytecode({
        address: intent.token,
        blockNumber
      }),
      this.publicClient.readContract({
        address: intent.curve,
        abi: ponsE0CurveTradeAbi,
        functionName: 'factory',
        blockNumber
      }),
      this.publicClient.readContract({
        address: intent.curve,
        abi: ponsE0CurveTradeAbi,
        functionName: 'token',
        blockNumber
      }),
      this.publicClient.readContract({
        address: intent.curve,
        abi: ponsE0CurveTradeAbi,
        functionName: 'pairToken',
        blockNumber
      }),
      this.publicClient.readContract({
        address: intent.curve,
        abi: ponsE0CurveTradeAbi,
        functionName: 'graduated',
        blockNumber
      }),
      this.publicClient.readContract({
        address: intent.token,
        abi: ponsE0TokenAbi,
        functionName: 'allowance',
        args: [this.walletAddress, intent.curve],
        blockNumber
      })
    ]);

    if (chainId !== ROBINHOOD_CHAIN_ID) {
      throw new Error(`PONS_E3B_CHAIN_ID_MISMATCH:${chainId}`);
    }
    if (
      !factoryCode ||
      factoryCode === '0x' ||
      keccak256(factoryCode).toLowerCase() !==
        CURRENT_PONS_V2_AUTHORITY.factoryRuntimeCodeHash.toLowerCase()
    ) {
      throw new Error('PONS_E3B_FACTORY_RUNTIME_DRIFT');
    }
    if (!tokenCode || tokenCode === '0x') {
      throw new Error('PONS_E3B_TOKEN_CODE_MISSING');
    }
    if (
      getAddress(curveFactory) !== getAddress(CURRENT_PONS_V2_AUTHORITY.factory)
    ) {
      throw new Error('PONS_E3B_CURVE_FACTORY_MISMATCH');
    }
    if (getAddress(curveToken) !== getAddress(intent.token)) {
      throw new Error('PONS_E3B_CURVE_TOKEN_MISMATCH');
    }
    if (getAddress(curvePairToken) !== getAddress(PONS_V2_NATIVE_PAIR_TOKEN)) {
      throw new Error('PONS_E3B_CURVE_PAIR_TOKEN_MISMATCH');
    }
    if (!graduated) {
      throw new Error('PONS_E3B_CURVE_REVOKE_REQUIRES_GRADUATED_CURVE');
    }
    if (allowance === 0n) {
      throw new Error('PONS_E3B_CURVE_REVOKE_NOT_REQUIRED');
    }
    return blockNumber;
  }
}

export async function assertSignedPonsE3BCleanupTransaction(
  intent: PonsE3BCurveRevokeIntent,
  signed: SignedPonsE3BCleanupTransaction,
  expectedSigner: Address,
  caps: PonsE3BCleanupExecutorCaps
): Promise<void> {
  assertPonsE3BCurveRevokeIntent(intent);
  const actualHash = keccak256(signed.serializedTransaction);
  if (actualHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
    throw new Error('PONS_E3B_SIGNED_HASH_MISMATCH');
  }
  const parsed = parseTransaction(signed.serializedTransaction);
  const recovered = await recoverTransactionAddress({
    serializedTransaction: signed.serializedTransaction as `0x02${string}`
  });
  if (getAddress(recovered) !== getAddress(expectedSigner)) {
    throw new Error('PONS_E3B_SIGNED_SIGNER_MISMATCH');
  }
  if (parsed.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`PONS_E3B_SIGNED_CHAIN_ID_MISMATCH:${parsed.chainId}`);
  }
  if (!parsed.to || getAddress(parsed.to) !== getAddress(intent.target)) {
    throw new Error('PONS_E3B_SIGNED_TARGET_MISMATCH');
  }
  if ((parsed.value ?? 0n) !== 0n) {
    throw new Error('PONS_E3B_SIGNED_NATIVE_VALUE_FORBIDDEN');
  }
  if ((parsed.data ?? '0x').toLowerCase() !== intent.calldata.toLowerCase()) {
    throw new Error('PONS_E3B_SIGNED_CALLDATA_MISMATCH');
  }
  if (parsed.gas !== signed.gas) {
    throw new Error('PONS_E3B_SIGNED_GAS_MISMATCH');
  }
  if (parsed.maxFeePerGas !== signed.maxFeePerGas) {
    throw new Error('PONS_E3B_SIGNED_MAX_FEE_MISMATCH');
  }
  if ((parsed.maxPriorityFeePerGas ?? 0n) !== signed.maxPriorityFeePerGas) {
    throw new Error('PONS_E3B_SIGNED_PRIORITY_FEE_MISMATCH');
  }
  assertFeeAndGasCaps(
    signed.gas,
    signed.maxFeePerGas,
    signed.maxPriorityFeePerGas,
    caps
  );
}

function validateCaps(caps: PonsE3BCleanupExecutorCaps): void {
  if (caps.maxGas <= 0n || caps.maxGas > 500_000n) {
    throw new Error('PONS_E3B_MAX_GAS_INVALID');
  }
  if (caps.maxFeePerGas <= 0n || caps.maxFeePerGas > 100_000_000_000n) {
    throw new Error('PONS_E3B_MAX_FEE_PER_GAS_INVALID');
  }
  if (
    caps.maxPriorityFeePerGas < 0n ||
    caps.maxPriorityFeePerGas > caps.maxFeePerGas
  ) {
    throw new Error('PONS_E3B_MAX_PRIORITY_FEE_PER_GAS_INVALID');
  }
}

function assertFeeAndGasCaps(
  gas: bigint,
  maxFeePerGas: bigint,
  maxPriorityFeePerGas: bigint,
  caps: PonsE3BCleanupExecutorCaps
): void {
  if (gas <= 0n || gas > caps.maxGas) {
    throw new Error(`PONS_E3B_GAS_CAP_EXCEEDED:${gas}:${caps.maxGas}`);
  }
  if (maxFeePerGas <= 0n || maxFeePerGas > caps.maxFeePerGas) {
    throw new Error(
      `PONS_E3B_MAX_FEE_CAP_EXCEEDED:${maxFeePerGas}:${caps.maxFeePerGas}`
    );
  }
  if (
    maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas > caps.maxPriorityFeePerGas ||
    maxPriorityFeePerGas > maxFeePerGas
  ) {
    throw new Error(
      `PONS_E3B_PRIORITY_FEE_CAP_EXCEEDED:${maxPriorityFeePerGas}:${caps.maxPriorityFeePerGas}`
    );
  }
}
