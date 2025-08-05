import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests can be slower, so we'll increase the timeout.
    testTimeout: 30000,
    // We only want to run files that end in .integration.test.ts
    include: ['**/*.integration.test.ts'],
  },
});
