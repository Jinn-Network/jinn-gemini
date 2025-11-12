/**
 * Unit tests for gemini-agent/mcp/tools/dispatch_new_job.ts
 *
 * Tests job delegation MCP tool - creates/updates job definitions and dispatches marketplace requests.
 * This is the MOST CRITICAL MCP tool - used for all job delegation in the system.
 *
 * Priority: P1 (HIGHEST Priority)
 * Business Impact: Agent Functionality - Job Delegation (Core Feature)
 * Coverage Target: 100% of dispatch logic
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { dispatchNewJob } from '../../../../../gemini-agent/mcp/tools/dispatch_new_job.js';

// Mock dependencies
vi.mock('../../../../../http/client.js', () => ({
  graphQLRequest: vi.fn(),
}));

vi.mock('@jinn-network/mech-client-ts/dist/marketplace_interact.js', () => ({
  marketplaceInteract: vi.fn(),
}));

vi.mock('../../../../../gemini-agent/mcp/tools/shared/context.js', () => ({
  getCurrentJobContext: vi.fn(),
}));

vi.mock('../../../../../env/operate-profile.js', () => ({
  getMechAddress: vi.fn(),
  getMechChainConfig: vi.fn(),
  getServicePrivateKey: vi.fn(),
}));

vi.mock('../../../../../gemini-agent/mcp/tools/shared/env.js', () => ({
  getPonderGraphqlUrl: vi.fn(),
}));

vi.mock('../../../../../gemini-agent/shared/code_metadata.js', () => ({
  collectLocalCodeMetadata: vi.fn(),
  ensureJobBranch: vi.fn(),
}));

vi.mock('../../../../../config/index.js', () => ({
  getCodeMetadataDefaultBaseBranch: vi.fn(),
}));

import { graphQLRequest } from '../../../../../http/client.js';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from '../../../../../gemini-agent/mcp/tools/shared/context.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from '../../../../../env/operate-profile.js';
import { getPonderGraphqlUrl } from '../../../../../gemini-agent/mcp/tools/shared/env.js';
import { collectLocalCodeMetadata, ensureJobBranch } from '../../../../../gemini-agent/shared/code_metadata.js';
import { getCodeMetadataDefaultBaseBranch } from '../../../../../config/index.js';

describe('dispatchNewJob', () => {
  // Suppress console.error and console.warn during tests
  const originalError = console.error;
  const originalWarn = console.warn;

  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
    console.warn = vi.fn();

    // Default mock implementations
    (getCurrentJobContext as any).mockReturnValue({
      requestId: '0xParent123',
      jobDefinitionId: 'parent-job-uuid',
    });
    (getMechAddress as any).mockReturnValue('0xMechAddress');
    (getMechChainConfig as any).mockReturnValue('base');
    (getServicePrivateKey as any).mockReturnValue('0xPrivateKey');
    (getPonderGraphqlUrl as any).mockReturnValue('http://localhost:42069/graphql');
    (getCodeMetadataDefaultBaseBranch as any).mockReturnValue('main');

    // Mock graphQLRequest to return empty job list first (no existing job),
    // then return ipfsHash on poll
    (graphQLRequest as any).mockImplementation(async ({ query }: any) => {
      if (query.includes('jobDefinitions')) {
        return { jobDefinitions: { items: [] } };
      }
      if (query.includes('request(id:')) {
        return { request: { ipfsHash: 'QmTestIpfsHash' } };
      }
      return {};
    });

    (ensureJobBranch as any).mockResolvedValue({ branchName: 'job/test-branch' });
    (collectLocalCodeMetadata as any).mockResolvedValue({ repo: 'test-repo', commit: 'abc123' });
    (marketplaceInteract as any).mockResolvedValue({ request_ids: ['0xRequest123'] });
  });

  afterEach(() => {
    console.error = originalError;
    console.warn = originalWarn;
  });

  describe('validation', () => {
    it('validates required objective field', async () => {
      const args = {
        context: 'This is the context explaining why',
        acceptanceCriteria: 'Task is complete',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
      expect(response.meta.message).toContain('objective');
    });

    it('validates required context field', async () => {
      const args = {
        objective: 'Complete the task successfully',
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
      expect(response.meta.message).toContain('context');
    });

    it('validates required acceptanceCriteria field', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'This is the context explaining why',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
      expect(response.meta.message).toContain('acceptanceCriteria');
    });

    it('validates required jobName field', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'This is the context explaining why',
        acceptanceCriteria: 'Task is done',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
      expect(response.meta.message).toContain('jobName');
    });

    it('validates minimum length for objective (min 10 chars)', async () => {
      const args = {
        objective: 'Short', // Only 5 chars
        context: 'This is the context explaining why',
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
    });

    it('validates minimum length for context (min 20 chars)', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'Short', // Only 5 chars
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
    });

    it('validates minimum length for acceptanceCriteria (min 10 chars)', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'This is the context explaining why',
        acceptanceCriteria: 'Done', // Only 4 chars
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
    });

    it('validates minimum length for jobName (min 1 char)', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'This is the context explaining why',
        acceptanceCriteria: 'Task is done',
        jobName: '',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
    });

    it('accepts job with only required fields', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'This is the context explaining why we need this',
        acceptanceCriteria: 'Task is done when output is verified',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(true);
      expect(marketplaceInteract).toHaveBeenCalled();
    });

    it('accepts job with all optional fields', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'This is the context explaining why we need this',
        deliverables: 'Research report artifact',
        acceptanceCriteria: 'Task is done when output is verified',
        constraints: 'Must complete within 1 hour',
        instructions: 'Follow security guidelines',
        jobName: 'test-job',
        model: 'gemini-2.5-pro',
        enabledTools: ['read_file', 'write_file'],
        updateExisting: false,
        message: 'Please start working on this',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(true);
    });

    it('validates enabledTools is an array if provided', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'This is the context explaining why we need this',
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
        enabledTools: 'not-an-array',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
    });

    it('validates updateExisting is a boolean if provided', async () => {
      const args = {
        objective: 'Complete the task successfully',
        context: 'This is the context explaining why we need this',
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
        updateExisting: 'true', // String instead of boolean
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('prompt construction', () => {
    it('constructs prompt with only required fields', async () => {
      const args = {
        objective: 'Implement feature X',
        context: 'Feature X is needed for user workflow Y',
        acceptanceCriteria: 'Feature X is implemented and tested',
        jobName: 'implement-feature-x',
      };

      await dispatchNewJob(args);

      expect(marketplaceInteract).toHaveBeenCalledWith(
        expect.objectContaining({
          prompts: [
            expect.stringContaining('# Objective\nImplement feature X') &&
            expect.stringContaining('# Context\nFeature X is needed for user workflow Y') &&
            expect.stringContaining('# Acceptance Criteria\nFeature X is implemented and tested'),
          ],
        })
      );
    });

    it('includes deliverables section when provided', async () => {
      const args = {
        objective: 'Research topic Z',
        context: 'Topic Z is important for decision making',
        deliverables: 'Research report with findings',
        acceptanceCriteria: 'Report is complete',
        jobName: 'research-z',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.prompts[0]).toContain('# Deliverables\nResearch report with findings');
    });

    it('includes constraints section when provided', async () => {
      const args = {
        objective: 'Optimize performance',
        context: 'Current performance is too slow',
        acceptanceCriteria: 'Performance improved by 50%',
        constraints: 'Must not break existing functionality',
        jobName: 'optimize-perf',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.prompts[0]).toContain('# Constraints\nMust not break existing functionality');
    });

    it('includes instructions section when provided', async () => {
      const args = {
        objective: 'Fix security bug',
        context: 'Security vulnerability found',
        acceptanceCriteria: 'Bug is fixed and verified',
        instructions: 'Follow OWASP guidelines',
        jobName: 'fix-security',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.prompts[0]).toContain('# Instructions\nFollow OWASP guidelines');
    });

    it('trims empty instructions', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion for project',
        acceptanceCriteria: 'Task is done',
        instructions: '   \n\n  ',
        jobName: 'complete-task',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.prompts[0]).not.toContain('# Instructions');
    });

    it('constructs prompt with all sections', async () => {
      const args = {
        objective: 'Build dashboard',
        context: 'Dashboard needed for monitoring',
        deliverables: 'React dashboard component',
        acceptanceCriteria: 'Dashboard displays metrics correctly',
        constraints: 'Use existing design system',
        instructions: 'Follow accessibility guidelines',
        jobName: 'build-dashboard',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      const prompt = call.prompts[0];

      expect(prompt).toContain('# Objective');
      expect(prompt).toContain('# Context');
      expect(prompt).toContain('# Deliverables');
      expect(prompt).toContain('# Acceptance Criteria');
      expect(prompt).toContain('# Constraints');
      expect(prompt).toContain('# Instructions');
    });

    it('maintains section order in prompt', async () => {
      const args = {
        objective: 'Task objective',
        context: 'Task context information',
        deliverables: 'Task deliverables list',
        acceptanceCriteria: 'Task acceptance criteria',
        constraints: 'Task constraints',
        instructions: 'Task instructions',
        jobName: 'ordered-sections',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      const prompt = call.prompts[0];

      const objectiveIdx = prompt.indexOf('# Objective');
      const contextIdx = prompt.indexOf('# Context');
      const deliverablesIdx = prompt.indexOf('# Deliverables');
      const criteriaIdx = prompt.indexOf('# Acceptance Criteria');
      const constraintsIdx = prompt.indexOf('# Constraints');
      const instructionsIdx = prompt.indexOf('# Instructions');

      expect(objectiveIdx).toBeLessThan(contextIdx);
      expect(contextIdx).toBeLessThan(deliverablesIdx);
      expect(deliverablesIdx).toBeLessThan(criteriaIdx);
      expect(criteriaIdx).toBeLessThan(constraintsIdx);
      expect(constraintsIdx).toBeLessThan(instructionsIdx);
    });
  });

  describe('job definition management', () => {
    it('creates new job definition when none exists', async () => {
      (graphQLRequest as any).mockImplementation(async ({ query }: any) => {
        if (query.includes('jobDefinitions')) {
          return { jobDefinitions: { items: [] } }; // No existing job
        }
        if (query.includes('request(id:')) {
          return { request: { ipfsHash: 'QmTestHash' } };
        }
        return {};
      });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'new-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(true);
      expect(response.data.jobDefinitionId).toBeDefined();
      expect(marketplaceInteract).toHaveBeenCalled();
    });

    it('returns existing job when found and updateExisting=false', async () => {
      const existingJob = {
        id: 'existing-uuid',
        name: 'existing-job',
        enabledTools: JSON.stringify(['tool1']),
      };

      (graphQLRequest as any).mockImplementation(async ({ query }: any) => {
        if (query.includes('jobDefinitions')) {
          return { jobDefinitions: { items: [existingJob] } };
        }
        return {};
      });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'existing-job',
        updateExisting: false,
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(true);
      expect(response.meta.code).toBe('JOB_EXISTS');
      expect(response.data.id).toBe('existing-uuid');
      expect(marketplaceInteract).not.toHaveBeenCalled();
    });

    it('reuses existing job when updateExisting=true', async () => {
      const existingJob = {
        id: 'existing-uuid',
        name: 'existing-job',
      };

      (graphQLRequest as any).mockImplementation(async ({ query }: any) => {
        if (query.includes('jobDefinitions')) {
          return { jobDefinitions: { items: [existingJob] } };
        }
        if (query.includes('request(id:')) {
          return { request: { ipfsHash: 'QmTestHash' } };
        }
        return {};
      });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'existing-job',
        updateExisting: true,
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(true);
      expect(response.data.jobDefinitionId).toBe('existing-uuid');
      expect(marketplaceInteract).toHaveBeenCalled();
    });

    it('includes enabled_tools in marketplace request', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'tools-job',
        enabledTools: ['read_file', 'write_file', 'bash'],
      };

      await dispatchNewJob(args);

      expect(marketplaceInteract).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ['read_file', 'write_file', 'bash'],
        })
      );
    });

    it('defaults to gemini-2.5-flash model when not specified', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'default-model',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.ipfsJsonContents[0].model).toBe('gemini-2.5-flash');
    });

    it('uses custom model when specified', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'custom-model',
        model: 'gemini-2.5-pro',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.ipfsJsonContents[0].model).toBe('gemini-2.5-pro');
    });

    it('includes parent lineage context when available', async () => {
      (getCurrentJobContext as any).mockReturnValue({
        requestId: '0xParent123',
        jobDefinitionId: 'parent-uuid',
      });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'child-job',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.ipfsJsonContents[0].sourceRequestId).toBe('0xParent123');
      expect(call.ipfsJsonContents[0].sourceJobDefinitionId).toBe('parent-uuid');
    });

    it('handles GraphQL lookup failure gracefully', async () => {
      (graphQLRequest as any).mockRejectedValueOnce(new Error('Subgraph down'));

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'resilient-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      // Should continue without checking for existing job
      expect(response.meta.ok).toBe(true);
      expect(marketplaceInteract).toHaveBeenCalled();
    });
  });

  describe('marketplace interaction', () => {
    it('calls marketplaceInteract with correct parameters', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
      };

      await dispatchNewJob(args);

      expect(marketplaceInteract).toHaveBeenCalledWith(
        expect.objectContaining({
          priorityMech: '0xMechAddress',
          chainConfig: 'base',
          keyConfig: { source: 'value', value: '0xPrivateKey' },
          postOnly: true,
        })
      );
    });

    it('returns request ID from marketplace', async () => {
      (marketplaceInteract as any).mockResolvedValue({
        request_ids: ['0xNewRequest456'],
      });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(true);
      expect(response.data.request_ids).toEqual(['0xNewRequest456']);
    });

    it('handles missing mech address error', async () => {
      (getMechAddress as any).mockReturnValue(null);

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('EXECUTION_ERROR');
      expect(response.meta.message).toContain('mech address not configured');
    });

    it('handles missing private key error', async () => {
      (getServicePrivateKey as any).mockReturnValue(null);

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'test-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('EXECUTION_ERROR');
      expect(response.meta.message).toContain('private key not found');
    });

    it('handles marketplace dispatch failure (no request IDs)', async () => {
      (marketplaceInteract as any).mockResolvedValue({ request_ids: [] });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'failed-dispatch',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('DISPATCH_FAILED');
    });

    it('handles marketplace dispatch exception', async () => {
      (marketplaceInteract as any).mockRejectedValue(new Error('Network timeout'));

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'network-error',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('EXECUTION_ERROR');
      expect(response.meta.message).toContain('Network timeout');
    });

    it('includes IPFS gateway URL when available', async () => {
      (graphQLRequest as any).mockImplementation(async ({ query }: any) => {
        if (query.includes('jobDefinitions')) {
          return { jobDefinitions: { items: [] } };
        }
        if (query.includes('request(id:')) {
          return { request: { ipfsHash: 'QmEnrichedHash' } };
        }
        return {};
      });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'enriched-job',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.data.ipfs_gateway_url).toContain('QmEnrichedHash');
      expect(response.data.ipfs_gateway_url).toContain('gateway.autonolas.tech');
    });
  });

  describe('code metadata', () => {
    it('calls ensureJobBranch with correct parameters', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'branch-test',
      };

      await dispatchNewJob(args);

      expect(ensureJobBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          jobName: 'branch-test',
          baseBranch: 'main',
          jobDefinitionId: expect.any(String),
        })
      );
    });

    it('calls collectLocalCodeMetadata after branch creation', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'metadata-test',
      };

      await dispatchNewJob(args);

      expect(collectLocalCodeMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          branchName: 'job/test-branch',
          baseBranch: 'main',
        })
      );
    });

    it('includes code metadata in IPFS payload', async () => {
      (collectLocalCodeMetadata as any).mockResolvedValue({
        repo: 'test-repo',
        commit: 'abc123',
      });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'metadata-included',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.ipfsJsonContents[0].codeMetadata).toEqual({
        repo: 'test-repo',
        commit: 'abc123',
      });
    });

    it('handles branch creation failure', async () => {
      (ensureJobBranch as any).mockRejectedValue(new Error('Git error'));

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'branch-error',
      };

      const result = await dispatchNewJob(args);
      const response = JSON.parse(result.content[0].text);

      expect(response.meta.ok).toBe(false);
      expect(response.meta.code).toBe('BRANCH_ERROR');
      expect(response.meta.message).toContain('Git error');
    });

    it('includes execution policy with branch name', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'execution-policy',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.ipfsJsonContents[0].executionPolicy).toEqual({
        branch: 'job/test-branch',
        ensureTestsPass: true,
        description: expect.any(String),
      });
    });
  });

  describe('edge cases', () => {
    it('handles message parameter (structured)', async () => {
      const structuredMessage = JSON.stringify({
        content: 'Here is your task',
        to: 'child-job',
        from: 'parent-job',
      });

      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'message-job',
        message: structuredMessage,
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.ipfsJsonContents[0].additionalContext.message.content).toBe('Here is your task');
    });

    it('handles message parameter (plain string)', async () => {
      const args = {
        objective: 'Complete task',
        context: 'Task needs completion',
        acceptanceCriteria: 'Task is done',
        jobName: 'plain-message',
        message: 'Please start this task',
      };

      await dispatchNewJob(args);

      const call = (marketplaceInteract as any).mock.calls[0][0];
      expect(call.ipfsJsonContents[0].additionalContext.message.content).toBe('Please start this task');
    });
  });
});
