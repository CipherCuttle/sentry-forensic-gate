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
  CURRENT_PONS_V2_AUTHORITY
} from '../adapters/robinhood/ponsV2/authority.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL
} from '../adapters/robinhood/ponsV2/contracts.js';
import {
  assertPonsE0IntentCalldata,
  type PonsE0Intent
} from './ponsE0Intent.js';
import { ponsE0CurveTradeAbi, ponsE0TokenAbi } from './ponsE0Contracts.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});

export interface PonsE0ExecutorCaps {
  maxNativeValueWei: bigint;
  maxGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface PonsE0Preflight {
  kind: PonsE0Intent['kind'];
  checkedAtBlock: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface SignedPonsE0Transaction {
  kind: PonsE0Intent['kind'];
  nonce: number;
  transactionHash: Hex;
  serializedTransaction: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface ViemPonsE0CanaryExecutorOptions {
  privateKey: Hex;
  rpcUrl?: string;
  caps: PonsE0ExecutorCaps;
  publicClient?: PublicClient;
}

export class ViemPonsE0CanaryExecutor {
  readonly walletAddress: Address;
  private readonly account: LocalAccount;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly caps: PonsE0ExecutorCaps;
  private readonly signedIntents = new Map<string, Readonly<PonsE0Intent>>();
  private authorizedBuyValueWei: bigint | null = null;
  private buyAuthorizationConsumed = false;

  constructor(options: ViemPonsE0CanaryExecutorOptions) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) {
      throw new Error('PONS_E0_PRIVATE_KEY_FORMAT_INVALID');
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
  }

  authorizeExactBuyValue(value: bigint): void {
    if (this.authorizedBuyValueWei !== null || this.buyAuthorizationConsumed) {
      throw new Error('PONS_E0_BUY_VALUE_ALREADY_AUTHORIZED');
    }
    if (value <= 0n || value > this.caps.maxNativeValueWei) {
      throw new Error(`PONS_E0_EXACT_BUY_VALUE_CAP_EXCEEDED:${value}:${this.caps.maxNativeValueWei}`);
    }
    this.authorizedBuyValueWei = value;
  }

  async getBlockNumber(): Promise<bigint> {
    const chainId = await this.publicClient.getChainId();
    if (chainId !== ROBINHOOD_CHAIN_ID) {
      throw new Error(`PONS_E0_CHAIN_ID_MISMATCH:${chainId}`);
    }
    return this.publicClient.getBlockNumber();
  }

  async getTokenBalance(token: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: token,
      abi: ponsE0TokenAbi,
      functionName: 'balanceOf',
      args: [this.walletAddress]
    });
  }

  async getTokenAllowance(token: Address, curve: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: token,
      abi: ponsE0TokenAbi,
      functionName: 'allowance',
      args: [this.walletAddress, curve]
    });
  }

  async getNativeBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.walletAddress });
  }

  async getWalletSnipeTaxBps(curve: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: curve,
      abi: ponsE0CurveTradeAbi,
      functionName: 'currentSnipeTaxBps',
      args: [this.walletAddress]
    });
  }

  async preflight(intent: PonsE0Intent): Promise<PonsE0Preflight> {
    assertPonsE0IntentCalldata(intent);
    const checkedAtBlock = await this.getBlockNumber();
    await this.assertIntentAuthority(intent, checkedAtBlock);

    if (intent.kind === 'BUY') {
      this.assertExactBuyValueAuthorized(intent.value);
      if (intent.value > this.caps.maxNativeValueWei) {
        throw new Error(`PONS_E0_NATIVE_VALUE_CAP_EXCEEDED:${intent.value}`);
      }
      const nativeBalance = await this.getNativeBalance();
      if (nativeBalance <= intent.value) {
        throw new Error(`PONS_E0_NATIVE_BALANCE_INSUFFICIENT:${nativeBalance}:${intent.value}`);
      }
    } else {
      const balance = await this.getTokenBalance(intent.token);
      const required = intent.kind === 'APPROVE_SELL_EXACT' ? intent.amount : intent.tokensIn;
      if (balance < required) {
        throw new Error(`PONS_E0_TOKEN_BALANCE_INSUFFICIENT:${balance}:${required}`);
      }
      if (intent.kind === 'APPROVE_SELL_EXACT') {
        const allowance = await this.getTokenAllowance(intent.token, intent.curve);
        if (allowance !== 0n) {
          throw new Error(`PONS_E0_APPROVAL_REQUIRES_ZERO_ALLOWANCE:${allowance}`);
        }
      } else {
        const allowance = await this.getTokenAllowance(intent.token, intent.curve);
        if (allowance !== intent.tokensIn) {
          throw new Error(`PONS_E0_SELL_ALLOWANCE_NOT_EXACT:${allowance}:${intent.tokensIn}`);
        }
      }
    }

    const target = intent.kind === 'APPROVE_SELL_EXACT' ? intent.token : intent.curve;
    const simulated = await this.publicClient.call({
      account: this.walletAddress,
      to: target,
      data: intent.calldata,
      value: intent.value
    });
    if (intent.kind === 'APPROVE_SELL_EXACT') {
      if (!simulated.data || simulated.data === '0x') {
        throw new Error('PONS_E0_APPROVAL_SIMULATION_RESULT_MISSING');
      }
      const approved = decodeFunctionResult({
        abi: ponsE0TokenAbi,
        functionName: 'approve',
        data: simulated.data
      });
      if (approved !== true) throw new Error('PONS_E0_APPROVAL_SIMULATION_FALSE');
    }

    const [gas, fees] = await Promise.all([
      this.publicClient.estimateGas({
        account: this.walletAddress,
        to: target,
        data: intent.calldata,
        value: intent.value
      }),
      this.publicClient.estimateFeesPerGas({ chain: undefined, type: 'eip1559' })
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
    intent: PonsE0Intent,
    preflight: PonsE0Preflight
  ): Promise<SignedPonsE0Transaction> {
    if (preflight.kind !== intent.kind) throw new Error('PONS_E0_PREFLIGHT_KIND_MISMATCH');
    assertFeeAndGasCaps(
      preflight.gas,
      preflight.maxFeePerGas,
      preflight.maxPriorityFeePerGas,
      this.caps
    );
    const head = await this.getBlockNumber();
    if (head < preflight.checkedAtBlock || head - preflight.checkedAtBlock > 2n) {
      throw new Error(`PONS_E0_PREFLIGHT_STALE:${preflight.checkedAtBlock}:${head}`);
    }
    await this.assertIntentAuthority(intent, head);

    if (intent.kind === 'BUY') this.assertExactBuyValueAuthorized(intent.value);
    const target = intent.kind === 'APPROVE_SELL_EXACT' ? intent.token : intent.curve;
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
      to: target,
      value: intent.value,
      data: intent.calldata
    });
    const transactionHash = keccak256(serializedTransaction);
    const signed: SignedPonsE0Transaction = {
      kind: intent.kind,
      nonce,
      transactionHash,
      serializedTransaction,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas
    };
    await assertSignedPonsE0Transaction(intent, signed, this.walletAddress, this.caps);
    if (intent.kind === 'BUY') {
      this.assertExactBuyValueAuthorized(intent.value);
      this.buyAuthorizationConsumed = true;
      this.authorizedBuyValueWei = null;
    }
    this.signedIntents.set(transactionHash.toLowerCase(), Object.freeze({ ...intent }));
    return signed;
  }

  async broadcastExact(signed: SignedPonsE0Transaction): Promise<Hex> {
    const key = signed.transactionHash.toLowerCase();
    const intent = this.signedIntents.get(key);
    if (!intent) throw new Error('PONS_E0_BROADCAST_SIGNED_AUTHORITY_UNKNOWN');
    await assertSignedPonsE0Transaction(intent, signed, this.walletAddress, this.caps);
    this.signedIntents.delete(key);

    const returnedHash = await this.walletClient.sendRawTransaction({
      serializedTransaction: signed.serializedTransaction
    });
    if (returnedHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
      throw new Error(`PONS_E0_BROADCAST_HASH_MISMATCH:${returnedHash}:${signed.transactionHash}`);
    }
    return returnedHash;
  }

  async getReceiptIfPresent(transactionHash: Hex) {
    try {
      return await this.publicClient.getTransactionReceipt({ hash: transactionHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|could not be found|TransactionReceiptNotFound/i.test(message)) return null;
      throw error;
    }
  }

  private assertExactBuyValueAuthorized(value: bigint): void {
    if (
      this.buyAuthorizationConsumed ||
      this.authorizedBuyValueWei === null ||
      value !== this.authorizedBuyValueWei
    ) {
      throw new Error(
        `PONS_E0_EXACT_BUY_VALUE_NOT_AUTHORIZED:${value}:${this.authorizedBuyValueWei ?? 'NONE'}`
      );
    }
  }

  private async assertIntentAuthority(intent: PonsE0Intent, blockNumber: bigint): Promise<void> {
    const [chainId, curveCode, factory, token, pairToken, graduated, ready] = await Promise.all([
      this.publicClient.getChainId(),
      this.publicClient.getBytecode({ address: intent.curve, blockNumber }),
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
        address: intent.curve,
        abi: ponsE0CurveTradeAbi,
        functionName: 'readyToGraduate',
        blockNumber
      })
    ]);
    if (chainId !== ROBINHOOD_CHAIN_ID) throw new Error(`PONS_E0_CHAIN_ID_MISMATCH:${chainId}`);
    if (!curveCode || curveCode === '0x') throw new Error('PONS_E0_CURVE_CODE_MISSING');
    if (getAddress(factory as Address) !== getAddress(CURRENT_PONS_V2_AUTHORITY.factory)) {
      throw new Error('PONS_E0_CURVE_FACTORY_MISMATCH');
    }
    if (getAddress(token as Address) !== getAddress(intent.token)) {
      throw new Error('PONS_E0_CURVE_TOKEN_MISMATCH');
    }
    if (getAddress(pairToken as Address) !== getAddress(PONS_V2_NATIVE_PAIR_TOKEN)) {
      throw new Error('PONS_E0_NATIVE_PAIR_REQUIRED');
    }
    if (graduated || ready) throw new Error('PONS_E0_CURVE_NOT_ACTIVE');

    if (intent.kind === 'BUY') {
      if (getAddress(intent.recipient) !== getAddress(this.walletAddress)) {
        throw new Error('PONS_E0_BUY_RECIPIENT_MUST_EQUAL_WALLET');
      }
      const tax = await this.getWalletSnipeTaxBps(intent.curve);
      if (tax !== 0n) throw new Error(`PONS_E0_SNIPE_TAX_MUST_BE_ZERO:${tax}`);
    } else if (intent.kind === 'APPROVE_SELL_EXACT') {
      if (getAddress(intent.owner) !== getAddress(this.walletAddress)) {
        throw new Error('PONS_E0_APPROVAL_OWNER_MUST_EQUAL_WALLET');
      }
    } else if (getAddress(intent.recipient) !== getAddress(this.walletAddress)) {
      throw new Error('PONS_E0_SELL_RECIPIENT_MUST_EQUAL_WALLET');
    }
  }
}

export async function assertSignedPonsE0Transaction(
  intent: PonsE0Intent,
  signed: SignedPonsE0Transaction,
  expectedSigner: Address,
  caps: PonsE0ExecutorCaps
): Promise<void> {
  assertPonsE0IntentCalldata(intent);
  const actualHash = keccak256(signed.serializedTransaction);
  if (actualHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
    throw new Error('PONS_E0_SIGNED_HASH_MISMATCH');
  }
  const parsed = parseTransaction(signed.serializedTransaction);
  const recovered = await recoverTransactionAddress({
    serializedTransaction: signed.serializedTransaction as `0x02${string}`
  });
  if (getAddress(recovered) !== getAddress(expectedSigner)) {
    throw new Error('PONS_E0_SIGNED_SIGNER_MISMATCH');
  }
  if (parsed.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`PONS_E0_SIGNED_CHAIN_ID_MISMATCH:${parsed.chainId}`);
  }
  const expectedTo = intent.kind === 'APPROVE_SELL_EXACT' ? intent.token : intent.curve;
  if (!parsed.to || getAddress(parsed.to) !== getAddress(expectedTo)) {
    throw new Error('PONS_E0_SIGNED_TARGET_MISMATCH');
  }
  if ((parsed.value ?? 0n) !== intent.value) throw new Error('PONS_E0_SIGNED_VALUE_MISMATCH');
  if ((parsed.data ?? '0x').toLowerCase() !== intent.calldata.toLowerCase()) {
    throw new Error('PONS_E0_SIGNED_CALLDATA_MISMATCH');
  }
  if (parsed.gas !== signed.gas) throw new Error('PONS_E0_SIGNED_GAS_MISMATCH');
  if (parsed.maxFeePerGas !== signed.maxFeePerGas) {
    throw new Error('PONS_E0_SIGNED_MAX_FEE_MISMATCH');
  }
  if (parsed.maxPriorityFeePerGas !== signed.maxPriorityFeePerGas) {
    throw new Error('PONS_E0_SIGNED_PRIORITY_FEE_MISMATCH');
  }
  assertFeeAndGasCaps(
    signed.gas,
    signed.maxFeePerGas,
    signed.maxPriorityFeePerGas,
    caps
  );
  if (intent.kind === 'BUY' && intent.value > caps.maxNativeValueWei) {
    throw new Error('PONS_E0_SIGNED_NATIVE_VALUE_CAP_EXCEEDED');
  }
}

function validateCaps(caps: PonsE0ExecutorCaps): void {
  if (caps.maxNativeValueWei <= 0n || caps.maxNativeValueWei > 10_000_000_000_000_000n) {
    throw new Error('PONS_E0_MAX_NATIVE_VALUE_CAP_INVALID');
  }
  if (caps.maxGas <= 0n || caps.maxGas > 1_000_000n) throw new Error('PONS_E0_MAX_GAS_INVALID');
  if (caps.maxFeePerGas <= 0n || caps.maxFeePerGas > 100_000_000_000n) {
    throw new Error('PONS_E0_MAX_FEE_PER_GAS_INVALID');
  }
  if (
    caps.maxPriorityFeePerGas < 0n ||
    caps.maxPriorityFeePerGas > caps.maxFeePerGas
  ) {
    throw new Error('PONS_E0_MAX_PRIORITY_FEE_PER_GAS_INVALID');
  }
}

function assertFeeAndGasCaps(
  gas: bigint,
  maxFeePerGas: bigint,
  maxPriorityFeePerGas: bigint,
  caps: PonsE0ExecutorCaps
): void {
  if (gas <= 0n || gas > caps.maxGas) {
    throw new Error(`PONS_E0_GAS_CAP_EXCEEDED:${gas}:${caps.maxGas}`);
  }
  if (maxFeePerGas <= 0n || maxFeePerGas > caps.maxFeePerGas) {
    throw new Error(`PONS_E0_MAX_FEE_CAP_EXCEEDED:${maxFeePerGas}:${caps.maxFeePerGas}`);
  }
  if (
    maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas > caps.maxPriorityFeePerGas ||
    maxPriorityFeePerGas > maxFeePerGas
  ) {
    throw new Error(
      `PONS_E0_PRIORITY_FEE_CAP_EXCEEDED:${maxPriorityFeePerGas}:${caps.maxPriorityFeePerGas}`
    );
  }
}
