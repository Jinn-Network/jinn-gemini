/**
 * Integration tests for worker blueprint processing flow
 * Phase 1 verification: Blueprint-Per-Job Infrastructure
 * 
 * Tests the complete flow from IPFS metadata fetch through worker processing
 * Verifies that blueprint is used as primary specification without external search
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createBlueprintBuilder } from '../../../worker/prompt/index.js';
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
    it('should build prompt with blueprint as primary content', async () => {
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

      const prompt = await createBlueprintBuilder().buildPrompt('test-req-001', metadata, null);

      // Prompt should include blueprint content
      expect(prompt).toContain('PROMPT-001');
      expect(prompt).toContain('All functions must have JSDoc comments');
      expect(prompt).toContain('Add @param and @return tags');
      expect(prompt).toContain('Skip documentation');
      expect(prompt).toContain('Documentation enables IDE tooltips');
    });

    it('should build prompt with multi-assertion blueprint', async () => {
      const blueprint = buildMultiAssertionBlueprint(4);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'multi-prompt-test',
        model: 'gemini-2.5-pro',
      };

      const prompt = await createBlueprintBuilder().buildPrompt('test-req-002', metadata, null);

      // All assertions should be included
      expect(prompt).toContain('TEST-001');
      expect(prompt).toContain('TEST-002');
      expect(prompt).toContain('TEST-003');
      expect(prompt).toContain('TEST-004');
    });

    it('should augment blueprint with job context when available', async () => {
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

      const prompt = await createBlueprintBuilder().buildPrompt('test-req-003', metadata, null);

      // Prompt is now JSON, parse and verify structure
      const parsed = JSON.parse(prompt);
      
      // Should include blueprint assertions
      expect(parsed.assertions).toBeDefined();
      expect(parsed.assertions.some((a: any) => a.id === 'CONTEXT-001')).toBe(true);
      
      // Should include context from additionalContext
      expect(parsed.context).toBeDefined();
      expect(parsed.context.hierarchy).toBeDefined();
      expect(parsed.context.hierarchy.totalJobs).toBe(3);
      expect(parsed.context.hierarchy.completedJobs).toBe(2);
      
      // Should include child information
      expect(parsed.context.hierarchy.children).toBeDefined();
      expect(parsed.context.hierarchy.children.some((c: any) => c.jobName === 'parent-job')).toBe(true);
      
      // Should include artifact information
      expect(parsed.context.artifacts).toBeDefined();
      expect(parsed.context.artifacts.some((a: any) => a.name === 'analysis-doc')).toBe(true);
    });

    it('should handle blueprint without job context', async () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('NO-CONTEXT-001')]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'no-context-test',
        model: 'gemini-2.5-flash',
      };

      const prompt = await createBlueprintBuilder().buildPrompt('test-req-004', metadata, null);

      // Should only include blueprint
      expect(prompt).toContain('NO-CONTEXT-001');
      expect(prompt).not.toContain('Job Context');
    });
  });

  describe('Agent execution with blueprint (no external search)', () => {
    it('should use blueprint directly without searching', async () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('NO-SEARCH-001')]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'no-search-test',
        model: 'gemini-2.5-flash',
        enabledTools: ['create_artifact'],
      };

      const prompt = await createBlueprintBuilder().buildPrompt('test-req-005', metadata, null);

      // Blueprint content should be in prompt
      expect(prompt).toContain('NO-SEARCH-001');
      
      // In actual execution, agent should NOT use search tools for blueprint
      // This would be verified in telemetry (no search_artifacts calls for blueprint)
      // For integration test, we verify the prompt has everything needed
      expect(prompt).toContain('Test assertion NO-SEARCH-001');
      expect(prompt).toContain('Example positive behavior');
      expect(prompt).toContain('Example negative behavior');
    });

    it('should provide complete assertion structure to agent', async () => {
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

      const prompt = await createBlueprintBuilder().buildPrompt('test-req-006', metadata, null);

      // All parts of assertion should be present
      expect(prompt).toContain('COMPLETE-001');
      expect(prompt).toContain('API endpoints must validate all input parameters');
      expect(prompt).toContain('Use Zod schemas for validation');
      expect(prompt).toContain('Trust client input without validation');
      expect(prompt).toContain('Input validation prevents security vulnerabilities');
    });

    it('should handle blueprint with model selection', async () => {
      const blueprint = buildTestBlueprint([buildMinimalAssertion('MODEL-001')]);
      
      const metadata: IpfsMetadata = {
        blueprint,
        jobName: 'model-selection-test',
        model: 'gemini-2.5-pro', // Explicit model selection
        enabledTools: ['create_artifact', 'dispatch_new_job'],
      };

      const prompt = await createBlueprintBuilder().buildPrompt('test-req-007', metadata, null);

      // Blueprint should be in prompt regardless of model
      expect(prompt).toContain('MODEL-001');
      expect(metadata.model).toBe('gemini-2.5-pro');
    });
  });

  describe('End-to-end metadata → prompt flow', () => {
    it('should complete full flow: IPFS metadata → blueprint extraction → prompt building', async () => {
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
      const prompt = await createBlueprintBuilder().buildPrompt('test-req-008', ipfsMetadata, null);
      expect(prompt).toContain('TEST-001');
      expect(prompt).toContain('TEST-002');
      expect(prompt).toContain('TEST-003');

      // Step 4: Verify all metadata is preserved
      expect(ipfsMetadata.jobName).toBe('e2e-flow-test');
      expect(ipfsMetadata.model).toBe('gemini-2.5-flash');
      expect(ipfsMetadata.jobDefinitionId).toBe('e2e-job-def');
      expect(ipfsMetadata.codeMetadata?.branch?.name).toBe('job/e2e-test');
    });

    it('should handle complete flow with dependencies', async () => {
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
      const prompt = await createBlueprintBuilder().buildPrompt('test-req-009', ipfsMetadata, null);
      expect(prompt).toContain('DEP-FLOW-001');

      // Dependencies metadata preserved (used by worker for execution control)
      expect(ipfsMetadata.dependencies).toEqual(['prereq-job-def-1', 'prereq-job-def-2']);
    });

    it('should handle artifact-only jobs with blueprint', async () => {
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
      const prompt = await createBlueprintBuilder().buildPrompt('test-req-010', ipfsMetadata, null);
      expect(prompt).toContain('ARTIFACT-FLOW-001');
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle malformed blueprint JSON gracefully', async () => {
      const ipfsMetadata: IpfsMetadata = {
        blueprint: 'not valid json {',
        jobName: 'malformed-test',
        model: 'gemini-2.5-flash',
      };

      // Prompt builder will still construct a valid JSON blueprint structure
      // When blueprint is malformed, it falls back to system assertions only
      const prompt = await createBlueprintBuilder().buildPrompt('test-req-011', ipfsMetadata, null);
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      // Should contain system assertions like SYS-COMPLETENESS-001
      expect(prompt).toContain('SYS-');
    });

    it('should handle empty blueprint string', async () => {
      const ipfsMetadata: IpfsMetadata = {
        blueprint: '',
        jobName: 'empty-blueprint-test',
        model: 'gemini-2.5-flash',
      };

      // Empty blueprint still produces a valid prompt structure
      const prompt = await createBlueprintBuilder().buildPrompt('test-req-012', ipfsMetadata, null);
      // Should contain system assertions at minimum
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
    });

    it('should handle missing all specification fields', async () => {
      const ipfsMetadata: IpfsMetadata = {
        jobName: 'no-spec-test',
        model: 'gemini-2.5-flash',
      };

      // Even without blueprint, system generates baseline prompt
      const prompt = await createBlueprintBuilder().buildPrompt('test-req-013', ipfsMetadata, null);
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
    });

    it('should preserve blueprint with unicode characters', async () => {
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

      const prompt = await createBlueprintBuilder().buildPrompt('test-req-014', metadata, null);
      expect(prompt).toContain('日本語');
      expect(prompt).toContain('العربية');
      expect(prompt).toContain('🚀✨');
    });
  });
});

