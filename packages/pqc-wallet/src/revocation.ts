import type { RevocationRegistry, SessionCapability } from './types.js';

/** Creates an in-memory registry of revoked capability token ids. */
export function createRevocationRegistry(): RevocationRegistry {
  const revoked = new Set<string>();
  return {
    revoke(tokenId: string): void {
      revoked.add(tokenId);
    },
    isRevoked(tokenId: string): boolean {
      return revoked.has(tokenId);
    },
  };
}

/** Marks a session capability as revoked in the given registry. */
export function revokeSessionCapability(
  registry: RevocationRegistry,
  capability: SessionCapability,
): void {
  registry.revoke(capability.payload.id);
}
