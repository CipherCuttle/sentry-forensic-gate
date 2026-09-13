import type { Hex, LaunchObserved } from '../domain.js';
import type { LaunchMarket } from '../shadow/baselineTypes.js';

export interface PositionIdentity {
  token0: Hex;
  token1: Hex;
  fee: number;
  liquidity: bigint;
}

export function classifyLaunchMarket(input: {
  launch: LaunchObserved;
  position: PositionIdentity;
  supportedBaseTokens: Hex[];
  pool: Hex;
  poolToken0: Hex;
  poolToken1: Hex;
  poolFee: number;
  activeLiquidity: bigint;
  sqrtPriceX96Before: bigint;
}): LaunchMarket {
  const launched = norm(input.launch.token);
  const token0 = norm(input.position.token0);
  const token1 = norm(input.position.token1);
  const tokenMatches0 = token0 === launched;
  const tokenMatches1 = token1 === launched;
  if (tokenMatches0 === tokenMatches1) {
    throw new Error(`MARKET_TOKEN_POSITION_MISMATCH:${input.launch.launchId}`);
  }

  const baseToken = (tokenMatches0 ? token1 : token0) as Hex;
  const supported = new Set(input.supportedBaseTokens.map(norm));
  if (!supported.has(baseToken)) {
    throw new Error(`UNSUPPORTED_SENTRY_BASE:${baseToken}`);
  }
  if (input.position.liquidity <= 0n) {
    throw new Error(`EMPTY_SENTRY_POSITION:${input.launch.tokenId}`);
  }

  if (norm(input.poolToken0) !== token0 || norm(input.poolToken1) !== token1) {
    throw new Error(`POOL_TOKEN_IDENTITY_MISMATCH:${input.pool}`);
  }
  if (input.poolFee !== input.position.fee) {
    throw new Error(`POOL_FEE_IDENTITY_MISMATCH:${input.poolFee}:${input.position.fee}`);
  }

  return {
    launchId: input.launch.launchId,
    launchedToken: launched as Hex,
    baseToken,
    token0: token0 as Hex,
    token1: token1 as Hex,
    fee: input.position.fee,
    pool: norm(input.pool) as Hex,
    positionLiquidity: input.position.liquidity,
    activeLiquidity: input.activeLiquidity,
    sqrtPriceX96Before: input.sqrtPriceX96Before
  };
}

function norm(value: string): string { return value.toLowerCase(); }
