import {
  generateSessionKey,
  issueAndFundSessionCapability,
  revokeSessionCapability,
} from '@noisebound/pqc-wallet';
import type {
  IssueAndFundResult,
  RevocationRegistry,
  SessionCapability,
  SessionCapabilityScope,
} from '@noisebound/pqc-wallet';
import type { IdentityKeyPair } from '@noisebound/identity';
import { DEV_SESSION_FUNDING_WEI, getDevFunderWallet } from './fixtures/devWallet';

/**
 * Generates a fresh session key, then issues and gas-funds a capability for
 * it. The session key's own private key is never returned — this UI layer
 * only ever needs the resulting capability and its on-chain address.
 */
export async function issueNewSessionCapability(
  identityKeyPair: IdentityKeyPair,
  scope: SessionCapabilityScope,
  ttlMs: number,
): Promise<IssueAndFundResult> {
  const sessionKey = generateSessionKey();
  const funderWallet = getDevFunderWallet();
  return issueAndFundSessionCapability(
    identityKeyPair,
    sessionKey.publicKey,
    scope,
    ttlMs,
    funderWallet,
    DEV_SESSION_FUNDING_WEI,
  );
}

export function revokeStoredCapability(
  registry: RevocationRegistry,
  capability: SessionCapability,
): void {
  revokeSessionCapability(registry, capability);
}
