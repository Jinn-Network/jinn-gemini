/**
 * MergeConflictAssertionProvider - Generates assertions when dependency branches
 * have merge conflicts that the agent must resolve.
 *
 * When a job has dependencies with branches, the worker merges those branches
 * before agent execution. If conflicts occur, they are left in the working tree
 * and this provider injects assertions telling the agent to resolve them.
 */

import type {
  AssertionProvider,
  BuildContext,
  BlueprintContext,
  BlueprintBuilderConfig,
  BlueprintAssertion,
} from '../../types.js';

/**
 * MergeConflictAssertionProvider generates critical assertions when merge conflicts exist
 */
export class MergeConflictAssertionProvider implements AssertionProvider {
  name = 'merge-conflict-assertions';
  category = 'context' as const;

  enabled(config: BlueprintBuilderConfig): boolean {
    return config.enableContextAssertions;
  }

  async provide(
    ctx: BuildContext,
    _builtContext: BlueprintContext
  ): Promise<BlueprintAssertion[]> {
    const mergeConflicts = ctx.metadata.additionalContext?.mergeConflicts;

    if (!mergeConflicts || mergeConflicts.length === 0) {
      return [];
    }

    const assertions: BlueprintAssertion[] = [];

    // Create a high-priority assertion about the conflicts
    const totalFiles = mergeConflicts.reduce((sum, c) => sum + c.files.length, 0);
    const branchList = mergeConflicts.map((c) => `'${c.branch}'`).join(', ');

    assertions.push({
      id: 'CTX-MERGE-CONFLICTS',
      category: 'context',
      assertion: `CRITICAL: Your working tree contains ${totalFiles} file(s) with merge conflicts from dependency branch(es): ${branchList}. You MUST resolve all conflict markers (<<<<<<< / ======= / >>>>>>>) before proceeding with your task.`,
      examples: {
        do: [
          'Open each conflicting file and resolve the conflict markers',
          'Choose the correct version of conflicting code (yours, theirs, or a combination)',
          'Remove all <<<<<<< HEAD, =======, and >>>>>>> markers',
          'Stage resolved files with git add',
          'Commit the merge resolution before continuing with your main task',
          'Test that the merged code compiles/runs correctly',
        ],
        dont: [
          'Ignore merge conflicts and proceed with your task',
          'Leave conflict markers in the code',
          'Delete conflicting files instead of resolving them',
          'Commit files that still contain conflict markers',
          'Assume conflicts will resolve themselves',
        ],
      },
      commentary: `The worker attempted to merge dependency branches into your working branch to give you access to their work. However, merge conflicts occurred. Your branch now has unresolved conflicts in the working tree. You must resolve these conflicts FIRST before doing any other work, or your code will not compile/run.`,
    });

    // Add per-file details for each conflict
    for (const conflict of mergeConflicts) {
      const fileList = conflict.files.slice(0, 5).join(', ');
      const moreCount = conflict.files.length > 5 ? ` (+${conflict.files.length - 5} more)` : '';

      assertions.push({
        id: `CTX-CONFLICT-${conflict.branch.replace(/[^a-zA-Z0-9]/g, '-').toUpperCase()}`,
        category: 'context',
        assertion: `Conflicts from '${conflict.branch}': ${fileList}${moreCount}`,
        examples: {
          do: [
            `Read each conflicting file to understand the conflict`,
            `Use git diff to see what changes conflict`,
          ],
          dont: [
            `Skip files without checking for conflict markers`,
          ],
        },
        commentary: `Files with conflicts from merging ${conflict.branch}. Each file contains <<<<<<< and >>>>>>> markers showing the conflicting sections.`,
      });
    }

    return assertions;
  }
}
