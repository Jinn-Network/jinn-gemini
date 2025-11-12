import path from 'node:path';
import { defineConfig, defineProject } from 'vitest/config';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

const sharedResolve = {
  alias: {
    'mech-client-ts': path.resolve(__dirname, './packages/mech-client-ts'),
    '@jinn/types': path.resolve(__dirname, './packages/jinn-types/src'),
    '@codespec': path.resolve(__dirname, './codespec'),
    '@tests-next': path.resolve(__dirname, './tests-next'),
  },
};

const sharedExclude = [
  '**/.conductor/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/.tmp/**',
  '**/temp-build/**',
];

export default defineConfig({
  resolve: sharedResolve,
  test: {
    globals: true,
    exclude: sharedExclude,
    projects: [
      defineProject({
        test: {
          name: 'unit-next',
          include: ['tests-next/unit/**/*.test.ts'],
          environment: 'node',
        },
      }),
      defineProject({
        test: {
          name: 'integration-next',
          include: ['tests-next/integration/**/*.test.ts'],
          environment: 'node',
        },
      }),
      defineProject({
        test: {
          name: 'system-next',
          include: ['tests-next/system/**/*.test.ts'],
          globals: true,
          fileParallelism: false,
          sequence: {
            shuffle: false,
            concurrent: false,
          },
          testTimeout: 240_000,
        },
      }),
    ],
  },
});
