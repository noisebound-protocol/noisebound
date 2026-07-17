import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { MemoryStore } from './store.js';
import type { EncryptedMemoryEntry, MemoryQuery } from './types.js';

const FILE_EXTENSION = '.json';

/** JSON-safe wire format for an {@link EncryptedMemoryEntry}: binary fields become base64. */
type SerializedEntry = {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
};

function serialize(entry: EncryptedMemoryEntry): SerializedEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    nonce: Buffer.from(entry.nonce).toString('base64'),
    ciphertext: Buffer.from(entry.ciphertext).toString('base64'),
    authTag: Buffer.from(entry.authTag).toString('base64'),
  };
}

function deserialize(serialized: SerializedEntry): EncryptedMemoryEntry {
  return {
    id: serialized.id,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
    nonce: new Uint8Array(Buffer.from(serialized.nonce, 'base64')),
    ciphertext: new Uint8Array(Buffer.from(serialized.ciphertext, 'base64')),
    authTag: new Uint8Array(Buffer.from(serialized.authTag, 'base64')),
  };
}

/**
 * Maps an entry id to a filesystem-safe filename. Base64url-encoding the id (rather than
 * using it as a raw filename) means path-traversal sequences like `../../etc/passwd` or
 * embedded separators can never escape the base directory — the encoded output only ever
 * contains `[A-Za-z0-9_-]`.
 */
function filenameForId(id: string): string {
  return `${Buffer.from(id, 'utf8').toString('base64url')}${FILE_EXTENSION}`;
}

/** Persistent {@link MemoryStore} backed by one encrypted JSON file per entry under `baseDir`. */
export class FilesystemStore implements MemoryStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async put(entry: EncryptedMemoryEntry): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });

    const targetPath = join(this.baseDir, filenameForId(entry.id));
    const tempPath = join(this.baseDir, `.${filenameForId(entry.id)}.${randomBytes(8).toString('hex')}.tmp`);

    const payload = JSON.stringify(serialize(entry));
    await writeFile(tempPath, payload, 'utf8');
    await rename(tempPath, targetPath);
  }

  async get(id: string): Promise<EncryptedMemoryEntry | undefined> {
    const filePath = join(this.baseDir, filenameForId(id));
    try {
      const raw = await readFile(filePath, 'utf8');
      return deserialize(JSON.parse(raw) as SerializedEntry);
    } catch (error) {
      if (isEnoent(error)) return undefined;
      throw error;
    }
  }

  async query(query: MemoryQuery): Promise<readonly EncryptedMemoryEntry[]> {
    const entries = await this.readAll();

    const idFilter = query.ids === undefined ? undefined : new Set(query.ids);

    const matches = entries.filter((entry) => {
      if (idFilter !== undefined && !idFilter.has(entry.id)) return false;
      if (query.createdAfter !== undefined && entry.createdAt < query.createdAfter) return false;
      if (query.createdBefore !== undefined && entry.createdAt > query.createdBefore) return false;
      if (query.updatedAfter !== undefined && entry.updatedAt < query.updatedAfter) return false;
      if (query.updatedBefore !== undefined && entry.updatedAt > query.updatedBefore) return false;
      return true;
    });

    return query.limit === undefined ? matches : matches.slice(0, query.limit);
  }

  async delete(id: string): Promise<void> {
    const filePath = join(this.baseDir, filenameForId(id));
    try {
      await unlink(filePath);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }

  private async readAll(): Promise<readonly EncryptedMemoryEntry[]> {
    let filenames: readonly string[];
    try {
      filenames = await readdir(this.baseDir);
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }

    const entries: EncryptedMemoryEntry[] = [];
    for (const filename of filenames) {
      if (!filename.endsWith(FILE_EXTENSION) || filename.startsWith('.')) continue;
      const raw = await readFile(join(this.baseDir, filename), 'utf8');
      entries.push(deserialize(JSON.parse(raw) as SerializedEntry));
    }
    return entries;
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT';
}
