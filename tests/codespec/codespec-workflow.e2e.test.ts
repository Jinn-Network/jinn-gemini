import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  runDetectViolations,
  runObjectiveReview,
  getLedgerStats,
  getAllViolations,
  waitForLedgerUpdate,
} from './helpers/violation-runner.js';

const execAsync = promisify(exec);

/**
 * Check if Claude CLI is available
 */
async function isClaudeAvailable(): Promise<boolean> {
  try {
    await execAsync('claude --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Test modes for different workflow scenarios
 */
const TEST_MODES = [
  {
    name: 'PR review (full directory)',
    target: 'tests/codespec/fixtures/',
    clauses: ['obj1', 'obj2', 'obj3'],
    expectBlock: false, // Fixtures may not trigger real violations
  },
  {
    name: 'baseline audit (specific file)',
    target: 'tests/codespec/fixtures/obj3-violation.ts',
    clauses: ['obj3'],
    expectBlock: false, // Fixture may not trigger real violations
  },
] as const;

describe('CodeSpec Workflow E2E', () => {
  let claudeAvailable = false;

  beforeAll(async () => {
    claudeAvailable = await isClaudeAvailable();
    if (!claudeAvailable) {
      console.warn('\n⚠️  Claude CLI not found - skipping e2e tests');
      console.warn('   Install Claude Code: https://docs.claude.com/en/docs/claude-code/setup\n');
    }
  });

  describe('with Claude CLI', () => {
    describe.each(TEST_MODES)('$name', (mode) => {
      it('should run detection without errors', async () => {
        if (!claudeAvailable) {
          console.log('⊘ Skipping - Claude CLI not available');
          return;
        }

        const result = await runDetectViolations(mode.target, {
          cwd: process.cwd(),
          timeout: 180000, // 3 minutes
        });

        // Should complete (exit code 0 or 1, not crash)
        expect([0, 1]).toContain(result.exitCode);
      }, 200000); // 3+ minute timeout per test

      it('should update ledger after detection', async () => {
        if (!claudeAvailable) {
          console.log('⊘ Skipping - Claude CLI not available');
          return;
        }

        // Run detection
        await runDetectViolations(mode.target, {
          cwd: process.cwd(),
          timeout: 180000,
        });

        // Wait for background ledger update to complete
        const updated = await waitForLedgerUpdate(process.cwd(), 15000);

        // Ledger should exist (even if no violations found)
        expect(updated).toBe(true);

        // Check ledger is readable
        const stats = await getLedgerStats(process.cwd());
        expect(stats).toBeDefined();
      }, 200000);
    });

    describe('Individual Objectives', () => {
      it('should run obj3 review (security)', async () => {
        if (!claudeAvailable) {
          console.log('⊘ Skipping - Claude CLI not available');
          return;
        }

        const result = await runObjectiveReview(
          'obj3',
          'tests/codespec/fixtures/obj3-violation.ts',
          {
            cwd: process.cwd(),
            timeout: 180000,
          }
        );

        // Should complete without crash
        expect([0, 1]).toContain(result.exitCode);
      }, 200000);

      it('should run obj1 review (orthodoxy)', async () => {
        if (!claudeAvailable) {
          console.log('⊘ Skipping - Claude CLI not available');
          return;
        }

        const result = await runObjectiveReview(
          'obj1',
          'tests/codespec/fixtures/obj1-violation.ts',
          {
            cwd: process.cwd(),
            timeout: 180000,
          }
        );

        // Should complete without crash
        expect([0, 1]).toContain(result.exitCode);
      }, 200000);
    });

    describe('Ledger Operations', () => {
      it('should track violations in ledger', async () => {
        if (!claudeAvailable) {
          console.log('⊘ Skipping - Claude CLI not available');
          return;
        }

        // Run detection
        await runDetectViolations('tests/codespec/fixtures/', {
          cwd: process.cwd(),
          timeout: 180000,
        });

        await waitForLedgerUpdate(process.cwd(), 15000);

        const violations = await getAllViolations(process.cwd());

        // All violations should have required fields
        for (const v of violations) {
          expect(v.status).toBeDefined();
          expect(v.fingerprint).toBeTruthy();
          expect(v.id).toMatch(/^V-[a-f0-9]{6}$/);
          expect(v.clauses).toBeDefined();
          expect(v.clauses.length).toBeGreaterThan(0);
        }
      }, 200000);
    });
  });
});
