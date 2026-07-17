import type { EncryptedMemoryEntry, MemoryQuery } from './types.js';

/**
 * Storage contract for encrypted-at-rest memory entries. Implementations only ever see
 * ciphertext — filtering happens over the plaintext metadata carried on
 * {@link EncryptedMemoryEntry} (id/createdAt/updatedAt), never over decrypted content.
 */
export interface MemoryStore {
  /** Inserts or overwrites the entry with the given id. */
  put(entry: EncryptedMemoryEntry): Promise<void>;
  get(id: string): Promise<EncryptedMemoryEntry | undefined>;
  query(query: MemoryQuery): Promise<readonly EncryptedMemoryEntry[]>;
  /** Removes the entry with the given id. No-ops if it does not exist. */
  delete(id: string): Promise<void>;
}
