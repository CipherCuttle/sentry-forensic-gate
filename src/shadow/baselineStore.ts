import type { LaunchObserved } from '../domain.js';
import type { ExecutableBaselineBatch } from './baselineTypes.js';

export interface BaselineStore {
  listLaunchesPendingBaseline(maxLaunchBlock: bigint, limit: number): Promise<LaunchObserved[]>;
  putBaselineBatch(batch: ExecutableBaselineBatch): Promise<'INSERTED' | 'DUPLICATE'>;
}
