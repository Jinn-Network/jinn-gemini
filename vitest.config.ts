import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      'mech-client-ts': path.resolve(__dirname, './packages/mech-client-ts'),
    },
  },
  test: {
    globals: true,
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
