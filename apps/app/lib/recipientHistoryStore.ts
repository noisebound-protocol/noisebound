import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RecipientHistory } from '@noisebound/sigma-execute';

function normalize(address: string): string {
  return address.toLowerCase();
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT';
}

function loadSeenAddresses(filePath: string): Set<string> {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string').map(normalize));
  } catch (error) {
    if (isEnoent(error)) return new Set();
    throw error;
  }
}

/**
 * Default on-disk location for persisted recipient history. Overridable via
 * `NOISEBOUND_RECIPIENT_HISTORY_PATH` (set to an isolated temp path in
 * vitest.setup.ts, so tests that exercise the real evaluateActionRequest
 * singleton don't write into the checked-out repo directory).
 */
export function defaultRecipientHistoryPath(): string {
  return process.env.NOISEBOUND_RECIPIENT_HISTORY_PATH ?? join(process.cwd(), '.data', 'recipient-history.json');
}

/**
 * Persistent `RecipientHistory` backed by a single JSON file of seen
 * addresses. sigma-execute's `RecipientHistory` interface is synchronous, so
 * state is loaded once at construction and every `markSeen` writes straight
 * through to disk (atomic via temp-file + rename). Unlike memory-store's
 * general-purpose encrypted-at-rest entries, this data isn't encrypted:
 * recipient addresses a wallet has sent to are already public on-chain, so
 * there's no secrecy guarantee worth the async/AES-key overhead here.
 */
export function createPersistedRecipientHistory(filePath: string = defaultRecipientHistoryPath()): RecipientHistory {
  const seen = loadSeenAddresses(filePath);

  return {
    hasSeen(recipient: string): boolean {
      return seen.has(normalize(recipient));
    },
    markSeen(recipient: string): void {
      const normalized = normalize(recipient);
      if (seen.has(normalized)) return;
      seen.add(normalized);

      mkdirSync(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;
      writeFileSync(tempPath, JSON.stringify([...seen]), 'utf8');
      renameSync(tempPath, filePath);
    },
  };
}
