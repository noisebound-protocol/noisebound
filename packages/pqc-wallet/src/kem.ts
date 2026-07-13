import { ml_kem768 } from '@noble/post-quantum/ml-kem';

/**
 * ML-KEM-768 key encapsulation.
 * Given a recipient's KEM public key, produces a ciphertext and a shared secret.
 * Send the ciphertext to the recipient; both parties derive the same sharedSecret.
 */
export function encapsulateKey(recipientPublicKey: Uint8Array): {
  ciphertext: Uint8Array;
  sharedSecret: Uint8Array;
} {
  // @noble/post-quantum uses 'cipherText' (capital T); we normalize to 'ciphertext'
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(recipientPublicKey);
  return { ciphertext: cipherText, sharedSecret };
}

/**
 * ML-KEM-768 key decapsulation.
 * Given the ciphertext from encapsulation and the recipient's KEM secret key,
 * recovers the same sharedSecret the sender computed.
 */
export function decapsulateKey(
  ciphertext: Uint8Array,
  encapsulationKey: Uint8Array,
): Uint8Array {
  return ml_kem768.decapsulate(ciphertext, encapsulationKey);
}
