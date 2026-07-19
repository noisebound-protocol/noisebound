import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { ObservedFact } from '@noisebound/observe-loop';
import {
  FilesystemStore,
  decryptMemoryEntry,
  deriveMemoryEncryptionKey,
  encryptMemoryEntry,
  type MemoryEntry,
  type MemoryStore,
} from '@noisebound/memory-store';

const ID_PREFIX = 'observe-fact:';

/**
 * DEVELOPMENT FIXTURE — stands in for a real per-deployment secret. In
 * production this should come from a managed secret store; for local dev
 * and CI a fixed fallback keeps persisted facts readable across restarts
 * without requiring extra setup, mirroring lib/fixtures/devWallet.ts.
 */
const DEV_ENCRYPTION_SEED = 'noisebound-observe-loop-dev-seed-do-not-use-in-prod';

function resolveEncryptionKey(): Uint8Array {
  const seed = process.env.NOISEBOUND_OBSERVE_LOOP_SECRET ?? DEV_ENCRYPTION_SEED;
  return deriveMemoryEncryptionKey(Buffer.from(seed, 'utf8'));
}

function factEntryId(checkId: string): string {
  return `${ID_PREFIX}${checkId}`;
}

type SerializedFact = Omit<ObservedFact, 'lastCheckedAt'> & { readonly lastCheckedAt: string };

/**
 * Persists {@link ObservedFact} snapshots — one per observe-loop check id —
 * as encrypted-at-rest {@link MemoryEntry} content in a {@link MemoryStore}.
 * This is the adapter that lets observe-loop's checks survive process
 * restarts: state is round-tripped through memory-store rather than kept
 * only in the loop's in-memory Map.
 */
export class ObserveFactStore {
  private readonly store: MemoryStore;
  private readonly key: Uint8Array;

  constructor(store: MemoryStore, key: Uint8Array) {
    this.store = store;
    this.key = key;
  }

  async save(fact: ObservedFact): Promise<void> {
    const id = factEntryId(fact.id);
    const serialized: SerializedFact = { ...fact, lastCheckedAt: fact.lastCheckedAt.toISOString() };
    const now = Date.now();
    const entry: MemoryEntry = {
      id,
      content: JSON.stringify(serialized),
      embedding: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.store.put(encryptMemoryEntry(entry, this.key));
  }

  async load(checkId: string): Promise<ObservedFact | undefined> {
    const encrypted = await this.store.get(factEntryId(checkId));
    if (!encrypted) return undefined;

    const entry = decryptMemoryEntry(encrypted, this.key);
    const serialized = JSON.parse(entry.content) as SerializedFact;
    return { ...serialized, lastCheckedAt: new Date(serialized.lastCheckedAt) };
  }

  async loadAll(checkIds: readonly string[]): Promise<Map<string, ObservedFact>> {
    const results = new Map<string, ObservedFact>();
    for (const checkId of checkIds) {
      const fact = await this.load(checkId);
      if (fact) results.set(checkId, fact);
    }
    return results;
  }
}

/** Default on-disk location for persisted observe-loop facts. Overridable for tests. */
export function defaultObserveDataDir(): string {
  return join(process.cwd(), '.data', 'observe-loop');
}

/** Builds the production {@link ObserveFactStore}: one encrypted JSON file per check under `dataDir`. */
export function createObserveFactStore(dataDir: string = defaultObserveDataDir()): ObserveFactStore {
  return new ObserveFactStore(new FilesystemStore(dataDir), resolveEncryptionKey());
}

/** Unique scratch directory helper for tests that need an isolated FilesystemStore. */
export function randomDataDirSuffix(): string {
  return randomBytes(6).toString('hex');
}
