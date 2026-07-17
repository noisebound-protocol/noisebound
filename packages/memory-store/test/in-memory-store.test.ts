import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryEntry,
  encryptMemoryEntry,
  deriveMemoryEncryptionKey,
  InMemoryStore,
} from '../src/index.js';
import type { Clock, EncryptedMemoryEntry } from '../src/index.js';

class FakeClock implements Clock {
  private current: number;

  constructor(start: number) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

function encryptedFixture(clock: Clock, id: string, content: string): EncryptedMemoryEntry {
  const key = deriveMemoryEncryptionKey(randomBytes(32));
  return encryptMemoryEntry(createMemoryEntry(clock, { id, content }), key);
}

describe('InMemoryStore', () => {
  let clock: FakeClock;
  let store: InMemoryStore;

  beforeEach(() => {
    clock = new FakeClock(1_700_000_000_000);
    store = new InMemoryStore();
  });

  it('put/get round-trips an entry', async () => {
    const entry = encryptedFixture(clock, 'mem-1', 'first fact');
    await store.put(entry);

    const fetched = await store.get('mem-1');
    expect(fetched).toEqual(entry);
  });

  it('get returns undefined for a missing id', async () => {
    expect(await store.get('missing')).toBeUndefined();
  });

  it('put overwrites an existing entry with the same id', async () => {
    const original = encryptedFixture(clock, 'mem-1', 'v1');
    await store.put(original);

    clock.advance(1000);
    const updated = encryptedFixture(clock, 'mem-1', 'v2');
    await store.put(updated);

    const fetched = await store.get('mem-1');
    expect(fetched?.updatedAt).toBe(updated.updatedAt);
    expect(fetched?.ciphertext).toEqual(updated.ciphertext);
  });

  it('delete removes an entry', async () => {
    await store.put(encryptedFixture(clock, 'mem-1', 'fact'));
    await store.delete('mem-1');

    expect(await store.get('mem-1')).toBeUndefined();
  });

  it('delete is a no-op for a missing id', async () => {
    await expect(store.delete('missing')).resolves.toBeUndefined();
  });

  it('query filters by ids', async () => {
    await store.put(encryptedFixture(clock, 'mem-1', 'a'));
    await store.put(encryptedFixture(clock, 'mem-2', 'b'));
    await store.put(encryptedFixture(clock, 'mem-3', 'c'));

    const results = await store.query({ ids: ['mem-1', 'mem-3'] });

    expect(results.map((entry) => entry.id).sort()).toEqual(['mem-1', 'mem-3']);
  });

  it('query filters by createdAfter/createdBefore', async () => {
    const first = encryptedFixture(clock, 'mem-1', 'a');
    await store.put(first);

    clock.advance(1000);
    const second = encryptedFixture(clock, 'mem-2', 'b');
    await store.put(second);

    const results = await store.query({ createdAfter: first.createdAt + 1 });

    expect(results.map((entry) => entry.id)).toEqual(['mem-2']);
  });

  it('query respects limit', async () => {
    await store.put(encryptedFixture(clock, 'mem-1', 'a'));
    await store.put(encryptedFixture(clock, 'mem-2', 'b'));
    await store.put(encryptedFixture(clock, 'mem-3', 'c'));

    const results = await store.query({ limit: 2 });

    expect(results.length).toBe(2);
  });
});
