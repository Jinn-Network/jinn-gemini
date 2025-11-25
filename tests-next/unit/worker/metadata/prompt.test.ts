/**
 * Unit Test: Prompt Construction
 * Module: worker/metadata/prompt.ts
 * Priority: P1 (HIGH)
 *
 * Tests prompt enhancement with additional context for agent execution.
 * Critical for providing complete job context to agents.
 *
 * Impact: Ensures agents have full workflow context
 */

import { describe, expect, it } from 'vitest';
import { buildEnhancedPrompt } from '../../../../worker/metadata/prompt.js';
import type { IpfsMetadata } from '../../../../worker/types.js';

describe('buildEnhancedPrompt', () => {
  describe('basic blueprint handling', () => {
    it('uses metadata blueprint when fallbackPrompt not provided', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Task from metadata',
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('Task from metadata');
    });

    it('prefers blueprint over fallbackPrompt', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Original blueprint',
      };

      const result = buildEnhancedPrompt(metadata, 'Override prompt');

      // Blueprint takes precedence
      expect(result).toContain('Original blueprint');
      expect(result).not.toContain('Override prompt');
    });

    it('returns error message when no blueprint or fallback', () => {
      const metadata: IpfsMetadata = {};

      const result = buildEnhancedPrompt(metadata);

      expect(result).toBe('No job specification found');
    });

    it('uses fallback when blueprint missing', () => {
      const metadata: IpfsMetadata = {};

      const result = buildEnhancedPrompt(metadata, 'Fallback task');

      expect(result).toContain('Fallback task');
    });
  });

  describe('context enhancement', () => {
    it('adds context summary when present', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Base task',
        additionalContext: {
          summary: {
            totalJobs: 5,
            completedJobs: 3,
            activeJobs: 2,
            totalArtifacts: 10,
          },
          hierarchy: [],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('## Job Context');
      expect(result).toContain('Total jobs in hierarchy: 5');
      expect(result).toContain('Completed jobs: 3');
      expect(result).toContain('Active jobs: 2');
      expect(result).toContain('Available artifacts: 10');
    });

    it('adds related jobs information', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Base task',
        additionalContext: {
          summary: {
            totalJobs: 2,
            completedJobs: 1,
            activeJobs: 1,
            totalArtifacts: 0,
          },
          hierarchy: [
            { name: 'Parent Job', level: 1, status: 'COMPLETED' },
            { name: 'Current Job', level: 2, status: 'ACTIVE' },
          ],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('**Related Jobs:**');
      expect(result).toContain('Parent Job (Level 1, Status: COMPLETED)');
      expect(result).toContain('Current Job (Level 2, Status: ACTIVE)');
    });

    it('lists available artifacts', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Base task',
        additionalContext: {
          summary: {
            totalJobs: 1,
            completedJobs: 1,
            activeJobs: 0,
            totalArtifacts: 2,
          },
          hierarchy: [
            {
              name: 'Parent Job',
              level: 1,
              status: 'COMPLETED',
              artifactRefs: [
                { name: 'analysis.md', topic: 'analysis', cid: 'Qmabc123' },
                { name: 'data.json', topic: 'data', cid: 'Qmdef456' },
              ],
            },
          ],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('analysis.md (analysis) — ID: n/a, CID: Qmabc123');
      expect(result).toContain('data.json (data) — ID: n/a, CID: Qmdef456');
    });

    it('handles empty hierarchy', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Base task',
        additionalContext: {
          summary: {
            totalJobs: 0,
            completedJobs: 0,
            activeJobs: 0,
            totalArtifacts: 0,
          },
          hierarchy: [],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('No related jobs found');
      expect(result).toContain('No artifacts available');
    });

    it('handles jobs without artifacts', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Base task',
        additionalContext: {
          summary: {
            totalJobs: 1,
            completedJobs: 1,
            activeJobs: 0,
            totalArtifacts: 0,
          },
          hierarchy: [
            {
              name: 'Job without artifacts',
              level: 1,
              status: 'COMPLETED',
            },
          ],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('No artifacts available');
    });

    it('prepends context before base prompt', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Original task instructions',
        additionalContext: {
          summary: {
            totalJobs: 1,
            completedJobs: 0,
            activeJobs: 1,
            totalArtifacts: 0,
          },
          hierarchy: [],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      const contextIndex = result.indexOf('## Job Context');
      const promptIndex = result.indexOf('Original task instructions');

      expect(contextIndex).toBeLessThan(promptIndex);
    });

    it('handles missing summary fields with defaults', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Base task',
        additionalContext: {
          summary: {},
          hierarchy: [],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('Total jobs in hierarchy: 0');
      expect(result).toContain('Completed jobs: 0');
      expect(result).toContain('Active jobs: 0');
      expect(result).toContain('Available artifacts: 0');
    });

    it('does not add context when additionalContext is absent', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Simple task',
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).not.toContain('## Job Context');
      expect(result).toContain('Blueprint (required):');
      expect(result).toContain('Simple task');
    });

    it('handles null additionalContext', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Simple task',
        additionalContext: null as any,
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).not.toContain('## Job Context');
    });
  });

  describe('complex scenarios', () => {
    it('handles multiple jobs with multiple artifacts', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Complete the analysis',
        additionalContext: {
          summary: {
            totalJobs: 3,
            completedJobs: 2,
            activeJobs: 1,
            totalArtifacts: 5,
          },
          hierarchy: [
            {
              name: 'Data Collection',
              level: 1,
              status: 'COMPLETED',
              artifactRefs: [
                { name: 'raw-data.csv', topic: 'data', cid: 'Qm1' },
                { name: 'metadata.json', topic: 'metadata', cid: 'Qm2' },
              ],
            },
            {
              name: 'Data Processing',
              level: 2,
              status: 'COMPLETED',
              artifactRefs: [
                { name: 'processed-data.csv', topic: 'data', cid: 'Qm3' },
                { name: 'summary.md', topic: 'report', cid: 'Qm4' },
              ],
            },
            {
              name: 'Analysis',
              level: 3,
              status: 'ACTIVE',
              artifactRefs: [
                { name: 'partial-analysis.md', topic: 'analysis', cid: 'Qm5' },
              ],
            },
          ],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('Total jobs in hierarchy: 3');
      expect(result).toContain('Data Collection (Level 1, Status: COMPLETED)');
      expect(result).toContain('raw-data.csv (data) — ID: n/a, CID: Qm1');
      expect(result).toContain('processed-data.csv (data) — ID: n/a, CID: Qm3');
      expect(result).toContain('partial-analysis.md (analysis) — ID: n/a, CID: Qm5');
      expect(result).toContain('Complete the analysis');
    });

    it('preserves blueprint line breaks', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Line 1\nLine 2\nLine 3',
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('Line 1\nLine 2\nLine 3');
    });

    it('handles very long blueprints', () => {
      const longBlueprint = 'a'.repeat(10000);
      const metadata: IpfsMetadata = {
        blueprint: longBlueprint,
        additionalContext: {
          summary: { totalJobs: 1, completedJobs: 0, activeJobs: 1, totalArtifacts: 0 },
          hierarchy: [],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result.length).toBeGreaterThan(10000);
      expect(result).toContain(longBlueprint);
    });
  });

  describe('review-first guidance for completed children', () => {
    it('adds review guidance when completed child jobs exist', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Complete the task',
        additionalContext: {
          summary: {
            totalJobs: 2,
            completedJobs: 1,
            activeJobs: 1,
            totalArtifacts: 0,
          },
          hierarchy: [
            {
              name: 'Current Job',
              level: 0,
              status: 'active',
            },
            {
              name: 'Child Job',
              level: 1,
              status: 'completed',
              artifactRefs: [],
            },
          ],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('## IMPORTANT: Review Completed Child Work Before Acting');
      expect(result).toContain('You have 1 completed child job(s)');
      expect(result).toContain('Review Child Deliverables');
      expect(result).toContain('Do **not** re-delegate until you have reviewed');
    });

    it('does not add review guidance when only parent jobs are completed', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Complete the task',
        additionalContext: {
          summary: {
            totalJobs: 2,
            completedJobs: 1,
            activeJobs: 1,
            totalArtifacts: 0,
          },
          hierarchy: [
            {
              name: 'Parent Job',
              level: 0,
              status: 'completed',
            },
            {
              name: 'Current Job',
              level: 1,
              status: 'active',
            },
          ],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).not.toContain('## IMPORTANT: Review Completed Child Work Before Acting');
    });

    it('adds review guidance when Work Protocol message indicates child completion', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Complete the task',
        additionalContext: {
          summary: {
            totalJobs: 1,
            completedJobs: 0,
            activeJobs: 1,
            totalArtifacts: 0,
          },
          hierarchy: [],
          message: {
            content: 'Child job COMPLETED: Job completed direct work. Output: ...',
            to: 'job-def-id',
            from: 'child-request-id',
          },
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('## IMPORTANT: Review Completed Child Work Before Acting');
      expect(result).toContain('Review Child Deliverables');
    });

    it('adds review guidance when Work Protocol message is a string', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Complete the task',
        additionalContext: {
          summary: {
            totalJobs: 1,
            completedJobs: 0,
            activeJobs: 1,
            totalArtifacts: 0,
          },
          hierarchy: [],
          message: 'Child job completed successfully',
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('## IMPORTANT: Review Completed Child Work Before Acting');
    });

    it('does not add review guidance when no completed children or Work Protocol message', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Complete the task',
        additionalContext: {
          summary: {
            totalJobs: 2,
            completedJobs: 0,
            activeJobs: 2,
            totalArtifacts: 0,
          },
          hierarchy: [
            {
              name: 'Current Job',
              level: 0,
              status: 'active',
            },
            {
              name: 'Child Job',
              level: 1,
              status: 'active',
            },
          ],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).not.toContain('## IMPORTANT: Review Completed Child Work Before Acting');
    });

    it('counts multiple completed children correctly', () => {
      const metadata: IpfsMetadata = {
        blueprint: 'Complete the task',
        additionalContext: {
          summary: {
            totalJobs: 3,
            completedJobs: 2,
            activeJobs: 1,
            totalArtifacts: 0,
          },
          hierarchy: [
            {
              name: 'Current Job',
              level: 0,
              status: 'active',
            },
            {
              name: 'Child Job 1',
              level: 1,
              status: 'completed',
            },
            {
              name: 'Child Job 2',
              level: 1,
              status: 'completed',
            },
          ],
        },
      };

      const result = buildEnhancedPrompt(metadata);

      expect(result).toContain('You have 2 completed child job(s)');
    });
  });
});
