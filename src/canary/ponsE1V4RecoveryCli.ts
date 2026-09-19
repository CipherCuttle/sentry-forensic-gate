import { getAddress } from 'viem';
import { verifyPonsE1V4Recovery } from './viemPonsE1V4RecoveryVerifier.js';

if (
  process.env.PONS_E1_LIVE ||
  process.env.PONS_E1_PRIVATE_KEY ||
  process.env.PONS_E0_PRIVATE_KEY
) {
  throw new Error('PONS_E1_V4_RECOVERY_DRY_ONLY_NO_SIGNER_ALLOWED');
}

const tokenRaw = process.env.PONS_E1_TOKEN;
const ownerRaw = process.env.PONS_E1_OWNER;
if (!tokenRaw) throw new Error('PONS_E1_TOKEN_REQUIRED');
if (!ownerRaw) throw new Error('PONS_E1_OWNER_REQUIRED');

const slippageRaw = process.env.PONS_E1_SLIPPAGE_BPS;
const slippageBps = slippageRaw === undefined ? 500 : Number(slippageRaw);
if (!Number.isInteger(slippageBps)) {
  throw new Error('PONS_E1_SLIPPAGE_BPS_INTEGER_REQUIRED');
}

const result = await verifyPonsE1V4Recovery({
  token: getAddress(tokenRaw),
  owner: getAddress(ownerRaw),
  slippageBps,
  rpcUrl: process.env.PONS_E1_RPC_URL
});

console.log(JSON.stringify(jsonSafe({
  ...result,
  plan: {
    ...result.plan,
    calls: result.plan.calls.map((call) => ({
      ...call,
      calldataBytes: (call.calldata.length - 2) / 2
    }))
  },
  liveMoneyAuthority: false,
  signerAvailable: false,
  broadcastAvailable: false
}), null, 2));

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        jsonSafe(item)
      ])
    );
  }
  return value;
}
