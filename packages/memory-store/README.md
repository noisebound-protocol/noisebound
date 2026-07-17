# @noisebound/memory-store

Local-first encrypted memory storage for σ-1.

This package models a single unit of persisted memory (`MemoryEntry`: an id, text content, an
optional embedding, and timestamps), encrypts it at rest with AES-256-GCM, and stores the
resulting ciphertext behind a small `MemoryStore` interface. Two implementations are provided:
an in-memory store for tests/prototyping and a filesystem-backed store that persists one JSON
file per entry. Storage implementations only ever see ciphertext plus the plaintext id/timestamp
metadata needed to filter and range-query — they never see decrypted content. A `MemorySyncTransport`
interface is also defined as scaffolding for a future cross-device sync transport that would move
already-encrypted entries without needing the decryption key; no implementation exists yet.

## Public API

### Types (`types.ts`)

- `Clock` — injectable time source (`{ now(): number }`); callers pass a real or fake clock instead of calling `Date.now()` directly.
- `MemoryEntry` — a plaintext memory unit: `{ id, content, embedding, createdAt, updatedAt }`. `embedding` is an empty placeholder until vector search is wired up.
- `EncryptedMemoryEntry` — the at-rest form: `{ id, createdAt, updatedAt, nonce, ciphertext, authTag }`, with `content`/`embedding` folded into `ciphertext`.
- `MemoryQuery` — filter criteria for `MemoryStore.query`: `{ ids?, createdAfter?, createdBefore?, updatedAfter?, updatedBefore?, limit? }`, evaluated against plaintext metadata only.
- `createMemoryEntry(clock, { id, content, embedding? }): MemoryEntry` — builds a `MemoryEntry`, stamping `createdAt`/`updatedAt` from the injected clock.

### Crypto (`crypto.ts`)

- `deriveMemoryEncryptionKey(seedMaterial: Uint8Array): Uint8Array` — derives a 32-byte AES-256-GCM key from seed material via HKDF-SHA256, domain-separated with a fixed `info` label. Seed material must already be high-entropy; this is not a password KDF.
- `encryptMemoryEntry(entry: MemoryEntry, key: Uint8Array): EncryptedMemoryEntry` — encrypts an entry's `content`/`embedding` with AES-256-GCM under a fresh random 12-byte nonce per call.
- `decryptMemoryEntry(encrypted: EncryptedMemoryEntry, key: Uint8Array): MemoryEntry` — decrypts and verifies the GCM auth tag, throwing on tampered ciphertext/nonce/tag or a wrong key.

### Store (`store.ts`, `in-memory-store.ts`, `filesystem-store.ts`)

- `MemoryStore` — storage contract: `put(entry)`, `get(id)`, `query(query)`, `delete(id)`, all returning `Promise`s and operating purely on `EncryptedMemoryEntry`.
- `InMemoryStore` — volatile, process-local `MemoryStore` backed by a `Map`. For tests and prototyping; nothing is persisted.
- `FilesystemStore` — persistent `MemoryStore` that writes one encrypted JSON file per entry under a `baseDir` (constructor argument). Writes go through a temp file + rename for atomicity; entry ids are base64url-encoded into filenames so they can't escape `baseDir` via path traversal.

### Sync (`sync.ts`)

- `SyncCursor` — opaque string position marker for incremental sync, replayed on the next pull to resume where the last one left off.
- `MemorySyncPushResult` — `{ cursor }` returned from a push.
- `MemorySyncPullResult` — `{ entries, cursor, hasMore }` returned from a pull.
- `MemorySyncTransport` — interface for a future sync transport: `push(entries, sinceCursor)` and `pull(sinceCursor)`, moving only already-encrypted entries. No implementation is provided yet.

## Usage

```ts
import {
  createMemoryEntry,
  deriveMemoryEncryptionKey,
  encryptMemoryEntry,
  decryptMemoryEntry,
  InMemoryStore,
} from '@noisebound/memory-store';
import { randomBytes } from 'node:crypto';

const clock = { now: () => Date.now() };
const key = deriveMemoryEncryptionKey(randomBytes(32)); // seed must come from a secure source
const store = new InMemoryStore(); // or: new FilesystemStore('/path/to/dir')

const entry = createMemoryEntry(clock, { id: 'mem-1', content: 'The user prefers TypeScript strict mode.' });
await store.put(encryptMemoryEntry(entry, key));

const encrypted = await store.get('mem-1');
const decrypted = encrypted && decryptMemoryEntry(encrypted, key);
```
