import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'mech-client-ts': path.resolve(__dirname, '../../packages/mech-client-ts'),
      '@jinn/types': path.resolve(__dirname, '../../packages/jinn-types/src'),
    },
  },
  test: {
    globals: true,
    include: [path.resolve(__dirname, '**/*.integration.test.ts')],
    environment: 'node',
    fileParallelism: false,
    sequence: {
      shuffle: false,
      concurrent: false,
    },
  },
});
