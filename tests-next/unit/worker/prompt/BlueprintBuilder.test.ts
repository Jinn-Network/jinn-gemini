/**
 * Unit tests for BlueprintBuilder
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BlueprintBuilder, createBlueprintBuilder } from '../../../../worker/prompt/BlueprintBuilder.js';
import type {
  IpfsMetadata,
  RecognitionPhaseResult,
  BlueprintAssertion,
  BlueprintContext,
  ContextProvider,
  AssertionProvider,
  BuildContext,
  BlueprintBuilderConfig,
} from '../../../../worker/types.js';

describe('BlueprintBuilder', () => {
  describe('createBlueprintBuilder', () => {
    it('should create a builder with all default providers registered', () => {
      const builder = createBlueprintBuilder();
      expect(builder).toBeInstanceOf(BlueprintBuilder);

      const config = builder.getConfig();
      expect(config.enableSystemBlueprint).toBe(true);
      expect(config.enableContextAssertions).toBe(true);
      expect(config.enableRecognitionLearnings).toBe(true);
      expect(config.enableJobContext).toBe(true);
      expect(config.enableProgressCheckpoint).toBe(true);
    });

    it('should allow config overrides', () => {
      const builder = createBlueprintBuilder({
        enableSystemBlueprint: false,
        debug: true,
      });

      const config = builder.getConfig();
      expect(config.enableSystemBlueprint).toBe(false);
      expect(config.debug).toBe(true);
    });
  });

  describe('build', () => {
    let builder: BlueprintBuilder;
    let mockMetadata: IpfsMetadata;

    beforeEach(() => {
      builder = new BlueprintBuilder({
        enableSystemBlueprint: false, // Disable to avoid file dependencies
        enableContextAssertions: false,
        enableRecognitionLearnings: false,
        enableJobContext: false,
        enableProgressCheckpoint: false,
      });

      mockMetadata = {
        jobName: 'test-job',
        jobDefinitionId: 'test-def-123',
      };
    });

    it('should build an empty blueprint with no providers', async () => {
      const { blueprint, buildTime } = await builder.build(
        'req-123',
        mockMetadata
      );

      expect(blueprint.assertions).toEqual([]);
      expect(blueprint.context).toEqual({});
      expect(blueprint.metadata.requestId).toBe('req-123');
      expect(blueprint.metadata.providers).toEqual([]);
      expect(buildTime).toBeGreaterThanOrEqual(0);
    });

    it('should run context providers first', async () => {
      const executionOrder: string[] = [];

      const mockContextProvider: ContextProvider = {
        name: 'test-context',
        enabled: () => true,
        provide: async () => {
          executionOrder.push('context');
          return { hierarchy: { totalJobs: 5, completedJobs: 3, activeJobs: 2, children: [] } };
        },
      };

      const mockAssertionProvider: AssertionProvider = {
        name: 'test-assertion',
        category: 'job',
        enabled: () => true,
        provide: async (ctx, builtContext) => {
          executionOrder.push('assertion');
          // Should have access to context
          expect(builtContext.hierarchy).toBeDefined();
          return [];
        },
      };

      builder.registerContextProvider(mockContextProvider);
      builder.registerAssertionProvider(mockAssertionProvider);

      await builder.build('req-123', mockMetadata);

      expect(executionOrder).toEqual(['context', 'assertion']);
    });

    it('should pass built context to assertion providers', async () => {
      const mockContextProvider: ContextProvider = {
        name: 'test-context',
        enabled: () => true,
        provide: async () => ({
          hierarchy: { totalJobs: 5, completedJobs: 3, activeJobs: 2, children: [] },
        }),
      };

      const mockAssertionProvider: AssertionProvider = {
        name: 'test-assertion',
        category: 'job',
        enabled: () => true,
        provide: async (_ctx, builtContext) => {
          expect(builtContext.hierarchy?.totalJobs).toBe(5);
          return [
            {
              id: 'TEST-001',
              category: 'job',
              assertion: `There are ${builtContext.hierarchy?.totalJobs} jobs in the hierarchy`,
              examples: { do: ['test'], dont: ['test'] },
              commentary: 'Test assertion',
            },
          ];
        },
      };

      builder.registerContextProvider(mockContextProvider);
      builder.registerAssertionProvider(mockAssertionProvider);

      const { blueprint } = await builder.build('req-123', mockMetadata);

      expect(blueprint.context.hierarchy?.totalJobs).toBe(5);
      expect(blueprint.assertions).toHaveLength(1);
      expect(blueprint.assertions[0].assertion).toContain('5 jobs');
    });

    it('should skip disabled providers', async () => {
      const mockProvider: ContextProvider = {
        name: 'disabled-provider',
        enabled: () => false,
        provide: async () => ({ hierarchy: { totalJobs: 5, completedJobs: 3, activeJobs: 2, children: [] } }),
      };

      builder.registerContextProvider(mockProvider);

      const { blueprint } = await builder.build('req-123', mockMetadata);

      expect(blueprint.context).toEqual({});
      expect(blueprint.metadata.providers).not.toContain('disabled-provider');
    });

    it('should handle provider errors gracefully', async () => {
      const mockProvider: ContextProvider = {
        name: 'error-provider',
        enabled: () => true,
        provide: async () => {
          throw new Error('Test error');
        },
      };

      builder.registerContextProvider(mockProvider);

      const { blueprint } = await builder.build('req-123', mockMetadata);

      // Should continue despite error
      expect(blueprint.context).toEqual({});
    });
  });

  describe('buildPrompt', () => {
    it('should return JSON string', async () => {
      const builder = new BlueprintBuilder({
        enableSystemBlueprint: false,
        enableContextAssertions: false,
        enableRecognitionLearnings: false,
        enableJobContext: false,
        enableProgressCheckpoint: false,
      });

      const prompt = await builder.buildPrompt('req-123', {});

      expect(typeof prompt).toBe('string');
      const parsed = JSON.parse(prompt);
      expect(parsed.assertions).toBeDefined();
      expect(parsed.context).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const builder = new BlueprintBuilder();
      expect(builder.getConfig().debug).toBe(false);

      builder.updateConfig({ debug: true });
      expect(builder.getConfig().debug).toBe(true);
    });

    it('should merge with existing config', () => {
      const builder = new BlueprintBuilder({ enableSystemBlueprint: false });
      expect(builder.getConfig().enableSystemBlueprint).toBe(false);
      expect(builder.getConfig().enableJobContext).toBe(true);

      builder.updateConfig({ enableJobContext: false });
      expect(builder.getConfig().enableSystemBlueprint).toBe(false);
      expect(builder.getConfig().enableJobContext).toBe(false);
    });
  });
});
