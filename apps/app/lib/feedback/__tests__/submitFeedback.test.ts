import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { submitFeedback } from '../submitFeedback';

let scratchDir: string;
let originalPath: string | undefined;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'noisebound-feedback-action-'));
  originalPath = process.env.NOISEBOUND_FEEDBACK_STORE_PATH;
  process.env.NOISEBOUND_FEEDBACK_STORE_PATH = join(scratchDir, 'feedback.json');
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
  if (originalPath === undefined) {
    delete process.env.NOISEBOUND_FEEDBACK_STORE_PATH;
  } else {
    process.env.NOISEBOUND_FEEDBACK_STORE_PATH = originalPath;
  }
});

describe('submitFeedback', () => {
  it('rejects an empty (or whitespace-only) message', () => {
    expect(() => submitFeedback({ message: '   ', category: null })).toThrow(
      'Feedback message cannot be empty.',
    );
  });

  it('rejects a message over the length limit', () => {
    expect(() => submitFeedback({ message: 'a'.repeat(4001), category: null })).toThrow(
      'Feedback message must be 4000 characters or fewer.',
    );
  });

  it('trims the message, stamps an id and timestamp, and persists it to disk', () => {
    const before = Date.now();
    const entry = submitFeedback({ message: '  fix the thing  ', category: 'bug' });
    const after = Date.now();

    expect(entry.message).toBe('fix the thing');
    expect(entry.category).toBe('bug');
    expect(entry.id).toBeTruthy();
    expect(entry.submittedAt).toBeGreaterThanOrEqual(before);
    expect(entry.submittedAt).toBeLessThanOrEqual(after);

    const filePath = process.env.NOISEBOUND_FEEDBACK_STORE_PATH as string;
    const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(persisted).toEqual([entry]);
  });

  it('assigns distinct ids to consecutive submissions', () => {
    const first = submitFeedback({ message: 'one', category: null });
    const second = submitFeedback({ message: 'two', category: null });
    expect(first.id).not.toBe(second.id);
  });
});
