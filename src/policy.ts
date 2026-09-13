import { sha256Hex } from './evidence/canonical.js';

export const FORENSIC_GATE_V0 = Object.freeze({
  version: 'FORENSIC_GATE_V0',
  shadowOnly: true,
  chainId: 57073,
  quoteNotionalUsdMicros: [250_000n, 500_000n, 1_000_000n, 2_000_000n, 5_000_000n],
  primaryNotionalUsdMicros: 1_000_000n,
  outcomeHorizonsMs: [60_000, 300_000, 1_800_000, 7_200_000, 86_400_000]
});

export function policyDigest(): Promise<string> {
  return sha256Hex(FORENSIC_GATE_V0);
}
