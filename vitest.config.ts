import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import path from 'path'

// Load .env.test and merge into process.env so tests have access
const testEnv = loadEnv('test', process.cwd(), '')
Object.assign(process.env, testEnv)

export default defineConfig({
  resolve: {
    alias: {
      'mech-client-ts': path.resolve(__dirname, './packages/mech-client-ts'),
      '@jinn/types': path.resolve(__dirname, './packages/jinn-types/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    env: testEnv,
    include: ['tests/unit/**/*.test.ts'],
    // Run test files sequentially to prevent port conflicts
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true,
      }
    },
    // Ensure tests run in order
    sequence: {
      shuffle: false,
      concurrent: false,
    },
    // Prevent collecting tests from ephemeral Conductor worktrees
    exclude: [
      '**/.conductor/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.tmp/**',
      '**/temp-build/**',
    ],
  },
})
