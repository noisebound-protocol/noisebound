import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // Safe local-dev default so tests exercising getActiveNetwork() don't
    // need to set this themselves; tests for the missing/invalid case
    // override or delete it explicitly.
    env: {
      NEXT_PUBLIC_NOISEBOUND_NETWORK: 'base-sepolia',
    },
  },
});
