import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { sha3_256 } from '@noble/hashes/sha3';
import type { PQCKeypair, CapabilityToken, Scope } from './types.js';
import { toHex, fromHex, randomBytes } from './utils.js';

const CAPABILITY_SPEC_VERSION = 'x402-pqc-capability-v1';

function canonicalTokenMessage(
  tokenId: string,
  sessionId: string,
  scopes: Scope[],
  issuedAt: number,
  expiresAt: number,
  executionAddress: string,
  granterPublicKey: string,
): Uint8Array {
  const enc = new TextEncoder();
  const concat = enc.encode(
    CAPABILITY_SPEC_VERSION +
      tokenId +
      sessionId +
      JSON.stringify(scopes) +
      issuedAt.toString() +
      expiresAt.toString() +
      executionAddress +
      granterPublicKey,
  );
  return sha3_256(concat);
}

/**
 * Grants an ephemeral execution key a scoped, time-boxed capability, signed by
 * the long-lived ML-DSA-65 identity. The execution key never receives a
 * standing/unscoped grant — every scope must be explicitly listed.
 */
export function issueCapabilityToken(
  granterKeypair: PQCKeypair,
  sessionId: string,
  executionAddress: string,
  scopes: Scope[],
  ttlSeconds: number,
): CapabilityToken {
  const tokenId = toHex(randomBytes(16));
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const granterPublicKey = toHex(granterKeypair.publicKey.dsa);

  const msgHash = canonicalTokenMessage(
    tokenId,
    sessionId,
    scopes,
    issuedAt,
    expiresAt,
    executionAddress,
    granterPublicKey,
  );
  const signature = ml_dsa65.sign(granterKeypair.signingKey, msgHash);

  return {
    tokenId,
    sessionId,
    scopes,
    issuedAt,
    expiresAt,
    executionAddress,
    granterPublicKey,
    signature: toHex(signature),
  };
}

/** Re-derives the canonical message for a token and checks its ML-DSA-65 signature. */
export function verifyCapabilitySignature(token: CapabilityToken): boolean {
  try {
    const msgHash = canonicalTokenMessage(
      token.tokenId,
      token.sessionId,
      token.scopes,
      token.issuedAt,
      token.expiresAt,
      token.executionAddress,
      token.granterPublicKey,
    );
    const publicKeyBytes = fromHex(token.granterPublicKey);
    const signatureBytes = fromHex(token.signature);
    return ml_dsa65.verify(publicKeyBytes, msgHash, signatureBytes);
  } catch {
    return false;
  }
}