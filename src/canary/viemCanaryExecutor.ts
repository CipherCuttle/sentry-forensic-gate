import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
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
  CANARY_MAX_DEADLINE_SECONDS,
  INK_SWAP_ROUTER_02,
  swapRouter02Abi,
  type CanarySwapIntent
} from './swapIntent.js';

const erc20CanaryAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }
] as const;

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
  readonly account: LocalAccount;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly caps: CanaryExecutorCaps;

  constructor(options: ViemCanaryExecutorOptions) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) throw new Error('CANARY_PRIVATE_KEY_FORMAT_INVALID');
    this.account = privateKeyToAccount(options.privateKey);
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
    if (gas > this.caps.maxGas) throw new Error(`CANARY_GAS_CAP_EXCEEDED:${gas}:${this.caps.maxGas}`);
    if (fees.maxFeePerGas > this.caps.maxFeePerGas) throw new Error(`CANARY_MAX_FEE_CAP_EXCEEDED:${fees.maxFeePerGas}:${this.caps.maxFeePerGas}`);
    if (fees.maxPriorityFeePerGas > this.caps.maxPriorityFeePerGas) {
      throw new Error(`CANARY_PRIORITY_FEE_CAP_EXCEEDED:${fees.maxPriorityFeePerGas}:${this.caps.maxPriorityFeePerGas}`);
    }

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

  async sign(intent: CanarySwapIntent, preflight: CanaryPreflight): Promise<SignedCanaryTransaction> {
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
    return {
      actionId: intent.actionId,
      nonce,
      transactionHash,
      serializedTransaction,
      serializedTransactionKeccak256: transactionHash,
      gas: preflight.gas,
      maxFeePerGas: preflight.maxFeePerGas,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGas
    };
  }

  async broadcastExact(signed: SignedCanaryTransaction): Promise<Hex> {
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

  private async assertQuoteBlockCanonical(intent: CanarySwapIntent): Promise<void> {
    const block = await this.publicClient.getBlock({ blockNumber: intent.quoteBlockNumber });
    if (!block.hash) throw new Error(`CANARY_QUOTE_BLOCK_HASH_MISSING:${intent.quoteBlockNumber}`);
    assertCanaryQuoteBlockHash(intent.quoteBlockHash, block.hash);
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
