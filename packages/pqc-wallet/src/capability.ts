import { computeAddress } from 'ethers';
import { signCapabilityToken, verifyCapabilityToken } from '@noisebound/identity';
import type { IdentityKeyPair } from '@noisebound/identity';
import type {
  RevocationRegistry,
  SessionCapability,
  SessionCapabilityPayload,
  SessionCapabilityScope,
} from './types.js';

function encodePayload(payload: SessionCapabilityPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/** Issues an ML-DSA-65-signed capability token binding a session key to a scope and expiry. */
export function issueSessionCapability(
  identityKeyPair: IdentityKeyPair,
  sessionPublicKey: string,
  scope: SessionCapabilityScope,
  ttlMs: number,
): SessionCapability {
  const issuedAt = Date.now();
  const payload: SessionCapabilityPayload = {
    id: crypto.randomUUID(),
    sessionAddress: computeAddress(sessionPublicKey) as `0x${string}`,
    sessionPublicKey,
    scope,
    issuedAt,
    expiresAt: issuedAt + ttlMs,
  };

  const token = signCapabilityToken(identityKeyPair.secretKey, encodePayload(payload));
  return { payload, signature: token.signature };
}

/** Verifies a session capability's signature, expiry, and (if a registry is given) revocation status. */
export function verifySessionCapability(
  identityPublicKey: Uint8Array,
  capability: SessionCapability,
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
