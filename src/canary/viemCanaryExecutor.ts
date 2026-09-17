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
import { INK_CHAIN_ID, DEFAULT_INK_RPC_URL } from '../sentry/contracts.js';
import { TSUNAMI_V3_FACTORY, WETH9 } from '../tsunami/contracts.js';
import {
  assertCanaryApprovalCalldata,
  CANARY_E0_APPROVAL_R0,
  classifyCanaryApprovalAllowance,
  erc20ApprovalAbi,
  type CanaryApprovalIntent
} from './approval.js';
import {
  assertCanaryEntryApprovalCalldata,
  assertCanaryEntryApprovalMatchesParentBuy,
  CANARY_E0_ENTRY_APPROVAL_R0,
  type CanaryEntryApprovalIntent
} from './entryApproval.js';
import { CanaryEntryApprovalStore } from './entryApprovalStore.js';
import {
  assertCanaryEntryApprovalRevokeCalldata,
  CANARY_E0_ENTRY_APPROVAL_REVOKE_R0,
  type CanaryEntryApprovalRevokeIntent
} from './entryApprovalRevoke.js';
import {
  CANARY_MAX_DEADLINE_SECONDS,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02,
  swapRouter02Abi,
  type CanarySwapIntent
} from './swapIntent.js';

const erc20CanaryAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }
] as const;

type CanaryExactApprovalIntent = CanaryApprovalIntent | CanaryEntryApprovalIntent;

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_INK_RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } }
});

export interface CanaryExecutorCaps {
  maxQuoteAgeBlocks: bigint;
  maxGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface CanaryPreflight {
  wallet: Address;
  checkedAtBlock: bigint;
  inputBalance: bigint;
  inputAllowance: bigint;
  outputBalanceBefore: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface CanaryApprovalPreflight {
  actionId: string;
  wallet: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  checkedAtBlock: bigint;
  tokenBalance: bigint;
  allowanceBefore: 0n;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface CanaryApprovalRevokePreflight {
  actionId: string;
  wallet: Address;
  token: Address;
  spender: Address;
  expectedAllowance: bigint;
  amount: 0n;
  checkedAtBlock: bigint;
  allowanceBefore: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface CanaryChainClock {
  blockNumber: bigint;
  blockHash: Hex;
  timestampSeconds: number;
}

export interface SignedCanaryTransaction {
  actionId: string;
  nonce: number;
  transactionHash: Hex;
  serializedTransaction: Hex;
  serializedTransactionKeccak256: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface ViemCanaryExecutorOptions {
  privateKey: Hex;
  rpcUrl?: string;
  caps: CanaryExecutorCaps;
  publicClient?: PublicClient;
}

export class ViemCanaryExecutor {
  readonly walletAddress: Address;
  private readonly account: LocalAccount;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly caps: CanaryExecutorCaps;
  private readonly signedApprovalIntents = new Map<string, Readonly<CanaryExactApprovalIntent>>();
  private readonly signedSwapHashes = new Set<string>();

  constructor(options: ViemCanaryExecutorOptions) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) throw new Error('CANARY_PRIVATE_KEY_FORMAT_INVALID');
    this.account = privateKeyToAccount(options.privateKey);
    this.walletAddress = this.account.address;
    const transport = http(options.rpcUrl ?? DEFAULT_INK_RPC_URL);
    this.publicClient = options.publicClient ?? createPublicClient({ chain: ink, transport });
    this.walletClient = createWalletClient({ account: this.account, chain: ink, transport });
    this.caps = options.caps;
    validateCaps(this.caps);
  }

  async getChainClock(): Promise<CanaryChainClock> {
    const [chainId, block] = await Promise.all([
      this.publicClient.getChainId(),
      this.publicClient.getBlock()
    ]);
    if (chainId !== INK_CHAIN_ID) throw new Error(`CANARY_CHAIN_ID_MISMATCH:${chainId}`);
    if (block.number === null || !block.hash) throw new Error('CANARY_CHAIN_CLOCK_BLOCK_IDENTITY_MISSING');
    const timestampSeconds = blockTimestampToNumber(block.timestamp);
    return { blockNumber: block.number, blockHash: block.hash, timestampSeconds };
  }

  async preflight(intent: CanarySwapIntent): Promise<CanaryPreflight> {
    if (getAddress(intent.router) !== INK_SWAP_ROUTER_02) throw new Error(`CANARY_ROUTER_MISMATCH:${intent.router}`);
    if (getAddress(intent.recipient) !== getAddress(this.account.address)) throw new Error('CANARY_RECIPIENT_MUST_EQUAL_WALLET');
    const chainClock = await this.getChainClock();
    assertQuoteFresh(intent.quoteBlockNumber, chainClock.blockNumber, this.caps.maxQuoteAgeBlocks);
    assertCanaryDeadlineAgainstChainClock(intent.deadlineEpochSeconds, chainClock.timestampSeconds);
    await this.assertQuoteBlockCanonical(intent);

    const [routerCode, routerFactory, routerWeth] = await Promise.all([
      this.publicClient.getBytecode({ address: INK_SWAP_ROUTER_02 }),
      this.publicClient.readContract({ address: INK_SWAP_ROUTER_02, abi: swapRouter02Abi, functionName: 'factory' }),
      this.publicClient.readContract({ address: INK_SWAP_ROUTER_02, abi: swapRouter02Abi, functionName: 'WETH9' })
    ]);
    if (!routerCode || routerCode === '0x') throw new Error('CANARY_ROUTER_CODE_MISSING');
    if (getAddress(routerFactory as Address) !== getAddress(TSUNAMI_V3_FACTORY)) throw new Error('CANARY_ROUTER_FACTORY_DRIFT');
    if (getAddress(routerWeth as Address) !== getAddress(WETH9)) throw new Error('CANARY_ROUTER_WETH_DRIFT');

    const [inputBalance, inputAllowance, outputBalanceBefore] = await Promise.all([
      this.publicClient.readContract({ address: intent.tokenIn, abi: erc20CanaryAbi, functionName: 'balanceOf', args: [this.account.address] }),
      this.publicClient.readContract({ address: intent.tokenIn, abi: erc20CanaryAbi, functionName: 'allowance', args: [this.account.address, INK_SWAP_ROUTER_02] }),
      this.publicClient.readContract({ address: intent.tokenOut, abi: erc20CanaryAbi, functionName: 'balanceOf', args: [this.account.address] })
    ]);
    if (inputBalance < intent.amountIn) throw new Error(`CANARY_INPUT_BALANCE_INSUFFICIENT:${inputBalance}:${intent.amountIn}`);
    if (inputAllowance < intent.amountIn) throw new Error(`CANARY_INPUT_ALLOWANCE_INSUFFICIENT:${inputAllowance}:${intent.amountIn}`);

    await this.publicClient.call({ account: this.account.address, to: INK_SWAP_ROUTER_02, data: intent.calldata, value: 0n });
    const [gas, fees] = await Promise.all([
      this.publicClient.estimateGas({ account: this.account.address, to: INK_SWAP_ROUTER_02, data: intent.calldata, value: 0n }),
      this.publicClient.estimateFeesPerGas({ chain: undefined, type: 'eip1559' })
    ]);
    assertFeeAndGasCaps(gas, fees.maxFeePerGas, fees.maxPriorityFeePerGas, this.caps);

    return {
      wallet: this.account.address,
      checkedAtBlock: chainClock.blockNumber,
      inputBalance,
      inputAllowance,
      outputBalanceBefore,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas
    };
  }

  async preflightApproval(intent: CanaryExactApprovalIntent): Promise<CanaryApprovalPreflight> {
    this.assertApprovalAuthority(intent);
    const chainClock = await this.getChainClock();
    const [tokenCode, tokenBalance, allowanceBefore] = await Promise.all([
      this.publicClient.getBytecode({ address: intent.token }),
      this.publicClient.readContract({ address: intent.token, abi: erc20CanaryAbi, functionName: 'balanceOf', args: [this.account.address] }),
      this.publicClient.readContract({ address: intent.token, abi: erc20CanaryAbi, functionName: 'allowance', args: [this.account.address, intent.spender] })
    ]);
    if (!tokenCode || tokenCode === '0x') throw new Error(`CANARY_APPROVAL_TOKEN_CODE_MISSING:${intent.token}`);
    if (tokenBalance < intent.amount) throw new Error(`CANARY_APPROVAL_TOKEN_BALANCE_INSUFFICIENT:${tokenBalance}:${intent.amount}`);
    if (classifyCanaryApprovalAllowance(allowanceBefore, intent.amount) !== 'APPROVE_EXACT') {
      throw new Error(`CANARY_APPROVAL_DIRTY_ALLOWANCE:${allowanceBefore}`);
    }
    await this.assertApprovalSimulation(intent);
    const [gas, fees] = await Promise.all([
      this.publicClient.estimateGas({ account: this.account.address, to: intent.token, data: intent.calldata, value: 0n }),
      this.publicClient.estimateFeesPerGas({ chain: undefined, type: 'eip1559' })
    ]);
    assertFeeAndGasCaps(gas, fees.maxFeePerGas, fees.maxPriorityFeePerGas, this.caps);
    return {
      actionId: intent.actionId,
      wallet: this.account.address,
      token: intent.token,
      spender: intent.spender,
      amount: intent.amount,
      checkedAtBlock: chainClock.blockNumber,
      tokenBalance,
      allowanceBefore: 0n,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas
    };
  }

  async preflightEntryApprovalRevoke(intent: CanaryEntryApprovalRevokeIntent): Promise<CanaryApprovalRevokePreflight> {
    this.assertEntryApprovalRevokeAuthority(intent);
    const chainClock = await this.getChainClock();
    const [tokenCode, allowanceBefore] = await Promise.all([
      this.publicClient.getBytecode({ address: intent.token }),
      this.publicClient.readContract({ address: intent.token, abi: erc20CanaryAbi, functionName: 'allowance', args: [this.account.address, intent.spender] })
    ]);
    if (!tokenCode || tokenCode === '0x') throw new Error(`CANARY_ENTRY_APPROVAL_REVOKE_TOKEN_CODE_MISSING:${intent.token}`);
    if (allowanceBefore !== intent.expectedAllowance) {
      throw new Error(`CANARY_ENTRY_APPROVAL_REVOKE_ALLOWANCE_NOT_EXACT:${allowanceBefore}:${intent.expectedAllowance}`);
    }
    await this.assertEntryApprovalRevokeSimulation(intent);
    const [gas, fees] = await Promise.all([
      this.publicClient.estimateGas({ account: this.account.address, to: intent.token, data: intent.calldata, value: 0n }),
      this.publicClient.estimateFeesPerGas({ chain: undefined, type: 'eip1559' })
    ]);
    assertFeeAndGasCaps(gas, fees.maxFeePerGas, fees.maxPriorityFeePerGas, this.caps);
    return {
      actionId: intent.actionId,
      wallet: this.account.address,
      token: intent.token,
      spender: intent.spender,
      expectedAllowance: intent.expectedAllowance,
      amount: 0n,
      checkedAtBlock: chainClock.blockNumber,
      allowanceBefore,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas
    };
  }

  async sign(intent: CanarySwapIntent, preflight: CanaryPreflight): Promise<SignedCanaryTransaction> {
    assertFeeAndGasCaps(preflight.gas, preflight.maxFeePerGas, preflight.maxPriorityFeePerGas, this.caps);
    const chainClock = await this.getChainClock();
    assertQuoteFresh(intent.quoteBlockNumber, chainClock.blockNumber, this.caps.maxQuoteAgeBlocks);
    assertCanaryDeadlineAgainstChainClock(intent.deadlineEpochSeconds, chainClock.timestampSeconds);
    await this.assertQuoteBlockCanonical(intent);
    const nonce = await this.publicClient.getTransactionCount({ address: this.account.address, blockTag: 'pending' });
    const serializedTransaction = await this.account.signTransaction({
      chainId: INK_CHAIN_ID,
      type: 'eip1559',
      nonce,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas,
      to: INK_SWAP_ROUTER_02,
      value: 0n,
      data: intent.calldata
    });
    const transactionHash = keccak256(serializedTransaction);
    const signed = {
      actionId: intent.actionId,
      nonce,
      transactionHash,
      serializedTransaction,
      serializedTransactionKeccak256: transactionHash,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas
    } satisfies SignedCanaryTransaction;
    this.signedSwapHashes.add(transactionHash.toLowerCase());
    return signed;
  }

  async signApproval(intent: CanaryApprovalIntent, preflight: CanaryApprovalPreflight): Promise<SignedCanaryTransaction> {
    if (intent.version !== CANARY_E0_APPROVAL_R0) throw new Error('CANARY_ENTRY_APPROVAL_SIGN_REQUIRES_RESERVATION_CAPABILITY');
    return this.signApprovalBound(intent, preflight);
  }

  async signEntryApprovalReserved(params: {
    intent: CanaryEntryApprovalIntent;
    preflight: CanaryApprovalPreflight;
    store: CanaryEntryApprovalStore;
    signingCapability: string;
  }): Promise<SignedCanaryTransaction> {
    if (!(params.store instanceof CanaryEntryApprovalStore)) throw new Error('CANARY_ENTRY_APPROVAL_STORE_AUTHORITY_INVALID');
    params.store.assertSigningAuthority(params.intent.actionId, params.signingCapability);
    const authoritativeParentBuyIntent = await params.store.getAuthoritativeParentBuyIntent(params.intent.actionId);
    await assertCanaryEntryApprovalMatchesParentBuy(params.intent, authoritativeParentBuyIntent);
    return this.signApprovalBound(params.intent, params.preflight, async () => {
      const consumedParentBuyIntent = await params.store.consumeSigningAuthority(params.intent.actionId, params.signingCapability);
      await assertCanaryEntryApprovalMatchesParentBuy(params.intent, consumedParentBuyIntent);
    });
  }

  async signEntryApprovalRevoke(
    intent: CanaryEntryApprovalRevokeIntent,
    preflight: CanaryApprovalRevokePreflight
  ): Promise<SignedCanaryTransaction> {
    this.assertEntryApprovalRevokeAuthority(intent);
    assertEntryApprovalRevokePreflightBinding(intent, preflight, this.account.address);
    assertFeeAndGasCaps(preflight.gas, preflight.maxFeePerGas, preflight.maxPriorityFeePerGas, this.caps);
    await this.getChainClock();
    const currentAllowance = await this.publicClient.readContract({
      address: intent.token,
      abi: erc20CanaryAbi,
      functionName: 'allowance',
      args: [this.account.address, intent.spender]
    });
    if (currentAllowance !== intent.expectedAllowance) {
      throw new Error(`CANARY_ENTRY_APPROVAL_REVOKE_ALLOWANCE_CHANGED:${currentAllowance}:${intent.expectedAllowance}`);
    }
    await this.assertEntryApprovalRevokeSimulation(intent);

    const nonce = await this.publicClient.getTransactionCount({ address: this.account.address, blockTag: 'pending' });
    const serializedTransaction = await this.account.signTransaction({
      chainId: INK_CHAIN_ID,
      type: 'eip1559',
      nonce,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas,
      to: intent.token,
      value: 0n,
      data: intent.calldata
    });
    const transactionHash = keccak256(serializedTransaction);
    const signed: SignedCanaryTransaction = {
      actionId: intent.actionId,
      nonce,
      transactionHash,
      serializedTransaction,
      serializedTransactionKeccak256: transactionHash,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas
    };
    await assertSignedEntryApprovalRevokeTransaction(intent, signed, this.account.address);
    return signed;
  }

  async broadcastExact(signed: SignedCanaryTransaction): Promise<Hex> {
    await assertSignedCanaryTransactionEnvelope(signed, this.account.address, this.caps);
    const key = signed.transactionHash.toLowerCase();
    const approvalIntent = this.signedApprovalIntents.get(key);
    if (approvalIntent) {
      await assertSignedApprovalTransaction(approvalIntent, signed, this.account.address);
      this.signedApprovalIntents.delete(key);
    } else if (this.signedSwapHashes.has(key)) {
      const parsed = parseTransaction(signed.serializedTransaction);
      if (!parsed.to || getAddress(parsed.to) !== INK_SWAP_ROUTER_02) throw new Error('CANARY_SWAP_BROADCAST_ROUTER_MISMATCH');
      this.signedSwapHashes.delete(key);
    } else {
      throw new Error('CANARY_BROADCAST_SIGNED_AUTHORITY_UNKNOWN');
    }

    const returnedHash = await this.walletClient.sendRawTransaction({ serializedTransaction: signed.serializedTransaction });
    if (returnedHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
      throw new Error(`CANARY_BROADCAST_HASH_MISMATCH:${returnedHash}:${signed.transactionHash}`);
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

  async getTokenBalance(token: Address): Promise<bigint> {
    return this.publicClient.readContract({ address: token, abi: erc20CanaryAbi, functionName: 'balanceOf', args: [this.account.address] });
  }

  async getTokenAllowance(token: Address, spender: Address = INK_SWAP_ROUTER_02): Promise<bigint> {
    return this.publicClient.readContract({ address: token, abi: erc20CanaryAbi, functionName: 'allowance', args: [this.account.address, spender] });
  }

  private async signApprovalBound(
    intent: CanaryExactApprovalIntent,
    preflight: CanaryApprovalPreflight,
    beforeSign?: () => Promise<void>
  ): Promise<SignedCanaryTransaction> {
    this.assertApprovalAuthority(intent);
    assertApprovalPreflightBinding(intent, preflight, this.account.address);
    assertFeeAndGasCaps(preflight.gas, preflight.maxFeePerGas, preflight.maxPriorityFeePerGas, this.caps);
    await this.getChainClock();
    const [tokenBalance, currentAllowance] = await Promise.all([
      this.publicClient.readContract({ address: intent.token, abi: erc20CanaryAbi, functionName: 'balanceOf', args: [this.account.address] }),
      this.publicClient.readContract({ address: intent.token, abi: erc20CanaryAbi, functionName: 'allowance', args: [this.account.address, intent.spender] })
    ]);
    if (tokenBalance < intent.amount) throw new Error(`CANARY_APPROVAL_TOKEN_BALANCE_CHANGED:${tokenBalance}:${intent.amount}`);
    if (classifyCanaryApprovalAllowance(currentAllowance, intent.amount) !== 'APPROVE_EXACT') {
      throw new Error(`CANARY_APPROVAL_ALLOWANCE_CHANGED:${currentAllowance}`);
    }
    await this.assertApprovalSimulation(intent);
    if (beforeSign) await beforeSign();

    const nonce = await this.publicClient.getTransactionCount({ address: this.account.address, blockTag: 'pending' });
    const serializedTransaction = await this.account.signTransaction({
      chainId: INK_CHAIN_ID,
      type: 'eip1559',
      nonce,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas,
      to: intent.token,
      value: 0n,
      data: intent.calldata
    });
    const transactionHash = keccak256(serializedTransaction);
    const signed: SignedCanaryTransaction = {
      actionId: intent.actionId,
      nonce,
      transactionHash,
      serializedTransaction,
      serializedTransactionKeccak256: transactionHash,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas
    };
    await assertSignedApprovalTransaction(intent, signed, this.account.address);
    this.signedApprovalIntents.set(transactionHash.toLowerCase(), Object.freeze({ ...intent }));
    return signed;
  }

  private async assertQuoteBlockCanonical(intent: CanarySwapIntent): Promise<void> {
    const block = await this.publicClient.getBlock({ blockNumber: intent.quoteBlockNumber });
    if (!block.hash) throw new Error(`CANARY_QUOTE_BLOCK_HASH_MISSING:${intent.quoteBlockNumber}`);
    assertCanaryQuoteBlockHash(intent.quoteBlockHash, block.hash);
  }

  private assertApprovalAuthority(intent: CanaryExactApprovalIntent): void {
    if (intent.version === CANARY_E0_APPROVAL_R0) {
      if (getAddress(intent.owner) !== getAddress(this.account.address)) throw new Error('CANARY_APPROVAL_OWNER_MUST_EQUAL_WALLET');
      if (getAddress(intent.spender) !== INK_SWAP_ROUTER_02) throw new Error(`CANARY_APPROVAL_SPENDER_MISMATCH:${intent.spender}`);
      assertCanaryApprovalCalldata(intent);
      return;
    }
    if (intent.version === CANARY_E0_ENTRY_APPROVAL_R0) {
      if (getAddress(intent.owner) !== getAddress(this.account.address)) throw new Error('CANARY_ENTRY_APPROVAL_OWNER_MUST_EQUAL_WALLET');
      if (getAddress(intent.token) !== getAddress(WETH9)) throw new Error(`CANARY_ENTRY_APPROVAL_TOKEN_MISMATCH:${intent.token}`);
      if (getAddress(intent.spender) !== INK_SWAP_ROUTER_02) throw new Error(`CANARY_ENTRY_APPROVAL_SPENDER_MISMATCH:${intent.spender}`);
      if (intent.notionalUsdMicros !== CANARY_PRIMARY_NOTIONAL_USD_MICROS) throw new Error('CANARY_ENTRY_APPROVAL_NOTIONAL_INVALID');
      assertCanaryEntryApprovalCalldata(intent);
      return;
    }
    throw new Error(`CANARY_APPROVAL_VERSION_INVALID:${String((intent as { version?: unknown }).version)}`);
  }

  private assertEntryApprovalRevokeAuthority(intent: CanaryEntryApprovalRevokeIntent): void {
    if (intent.version !== CANARY_E0_ENTRY_APPROVAL_REVOKE_R0) {
      throw new Error(`CANARY_ENTRY_APPROVAL_REVOKE_VERSION_INVALID:${String((intent as { version?: unknown }).version)}`);
    }
    if (getAddress(intent.owner) !== getAddress(this.account.address)) {
      throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_OWNER_MUST_EQUAL_WALLET');
    }
    if (getAddress(intent.spender) !== INK_SWAP_ROUTER_02) {
      throw new Error(`CANARY_ENTRY_APPROVAL_REVOKE_SPENDER_MISMATCH:${intent.spender}`);
    }
    assertCanaryEntryApprovalRevokeCalldata(intent);
  }

  private async assertApprovalSimulation(intent: CanaryExactApprovalIntent): Promise<void> {
    const simulated = await this.publicClient.call({ account: this.account.address, to: intent.token, data: intent.calldata, value: 0n });
    if (!simulated.data || simulated.data === '0x') throw new Error('CANARY_APPROVAL_SIMULATION_RESULT_MISSING');
    const result = decodeFunctionResult({ abi: erc20ApprovalAbi, functionName: 'approve', data: simulated.data });
    if (result !== true) throw new Error('CANARY_APPROVAL_SIMULATION_FALSE');
  }

  private async assertEntryApprovalRevokeSimulation(intent: CanaryEntryApprovalRevokeIntent): Promise<void> {
    const simulated = await this.publicClient.call({ account: this.account.address, to: intent.token, data: intent.calldata, value: 0n });
    if (!simulated.data || simulated.data === '0x') throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_SIMULATION_RESULT_MISSING');
    const result = decodeFunctionResult({ abi: erc20ApprovalAbi, functionName: 'approve', data: simulated.data });
    if (result !== true) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_SIMULATION_FALSE');
  }
}

export async function assertSignedCanaryTransactionEnvelope(
  signed: SignedCanaryTransaction,
  expectedWallet: Address,
  caps?: CanaryExecutorCaps
): Promise<void> {
  const derivedHash = keccak256(signed.serializedTransaction);
  if (
    derivedHash.toLowerCase() !== signed.transactionHash.toLowerCase() ||
    derivedHash.toLowerCase() !== signed.serializedTransactionKeccak256.toLowerCase()
  ) throw new Error('CANARY_BROADCAST_SIGNED_IDENTITY_MISMATCH');
  const parsed = parseTransaction(signed.serializedTransaction);
  if (parsed.chainId !== INK_CHAIN_ID) throw new Error(`CANARY_BROADCAST_CHAIN_ID_MISMATCH:${parsed.chainId}`);
  if ((parsed.value ?? 0n) !== 0n) throw new Error('CANARY_BROADCAST_VALUE_NONZERO');
  if (parsed.nonce !== signed.nonce) throw new Error('CANARY_BROADCAST_NONCE_MISMATCH');
  if (parsed.gas !== signed.gas) throw new Error('CANARY_BROADCAST_GAS_MISMATCH');
  if (parsed.maxFeePerGas !== signed.maxFeePerGas) throw new Error('CANARY_BROADCAST_MAX_FEE_MISMATCH');
  if (parsed.maxPriorityFeePerGas !== signed.maxPriorityFeePerGas) throw new Error('CANARY_BROADCAST_PRIORITY_FEE_MISMATCH');
  if (caps) assertFeeAndGasCaps(signed.gas, signed.maxFeePerGas, signed.maxPriorityFeePerGas, caps);
  const recovered = await recoverTransactionAddress({ serializedTransaction: signed.serializedTransaction as `0x02${string}` });
  if (getAddress(recovered) !== getAddress(expectedWallet)) throw new Error('CANARY_BROADCAST_SIGNER_MISMATCH');
}

export async function assertSignedApprovalTransaction(
  intent: CanaryExactApprovalIntent,
  signed: SignedCanaryTransaction,
  expectedWallet: Address
): Promise<void> {
  if (signed.actionId !== intent.actionId) throw new Error('CANARY_APPROVAL_SIGNED_ACTION_ID_MISMATCH');
  await assertSignedCanaryTransactionEnvelope(signed, expectedWallet);
  const parsed = parseTransaction(signed.serializedTransaction);
  if (!parsed.to || getAddress(parsed.to) !== getAddress(intent.token)) throw new Error('CANARY_APPROVAL_SIGNED_TO_MISMATCH');
  if ((parsed.data ?? '0x').toLowerCase() !== intent.calldata.toLowerCase()) throw new Error('CANARY_APPROVAL_SIGNED_CALLDATA_MISMATCH');
}

export async function assertSignedEntryApprovalRevokeTransaction(
  intent: CanaryEntryApprovalRevokeIntent,
  signed: SignedCanaryTransaction,
  expectedWallet: Address
): Promise<void> {
  if (signed.actionId !== intent.actionId) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_SIGNED_ACTION_ID_MISMATCH');
  await assertSignedCanaryTransactionEnvelope(signed, expectedWallet);
  const parsed = parseTransaction(signed.serializedTransaction);
  if (!parsed.to || getAddress(parsed.to) !== getAddress(intent.token)) {
    throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_SIGNED_TO_MISMATCH');
  }
  if ((parsed.data ?? '0x').toLowerCase() !== intent.calldata.toLowerCase()) {
    throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_SIGNED_CALLDATA_MISMATCH');
  }
}

export function assertCanaryQuoteBlockHash(expected: Hex, actual: Hex): void {
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(`CANARY_QUOTE_BLOCK_REORG:expected=${expected}:actual=${actual}`);
  }
}

export function assertCanaryDeadlineAgainstChainClock(deadlineEpochSeconds: bigint, chainTimestampSeconds: number): void {
  if (!Number.isInteger(chainTimestampSeconds) || chainTimestampSeconds <= 0) throw new Error('CANARY_CHAIN_TIMESTAMP_INVALID');
  const chainTimestamp = BigInt(chainTimestampSeconds);
  if (deadlineEpochSeconds <= chainTimestamp) throw new Error('CANARY_DEADLINE_EXPIRED');
  const lifetime = deadlineEpochSeconds - chainTimestamp;
  if (lifetime > BigInt(CANARY_MAX_DEADLINE_SECONDS)) {
    throw new Error(`CANARY_DEADLINE_EXCEEDS_MAX:${lifetime}:${CANARY_MAX_DEADLINE_SECONDS}`);
  }
}

function assertApprovalPreflightBinding(intent: CanaryExactApprovalIntent, preflight: CanaryApprovalPreflight, wallet: Address): void {
  if (preflight.actionId !== intent.actionId) throw new Error('CANARY_APPROVAL_PREFLIGHT_ACTION_ID_MISMATCH');
  if (getAddress(preflight.wallet) !== getAddress(wallet)) throw new Error('CANARY_APPROVAL_PREFLIGHT_WALLET_MISMATCH');
  if (getAddress(preflight.token) !== getAddress(intent.token)) throw new Error('CANARY_APPROVAL_PREFLIGHT_TOKEN_MISMATCH');
  if (getAddress(preflight.spender) !== getAddress(intent.spender)) throw new Error('CANARY_APPROVAL_PREFLIGHT_SPENDER_MISMATCH');
  if (preflight.amount !== intent.amount) throw new Error('CANARY_APPROVAL_PREFLIGHT_AMOUNT_MISMATCH');
  if (preflight.allowanceBefore !== 0n) throw new Error('CANARY_APPROVAL_PREFLIGHT_ALLOWANCE_NOT_ZERO');
  if (preflight.tokenBalance < intent.amount) throw new Error('CANARY_APPROVAL_PREFLIGHT_BALANCE_INSUFFICIENT');
}

function assertEntryApprovalRevokePreflightBinding(
  intent: CanaryEntryApprovalRevokeIntent,
  preflight: CanaryApprovalRevokePreflight,
  wallet: Address
): void {
  if (preflight.actionId !== intent.actionId) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PREFLIGHT_ACTION_ID_MISMATCH');
  if (getAddress(preflight.wallet) !== getAddress(wallet)) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PREFLIGHT_WALLET_MISMATCH');
  if (getAddress(preflight.token) !== getAddress(intent.token)) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PREFLIGHT_TOKEN_MISMATCH');
  if (getAddress(preflight.spender) !== getAddress(intent.spender)) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PREFLIGHT_SPENDER_MISMATCH');
  if (preflight.expectedAllowance !== intent.expectedAllowance) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PREFLIGHT_EXPECTED_ALLOWANCE_MISMATCH');
  if (preflight.amount !== 0n || intent.amount !== 0n) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PREFLIGHT_AMOUNT_NONZERO');
  if (preflight.allowanceBefore !== intent.expectedAllowance) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PREFLIGHT_ALLOWANCE_NOT_EXACT');
}

function blockTimestampToNumber(timestamp: bigint): number {
  if (timestamp <= 0n || timestamp > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`CANARY_CHAIN_TIMESTAMP_INVALID:${timestamp}`);
  return Number(timestamp);
}

function assertQuoteFresh(quoteBlock: bigint, headBlock: bigint, maxAge: bigint): void {
  if (headBlock < quoteBlock) throw new Error(`CANARY_HEAD_BEHIND_QUOTE:${headBlock}:${quoteBlock}`);
  if (headBlock - quoteBlock > maxAge) throw new Error(`CANARY_QUOTE_STALE:${quoteBlock}:${headBlock}:${maxAge}`);
}

function validateCaps(caps: CanaryExecutorCaps): void {
  if (caps.maxQuoteAgeBlocks < 0n || caps.maxQuoteAgeBlocks > 3n) throw new Error('CANARY_MAX_QUOTE_AGE_BLOCKS_OUT_OF_RANGE');
  if (caps.maxGas <= 0n || caps.maxGas > 1_000_000n) throw new Error('CANARY_MAX_GAS_OUT_OF_RANGE');
  if (caps.maxFeePerGas <= 0n || caps.maxPriorityFeePerGas < 0n || caps.maxPriorityFeePerGas > caps.maxFeePerGas) {
    throw new Error('CANARY_FEE_CAPS_INVALID');
  }
}

function assertFeeAndGasCaps(gas: bigint, maxFeePerGas: bigint, maxPriorityFeePerGas: bigint, caps: CanaryExecutorCaps): void {
  if (gas <= 0n || gas > caps.maxGas) throw new Error(`CANARY_GAS_CAP_EXCEEDED:${gas}:${caps.maxGas}`);
  if (maxFeePerGas <= 0n || maxFeePerGas > caps.maxFeePerGas) {
    throw new Error(`CANARY_MAX_FEE_CAP_EXCEEDED:${maxFeePerGas}:${caps.maxFeePerGas}`);
  }
  if (maxPriorityFeePerGas < 0n || maxPriorityFeePerGas > caps.maxPriorityFeePerGas || maxPriorityFeePerGas > maxFeePerGas) {
    throw new Error(`CANARY_PRIORITY_FEE_CAP_EXCEEDED:${maxPriorityFeePerGas}:${caps.maxPriorityFeePerGas}`);
  }
}
