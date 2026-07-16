import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { fromBase64, toBase64 } from './encoding.js';
import type { IdentityKeyPair, SerializedIdentityKeyPair } from './types.js';

/** Generates a fresh ML-DSA-65 identity keypair. */
export function generateIdentityKeyPair(): IdentityKeyPair {
  const { publicKey, secretKey } = ml_dsa65.keygen();
  return { publicKey, secretKey };
}

/** Encodes an identity keypair as base64 strings for storage. */
export function serializeIdentityKeyPair(keyPair: IdentityKeyPair): SerializedIdentityKeyPair {
  return {
    publicKey: toBase64(keyPair.publicKey),
    secretKey: toBase64(keyPair.secretKey),
  };
}

/** Decodes a base64-serialized identity keypair back into raw key bytes. */
export function deserializeIdentityKeyPair(serialized: SerializedIdentityKeyPair): IdentityKeyPair {
  return {
    publicKey: fromBase64(serialized.publicKey),
    secretKey: fromBase64(serialized.secretKey),
  };
}

/** Encodes a public key as a base64 string for storage. */
export function serializePublicKey(publicKey: Uint8Array): string {
  return toBase64(publicKey);
}

/** Decodes a base64-encoded public key back into raw bytes. */
export function deserializePublicKey(serialized: string): Uint8Array {
  return fromBase64(serialized);
}
