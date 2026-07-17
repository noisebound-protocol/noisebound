import type { StoredSessionCapability } from './types';

export function isCapabilityActive(capability: StoredSessionCapability, nowMs: number): boolean {
  return !capability.revoked && capability.payload.expiresAt > nowMs;
}

export function pickPrimaryCapability(
  capabilities: readonly StoredSessionCapability[],
  nowMs: number,
): StoredSessionCapability | undefined {
  return capabilities.find((capability) => isCapabilityActive(capability, nowMs));
}
