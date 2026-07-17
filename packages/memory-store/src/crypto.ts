import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { EncryptedMemoryEntry, MemoryEntry } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const NONCE_LENGTH_BYTES = 12;

/**
 * Domain-separation label for HKDF, per RFC 5869 §3.2: binding the derived key to this exact
 * purpose means the same seed material can safely be reused (with a different `info`) to derive
 * unrelated keys elsewhere without key-reuse risk.
 */
const HKDF_INFO = 'noisebound/memory-store/v1/aes-256-gcm-key';

/**
 * Derives a 32-byte AES-256-GCM key from arbitrary seed material via HKDF-SHA256 (RFC 5869).
 *
 * `seedMaterial` must already carry sufficient entropy (e.g. a signing secret key or a dedicated
 * random seed) — HKDF is an extract-then-expand KDF, not a password-hashing function, so it does
 * not add work-factor protection for low-entropy inputs. No salt is supplied: RFC 5869 treats
 * salt as optional, and with high-entropy IKM the security proof does not depend on it. `info`
 * pins the output to this package's specific purpose so the same seed can be reused elsewhere
 * under a different label without producing colliding keys.
 */
export function deriveMemoryEncryptionKey(seedMaterial: Uint8Array): Uint8Array {
  const derived = hkdfSync('sha256', seedMaterial, new Uint8Array(0), HKDF_INFO, KEY_LENGTH_BYTES);
  return new Uint8Array(derived);
}

/**
 * Encrypts a {@link MemoryEntry} with AES-256-GCM under a fresh random nonce.
 * The nonce is generated per call via `randomBytes`, so encrypting identical content twice
 * yields different ciphertext.
 */
export function encryptMemoryEntry(entry: MemoryEntry, key: Uint8Array): EncryptedMemoryEntry {
  const nonce = randomBytes(NONCE_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);

  const plaintext = Buffer.from(
    JSON.stringify({ content: entry.content, embedding: entry.embedding }),
    'utf8',
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    id: entry.id,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    nonce: new Uint8Array(nonce),
    ciphertext: new Uint8Array(ciphertext),
    authTag: new Uint8Array(authTag),
  };
}

/**
 * Decrypts an {@link EncryptedMemoryEntry}, verifying its GCM authentication tag.
 * Throws if the ciphertext, nonce, or tag have been tampered with, or if `key` is wrong —
 * GCM tag verification fails closed rather than returning corrupted plaintext.
 */
export function decryptMemoryEntry(encrypted: EncryptedMemoryEntry, key: Uint8Array): MemoryEntry {
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce);
  decipher.setAuthTag(encrypted.authTag);

  const plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
  const payload = JSON.parse(plaintext.toString('utf8')) as { content: string; embedding: number[] };

  return {
    id: encrypted.id,
    content: payload.content,
    embedding: payload.embedding,
    createdAt: encrypted.createdAt,
    updatedAt: encrypted.updatedAt,
  };
}
