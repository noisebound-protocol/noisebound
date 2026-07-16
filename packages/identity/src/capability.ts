import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { fromBase64, toBase64 } from './encoding.js';
import type { CapabilityToken, SerializedCapabilityToken } from './types.js';

/** Signs an arbitrary payload with an ML-DSA-65 identity secret key, producing a capability token. */
export function signCapabilityToken(secretKey: Uint8Array, payload: Uint8Array): CapabilityToken {
  const signature = ml_dsa65.sign(payload, secretKey);
  return { payload, signature };
}

/** Verifies a capability token's signature against an ML-DSA-65 identity public key. */
export function verifyCapabilityToken(
  publicKey: Uint8Array,
  payload: Uint8Array,
  signature: Uint8Array,
): boolean {
  return ml_dsa65.verify(signature, payload, publicKey);
}

/** Encodes a capability token as base64 strings for storage or transport. */
export function serializeCapabilityToken(token: CapabilityToken): SerializedCapabilityToken {
  return {
    payload: toBase64(token.payload),
    signature: toBase64(token.signature),
  };
}

/** Decodes a base64-serialized capability token back into raw bytes. */
export function deserializeCapabilityToken(serialized: SerializedCapabilityToken): CapabilityToken {
  return {
    payload: fromBase64(serialized.payload),
    signature: fromBase64(serialized.signature),
  };
}
