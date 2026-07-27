import { signCapabilityToken, verifyCapabilityToken } from '@noisebound/identity';
import type { IdentityKeyPair } from '@noisebound/identity';
import type {
  RevocationRegistry,
  WebActionCapability,
  WebActionCapabilityPayload,
  WebActionScope,
} from './types.js';

function encodePayload(payload: WebActionCapabilityPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/** Issues an ML-DSA-65-signed capability token authorizing σ-1 to perform scoped web actions as `subjectPublicKey`. */
export function issueWebActionCapability(
  identityKeyPair: IdentityKeyPair,
  subjectPublicKey: string,
  scope: WebActionScope,
  ttlMs: number,
): WebActionCapability {
  const issuedAt = Date.now();
  const payload: WebActionCapabilityPayload = {
    id: crypto.randomUUID(),
    subjectPublicKey,
    scope,
    issuedAt,
    expiresAt: issuedAt + ttlMs,
  };

  const token = signCapabilityToken(identityKeyPair.secretKey, encodePayload(payload));
  return { payload, signature: token.signature };
}

/** Verifies a web-action capability's signature, expiry, and (if a registry is given) revocation status. */
export function verifyWebActionCapability(
  identityPublicKey: Uint8Array,
  capability: WebActionCapability,
  registry?: RevocationRegistry,
): boolean {
  if (registry !== undefined && registry.isRevoked(capability.payload.id)) {
    return false;
  }

  if (Date.now() > capability.payload.expiresAt) {
    return false;
  }

  return verifyCapabilityToken(
    identityPublicKey,
    encodePayload(capability.payload),
    capability.signature,
  );
}
