/**
 * Unit tests for ChildWorkAssertionProvider
 */

import { describe, it, expect } from 'vitest';
import { ChildWorkAssertionProvider } from '../../../../worker/prompt/providers/assertions/ChildWorkAssertionProvider.js';
import type { BuildContext, BlueprintContext, IpfsMetadata } from '../../../../worker/types.js';
import { DEFAULT_BLUEPRINT_CONFIG } from '../../../../worker/prompt/config.js';

describe('ChildWorkAssertionProvider', () => {
  const provider = new ChildWorkAssertionProvider();

  const createBuildContext = (metadata: IpfsMetadata = {}): BuildContext => ({
    requestId: 'test-req-123',
    metadata,
    config: DEFAULT_BLUEPRINT_CONFIG,
  });

  describe('enabled', () => {
    it('should be enabled when context assertions are enabled', () => {
      expect(provider.enabled(DEFAULT_BLUEPRINT_CONFIG)).toBe(true);
    });

    it('should be disabled when context assertions are disabled', () => {
      expect(
        provider.enabled({ ...DEFAULT_BLUEPRINT_CONFIG, enableContextAssertions: false })
      ).toBe(false);
    });
  });

  describe('provide', () => {
    it('should return empty array when no hierarchy context', async () => {
      const ctx = createBuildContext();
      const builtContext: BlueprintContext = {};

      const assertions = await provider.provide(ctx, builtContext);

      expect(assertions).toEqual([]);
    });

    it('should return empty array when no children', async () => {
      const ctx = createBuildContext();
      const builtContext: BlueprintContext = {
        hierarchy: {
          totalJobs: 1,
          completedJobs: 0,
          activeJobs: 1,
          children: [],
        },
      };

      const assertions = await provider.provide(ctx, builtContext);

      expect(assertions).toEqual([]);
    });

    it('should create assertions for completed children', async () => {
      const ctx = createBuildContext();
      const builtContext: BlueprintContext = {
        hierarchy: {
          totalJobs: 3,
          completedJobs: 2,
          activeJobs: 1,
          children: [
            {
              requestId: 'child-1',
              jobName: 'data-fetch',
              status: 'COMPLETED',
              summary: 'Fetched 100 Ethereum protocol records from the blockchain',
            },
            {
              requestId: 'child-2',
              jobName: 'data-processing',
              status: 'COMPLETED',
              summary: 'Processed and cleaned all records',
            },
            {
              requestId: 'child-3',
              jobName: 'active-job',
              status: 'ACTIVE',
              summary: 'Still running',
            },
          ],
        },
      };

      const assertions = await provider.provide(ctx, builtContext);

      // Should have summary + 2 child assertions (only completed)
      expect(assertions).toHaveLength(3);

      // Check summary assertion
      expect(assertions[0].id).toBe('CTX-CHILDREN-SUMMARY');
      expect(assertions[0].category).toBe('context');
      expect(assertions[0].assertion).toContain('2 completed child job(s)');
      expect(assertions[0].assertion).toContain('data-fetch');
      expect(assertions[0].assertion).toContain('data-processing');

      // Check first child assertion
      expect(assertions[1].id).toBe('CTX-CHILD-001');
      expect(assertions[1].category).toBe('context');
      expect(assertions[1].assertion).toContain('data-fetch');
      expect(assertions[1].assertion).toContain('Fetched 100 Ethereum protocol records');
      expect(assertions[1].examples.do[0]).toContain('data-fetch');

      // Check second child assertion
      expect(assertions[2].id).toBe('CTX-CHILD-002');
      expect(assertions[2].assertion).toContain('data-processing');
      expect(assertions[2].assertion).toContain('Processed and cleaned all records');
    });

    it('should handle children without job names', async () => {
      const ctx = createBuildContext();
      const builtContext: BlueprintContext = {
        hierarchy: {
          totalJobs: 1,
          completedJobs: 1,
          activeJobs: 0,
          children: [
            {
              requestId: 'abcd1234efgh5678',
              status: 'COMPLETED',
              summary: 'Completed successfully',
            },
          ],
        },
      };

      const assertions = await provider.provide(ctx, builtContext);

      expect(assertions).toHaveLength(2); // summary + 1 child
      expect(assertions[1].assertion).toContain('job abcd1234'); // Uses request ID prefix
    });

    it('should truncate long summaries', async () => {
      const ctx = createBuildContext();
      const longSummary = 'A'.repeat(500);
      const builtContext: BlueprintContext = {
        hierarchy: {
          totalJobs: 1,
          completedJobs: 1,
          activeJobs: 0,
          children: [
            {
              requestId: 'child-1',
              jobName: 'long-job',
              status: 'COMPLETED',
              summary: longSummary,
            },
          ],
        },
      };

      const assertions = await provider.provide(ctx, builtContext);

      expect(assertions[1].assertion.length).toBeLessThan(350); // 300 + prefix
      expect(assertions[1].assertion).toContain('...');
    });

    it('should handle children without summaries', async () => {
      const ctx = createBuildContext();
      const builtContext: BlueprintContext = {
        hierarchy: {
          totalJobs: 1,
          completedJobs: 1,
          activeJobs: 0,
          children: [
            {
              requestId: 'child-1',
              jobName: 'test-job',
              status: 'COMPLETED',
            },
          ],
        },
      };

      const assertions = await provider.provide(ctx, builtContext);

      expect(assertions).toHaveLength(2);
      expect(assertions[1].assertion).toContain('No summary available');
    });

    it('should only process completed children', async () => {
      const ctx = createBuildContext();
      const builtContext: BlueprintContext = {
        hierarchy: {
          totalJobs: 3,
          completedJobs: 1,
          activeJobs: 1,
          children: [
            {
              requestId: 'child-1',
              jobName: 'completed',
              status: 'COMPLETED',
              summary: 'Done',
            },
            {
              requestId: 'child-2',
              jobName: 'active',
              status: 'ACTIVE',
              summary: 'Running',
            },
            {
              requestId: 'child-3',
              jobName: 'failed',
              status: 'FAILED',
              summary: 'Failed',
            },
          ],
        },
      };

      const assertions = await provider.provide(ctx, builtContext);

      // Only 1 completed child + summary = 2 assertions
      expect(assertions).toHaveLength(2);
      expect(assertions[0].assertion).toContain('1 completed child job');
      expect(assertions[1].assertion).toContain('completed');
      expect(assertions[1].assertion).not.toContain('active');
      expect(assertions[1].assertion).not.toContain('failed');
    });
  });
});
