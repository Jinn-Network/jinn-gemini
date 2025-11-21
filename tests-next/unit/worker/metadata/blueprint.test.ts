/**
 * Unit tests for blueprint metadata parsing and prompt building
 * Phase 1 verification: Blueprint-Per-Job Infrastructure
 */

import { describe, it, expect } from 'vitest';
import { buildEnhancedPrompt } from '../../../../worker/metadata/prompt.js';
import type { IpfsMetadata } from '../../../../worker/types.js';
import {
  buildTestBlueprint,
  buildMinimalAssertion,
  buildMultiAssertionBlueprint,
} from '../../../fixtures/blueprint-builder.js';

describe('Blueprint metadata parsing', () => {
  describe('Blueprint extraction from IPFS metadata', () => {
    it('should extract blueprint from root level', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('ROOT-001')]);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'test-job',
        model: 'gemini-2.5-flash',
      };

      expect(metadata.blueprint).toBe(blueprint);
      expect(metadata.blueprint).toContain('ROOT-001');
    });

    it('should handle metadata with blueprint at root level (new architecture)', () => {
      const blueprint = buildMultiAssertionBlueprint(3);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'new-architecture-job',
        jobDefinitionId: 'test-job-def-id',
        enabledTools: ['create_artifact'],
      };

      expect(metadata.blueprint).toBeTruthy();
      expect(typeof metadata.blueprint).toBe('string');
      
      // Should be valid JSON
      const parsed = JSON.parse(metadata.blueprint!);
      expect(parsed.assertions).toHaveLength(3);
    });

    it('should handle metadata with blueprint in additionalContext (backward compatibility)', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('COMPAT-001')]);
      const metadata: IpfsMetadata = {
        additionalContext: {
          blueprint,
        },
        jobName: 'backward-compatible-job',
      };

      // In actual implementation, fetchIpfsMetadata handles this fallback
      // Here we test that the structure is valid
      expect(metadata.additionalContext.blueprint).toBe(blueprint);
    });

    it('should handle metadata without blueprint (legacy jobs)', () => {
      const metadata: IpfsMetadata = {
        jobName: 'legacy-job-no-blueprint',
        model: 'gemini-2.5-flash',
      };

      expect(metadata.blueprint).toBeUndefined();
    });
  });

  describe('Enhanced prompt building with blueprint', () => {
    it('should build prompt from blueprint when present', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('PROMPT-001')]);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'prompt-test',
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('PROMPT-001');
      expect(prompt).toContain('Test assertion PROMPT-001');
    });

    it('should use fallback prompt when no blueprint exists', () => {
      const metadata: IpfsMetadata = {
        jobName: 'fallback-test',
      };

      const fallback = 'This is a fallback prompt';
      const prompt = buildEnhancedPrompt(metadata, fallback);

      expect(prompt).toContain('Blueprint (required):');
      expect(prompt).toContain(fallback);
    });

    it('should return "No job specification found" when neither blueprint nor fallback exists', () => {
      const metadata: IpfsMetadata = {
        jobName: 'no-spec-test',
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toBe('No job specification found');
    });

    it('should build prompt with multi-assertion blueprint', () => {
      const blueprint = buildMultiAssertionBlueprint(5);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'multi-assertion-prompt-test',
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('TEST-001');
      expect(prompt).toContain('TEST-002');
      expect(prompt).toContain('TEST-003');
      expect(prompt).toContain('TEST-004');
      expect(prompt).toContain('TEST-005');
    });

    it('should include blueprint content as primary specification', () => {
      const assertion = {
        id: 'PRIMARY-001',
        assertion: 'This is the primary job specification',
        examples: {
          do: ['Follow this blueprint'],
          dont: ['Search for external blueprints'],
        },
        commentary: 'Blueprint is embedded in metadata',
      };
      const blueprint = buildTestBlueprint([assertion]);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'primary-spec-test',
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('PRIMARY-001');
      expect(prompt).toContain('This is the primary job specification');
      expect(prompt).toContain('Follow this blueprint');
      expect(prompt).toContain('Search for external blueprints');
    });
  });

  describe('Prompt enhancement with job context', () => {
    it('should include job hierarchy context when additionalContext is present', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('CONTEXT-001')]);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'context-test',
        additionalContext: {
          summary: {
            totalJobs: 5,
            completedJobs: 3,
            activeJobs: 2,
            totalArtifacts: 7,
          },
          hierarchy: [
            {
              name: 'parent-job',
              level: 1,
              status: 'completed',
            },
            {
              name: 'sibling-job',
              level: 2,
              status: 'active',
            },
          ],
        },
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('Job Context');
      expect(prompt).toContain('Total jobs in hierarchy: 5');
      expect(prompt).toContain('Completed jobs: 3');
      expect(prompt).toContain('parent-job');
      expect(prompt).toContain('sibling-job');
    });

    it('should include artifact references when present in context', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('ARTIFACT-001')]);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'artifact-context-test',
        additionalContext: {
          summary: {
            totalJobs: 2,
            completedJobs: 1,
            activeJobs: 1,
            totalArtifacts: 2,
          },
          hierarchy: [
            {
              name: 'completed-job',
              level: 1,
              status: 'completed',
              artifactRefs: [
                {
                  name: 'analysis-report',
                  topic: 'research',
                  cid: 'bafytest123',
                },
              ],
            },
          ],
        },
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('analysis-report (research)');
      expect(prompt).toContain('CID: bafytest123');
    });

    it('should gracefully handle context without hierarchy', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('NO-HIERARCHY-001')]);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'no-hierarchy-test',
        additionalContext: {
          summary: {
            totalJobs: 1,
            completedJobs: 0,
            activeJobs: 1,
            totalArtifacts: 0,
          },
        },
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('Job Context');
      expect(prompt).toContain('No related jobs found');
      expect(prompt).toContain('No artifacts available');
    });
  });

  describe('Blueprint priority over legacy prompt', () => {
    it('should prefer blueprint over legacy prompt field', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('PRIORITY-001')]);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'priority-test',
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('PRIORITY-001');
      expect(prompt).not.toContain('legacy');
    });

    it('should use blueprint as string without modification', () => {
      const blueprint = buildMultiAssertionBlueprint(2);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'unmodified-test',
      };

      const prompt = buildEnhancedPrompt(metadata);

      // Blueprint JSON should be included as-is (possibly with context prepended)
      expect(prompt).toContain('TEST-001');
      expect(prompt).toContain('TEST-002');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty blueprint string', () => {
      const metadata: IpfsMetadata = {
        blueprint: '',
        jobName: 'empty-blueprint',
      };

      const prompt = buildEnhancedPrompt(metadata, 'fallback');

      // Empty string is falsy, should use fallback with blueprint preface
      expect(prompt).toContain('Blueprint (required):');
      expect(prompt).toContain('fallback');
    });

    it('should handle blueprint with special JSON characters', () => {
      const specialAssertion = {
        id: 'SPECIAL-001',
        assertion: 'Handle JSON special chars: "quotes", \\backslash, /slash',
        examples: {
          do: ['Escape: \\"text\\"', 'Preserve: \\n newlines'],
          dont: ['Break JSON', 'Lose escapes'],
        },
        commentary: 'Special characters must be properly escaped',
      };
      const blueprint = buildTestBlueprint([specialAssertion]);
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'special-chars-test',
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('SPECIAL-001');
      expect(prompt).toContain('quotes');
      expect(prompt).toContain('backslash');
    });

    it('should handle very large blueprints', () => {
      const largeBlueprint = buildMultiAssertionBlueprint(50);
      const metadata: IpfsMetadata = {
        blueprint: largeBlueprint,
        jobName: 'large-blueprint-test',
      };

      const prompt = buildEnhancedPrompt(metadata);

      expect(prompt).toContain('TEST-001');
      expect(prompt).toContain('TEST-050');
      expect(prompt.length).toBeGreaterThan(1000);
    });
  });
});
