import { encapsulateKey, decapsulateKey } from '@noisebound/pqc-wallet';
import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import type { EncryptedMetadata } from './types.js';
import { randomBytes } from './utils.js';

const ENC_INFO = new TextEncoder().encode('x402-pqc-encryption-v1');

function deriveAesKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, undefined, ENC_INFO, 32);
}

/**
 * Encrypts arbitrary payment metadata for a specific payee using ML-KEM-768 + AES-256-GCM.
 * The payeePublicKey is the recipient's ML-KEM-768 encapsulation (public) key.
 */
export function encryptPaymentMetadata(
  metadata: object,
  payeePublicKey: Uint8Array,
): EncryptedMetadata {
  const { ciphertext: kemCiphertext, sharedSecret } = encapsulateKey(payeePublicKey);
  const aesKey = deriveAesKey(sharedSecret);
  const aesNonce = randomBytes(12);

  const plaintext = new TextEncoder().encode(JSON.stringify(metadata));
  const aesCiphertext = gcm(aesKey, aesNonce).encrypt(plaintext);

  return { kemCiphertext, aesCiphertext, aesNonce, payeePublicKey };
}

/**
 * Decrypts payment metadata using the payee's ML-KEM-768 secret key.
 * Throws if decapsulation or AES-GCM authentication fails.
 */
export function decryptPaymentMetadata(
  encrypted: EncryptedMetadata,
  privateKey: Uint8Array,
): object {
  const sharedSecret = decapsulateKey(encrypted.kemCiphertext, privateKey);
  const aesKey = deriveAesKey(sharedSecret);
  const plaintext = gcm(aesKey, encrypted.aesNonce).decrypt(encrypted.aesCiphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as object;
}
