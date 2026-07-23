import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Keeps lib/actionTrigger.ts's module-level persisted RecipientHistory
// singleton pointed at a scratch file instead of the real repo checkout when
// tests exercise the real evaluateActionRequest wiring end-to-end.
process.env.NOISEBOUND_RECIPIENT_HISTORY_PATH ??= join(
  tmpdir(),
  `noisebound-test-recipient-history-${randomBytes(6).toString('hex')}.json`,
);

afterEach(() => {
  cleanup();
});
