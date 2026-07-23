import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFeedbackStore } from '../feedbackStore';
import type { FeedbackEntry } from '../types';

let scratchDir: string | undefined;

function scratchFilePath(): string {
  scratchDir = mkdtempSync(join(tmpdir(), 'noisebound-feedback-store-'));
  return join(scratchDir, 'feedback.json');
}

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

function entry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    id: 'entry-1',
    submittedAt: 1_700_000_000_000,
    message: 'The dashboard is great.',
    category: null,
    ...overrides,
  };
}

describe('createFeedbackStore', () => {
  it('returns an empty list when no file exists yet', () => {
    const store = createFeedbackStore(scratchFilePath());
    expect(store.list()).toEqual([]);
  });

  it('persists an appended entry to disk as JSON', () => {
    const filePath = scratchFilePath();
    const store = createFeedbackStore(filePath);

    store.append(entry());

    const raw = readFileSync(filePath, 'utf8');
    expect(JSON.parse(raw)).toEqual([entry()]);
  });

  it('orders entries newest first', () => {
    const store = createFeedbackStore(scratchFilePath());

    store.append(entry({ id: 'a', submittedAt: 1 }));
    store.append(entry({ id: 'b', submittedAt: 2 }));

    expect(store.list().map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('preserves category and free-text across a fresh store instance pointed at the same file', () => {
    const filePath = scratchFilePath();
    createFeedbackStore(filePath).append(entry({ category: 'bug', message: 'Session key issuance fails.' }));

    const reloaded = createFeedbackStore(filePath).list();
    expect(reloaded).toEqual([entry({ category: 'bug', message: 'Session key issuance fails.' })]);
  });

  it('ignores malformed entries when reading back a corrupted file', () => {
    const filePath = scratchFilePath();
    const store = createFeedbackStore(filePath);
    store.append(entry());

    // Simulate a corrupted/partial entry alongside a valid one.
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown[];
    raw.push({ id: 'bad' });
    writeFileSync(filePath, JSON.stringify(raw), 'utf8');

    expect(store.list()).toEqual([entry()]);
  });

  it('does not create the file until the first append', () => {
    const filePath = scratchFilePath();
    createFeedbackStore(filePath).list();
    expect(existsSync(filePath)).toBe(false);
  });

  it('writes atomically via a temp file that does not linger', () => {
    const filePath = scratchFilePath();
    const store = createFeedbackStore(filePath);
    store.append(entry({ id: randomBytes(4).toString('hex') }));

    expect(existsSync(filePath)).toBe(true);
  });
});
