/** Injectable time source. Callers pass a real or fake clock — never call `Date.now()` directly. */
export type Clock = {
  readonly now: () => number;
};

/**
 * A single unit of σ-1's persisted memory, in plaintext form.
 * `embedding` is a placeholder slot for a future vector-search embedding; it is empty until wired up.
 */
export type MemoryEntry = {
  readonly id: string;
  readonly content: string;
  readonly embedding: readonly number[];
  readonly createdAt: number;
  readonly updatedAt: number;
};

/**
 * The at-rest form of a {@link MemoryEntry}. `content` and `embedding` are folded into `ciphertext`
 * under AES-256-GCM; `id`/`createdAt`/`updatedAt` stay in the clear so a store can index and range-query
 * without holding the decryption key.
 */
export type EncryptedMemoryEntry = {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** 12-byte AES-GCM nonce, unique per encryption. */
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  /** 16-byte AES-GCM authentication tag. */
  readonly authTag: Uint8Array;
};

/** Filter criteria evaluated against the plaintext metadata a {@link MemoryStore} can see without decrypting. */
export type MemoryQuery = {
  readonly ids?: readonly string[];
  readonly createdAfter?: number;
  readonly createdBefore?: number;
  readonly updatedAfter?: number;
  readonly updatedBefore?: number;
  readonly limit?: number;
};

/** Builds a new {@link MemoryEntry}, stamping both timestamps from the injected clock. */
export function createMemoryEntry(
  clock: Clock,
  params: { readonly id: string; readonly content: string; readonly embedding?: readonly number[] },
): MemoryEntry {
  const timestamp = clock.now();
  return {
    id: params.id,
    content: params.content,
    embedding: params.embedding ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
