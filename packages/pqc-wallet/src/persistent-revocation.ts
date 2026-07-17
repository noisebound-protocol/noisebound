import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A revocation record as stored on disk, one JSON object per line. */
interface RevocationRecord {
  readonly id: string;
  readonly revokedAt: number;
}

/**
 * File-backed revocation registry. `isRevoked` is a synchronous in-memory
 * lookup; `revoke` is async because it must durably append to disk before
 * the in-memory state (and thus `isRevoked`) reflects the revocation.
 */
export interface PersistentRevocationRegistry {
  revoke(tokenId: string): Promise<void>;
  isRevoked(tokenId: string): boolean;
}

async function loadRevokedIds(filePath: string): Promise<Set<string>> {
  const revoked = new Set<string>();

  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return revoked;
    }
    throw error;
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const record = JSON.parse(trimmed) as RevocationRecord;
    revoked.add(record.id);
  }

  return revoked;
}

/**
 * Loads (or initializes) a persistent revocation registry backed by an
 * append-only JSON-lines file at `filePath`. Existing revocations are
 * replayed into memory so `isRevoked` survives a process restart.
 */
export async function createPersistentRevocationRegistry(
  filePath: string,
): Promise<PersistentRevocationRegistry> {
  await mkdir(dirname(filePath), { recursive: true });
  const revoked = await loadRevokedIds(filePath);

  return {
    async revoke(tokenId: string): Promise<void> {
      if (revoked.has(tokenId)) return;

      const record: RevocationRecord = { id: tokenId, revokedAt: Date.now() };
      // Append to disk first: if this throws, in-memory state below must
      // stay untouched so the two never drift out of sync.
      await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
      revoked.add(tokenId);
    },
    isRevoked(tokenId: string): boolean {
      return revoked.has(tokenId);
    },
  };
}
