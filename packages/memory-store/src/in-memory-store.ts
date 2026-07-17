import type { MemoryStore } from './store.js';
import type { EncryptedMemoryEntry, MemoryQuery } from './types.js';

/** Volatile, process-local {@link MemoryStore}. For tests and prototyping — not persistent. */
export class InMemoryStore implements MemoryStore {
  private readonly entries = new Map<string, EncryptedMemoryEntry>();

  put(entry: EncryptedMemoryEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    return Promise.resolve();
  }

  get(id: string): Promise<EncryptedMemoryEntry | undefined> {
    return Promise.resolve(this.entries.get(id));
  }

  query(query: MemoryQuery): Promise<readonly EncryptedMemoryEntry[]> {
    const idFilter = query.ids === undefined ? undefined : new Set(query.ids);

    const matches = [...this.entries.values()].filter((entry) => {
      if (idFilter !== undefined && !idFilter.has(entry.id)) return false;
      if (query.createdAfter !== undefined && entry.createdAt < query.createdAfter) return false;
      if (query.createdBefore !== undefined && entry.createdAt > query.createdBefore) return false;
      if (query.updatedAfter !== undefined && entry.updatedAt < query.updatedAfter) return false;
      if (query.updatedBefore !== undefined && entry.updatedAt > query.updatedBefore) return false;
      return true;
    });

    const limited = query.limit === undefined ? matches : matches.slice(0, query.limit);
    return Promise.resolve(limited);
  }

  delete(id: string): Promise<void> {
    this.entries.delete(id);
    return Promise.resolve();
  }
}
