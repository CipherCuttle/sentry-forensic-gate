import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient
} from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  assertPonsV2AuthorityBlock
} from '../adapters/robinhood/ponsV2/authority.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ponsV2CurveStateReadAbi,
  ponsV2FactoryReadAbi,
  ponsV2LaunchDeployerReadAbi,
  ponsV2MemeHookReadAbi,
  uniswapV4QuoterReadAbi,
  uniswapV4StateViewReadAbi
} from '../adapters/robinhood/ponsV2/contracts.js';
import {
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  assertPonsV2CurveTemplateBlock
} from '../adapters/robinhood/ponsV2/curveTemplateAuthority.js';
import {
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  assertPonsV2ForwardOutcomeBlock
} from '../adapters/robinhood/ponsV2/forwardOutcomeAuthority.js';
import {
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  assertRobinhoodUsdCalibrationBlock
} from '../adapters/robinhood/ponsV2/v4UsdCalibrationAuthority.js';
import {
  CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY,
  validatePonsV2V4ExitRecoveryAuthority
} from '../adapters/robinhood/ponsV2/v4ExitRecoveryAuthority.js';
import {
  buildPonsE1V4RecoveryPlan,
  type PonsE1V4PoolKey,
  type PonsE1V4RecoveryPlan
} from './ponsE1V4ExitRecovery.js';

const UINT128_MAX = (1n << 128n) - 1n;

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});

const erc20ReadAbi = [
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

const permit2ReadAbi = [{
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

const universalRouterReadAbi = [{
  type: 'function',
  name: 'poolManager',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }]
}] as const;

type PonsV2LaunchRecord = {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: number;
  sweptQuote: bigint;
  sweptTokens: bigint;
  sweptAt: bigint;
  exists: boolean;
};

export interface VerifyPonsE1V4RecoveryOptions {
  token: Address;
  owner: Address;
  slippageBps?: number;
  rpcUrl?: string;
  client?: PublicClient;
}

export interface PonsE1V4RecoveryVerification {
  verdict: 'PONS_E1_V4_EXIT_RECOVERY_DRY_READY';
  mode: 'READ_ONLY_DRY_RUN';
  blockNumber: bigint;
  blockHash: Hex;
  token: Address;
  owner: Address;
  curve: Address;
  poolId: Hex;
  poolKey: PonsE1V4PoolKey;
  liquidity: bigint;
  tokenBalance: bigint;
  quotedNativeOut: bigint;
  currentTokenAllowanceToPermit2: bigint;
  currentPermit2AllowanceToRouter: bigint;
  currentPermit2Expiration: bigint;
  plan: PonsE1V4RecoveryPlan;
}

export async function verifyPonsE1V4Recovery(
  options: VerifyPonsE1V4RecoveryOptions
): Promise<PonsE1V4RecoveryVerification> {
  validatePonsV2V4ExitRecoveryAuthority(
    CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY
  );
  const client = options.client ?? createPublicClient({
    chain: robinhood,
    transport: http(options.rpcUrl ?? DEFAULT_ROBINHOOD_RPC_URL, {
      retryCount: 2,
      retryDelay: 1_000
    })
  });
  const token = getAddress(options.token);
  const owner = getAddress(options.owner);
  const slippageBps = options.slippageBps ?? 500;

  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) throw new Error('PONS_E1_V4_RECOVERY_BLOCK_HASH_MISSING');
  if (await client.getChainId() !== ROBINHOOD_CHAIN_ID) {
    throw new Error('PONS_E1_V4_RECOVERY_CHAIN_ID_MISMATCH');
  }
  assertPonsV2AuthorityBlock(CURRENT_PONS_V2_AUTHORITY, blockNumber);
  assertPonsV2CurveTemplateBlock(
    CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
    blockNumber
  );
  assertPonsV2ForwardOutcomeBlock(
    CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
    blockNumber
  );
  assertRobinhoodUsdCalibrationBlock(
    CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
    blockNumber
  );
  if (blockNumber < CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.fromBlock) {
    throw new Error('PONS_E1_V4_RECOVERY_BEFORE_ROUTER_EPOCH');
  }

  await assertRuntimeAuthorities(client, blockNumber);

  const recordRaw = await client.readContract({
    address: CURRENT_PONS_V2_AUTHORITY.factory as Address,
    abi: ponsV2FactoryReadAbi,
    functionName: 'getLaunchedToken',
    args: [token],
    blockNumber
  });
  const record = recordRaw as unknown as PonsV2LaunchRecord;
  if (!record.exists || getAddress(record.token) !== token) {
    throw new Error('PONS_E1_V4_RECOVERY_LAUNCH_RECORD_MISSING');
  }
  if (getAddress(record.pairToken) !== getAddress(PONS_V2_NATIVE_PAIR_TOKEN)) {
    throw new Error('PONS_E1_V4_RECOVERY_NATIVE_PAIR_REQUIRED');
  }
  if (record.phase !== 2) {
    throw new Error(`PONS_E1_V4_RECOVERY_REQUIRES_PHASE_2:${record.phase}`);
  }
  const graduated = await client.readContract({
    address: record.curve,
    abi: ponsV2CurveStateReadAbi,
    functionName: 'graduated',
    blockNumber
  });
  if (!graduated) {
    throw new Error('PONS_E1_V4_RECOVERY_PHASE_2_CURVE_NOT_GRADUATED');
  }
  if (
    record.sweptQuote !== 0n ||
    record.sweptTokens !== 0n ||
    record.sweptAt !== 0n
  ) {
    throw new Error('PONS_E1_V4_RECOVERY_PHASE_2_SWEEP_FIELDS_NOT_CLEARED');
  }

  const poolKey: PonsE1V4PoolKey = {
    currency0: getAddress(PONS_V2_NATIVE_PAIR_TOKEN),
    currency1: token,
    fee: record.poolFee,
    tickSpacing: record.tickSpacing,
    hooks: getAddress(CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY.memeHook)
  };
  const poolId = derivePoolId(poolKey);

  const [slot0Raw, liquidity, launchInfoRaw, tokenBalance, tokenAllowance, permit2AllowanceRaw] =
    await Promise.all([
      client.readContract({
        address: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY.stateView as Address,
        abi: uniswapV4StateViewReadAbi,
        functionName: 'getSlot0',
        args: [poolId],
        blockNumber
      }),
      client.readContract({
        address: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY.stateView as Address,
        abi: uniswapV4StateViewReadAbi,
        functionName: 'getLiquidity',
        args: [poolId],
        blockNumber
      }),
      client.readContract({
        address: CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY.memeHook as Address,
        abi: ponsV2MemeHookReadAbi,
        functionName: 'launches',
        args: [poolId],
        blockNumber
      }),
      client.readContract({
        address: token,
        abi: erc20ReadAbi,
        functionName: 'balanceOf',
        args: [owner],
        blockNumber
      }),
      client.readContract({
        address: token,
        abi: erc20ReadAbi,
        functionName: 'allowance',
        args: [
          owner,
          CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2 as Address
        ],
        blockNumber
      }),
      client.readContract({
        address: CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2 as Address,
        abi: permit2ReadAbi,
        functionName: 'allowance',
        args: [
          owner,
          token,
          CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.universalRouter as Address
        ],
        blockNumber
      })
    ]);

  const slot0 = slot0Raw as readonly [bigint, number, number, number];
  if (slot0[0] <= 0n) {
    throw new Error('PONS_E1_V4_RECOVERY_POOL_UNINITIALIZED');
  }
  if ((liquidity as bigint) <= 0n) {
    throw new Error('PONS_E1_V4_RECOVERY_POOL_LIQUIDITY_ZERO');
  }
  if (Number(slot0[3]) !== record.poolFee) {
    throw new Error('PONS_E1_V4_RECOVERY_POOL_FEE_DRIFT');
  }

  const launchInfo = launchInfoRaw as unknown as readonly [
    boolean,
    boolean,
    Address,
    Address,
    Address,
    Address,
    Address,
    number,
    number,
    number,
    number,
    number,
    boolean
  ];
  if (!launchInfo[0]) {
    throw new Error('PONS_E1_V4_RECOVERY_POOL_NOT_REGISTERED');
  }
  if (launchInfo[1]) {
    throw new Error('PONS_E1_V4_RECOVERY_NATIVE_ORDERING_MISMATCH');
  }
  if (getAddress(launchInfo[2]) !== token) {
    throw new Error('PONS_E1_V4_RECOVERY_HOOK_TOKEN_MISMATCH');
  }
  if (getAddress(launchInfo[3]) !== getAddress(PONS_V2_NATIVE_PAIR_TOKEN)) {
    throw new Error('PONS_E1_V4_RECOVERY_HOOK_QUOTE_MISMATCH');
  }

  const balance = tokenBalance as bigint;
  if (balance <= 0n) {
    throw new Error('PONS_E1_V4_RECOVERY_OWNER_TOKEN_BALANCE_ZERO');
  }
  if (balance > UINT128_MAX) {
    throw new Error('PONS_E1_V4_RECOVERY_OWNER_BALANCE_UINT128_OVERFLOW');
  }

  const quoteData = encodeFunctionData({
    abi: uniswapV4QuoterReadAbi,
    functionName: 'quoteExactInputSingle',
    args: [{
      poolKey,
      zeroForOne: false,
      exactAmount: balance,
      hookData: '0x'
    }]
  });
  const quoteResult = await client.call({
    to: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY.quoter as Address,
    data: quoteData,
    blockNumber
  });
  if (!quoteResult.data) {
    throw new Error('PONS_E1_V4_RECOVERY_QUOTER_EMPTY_RETURN');
  }
  const [quotedNativeOut] = decodeFunctionResult({
    abi: uniswapV4QuoterReadAbi,
    functionName: 'quoteExactInputSingle',
    data: quoteResult.data
  }) as readonly [bigint, bigint];
  if (quotedNativeOut <= 0n) {
    throw new Error('PONS_E1_V4_RECOVERY_QUOTE_ZERO');
  }

  const deadline = block.timestamp + 300n;
  const permit2Expiration = block.timestamp + 600n;
  const plan = buildPonsE1V4RecoveryPlan({
    token,
    owner,
    poolKey,
    tokenAmount: balance,
    quotedNativeOut,
    slippageBps,
    deadline,
    permit2Expiration
  });

  await Promise.all([
    client.call({
      account: owner,
      to: plan.calls[0].target,
      data: plan.calls[0].calldata,
      value: 0n,
      blockNumber
    }),
    client.call({
      account: owner,
      to: plan.calls[1].target,
      data: plan.calls[1].calldata,
      value: 0n,
      blockNumber
    })
  ]);

  const blockAfter = await client.getBlock({ blockNumber });
  if (!blockAfter.hash || blockAfter.hash.toLowerCase() !== block.hash.toLowerCase()) {
    throw new Error('PONS_E1_V4_RECOVERY_REORG_DURING_VERIFICATION');
  }

  const permit2Allowance = permit2AllowanceRaw as unknown as readonly [
    bigint,
    number,
    number
  ];
  return {
    verdict: 'PONS_E1_V4_EXIT_RECOVERY_DRY_READY',
    mode: 'READ_ONLY_DRY_RUN',
    blockNumber,
    blockHash: block.hash,
    token,
    owner,
    curve: getAddress(record.curve),
    poolId,
    poolKey,
    liquidity: liquidity as bigint,
    tokenBalance: balance,
    quotedNativeOut,
    currentTokenAllowanceToPermit2: tokenAllowance as bigint,
    currentPermit2AllowanceToRouter: permit2Allowance[0],
    currentPermit2Expiration: BigInt(permit2Allowance[1]),
    plan
  };
}

async function assertRuntimeAuthorities(
  client: PublicClient,
  blockNumber: bigint
): Promise<void> {
  const recovery = CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY;
  const outcome = CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY;
  const usd = CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY;
  const [
    factoryCode,
    launchDeployerCode,
    routerCode,
    permit2Code,
    hookCode,
    poolManagerCode,
    stateViewCode,
    quoterCode
  ] = await Promise.all([
      client.getBytecode({
        address: CURRENT_PONS_V2_AUTHORITY.factory as Address,
        blockNumber
      }),
      client.getBytecode({
        address: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY.launchDeployer as Address,
        blockNumber
      }),
      client.getBytecode({ address: recovery.universalRouter as Address, blockNumber }),
      client.getBytecode({ address: recovery.permit2 as Address, blockNumber }),
      client.getBytecode({ address: outcome.memeHook as Address, blockNumber }),
      client.getBytecode({ address: usd.poolManager as Address, blockNumber }),
      client.getBytecode({ address: usd.stateView as Address, blockNumber }),
      client.getBytecode({ address: usd.quoter as Address, blockNumber })
    ]);
  assertCodeHash('FACTORY', factoryCode, CURRENT_PONS_V2_AUTHORITY.factoryRuntimeCodeHash);
  assertCodeHash(
    'LAUNCH_DEPLOYER',
    launchDeployerCode,
    CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY.launchDeployerRuntimeCodeHash
  );
  assertCodeHash('ROUTER', routerCode, recovery.universalRouterRuntimeCodeHash);
  assertCodeHash('PERMIT2', permit2Code, recovery.permit2RuntimeCodeHash);
  assertCodeHash('MEME_HOOK', hookCode, outcome.memeHookRuntimeCodeHash);
  assertCodeHash('POOL_MANAGER', poolManagerCode, usd.poolManagerRuntimeCodeHash);
  assertCodeHash('STATE_VIEW', stateViewCode, usd.stateViewRuntimeCodeHash);
  assertCodeHash('QUOTER', quoterCode, usd.quoterRuntimeCodeHash);

  const [
    factoryLaunchDeployer,
    factoryHook,
    factoryPoolManager,
    launchDeployerFactory,
    hookFactory,
    hookPoolManager,
    routerPoolManager,
    quoterPoolManager
  ] = await Promise.all([
    client.readContract({
      address: CURRENT_PONS_V2_AUTHORITY.factory as Address,
      abi: ponsV2FactoryReadAbi,
      functionName: 'launchDeployer',
      blockNumber
    }),
    client.readContract({
      address: CURRENT_PONS_V2_AUTHORITY.factory as Address,
      abi: ponsV2FactoryReadAbi,
      functionName: 'memeHook',
      blockNumber
    }),
    client.readContract({
      address: CURRENT_PONS_V2_AUTHORITY.factory as Address,
      abi: ponsV2FactoryReadAbi,
      functionName: 'poolManager',
      blockNumber
    }),
    client.readContract({
      address: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY.launchDeployer as Address,
      abi: ponsV2LaunchDeployerReadAbi,
      functionName: 'factory',
      blockNumber
    }),
    client.readContract({
      address: outcome.memeHook as Address,
      abi: ponsV2MemeHookReadAbi,
      functionName: 'factory',
      blockNumber
    }),
    client.readContract({
      address: outcome.memeHook as Address,
      abi: ponsV2MemeHookReadAbi,
      functionName: 'poolManager',
      blockNumber
    }),
    client.readContract({
      address: recovery.universalRouter as Address,
      abi: universalRouterReadAbi,
      functionName: 'poolManager',
      blockNumber
    }),
    client.readContract({
      address: usd.quoter as Address,
      abi: uniswapV4QuoterReadAbi,
      functionName: 'poolManager',
      blockNumber
    })
  ]);
  if (
    getAddress(factoryLaunchDeployer as Address) !==
    getAddress(CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY.launchDeployer)
  ) {
    throw new Error('PONS_E1_V4_RECOVERY_FACTORY_LAUNCH_DEPLOYER_DRIFT');
  }
  if (
    getAddress(launchDeployerFactory as Address) !==
    getAddress(CURRENT_PONS_V2_AUTHORITY.factory)
  ) {
    throw new Error('PONS_E1_V4_RECOVERY_LAUNCH_DEPLOYER_FACTORY_DRIFT');
  }
  if (getAddress(factoryHook as Address) !== getAddress(outcome.memeHook)) {
    throw new Error('PONS_E1_V4_RECOVERY_FACTORY_HOOK_DRIFT');
  }
  if (
    getAddress(hookFactory as Address) !==
    getAddress(CURRENT_PONS_V2_AUTHORITY.factory)
  ) {
    throw new Error('PONS_E1_V4_RECOVERY_HOOK_FACTORY_DRIFT');
  }
  for (const [label, actual] of [
    ['FACTORY', factoryPoolManager],
    ['HOOK', hookPoolManager],
    ['ROUTER', routerPoolManager],
    ['QUOTER', quoterPoolManager]
  ] as const) {
    if (getAddress(actual as Address) !== getAddress(usd.poolManager)) {
      throw new Error(`PONS_E1_V4_RECOVERY_${label}_POOL_MANAGER_DRIFT`);
    }
  }
}

function assertCodeHash(
  label: string,
  code: Hex | undefined,
  expected: Hex
): void {
  if (!code || code === '0x') {
    throw new Error(`PONS_E1_V4_RECOVERY_${label}_CODE_MISSING`);
  }
  const actual = keccak256(code);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `PONS_E1_V4_RECOVERY_${label}_CODE_HASH_DRIFT:expected=${expected}:actual=${actual}`
    );
  }
}

function derivePoolId(poolKey: PonsE1V4PoolKey): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' }
    ],
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks
    ]
  ));
}
