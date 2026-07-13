import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    env: {
      NEXT_PUBLIC_NOISEBOUND_NETWORK: 'base-sepolia',
    },
  },
});
