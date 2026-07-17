import type { EncryptedMemoryEntry } from './types.js';

/**
 * Opaque position marker for incremental sync, analogous to Matrix's `/sync` `since` token:
 * the transport hands one back with every pull, and the caller replays it on the next call to
 * resume exactly where it left off instead of re-fetching the full history.
 */
export type SyncCursor = string;

export type MemorySyncPushResult = {
  readonly cursor: SyncCursor;
};

export type MemorySyncPullResult = {
  readonly entries: readonly EncryptedMemoryEntry[];
  readonly cursor: SyncCursor;
  readonly hasMore: boolean;
};

/**
 * Future E2EE cross-device sync contract. Modeled on how Signal and Matrix keep sync servers
 * content-blind: the transport only ever moves already-encrypted {@link EncryptedMemoryEntry}
 * records (Signal relays opaque Double-Ratchet envelopes; Matrix's homeserver stores and
 * federates Megolm-encrypted event bodies it cannot itself decrypt), so a transport
 * implementation — and whatever server sits behind it — never needs the memory encryption key.
 * No implementation is provided yet; this is scaffolding for future sync transports
 * (e.g. a relay server, WebRTC data channel, or removable-media handoff).
 */
export interface MemorySyncTransport {
  /** Uploads local changes made since `sinceCursor` (undefined on first sync), returning a new cursor. */
  push(entries: readonly EncryptedMemoryEntry[], sinceCursor: SyncCursor | undefined): Promise<MemorySyncPushResult>;
  /** Downloads remote changes made since `sinceCursor` (undefined for a full initial sync). */
  pull(sinceCursor: SyncCursor | undefined): Promise<MemorySyncPullResult>;
}
