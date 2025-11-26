/**
 * ChildWorkAssertionProvider - Generates dynamic assertions for completed child jobs
 *
 * This provider creates context-aware assertions that embed specific information
 * about completed child jobs, making the instructions actionable and self-contained.
 */

import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
  ChildJobInfo,
} from '../../types.js';

/**
 * ChildWorkAssertionProvider generates assertions for each completed child
 */
export class ChildWorkAssertionProvider implements AssertionProvider {
  name = 'child-work-assertions';
  category = 'context' as const;

  enabled(config: BlueprintBuilderConfig): boolean {
    return config.enableContextAssertions;
  }

  async provide(
    _ctx: BuildContext,
    builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const hierarchy = builtContext.hierarchy;

    if (!hierarchy || !hierarchy.children || hierarchy.children.length === 0) {
      return [];
    }

    const assertions: BlueprintAssertion[] = [];
    let assertionIndex = 1;

    // Generate assertions for completed children
    const completedChildren = hierarchy.children.filter(
      (child) => child.status === 'COMPLETED'
    );

    for (const child of completedChildren) {
      const assertion = this.childToAssertion(child, assertionIndex);
      assertions.push(assertion);
      assertionIndex++;
    }

    // If there are any completed children, add a summary assertion
    if (completedChildren.length > 0) {
      assertions.unshift(this.createSummaryAssertion(completedChildren));
    }

    return assertions;
  }

  /**
   * Create a summary assertion about completed children
   */
  private createSummaryAssertion(children: ChildJobInfo[]): BlueprintAssertion {
    const childNames = children
      .map((c) => c.jobName || `job ${c.requestId.slice(0, 8)}`)
      .join(', ');

    return {
      id: 'CTX-CHILDREN-SUMMARY',
      category: 'context',
      assertion: `You have ${children.length} completed child job(s) that must be reviewed before proceeding: ${childNames}`,
      examples: {
        do: [
          'Review each child job summary before starting work',
          'Build upon completed child outputs',
          'Incorporate child deliverables into your work',
        ],
        dont: [
          'Ignore child job results',
          'Re-do work children already completed',
          'Start from scratch without reviewing child outputs',
        ],
      },
      commentary: `Child jobs have completed work that should inform your execution. Review their summaries in the context assertions below.`,
    };
  }

  /**
   * Create an assertion for a specific completed child
   */
  private childToAssertion(child: ChildJobInfo, index: number): BlueprintAssertion {
    const jobName = child.jobName || `job ${child.requestId.slice(0, 8)}`;
    const summary = child.summary || 'No summary available';

    // Truncate summary if too long
    const truncatedSummary =
      summary.length > 300 ? summary.slice(0, 300) + '...' : summary;

    return {
      id: `CTX-CHILD-${String(index).padStart(3, '0')}`,
      category: 'context',
      assertion: `You MUST review completed child '${jobName}': ${truncatedSummary}`,
      examples: {
        do: [
          `Build upon the work from '${jobName}'`,
          `Reference outputs from child job ${child.requestId.slice(0, 10)}`,
        ],
        dont: [
          `Ignore the work from '${jobName}'`,
          `Duplicate what this child already accomplished`,
        ],
      },
      commentary: `Child job ${child.requestId} completed successfully. Incorporate its outputs into your work.`,
    };
  }
}
