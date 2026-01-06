/**
 * CoordinationInvariantProvider - Generates dynamic invariants for parent-child coordination
 *
 * This provider consolidates child work handling and merge conflict resolution:
 * - Completed child jobs with branches to review
 * - Failed children requiring remediation
 * - Merge conflicts from dependency branches
 * 
 * Domain: coordination - Parent-child workflow and git operations
 */

import type {
    InvariantProvider,
    BuildContext,
    BlueprintContext,
    BlueprintBuilderConfig,
    Invariant,
    ChildJobInfo,
} from '../../types.js';
import { workerLogger } from '../../../../logging/index.js';

interface MergeConflict {
    branch: string;
    files: string[];
}

/**
 * CoordinationInvariantProvider generates invariants for parent-child coordination
 */
export class CoordinationInvariantProvider implements InvariantProvider {
    name = 'coordination';

    enabled(config: BlueprintBuilderConfig): boolean {
        return config.enableContextAssertions;
    }

    async provide(
        ctx: BuildContext,
        builtContext: BlueprintContext
    ): Promise<Invariant[]> {
        const invariants: Invariant[] = [];

        // Add child work invariants
        invariants.push(...this.getChildWorkInvariants(ctx, builtContext));

        // Add merge conflict invariants
        invariants.push(...this.getMergeConflictInvariants(ctx));

        return invariants;
    }

    private getChildWorkInvariants(
        ctx: BuildContext,
        builtContext: BlueprintContext
    ): Invariant[] {
        const hierarchy = builtContext.hierarchy;

        if (!hierarchy || !hierarchy.children || hierarchy.children.length === 0) {
            return [];
        }

        const invariants: Invariant[] = [];

        const completedChildren = hierarchy.children.filter(
            (child) => child.status === 'COMPLETED'
        );
        const failedChildren = hierarchy.children.filter(
            (child) => child.status === 'FAILED'
        );

        if (failedChildren.length > 0) {
            invariants.push(this.createFailedChildrenInvariant(failedChildren));
        } else {
            const isVerification = ctx.metadata?.additionalContext?.verificationRequired === true;
            if (!isVerification) {
                invariants.push(this.createParentRoleInvariant());
            }
        }

        const unintegratedChildren = completedChildren.filter(
            (c) => c.branchName && !c.isIntegrated
        );

        const integratedChildren = completedChildren.filter(
            (c) => c.branchName && c.isIntegrated === true
        );

        if (integratedChildren.length > 0) {
            workerLogger.info({
                excludedCount: integratedChildren.length,
                excludedChildren: integratedChildren.map(c => ({
                    jobName: c.jobName,
                    branchName: c.branchName,
                    requestId: c.requestId.slice(0, 10),
                })),
            }, 'Excluding integrated children from invariants');
        }

        const childrenWithoutBranches = completedChildren.filter(
            (c) => !c.branchName
        );

        if (unintegratedChildren.length > 0) {
            invariants.push(this.createBranchReviewInvariant(unintegratedChildren));
        }

        if (childrenWithoutBranches.length > 0) {
            invariants.push(this.createArtifactChildrenInvariant(childrenWithoutBranches));
        }

        return invariants;
    }

    private getMergeConflictInvariants(ctx: BuildContext): Invariant[] {
        const mergeConflicts = ctx.metadata.additionalContext?.mergeConflicts as MergeConflict[] | undefined;

        if (!mergeConflicts || mergeConflicts.length === 0) {
            return [];
        }

        const totalFiles = mergeConflicts.reduce((sum, c) => sum + c.files.length, 0);
        const branchList = mergeConflicts.map((c) => `'${c.branch}'`).join(', ');

        return [{
            id: 'COORD-MERGE-CONFLICTS',
            invariant: `CRITICAL: Your codebase contains ${totalFiles} file(s) with merge conflict markers from dependency branch(es): ${branchList}. Resolve all conflict markers (<<<<<<< / ======= / >>>>>>>) and amend the WIP commit(s).`,
            examples: {
                do: ['Open each conflicting file, resolve markers, then git add and git commit --amend'],
                dont: ['Proceed with your task while conflict markers remain in code'],
            },
        }];
    }

    private createFailedChildrenInvariant(failedChildren: ChildJobInfo[]): Invariant {
        const failedNames = failedChildren
            .map((c) => c.jobName || c.requestId.slice(0, 8))
            .join(', ');

        return {
            id: 'COORD-FAILED-CHILDREN',
            invariant: `CRITICAL: ${failedChildren.length} child job(s) failed and need remediation: ${failedNames}. Retry with corrected blueprints or document why they are superseded.`,
            examples: {
                do: ['Review failed child summaries, then dispatch_new_job with improved blueprints to retry'],
                dont: ['Ignore failed children and mark job COMPLETED'],
            },
        };
    }

    private createBranchReviewInvariant(children: ChildJobInfo[]): Invariant {
        const branchDetails = children.map((c) => {
            const name = c.jobName || c.requestId.slice(0, 8);
            return `- ${c.branchName} (${name})`;
        }).join('\\n');

        return {
            id: 'COORD-BRANCH-REVIEW',
            invariant: `Your PRIMARY TASK is to review and integrate ${children.length} child branch(es). For each, call process_branch to compare, then merge or reject.`,
            examples: {
                do: [`Call process_branch({ branch_name: '<branch>', action: 'compare' }), then merge or reject with rationale`],
                dont: ['Start new implementation without first reviewing all child branches'],
            },
        };
    }

    private createArtifactChildrenInvariant(children: ChildJobInfo[]): Invariant {
        const childList = children.map((c) => {
            const name = c.jobName || c.requestId.slice(0, 8);
            return `- ${name}`;
        }).join('\\n');

        return {
            id: 'COORD-ARTIFACT-CHILDREN',
            invariant: `${children.length} completed child job(s) produced artifacts (no branches to merge). Review their outputs in context.hierarchy.children.`,
            examples: {
                do: ['Check context.hierarchy.children for child job details and build upon their outputs'],
                dont: ['Re-do work children already completed'],
            },
        };
    }

    private createParentRoleInvariant(): Invariant {
        return {
            id: 'COORD-PARENT-ROLE',
            invariant: 'When I have completed children, my PRIMARY task is reviewing their branches with process_branch and merging - not redoing their work',
            examples: {
                do: [`Call process_branch({ action: 'compare' }) to review each child's diff, then merge or reject`],
                dont: ['Ignore child branches and start fresh implementation'],
            },
        };
    }
}
