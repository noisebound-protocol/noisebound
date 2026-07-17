import type { InstanceSelectionCriteria, TeeInstance } from './types.js';

/**
 * Pure selection logic shared by {@link TeeProvider} implementations and by
 * `getVerifiedInstance`'s post-attestation selection. Operates only on
 * whatever pool of instances it is given — callers decide whether that pool
 * is "everything the provider reports" or "only what passed attestation".
 */
export function selectFromPool(
  instances: readonly TeeInstance[],
  criteria: InstanceSelectionCriteria,
): TeeInstance | undefined {
  return instances.find((instance) => {
    if (criteria.region !== undefined && instance.region !== criteria.region) return false;
    if (criteria.gpuModel !== undefined && instance.gpuModel !== criteria.gpuModel) return false;
    return true;
  });
}
