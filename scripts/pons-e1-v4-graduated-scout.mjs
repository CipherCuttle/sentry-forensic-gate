import {
  createPublicClient,
  defineChain,
  getAddress,
  http
} from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ponsV2FactoryReadAbi,
  ponsV2TokenLaunchedEvent
} from '../dist/index.js';

const rpcUrl = process.env.PONS_E1_RPC_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
const lookback = BigInt(process.env.PONS_E1_SCOUT_LOOKBACK_BLOCKS ?? '100000');
const chunkSize = BigInt(process.env.PONS_E1_SCOUT_CHUNK_BLOCKS ?? '2000');

const chain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});
const client = createPublicClient({
  chain,
  transport: http(rpcUrl, { retryCount: 3, retryDelay: 1000 })
});

const head = await client.getBlockNumber();
const floor = head > lookback ? head - lookback : CURRENT_PONS_V2_AUTHORITY.fromBlock;
let scannedLogs = 0;
let scannedChunks = 0;

for (let chunkTo = head; chunkTo >= floor;) {
  const chunkFrom = chunkTo >= chunkSize - 1n
    ? (chunkTo - chunkSize + 1n < floor ? floor : chunkTo - chunkSize + 1n)
    : floor;
  const logs = await client.getLogs({
    address: CURRENT_PONS_V2_AUTHORITY.factory,
    event: ponsV2TokenLaunchedEvent,
    fromBlock: chunkFrom,
    toBlock: chunkTo,
    strict: true
  });
  scannedChunks += 1;
  logs.sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)));

  for (const log of logs) {
    const token = log.args.token;
    if (!token) continue;
    scannedLogs += 1;
    const record = await client.readContract({
      address: CURRENT_PONS_V2_AUTHORITY.factory,
      abi: ponsV2FactoryReadAbi,
      functionName: 'getLaunchedToken',
      args: [token]
    });
    const typed = record;
    if (
      typed.exists &&
      typed.phase === 2 &&
      getAddress(typed.pairToken) === getAddress(PONS_V2_NATIVE_PAIR_TOKEN)
    ) {
      console.log(JSON.stringify({
        verdict: 'PONS_E1_PHASE_2_NATIVE_CANDIDATE_FOUND',
        mode: 'READ_ONLY_SCOUT',
        head: head.toString(),
        launchBlock: log.blockNumber?.toString() ?? null,
        launchTxHash: log.transactionHash,
        token: getAddress(typed.token),
        curve: getAddress(typed.curve),
        poolFee: typed.poolFee,
        tickSpacing: typed.tickSpacing,
        phase: typed.phase,
        scannedChunks,
        scannedLogs,
        liveMoneyAuthority: false,
        signer: false,
        broadcast: false
      }, null, 2));
      process.exit(0);
    }
  }

  if (chunkFrom === floor) break;
  chunkTo = chunkFrom - 1n;
}

throw new Error(
  `PONS_E1_PHASE_2_NATIVE_CANDIDATE_NOT_FOUND:head=${head}:floor=${floor}:chunks=${scannedChunks}:logs=${scannedLogs}`
);
