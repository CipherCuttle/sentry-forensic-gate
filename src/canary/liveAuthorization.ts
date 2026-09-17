import { CANARY_PRIMARY_NOTIONAL_USD_MICROS } from './swapIntent.js';

export const CANARY_E0_LIVE_AUTHORIZATION_R0 = 'CANARY_E0_LIVE_AUTHORIZATION_R0' as const;

export interface CanaryE0LiveAuthorizationParams {
  live: boolean;
  entryApprovalEnabled: boolean;
  entryApprovalRevokeEnabled: boolean;
  roundTripEnabled: boolean;
  authorization: string | undefined;
  maxNotionalUsdMicros: string | undefined;
}

/**
 * Explicit operator latch for the already-qualified E0 approval -> BUY -> cleanup/exit stack.
 *
 * This does not authorize wallet funding or perform any wallet/network action. It only allows
 * the existing live runtime to proceed past startup when every money-moving child lifecycle is
 * enabled together, the versioned authorization acknowledgement is exact, and the runtime cap is
 * explicitly pinned to the compile-time $1 primary canary notional.
 *
 * Existing BUY-only live behavior (all child features disabled) is intentionally unchanged.
 */
export function assertCanaryE0LiveAuthorization(params: CanaryE0LiveAuthorizationParams): void {
  if (!params.live) return;

  const anyE0ChildEnabled = params.entryApprovalEnabled || params.entryApprovalRevokeEnabled || params.roundTripEnabled;
  if (!anyE0ChildEnabled) return;

  if (!params.entryApprovalEnabled || !params.entryApprovalRevokeEnabled || !params.roundTripEnabled) {
    throw new Error('CANARY_E0_LIVE_AUTHORIZATION_STACK_INCOMPLETE');
  }
  if (params.authorization !== CANARY_E0_LIVE_AUTHORIZATION_R0) {
    throw new Error('CANARY_E0_LIVE_AUTHORIZATION_REQUIRED');
  }
  if (!params.maxNotionalUsdMicros || !/^\d+$/.test(params.maxNotionalUsdMicros)) {
    throw new Error('CANARY_E0_LIVE_MAX_NOTIONAL_REQUIRED');
  }

  const maxNotionalUsdMicros = BigInt(params.maxNotionalUsdMicros);
  if (maxNotionalUsdMicros !== CANARY_PRIMARY_NOTIONAL_USD_MICROS) {
    throw new Error(`CANARY_E0_LIVE_MAX_NOTIONAL_MUST_EQUAL_PRIMARY:${maxNotionalUsdMicros}:${CANARY_PRIMARY_NOTIONAL_USD_MICROS}`);
  }
}
