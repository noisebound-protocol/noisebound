import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FeedbackEntry } from './types';

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT';
}

function isFeedbackEntry(value: unknown): value is FeedbackEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.submittedAt === 'number' &&
    typeof candidate.message === 'string' &&
    (candidate.category === null ||
      candidate.category === 'bug' ||
      candidate.category === 'feature' ||
      candidate.category === 'other')
  );
}

function loadEntries(filePath: string): FeedbackEntry[] {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFeedbackEntry);
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
}

/**
 * Default on-disk location for persisted beta feedback. Overridable via
 * `NOISEBOUND_FEEDBACK_STORE_PATH` (set to an isolated temp path in
 * vitest.setup.ts, so tests don't write into the checked-out repo directory).
 */
export function defaultFeedbackStorePath(): string {
  return process.env.NOISEBOUND_FEEDBACK_STORE_PATH ?? join(process.cwd(), '.data', 'feedback.json');
}

export interface FeedbackStore {
  list(): FeedbackEntry[];
  append(entry: FeedbackEntry): FeedbackEntry[];
}

/**
 * Persistent feedback log backed by a single JSON file, newest first.
 * Same atomic-write approach as recipientHistoryStore.ts (temp-file +
 * rename): entries are re-read from disk on every call rather than cached
 * in memory, since feedback volume in beta is low and this avoids the
 * store going stale across separate server-action invocations.
 */
export function createFeedbackStore(filePath: string = defaultFeedbackStorePath()): FeedbackStore {
  return {
    list(): FeedbackEntry[] {
      return loadEntries(filePath);
    },
    append(entry: FeedbackEntry): FeedbackEntry[] {
      const next = [entry, ...loadEntries(filePath)];

      mkdirSync(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;
      writeFileSync(tempPath, JSON.stringify(next), 'utf8');
      renameSync(tempPath, filePath);

      return next;
    },
  };
}
