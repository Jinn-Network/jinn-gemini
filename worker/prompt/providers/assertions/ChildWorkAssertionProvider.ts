/**
 * ChildWorkAssertionProvider - Generates dynamic assertions for completed child jobs
 *
 * This provider creates context-aware assertions that embed specific information
 * about completed child jobs, including their branch refs for review and merge.
 * When children have branches, the parent's main focus should be reviewing and
 * merging that work using the process_branch tool.
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

    // Classify children by status
    const completedChildren = hierarchy.children.filter(
      (child) => child.status === 'COMPLETED'
    );
    const failedChildren = hierarchy.children.filter(
      (child) => child.status === 'FAILED'
    );

    // CRITICAL: Add assertions for failed children first (highest priority)
    if (failedChildren.length > 0) {
      assertions.push(this.createFailedChildrenAssertion(failedChildren));
    }

    // Check if any completed children have branches to review
    const childrenWithBranches = completedChildren.filter((c) => c.branchName);

    // If there are children with branches, add a primary review assertion
    if (childrenWithBranches.length > 0) {
      assertions.push(this.createBranchReviewPriorityAssertion(childrenWithBranches));
    }

    for (const child of completedChildren) {
      const assertion = this.childToAssertion(child, assertionIndex);
      assertions.push(assertion);
      assertionIndex++;
    }

    // If there are any completed children, add a summary assertion
    if (completedChildren.length > 0 && childrenWithBranches.length === 0) {
      // Only add generic summary if no branch-specific guidance was added
      assertions.unshift(this.createSummaryAssertion(completedChildren));
    }

    return assertions;
  }

  /**
   * Create a critical assertion about failed children requiring remediation
   */
  private createFailedChildrenAssertion(failedChildren: ChildJobInfo[]): BlueprintAssertion {
    const failedNames = failedChildren
      .map((c) => c.jobName || c.requestId.slice(0, 8))
      .join(', ');

    return {
      id: 'CTX-FAILED-CHILDREN',
      category: 'context',
      assertion: `CRITICAL: ${failedChildren.length} child job(s) failed and need remediation: ${failedNames}. You MUST either retry them with corrected blueprints or explicitly document why they are superseded before marking this job COMPLETED.`,
      examples: {
        do: [
          'Review failed child summaries to understand the failure reason',
          'Use dispatch_new_job with improved blueprints to retry failed work',
          'Document in your execution summary why failed children are superseded (if you handle their work directly)',
          'Adjust your delegation strategy based on failure patterns',
        ],
        dont: [
          'Ignore failed children and mark job COMPLETED',
          'Retry with identical blueprints that already failed',
          'Proceed without understanding why children failed',
          'Claim completion while failed children represent unfinished requirements',
        ],
      },
      commentary: `Child jobs failed during execution. The system will block completion until you either retry with corrected blueprints or explicitly supersede them with documented rationale. This ensures failure patterns are addressed.`,
    };
  }

  /**
   * Create a high-priority assertion about reviewing child branches
   * This guides the parent to focus on branch review as the primary task
   */
  private createBranchReviewPriorityAssertion(
    childrenWithBranches: ChildJobInfo[]
  ): BlueprintAssertion {
    const branchList = childrenWithBranches
      .map((c) => `'${c.branchName}' (${c.jobName || c.requestId.slice(0, 8)})`)
      .join(', ');

    return {
      id: 'CTX-BRANCH-REVIEW-PRIORITY',
      category: 'context',
      assertion: `Your PRIMARY TASK is to review and integrate ${childrenWithBranches.length} child branch(es): ${branchList}. Use the process_branch tool to compare, then merge or reject each branch.`,
      examples: {
        do: [
          "Call process_branch({ branch_name: 'job/child-branch', action: 'compare', rationale: 'Review child work before integration' })",
          'Review the diff output to verify the child work meets requirements',
          "Call process_branch({ branch_name: 'job/child-branch', action: 'merge', rationale: 'Child work satisfies acceptance criteria' }) to integrate approved work",
          "Call process_branch({ branch_name: 'job/child-branch', action: 'reject', rationale: 'Work does not meet requirements: <reason>' }) if work is unsuitable",
          "Call process_branch({ branch_name: 'job/child-branch', action: 'checkout', rationale: 'Need to fix issues before merging' }) to make corrections",
        ],
        dont: [
          'Start new work without first reviewing child branches',
          'Ignore child branches and duplicate their work',
          'Merge branches without comparing them first',
          'Leave child branches unprocessed',
        ],
      },
      commentary: `Child jobs have completed work on separate branches. As the parent, your role is to review this work using process_branch with action='compare', then decide whether to merge (integrate), reject (discard), or checkout (fix issues). This is your primary responsibility before doing any other work.`,
    };
  }

  /**
   * Create a summary assertion about completed children (no branches)
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

    // If child has a branch, include branch-specific guidance
    if (child.branchName) {
      return {
        id: `CTX-CHILD-${String(index).padStart(3, '0')}`,
        category: 'context',
        assertion: `Child '${jobName}' completed work on branch '${child.branchName}'. Review and process this branch: ${truncatedSummary}`,
        examples: {
          do: [
            `Call process_branch({ branch_name: '${child.branchName}', action: 'compare', rationale: 'Review ${jobName} work' })`,
            `After review, call process_branch({ branch_name: '${child.branchName}', action: 'merge', rationale: '...' }) if work is acceptable`,
            `Reference request ID ${child.requestId.slice(0, 10)} for detailed context`,
          ],
          dont: [
            `Ignore branch '${child.branchName}'`,
            `Duplicate the work from '${jobName}'`,
            `Merge without reviewing the diff first`,
          ],
        },
        commentary: `Child job ${child.requestId} completed on branch '${child.branchName}'${child.baseBranch ? ` (based on '${child.baseBranch}')` : ''}. Use process_branch to review and integrate.`,
      };
    }

    // No branch - standard child assertion
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
