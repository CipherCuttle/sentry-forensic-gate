import type { Hex } from '../../../domain.js';
import { sha256Hex } from '../../../evidence/canonical.js';

function norm(value: Hex): Hex {
  return value.toLowerCase() as Hex;
}

export async function derivePonsV2LaunchId(input: {
  chainId: number;
  factory: Hex;
  txHash: Hex;
  token: Hex;
}): Promise<string> {
  return sha256Hex({
    kind: 'PONS_V2_LAUNCH_V1',
    chainId: input.chainId,
    factory: norm(input.factory),
    txHash: norm(input.txHash),
    token: norm(input.token)
  });
}

export async function derivePonsV2EventId(input: {
  chainId: number;
  factory: Hex;
  txHash: Hex;
  logIndex: number;
}): Promise<string> {
  return sha256Hex({
    kind: 'PONS_V2_EVENT_V1',
    chainId: input.chainId,
    factory: norm(input.factory),
    txHash: norm(input.txHash),
    logIndex: input.logIndex
  });
}
