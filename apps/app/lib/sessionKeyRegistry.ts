import type { SessionKey } from '@noisebound/pqc-wallet';
import type { SessionKeyResolver } from '@noisebound/sigma-execute';

/**
 * Dev-fixture session key registry. In-memory only, so it resets whenever
 * the server process restarts — fine for local development, not a real
 * store. Stashed on globalThis so it survives Next.js dev-mode module
 * hot-reloads, same pattern as lib/registry.ts's revocation registry.
 *
 * Session keys are registered here (by sessionKeyActions.issueNewSessionCapability)
 * instead of being returned to the client, so the private key never crosses
 * the server action boundary.
 */
const globalForSessionKeys = globalThis as unknown as {
  __noisebound_sessionKeyRegistry?: Map<`0x${string}`, SessionKey>;
};

function getRegistry(): Map<`0x${string}`, SessionKey> {
  globalForSessionKeys.__noisebound_sessionKeyRegistry ??= new Map();
  return globalForSessionKeys.__noisebound_sessionKeyRegistry;
}

export function registerSessionKey(sessionKey: SessionKey): void {
  getRegistry().set(sessionKey.address, sessionKey);
}

export const resolveSessionKey: SessionKeyResolver = (sessionAddress) =>
  getRegistry().get(sessionAddress);
