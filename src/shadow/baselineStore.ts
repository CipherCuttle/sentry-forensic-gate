import type { Hex, LaunchObserved } from '../domain.js';
import type { BaselineStatus, ExecutableBaselineBatch } from './baselineTypes.js';

export interface BaselineDecisionPoint {
  baselineId: string;
  authorityDigest: string;
  launchId: string;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  status: BaselineStatus;
}

export interface BaselineStore {
  listLaunchesPendingBaseline(maxLaunchBlock: bigint, limit: number): Promise<LaunchObserved[]>;
  listBaselineDecisionPoints(): Promise<BaselineDecisionPoint[]>;
  putBaselineBatch(batch: ExecutableBaselineBatch): Promise<'INSERTED' | 'DUPLICATE'>;
}
