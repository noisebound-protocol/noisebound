import { createRevocationRegistry } from '@noisebound/pqc-wallet';
import type { RevocationRegistry } from '@noisebound/pqc-wallet';

/**
 * Dev-fixture revocation registry. In-memory only, so it resets whenever the
 * server process restarts — fine for local development, not a real store.
 * Stashed on globalThis so it survives Next.js dev-mode module hot-reloads.
 */
const globalForRegistry = globalThis as unknown as {
  __noisebound_revocationRegistry?: RevocationRegistry;
};

export function getRevocationRegistry(): RevocationRegistry {
  globalForRegistry.__noisebound_revocationRegistry ??= createRevocationRegistry();
  return globalForRegistry.__noisebound_revocationRegistry;
}
