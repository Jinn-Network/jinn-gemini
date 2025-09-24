import { defineConfig } from 'vitest/config'

export default defineConfig({
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


