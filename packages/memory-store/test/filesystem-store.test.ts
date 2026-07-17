import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryEntry,
  decryptMemoryEntry,
  deriveMemoryEncryptionKey,
  encryptMemoryEntry,
  FilesystemStore,
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

const key = deriveMemoryEncryptionKey(randomBytes(32));

function encryptedFixture(clock: Clock, id: string, content: string): EncryptedMemoryEntry {
  return encryptMemoryEntry(createMemoryEntry(clock, { id, content }), key);
}

describe('FilesystemStore', () => {
  let clock: FakeClock;
  let baseDir: string;
  let store: FilesystemStore;

  beforeEach(async () => {
    clock = new FakeClock(1_700_000_000_000);
    baseDir = await mkdtemp(join(tmpdir(), 'filesystem-store-test-'));
    store = new FilesystemStore(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('put/get round-trips an entry through real encryption', async () => {
    const entry = encryptedFixture(clock, 'mem-1', 'first fact');
    await store.put(entry);

    const fetched = await store.get('mem-1');
    expect(fetched).toEqual(entry);

    const decrypted = decryptMemoryEntry(fetched as EncryptedMemoryEntry, key);
    expect(decrypted.content).toBe('first fact');
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

    const files = await readdir(baseDir);
    expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(1);
  });

  it('delete removes the file', async () => {
    await store.put(encryptedFixture(clock, 'mem-1', 'fact'));
    await store.delete('mem-1');

    expect(await store.get('mem-1')).toBeUndefined();
    const files = await readdir(baseDir);
    expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(0);
  });

  it('delete is a no-op for a missing id', async () => {
    await expect(store.delete('missing')).resolves.toBeUndefined();
  });

  it('query filters by ids, matching InMemoryStore semantics', async () => {
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

  it('query returns an empty array when the base directory does not exist yet', async () => {
    const emptyStore = new FilesystemStore(join(baseDir, 'never-created'));
    expect(await emptyStore.query({})).toEqual([]);
  });

  it('rejects path traversal in an id: writes stay inside the base directory', async () => {
    const maliciousId = '../../etc/passwd';
    const entry = encryptedFixture(clock, maliciousId, 'malicious');
    await store.put(entry);

    // Nothing escaped baseDir: the parent-of-parent directory has no such file.
    const escapedPath = join(baseDir, '..', '..', 'etc', 'passwd');
    await expect(readFile(escapedPath, 'utf8')).rejects.toThrow();

    // The entry is still retrievable through the store under its original id.
    const fetched = await store.get(maliciousId);
    expect(fetched?.id).toBe(maliciousId);

    // Every file actually written lives directly inside baseDir.
    const files = await readdir(baseDir);
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
    }
  });

  it('leaves no partial file behind if a write is interrupted before rename', async () => {
    await store.put(encryptedFixture(clock, 'mem-1', 'good entry'));

    // Simulate a crash mid-write: a temp file is created but never renamed into place.
    const danglingTemp = join(baseDir, '.dangling.abc123.tmp');
    await writeFile(danglingTemp, '{"incomplete": true', 'utf8');

    // The good entry, written via the real atomic put(), is unaffected.
    const fetched = await store.get('mem-1');
    expect(fetched).toBeDefined();
    expect(decryptMemoryEntry(fetched as EncryptedMemoryEntry, key).content).toBe('good entry');

    // query() ignores dotfiles/temp files and only reads completed .json entries.
    const results = await store.query({});
    expect(results.map((entry) => entry.id)).toEqual(['mem-1']);
  });
});
