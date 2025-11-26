/**
 * ProgressAssertionProvider - Generates dynamic assertions from progress data
 *
 * This provider creates context-aware assertions that embed specific information
 * about prior work in the workstream, preventing duplication of effort.
 */

import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
} from '../../types.js';

/**
 * ProgressAssertionProvider generates assertions from workstream progress
 */
export class ProgressAssertionProvider implements AssertionProvider {
  name = 'progress-assertions';
  category = 'context' as const;

  enabled(config: BlueprintBuilderConfig): boolean {
    return config.enableContextAssertions;
  }

  async provide(
    _ctx: BuildContext,
    builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const progress = builtContext.progress;

    if (!progress || !progress.summary) {
      return [];
    }

    const assertions: BlueprintAssertion[] = [];

    // Main progress assertion with embedded summary
    assertions.push(this.createMainProgressAssertion(progress.summary));

    // If we have completed phases, create specific assertions for each
    if (progress.completedPhases && progress.completedPhases.length > 0) {
      assertions.push(this.createPhasesAssertion(progress.completedPhases));
    }

    return assertions;
  }

  /**
   * Create the main progress assertion with summary
   */
  private createMainProgressAssertion(summary: string): BlueprintAssertion {
    // Truncate summary if too long
    const truncatedSummary =
      summary.length > 500 ? summary.slice(0, 500) + '...' : summary;

    return {
      id: 'CTX-PROGRESS-001',
      category: 'context',
      assertion: `Prior work has been completed in this workstream. You MUST NOT repeat this work: ${truncatedSummary}`,
      examples: {
        do: [
          'Continue from where prior work left off',
          'Build upon existing progress',
          'Reference completed work in your outputs',
        ],
        dont: [
          'Repeat work described in progress summary',
          'Start from scratch ignoring prior work',
          'Re-execute phases that were already completed',
        ],
      },
      commentary:
        'This is historical progress from the workstream. Use it to understand what has been done and avoid duplication.',
    };
  }

  /**
   * Create an assertion listing completed phases
   */
  private createPhasesAssertion(phases: string[]): BlueprintAssertion {
    const phaseList = phases.join(', ');

    return {
      id: 'CTX-PROGRESS-002',
      category: 'context',
      assertion: `The following phases have been completed and MUST NOT be repeated: ${phaseList}`,
      examples: {
        do: [
          'Skip phases listed as completed',
          'Focus on remaining uncompleted work',
          `Continue after: ${phases[phases.length - 1] || 'prior phases'}`,
        ],
        dont: [
          ...phases.slice(0, 3).map((p) => `Re-run '${p}' phase`),
          'Execute phases marked as complete',
        ],
      },
      commentary: `${phases.length} phase(s) completed in prior runs. Focus on remaining work.`,
    };
  }
}
