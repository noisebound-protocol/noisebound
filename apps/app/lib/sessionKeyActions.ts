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
import { computeDevSessionFundingWei, getDevFunderWallet } from './fixtures/devWallet';
import { registerSessionKey } from './sessionKeyRegistry';

/**
 * Generates a fresh session key, registers it so the real on-chain executor
 * can later resolve it by address, then issues and gas-funds a capability
 * for it. The session key's own private key is never returned — this UI
 * layer only ever needs the resulting capability and its on-chain address.
 *
 * The funding amount scales with the requested scope (see
 * `computeDevSessionFundingWei`) instead of a fixed gas top-up, so a session
 * key authorized to spend a meaningful amount actually receives enough
 * balance to use that authorization.
 */
export async function issueNewSessionCapability(
  identityKeyPair: IdentityKeyPair,
  scope: SessionCapabilityScope,
  ttlMs: number,
): Promise<IssueAndFundResult> {
  const sessionKey = generateSessionKey();
  registerSessionKey(sessionKey);
  const funderWallet = getDevFunderWallet();
  return issueAndFundSessionCapability(
    identityKeyPair,
    sessionKey.publicKey,
    scope,
    ttlMs,
    funderWallet,
    computeDevSessionFundingWei(scope),
  );
}

export function revokeStoredCapability(
  registry: RevocationRegistry,
  capability: SessionCapability,
): void {
  revokeSessionCapability(registry, capability);
}
