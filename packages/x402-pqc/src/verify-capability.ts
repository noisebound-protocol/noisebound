import type { CapabilityToken, Scope, VerificationResult } from './types.js';
import { verifyCapabilitySignature } from './capability.js';
import type { RevocationRegistry } from './revocation.js';

/**
 * Checks whether one of the token's granted scopes covers `requiredScope`.
 * For 'sign-tx', `requiredScope.maxAmountWei` is read as the amount actually
 * being requested — it must not exceed the granted cap, and if the grant
 * pins a contractAddress, the requested one must match exactly.
 */
function scopeSatisfies(granted: Scope, requiredScope: Scope): boolean {
  if (granted.type !== requiredScope.type) return false;

  if (granted.type === 'read-balance') return true;

  // granted.type === 'sign-tx'
  const required = requiredScope as Extract<Scope, { type: 'sign-tx' }>;
  if (BigInt(required.maxAmountWei) > BigInt(granted.maxAmountWei)) return false;
  if (granted.contractAddress !== undefined && granted.contractAddress !== required.contractAddress) {
    return false;
  }
  return true;
}

/**
 * Fail-closed capability verification: signature, then expiry, then
 * revocation, then an exact scope match. Any failure denies — there is no
 * fallback "allow" path.
 */
export function verifyCapabilityToken(
  token: CapabilityToken,
  requiredScope: Scope,
  registry: RevocationRegistry,
): VerificationResult {
  if (!verifyCapabilitySignature(token)) {
    return { valid: false, error: 'invalid signature' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > token.expiresAt) {
    return { valid: false, error: 'token expired' };
  }

  if (registry.isRevoked(token.tokenId)) {
    return { valid: false, error: 'token revoked' };
  }

  const scopeMatch = token.scopes.some(granted => scopeSatisfies(granted, requiredScope));
  if (!scopeMatch) {
    return { valid: false, error: 'out of scope' };
  }

  return { valid: true };
}