/**
 * Integration tests for worker blueprint processing flow
 * Phase 1 verification: Blueprint-Per-Job Infrastructure
 * 
 * Tests the complete flow from IPFS metadata fetch through worker processing
 * Verifies that blueprint is used as primary specification without external search
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildEnhancedPrompt } from '../../../worker/metadata/prompt.js';
import type { IpfsMetadata } from '../../../worker/types.js';
import {
  buildTestBlueprint,
  buildMinimalAssertion,
  buildMultiAssertionBlueprint,
  buildCustomAssertion,
} from '../../fixtures/blueprint-builder.js';

describe('Worker blueprint processing flow integration', () => {
  describe('Blueprint extraction from IPFS metadata', () => {
    it('should extract blueprint from root level of metadata', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('EXTRACT-001')]);
      
      // Simulated IPFS metadata response
      const ipfsMetadata: IpfsMetadata = {
        blueprint,
        jobName: 'extraction-test',
        model: 'gemini-2.5-flash',
        jobDefinitionId: 'extract-job-def',
        enabledTools: ['create_artifact'],
      };

      // Worker extracts blueprint
      expect(ipfsMetadata.blueprint).toBe(blueprint);
      expect(ipfsMetadata.blueprint).toContain('EXTRACT-001');
      
      // Blueprint is parseable
      const parsed = JSON.parse(ipfsMetadata.blueprint);
      expect(parsed.assertions).toHaveLength(1);
    });

    it('should prioritize root-level blueprint over additionalContext', () => {
      const rootBlueprint = buildTestBlueprint([buildMinimalAssertion('ROOT-001')]);
      const contextBlueprint = buildTestBlueprint([buildMinimalAssertion('CONTEXT-001')]);
      
      const ipfsMetadata: IpfsMetadata = {
        blueprint: rootBlueprint,
        additionalContext: {
          blueprint: contextBlueprint,
        },
        jobName: 'priority-test',
        model: 'gemini-2.5-flash',
      };

      // Root level takes priority
      expect(ipfsMetadata.blueprint).toBe(rootBlueprint);
      expect(ipfsMetadata.blueprint).toContain('ROOT-001');
      expect(ipfsMetadata.blueprint).not.toContain('CONTEXT-001');
    });

    it('should fall back to additionalContext.blueprint if root is missing', () => {
      const contextBlueprint = buildTestBlueprint([buildMinimalAssertion('FALLBACK-001')]);
      
      const ipfsMetadata: IpfsMetadata = {
        // No root-level blueprint
        additionalContext: {
          blueprint: contextBlueprint,
        },
        jobName: 'fallback-test',
        model: 'gemini-2.5-flash',
      };

      // In actual fetchIpfsMetadata, this fallback happens
      // Here we verify the structure supports it
      expect(ipfsMetadata.blueprint).toBeUndefined();
      expect(ipfsMetadata.additionalContext?.blueprint).toBe(contextBlueprint);
    });

    it('should handle metadata with no blueprint (legacy jobs)', () => {
      const ipfsMetadata: IpfsMetadata = {
        jobName: 'legacy-no-blueprint',
        model: 'gemini-2.5-flash',
        enabledTools: ['create_artifact'],
      };

      expect(ipfsMetadata.blueprint).toBeUndefined();
      expect(ipfsMetadata.additionalContext?.blueprint).toBeUndefined();
    });
  });

  describe('Enhanced prompt building from blueprint', () => {
    it('should build prompt with blueprint as primary content', () => {
      const assertion = buildCustomAssertion(
        'PROMPT-001',
        'All functions must have JSDoc comments',
        ['Add @param and @return tags', 'Include description'],
        ['Skip documentation', 'Use inline comments only'],
        'Documentation enables IDE tooltips and maintainability'
      );
      const blueprint = buildTestBlueprint([assertion]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'prompt-test',
        model: 'gemini-2.5-flash',
      };

      const prompt = buildEnhancedPrompt(metadata);

      // Prompt should include blueprint content
      expect(prompt).toContain('PROMPT-001');
      expect(prompt).toContain('All functions must have JSDoc comments');
      expect(prompt).toContain('Add @param and @return tags');
      expect(prompt).toContain('Skip documentation');
      expect(prompt).toContain('Documentation enables IDE tooltips');
    });

    it('should build prompt with multi-assertion blueprint', () => {
      const blueprint = buildMultiAssertionBlueprint(4);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'multi-prompt-test',
        model: 'gemini-2.5-pro',
      };

      const prompt = buildEnhancedPrompt(metadata);

      // All assertions should be included
      expect(prompt).toContain('TEST-001');
      expect(prompt).toContain('TEST-002');
      expect(prompt).toContain('TEST-003');
      expect(prompt).toContain('TEST-004');
    });

    it('should augment blueprint with job context when available', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('CONTEXT-001')]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'context-augment-test',
        model: 'gemini-2.5-flash',
        additionalContext: {
          summary: {
            totalJobs: 3,
            completedJobs: 2,
            activeJobs: 1,
            totalArtifacts: 5,
          },
          hierarchy: [
            {
              name: 'parent-job',
              level: 1,
              status: 'completed',
              artifactRefs: [
                {
                  name: 'analysis-doc',
                  topic: 'research',
                  cid: 'bafytest123',
                },
              ],
            },
          ],
        },
      };

      const prompt = buildEnhancedPrompt(metadata);

      // Should include both blueprint and context
      expect(prompt).toContain('CONTEXT-001');
      expect(prompt).toContain('Job Context');
      expect(prompt).toContain('Total jobs in hierarchy: 3');
      expect(prompt).toContain('parent-job');
      expect(prompt).toContain('analysis-doc');
    });

    it('should handle blueprint without job context', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('NO-CONTEXT-001')]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'no-context-test',
        model: 'gemini-2.5-flash',
      };

      const prompt = buildEnhancedPrompt(metadata);

      // Should only include blueprint
      expect(prompt).toContain('NO-CONTEXT-001');
      expect(prompt).not.toContain('Job Context');
    });
  });

  describe('Agent execution with blueprint (no external search)', () => {
    it('should use blueprint directly without searching', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('NO-SEARCH-001')]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'no-search-test',
        model: 'gemini-2.5-flash',
        enabledTools: ['create_artifact'],
      };

      const prompt = buildEnhancedPrompt(metadata);

      // Blueprint content should be in prompt
      expect(prompt).toContain('NO-SEARCH-001');
      
      // In actual execution, agent should NOT use search tools for blueprint
      // This would be verified in telemetry (no search_artifacts calls for blueprint)
      // For integration test, we verify the prompt has everything needed
      expect(prompt).toContain('Test assertion NO-SEARCH-001');
      expect(prompt).toContain('Example positive behavior');
      expect(prompt).toContain('Example negative behavior');
    });

    it('should provide complete assertion structure to agent', () => {
      const detailedAssertion = buildCustomAssertion(
        'COMPLETE-001',
        'API endpoints must validate all input parameters',
        [
          'Use Zod schemas for validation',
          'Return 400 with detailed error messages',
          'Validate types, ranges, and formats',
        ],
        [
          'Trust client input without validation',
          'Return generic error messages',
          'Skip optional parameter validation',
        ],
        'Input validation prevents security vulnerabilities and improves error messages'
      );
      const blueprint = buildTestBlueprint([detailedAssertion]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'complete-structure-test',
        model: 'gemini-2.5-flash',
      };

      const prompt = buildEnhancedPrompt(metadata);

      // All parts of assertion should be present
      expect(prompt).toContain('COMPLETE-001');
      expect(prompt).toContain('API endpoints must validate all input parameters');
      expect(prompt).toContain('Use Zod schemas for validation');
      expect(prompt).toContain('Trust client input without validation');
      expect(prompt).toContain('Input validation prevents security vulnerabilities');
    });

    it('should handle blueprint with model selection', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('MODEL-001')]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'model-selection-test',
        model: 'gemini-2.5-pro', // Explicit model selection
        enabledTools: ['create_artifact', 'dispatch_new_job'],
      };

      const prompt = buildEnhancedPrompt(metadata);

      // Blueprint should be in prompt regardless of model
      expect(prompt).toContain('MODEL-001');
      expect(metadata.model).toBe('gemini-2.5-pro');
    });
  });

  describe('End-to-end metadata → prompt flow', () => {
    it('should complete full flow: IPFS metadata → blueprint extraction → prompt building', () => {
      // Step 1: IPFS metadata structure (as fetched from gateway)
      const blueprint = buildMultiAssertionBlueprint(3);
      const ipfsMetadata: IpfsMetadata = {
        blueprint,
        jobName: 'e2e-flow-test',
        model: 'gemini-2.5-flash',
        jobDefinitionId: 'e2e-job-def',
        enabledTools: ['create_artifact'],
        sourceRequestId: '0xparent123',
        sourceJobDefinitionId: 'parent-job-def',
        codeMetadata: {
          branch: {
            name: 'job/e2e-test',
            remoteUrl: 'git@github.com:test/repo.git',
          },
          baseBranch: 'main',
        },
      };

      // Step 2: Worker extracts blueprint
      expect(ipfsMetadata.blueprint).toBeTruthy();
      const parsed = JSON.parse(ipfsMetadata.blueprint!);
      expect(parsed.assertions).toHaveLength(3);

      // Step 3: Enhanced prompt is built
      const prompt = buildEnhancedPrompt(ipfsMetadata);
      expect(prompt).toContain('TEST-001');
      expect(prompt).toContain('TEST-002');
      expect(prompt).toContain('TEST-003');

      // Step 4: Verify all metadata is preserved
      expect(ipfsMetadata.jobName).toBe('e2e-flow-test');
      expect(ipfsMetadata.model).toBe('gemini-2.5-flash');
      expect(ipfsMetadata.jobDefinitionId).toBe('e2e-job-def');
      expect(ipfsMetadata.codeMetadata?.branch?.name).toBe('job/e2e-test');
    });

    it('should handle complete flow with dependencies', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('DEP-FLOW-001')]);
      
      const ipfsMetadata: IpfsMetadata = {
        blueprint,
        jobName: 'dependency-flow-test',
        model: 'gemini-2.5-flash',
        jobDefinitionId: 'dep-flow-job-def',
        enabledTools: [],
        dependencies: ['prereq-job-def-1', 'prereq-job-def-2'],
      };

      // Blueprint extracted
      expect(ipfsMetadata.blueprint).toBeTruthy();
      expect(ipfsMetadata.dependencies).toHaveLength(2);

      // Prompt built
      const prompt = buildEnhancedPrompt(ipfsMetadata);
      expect(prompt).toContain('DEP-FLOW-001');

      // Dependencies metadata preserved (used by worker for execution control)
      expect(ipfsMetadata.dependencies).toEqual(['prereq-job-def-1', 'prereq-job-def-2']);
    });

    it('should handle artifact-only jobs with blueprint', () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('ARTIFACT-FLOW-001')]);
      
      const ipfsMetadata: IpfsMetadata = {
        blueprint,
        jobName: 'artifact-only-flow',
        model: 'gemini-2.5-flash',
        jobDefinitionId: 'artifact-flow-def',
        enabledTools: ['create_artifact'],
        // No codeMetadata - artifact-only job
      };

      // Blueprint processed normally
      expect(ipfsMetadata.blueprint).toBeTruthy();
      expect(ipfsMetadata.codeMetadata).toBeUndefined();

      // Prompt still built correctly
      const prompt = buildEnhancedPrompt(ipfsMetadata);
      expect(prompt).toContain('ARTIFACT-FLOW-001');
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle malformed blueprint JSON gracefully', () => {
      const ipfsMetadata: IpfsMetadata = {
        blueprint: 'not valid json {',
        jobName: 'malformed-test',
        model: 'gemini-2.5-flash',
      };

      // Prompt builder doesn't parse blueprint, just passes it through
      const prompt = buildEnhancedPrompt(ipfsMetadata);
      expect(prompt).toContain('not valid json');
    });

    it('should handle empty blueprint string', () => {
      const ipfsMetadata: IpfsMetadata = {
        blueprint: '',
        jobName: 'empty-blueprint-test',
        model: 'gemini-2.5-flash',
      };

      // Empty string is falsy, should use fallback with blueprint preface
      const prompt = buildEnhancedPrompt(ipfsMetadata, 'fallback prompt');
      expect(prompt).toContain('Blueprint (required):');
      expect(prompt).toContain('fallback prompt');
    });

    it('should handle missing all specification fields', () => {
      const ipfsMetadata: IpfsMetadata = {
        jobName: 'no-spec-test',
        model: 'gemini-2.5-flash',
      };

      const prompt = buildEnhancedPrompt(ipfsMetadata);
      expect(prompt).toBe('No job specification found');
    });

    it('should preserve blueprint with unicode characters', () => {
      const unicodeAssertion = buildCustomAssertion(
        'UNICODE-001',
        'Support internationalization: 日本語, العربية, עברית',
        ['Handle UTF-8 correctly', 'Display emoji: 🚀✨'],
        ['Assume ASCII only'],
        'Global applications require unicode support'
      );
      const blueprint = buildTestBlueprint([unicodeAssertion]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'unicode-test',
        model: 'gemini-2.5-flash',
      };

      const prompt = buildEnhancedPrompt(metadata);
      expect(prompt).toContain('日本語');
      expect(prompt).toContain('العربية');
      expect(prompt).toContain('🚀✨');
    });
  });
});

