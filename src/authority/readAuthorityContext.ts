import type { Hex } from '../domain.js';
import { CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH } from './executableInfraAuthority.js';
import { CURRENT_SENTRY_AUTHORITY_EPOCH } from './sentryAuthority.js';

export interface ReadAuthorityContext {
  sentryImplementation: Hex;
  npm: Hex;
  factory: Hex;
  quoterV2: Hex;
  weth: Hex;
}

export const CURRENT_READ_AUTHORITY_CONTEXT: Readonly<ReadAuthorityContext> = Object.freeze({
  sentryImplementation: CURRENT_SENTRY_AUTHORITY_EPOCH.implementation,
  npm: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.npm,
  factory: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.factory,
  quoterV2: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.quoterV2,
  weth: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.weth
});
