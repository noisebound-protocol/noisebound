import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersistentRevocationRegistry } from '../persistent-revocation.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, appendFile: vi.fn(actual.appendFile) };
});

const { appendFile: mockedAppendFile } = await import('node:fs/promises');

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pqc-wallet-revocation-'));
  filePath = join(dir, 'revocations.jsonl');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('createPersistentRevocationRegistry', () => {
  it('round-trips revoke + isRevoked within a single instance', async () => {
    const registry = await createPersistentRevocationRegistry(filePath);

    expect(registry.isRevoked('cap-1')).toBe(false);
    await registry.revoke('cap-1');
    expect(registry.isRevoked('cap-1')).toBe(true);
    expect(registry.isRevoked('cap-2')).toBe(false);
  });

  it('rebuilds state from an existing file on a fresh construction (process restart)', async () => {
    const first = await createPersistentRevocationRegistry(filePath);
    await first.revoke('cap-restart');

    const second = await createPersistentRevocationRegistry(filePath);

    expect(second.isRevoked('cap-restart')).toBe(true);
  });

  it('persists multiple revocations across multiple constructions', async () => {
    const first = await createPersistentRevocationRegistry(filePath);
    await first.revoke('cap-a');
    await first.revoke('cap-b');

    const second = await createPersistentRevocationRegistry(filePath);
    await second.revoke('cap-c');

    const third = await createPersistentRevocationRegistry(filePath);

    expect(third.isRevoked('cap-a')).toBe(true);
    expect(third.isRevoked('cap-b')).toBe(true);
    expect(third.isRevoked('cap-c')).toBe(true);
    expect(third.isRevoked('cap-d')).toBe(false);
  });

  it('does not update in-memory state when the append write fails', async () => {
    const registry = await createPersistentRevocationRegistry(filePath);

    vi.mocked(mockedAppendFile).mockRejectedValueOnce(new Error('disk full'));

    await expect(registry.revoke('cap-fail')).rejects.toThrow('disk full');
    expect(registry.isRevoked('cap-fail')).toBe(false);

    // Confirm the registry still works normally afterwards, and that the
    // failed revocation never made it to disk either.
    await registry.revoke('cap-fail');
    expect(registry.isRevoked('cap-fail')).toBe(true);

    const fresh = await createPersistentRevocationRegistry(filePath);
    expect(fresh.isRevoked('cap-fail')).toBe(true);
  });
});
