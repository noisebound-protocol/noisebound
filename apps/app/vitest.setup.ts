import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Keeps lib/feedback/feedbackStore.ts's default path pointed at a scratch
// file instead of the real repo checkout for any test that doesn't pass an
// explicit filePath.
process.env.NOISEBOUND_FEEDBACK_STORE_PATH ??= join(
  tmpdir(),
  `noisebound-test-feedback-${randomBytes(6).toString('hex')}.json`,
);

afterEach(() => {
  cleanup();
});
