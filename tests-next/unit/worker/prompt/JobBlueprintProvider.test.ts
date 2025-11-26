/**
 * Unit tests for JobBlueprintProvider
 *
 * Per the code spec's fail-fast principle, invalid blueprints cause
 * explicit errors rather than silent fallbacks.
 */

import { describe, it, expect } from 'vitest';
import { JobBlueprintProvider } from '../../../../worker/prompt/providers/assertions/JobBlueprintProvider.js';
import type { BuildContext, IpfsMetadata } from '../../../../worker/types.js';
import { DEFAULT_BLUEPRINT_CONFIG } from '../../../../worker/prompt/config.js';

describe('JobBlueprintProvider', () => {
  const provider = new JobBlueprintProvider();

  const createBuildContext = (metadata: IpfsMetadata): BuildContext => ({
    requestId: 'test-req-123',
    metadata,
    config: DEFAULT_BLUEPRINT_CONFIG,
  });

  describe('enabled', () => {
    it('should always be enabled', () => {
      expect(provider.enabled(DEFAULT_BLUEPRINT_CONFIG)).toBe(true);
    });
  });

  describe('provide - valid blueprints', () => {
    it('should return empty array when no blueprint in metadata', async () => {
      const ctx = createBuildContext({});
      const assertions = await provider.provide(ctx, {});

      expect(assertions).toEqual([]);
    });

    it('should parse and return JSON blueprint assertions', async () => {
      const blueprint = {
        assertions: [
          {
            id: 'JOB-001',
            assertion: 'Complete the data analysis',
            examples: {
              do: ['Analyze all datasets'],
              dont: ['Skip any datasets'],
            },
            commentary: 'Comprehensive analysis required',
          },
        ],
      };

      const ctx = createBuildContext({
        blueprint: JSON.stringify(blueprint),
      });

      const assertions = await provider.provide(ctx, {});

      expect(assertions).toHaveLength(1);
      expect(assertions[0].id).toBe('JOB-001');
      expect(assertions[0].category).toBe('job');
      expect(assertions[0].assertion).toBe('Complete the data analysis');
    });

    it('should handle multiple assertions', async () => {
      const blueprint = {
        assertions: [
          {
            id: 'JOB-001',
            assertion: 'First task',
            examples: { do: ['do1'], dont: ['dont1'] },
            commentary: 'Comment 1',
          },
          {
            id: 'JOB-002',
            assertion: 'Second task',
            examples: { do: ['do2'], dont: ['dont2'] },
            commentary: 'Comment 2',
          },
        ],
      };

      const ctx = createBuildContext({
        blueprint: JSON.stringify(blueprint),
      });

      const assertions = await provider.provide(ctx, {});

      expect(assertions).toHaveLength(2);
      expect(assertions[0].id).toBe('JOB-001');
      expect(assertions[1].id).toBe('JOB-002');
    });

    it('should handle blueprint as object (from internal augmentation)', async () => {
      const blueprint = {
        assertions: [
          {
            id: 'JOB-002',
            assertion: 'Test assertion',
            examples: { do: ['test'], dont: ['skip'] },
            commentary: 'Test',
          },
        ],
      };

      const ctx = createBuildContext({
        blueprint: blueprint as any, // Simulating augmentation that sets object
      });

      const assertions = await provider.provide(ctx, {});

      expect(assertions).toHaveLength(1);
      expect(assertions[0].id).toBe('JOB-002');
    });
  });

  describe('provide - fail fast on invalid blueprints', () => {
    it('should throw on invalid JSON', async () => {
      const ctx = createBuildContext({
        blueprint: '{invalid json',
      });

      await expect(provider.provide(ctx, {})).rejects.toThrow(
        'Invalid blueprint for request test-req-123: Blueprint must be valid JSON'
      );
    });

    it('should throw on JSON without assertions array', async () => {
      const ctx = createBuildContext({
        blueprint: JSON.stringify({ someField: 'value' }),
      });

      await expect(provider.provide(ctx, {})).rejects.toThrow(
        "Invalid blueprint for request test-req-123: Blueprint must have an 'assertions' array"
      );
    });

    it('should throw on markdown blueprint (no fallback)', async () => {
      const markdownBlueprint = `
# Job: Data Analysis

Complete the following tasks:
1. Load the dataset
2. Clean the data
`;

      const ctx = createBuildContext({
        blueprint: markdownBlueprint,
      });

      await expect(provider.provide(ctx, {})).rejects.toThrow(
        'Invalid blueprint for request test-req-123: Blueprint must be valid JSON'
      );
    });

    it('should include blueprint preview in error message', async () => {
      const ctx = createBuildContext({
        blueprint: 'This is not JSON at all',
      });

      await expect(provider.provide(ctx, {})).rejects.toThrow(
        'Got: This is not JSON at all'
      );
    });

    it('should truncate long blueprint in error message', async () => {
      const longInvalidBlueprint = 'A'.repeat(200);

      const ctx = createBuildContext({
        blueprint: longInvalidBlueprint,
      });

      try {
        await provider.provide(ctx, {});
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Got: ' + 'A'.repeat(100) + '...');
        expect(error.message.length).toBeLessThan(300);
      }
    });

    it('should include available keys when assertions missing', async () => {
      const ctx = createBuildContext({
        blueprint: JSON.stringify({ foo: 1, bar: 2, baz: 3 }),
      });

      await expect(provider.provide(ctx, {})).rejects.toThrow(
        'Got keys: foo, bar, baz'
      );
    });
  });
});
