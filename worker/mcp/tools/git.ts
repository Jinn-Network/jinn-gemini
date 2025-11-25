/**
 * Git-native MCP tools for branch processing
 */

import { z } from 'zod';
import { execSync } from 'node:child_process';
import { workerLogger } from '../../../logging/index.js';
import { serializeError } from '../../logging/errors.js';
import { getCurrentJobContext } from '../../../gemini-agent/mcp/tools/shared/context.js';

interface ProcessBranchArgs {
    branch_name: string;
    action: 'merge' | 'reject' | 'checkout';
    rationale: string;
}

interface ProcessBranchResult {
    success: boolean;
    action: string;
    message: string;
    details?: Record<string, any>;
    next_steps?: string;
    error?: string;
    conflicting_files?: string[];
}

/**
 * Get the current git branch
 */
function getCurrentBranch(repoPath: string): string {
    return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
    }).trim();
}

/**
 * Check if there are uncommitted changes
 */
function hasUncommittedChanges(repoPath: string): boolean {
    const status = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8',
    });
    return status.trim().length > 0;
}

/**
 * Check if a branch exists locally
 */
function branchExistsLocally(repoPath: string, branchName: string): boolean {
    try {
        execSync(`git rev-parse --verify ${branchName}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if a branch exists on remote
 */
function branchExistsOnRemote(repoPath: string, branchName: string): boolean {
    try {
        execSync(`git ls-remote --heads origin ${branchName}`, {
            cwd: repoPath,
            encoding: 'utf-8',
        });
        return true;
    } catch {
        return false;
    }
}

// Zod schema for process_branch parameters (defined before function to ensure availability)
export const process_branch_params = z.object({
    branch_name: z.string().min(1).describe('The full name of the child branch to process (e.g., \'job/abc-123-feature-name\')'),
    action: z.enum(['merge', 'reject', 'checkout']).describe('The action to take: merge (integrate), reject (delete), or checkout (switch to branch for edits)'),
    rationale: z.string().min(1).describe('A brief explanation of why you are taking this action (required for audit trail)'),
});

/**
 * Process a child branch: merge, reject, or checkout
 */
export async function process_branch(args: unknown) {
    // Validate args using Zod schema
    const parseResult = process_branch_params.safeParse(args);
    if (!parseResult.success) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    error: 'Invalid arguments',
                    message: parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
                }),
            }],
        };
    }

    const { branch_name, action, rationale } = parseResult.data;

    // Get context from job context (same pattern as other MCP tools)
    const context = getCurrentJobContext();
    const repoPath = process.env.CODE_METADATA_REPO_ROOT;

    if (!repoPath) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    action,
                    error: 'Repository path not available',
                    message: 'Cannot determine repository path from context',
                }),
            }],
        };
    }

    workerLogger.info(
        { branch_name, action, rationale, requestId: context.requestId },
        `Processing branch with action: ${action}`
    );

    try {
        let result: string;
        const baseBr = context.baseBranch || process.env.CODE_METADATA_BASE_BRANCH || 'main';
        switch (action) {
            case 'merge':
                result = await handleMerge(branch_name, repoPath, baseBr);
                break;
            case 'reject':
                result = await handleReject(branch_name, repoPath);
                break;
            case 'checkout':
                result = await handleCheckout(branch_name, repoPath);
                break;
            default:
                result = JSON.stringify({
                    success: false,
                    action,
                    error: 'Unknown action',
                    message: `Action '${action}' is not supported`,
                });
        }

        return {
            content: [{
                type: 'text' as const,
                text: result,
            }],
        };
    } catch (error) {
        workerLogger.error(
            { error: serializeError(error), branch_name, action },
            'Error processing branch'
        );
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    action,
                    error: error instanceof Error ? error.message : String(error),
                    message: `Failed to ${action} branch '${branch_name}'`,
                }),
            }],
        };
    }
}

/**
 * Handle the 'merge' action
 */
async function handleMerge(
    branchName: string,
    repoPath: string,
    baseBranch: string
): Promise<string> {
    const currentBranch = getCurrentBranch(repoPath);

    // Check for uncommitted changes
    if (hasUncommittedChanges(repoPath)) {
        return JSON.stringify({
            success: false,
            action: 'merge',
            error: 'Uncommitted changes detected',
            message: 'You have uncommitted changes in your working tree. Please commit or stash them before merging.',
            details: {
                current_branch: currentBranch,
            },
        });
    }

    // Fetch latest state
    try {
        execSync(`git fetch origin ${branchName}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
        execSync(`git fetch origin ${baseBranch}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
    } catch (fetchError) {
        return JSON.stringify({
            success: false,
            action: 'merge',
            error: 'Failed to fetch branches',
            message: `Could not fetch '${branchName}' or '${baseBranch}' from origin. Ensure the branches exist on remote.`,
        });
    }

    // Checkout base branch
    try {
        execSync(`git checkout ${baseBranch}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
    } catch (checkoutError) {
        return JSON.stringify({
            success: false,
            action: 'merge',
            error: 'Failed to checkout base branch',
            message: `Could not checkout base branch '${baseBranch}'. You remain on '${currentBranch}'.`,
        });
    }

    // Pull latest base
    try {
        execSync(`git pull origin ${baseBranch}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
    } catch (pullError) {
        // Non-fatal, continue with merge
    }

    // Attempt merge
    try {
        execSync(`git merge --no-ff origin/${branchName} -m "Merge branch '${branchName}' into '${baseBranch}'"`, {
            cwd: repoPath,
            stdio: 'pipe',
        });
    } catch (mergeError: any) {
        // Check if it's a conflict
        const statusOutput = execSync('git status', {
            cwd: repoPath,
            encoding: 'utf-8',
        });

        if (statusOutput.includes('Unmerged paths') || statusOutput.includes('merge conflict')) {
            // Abort the merge
            execSync('git merge --abort', {
                cwd: repoPath,
                stdio: 'ignore',
            });

            // Extract conflicting files
            const conflictingFiles: string[] = [];
            const conflictMatches = statusOutput.matchAll(/both modified:\s+(.+)/g);
            for (const match of conflictMatches) {
                conflictingFiles.push(match[1].trim());
            }

            return JSON.stringify({
                success: false,
                action: 'merge',
                error: 'Merge conflict detected',
                message: `Cannot auto-merge '${branchName}' into '${baseBranch}'. Conflicts must be resolved manually.`,
                conflicting_files: conflictingFiles,
                next_steps: `Use process_branch({ branch_name: '${branchName}', action: 'checkout' }) to switch to the branch, resolve conflicts, commit, then retry merge.`,
            });
        }

        // Other merge error
        return JSON.stringify({
            success: false,
            action: 'merge',
            error: 'Merge failed',
            message: `Failed to merge '${branchName}' into '${baseBranch}': ${mergeError.message}`,
        });
    }

    // Push the merge
    try {
        execSync(`git push origin ${baseBranch}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
    } catch (pushError) {
        return JSON.stringify({
            success: false,
            action: 'merge',
            error: 'Push failed',
            message: `Merge succeeded locally, but failed to push to origin. You may need to pull and retry.`,
            details: {
                current_branch: baseBranch,
            },
        });
    }

    // Delete remote branch
    try {
        execSync(`git push origin --delete ${branchName}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
    } catch {
        // Ignore if branch doesn't exist on remote
    }

    // Delete local branch if it exists
    const deletedLocal = branchExistsLocally(repoPath, branchName);
    if (deletedLocal) {
        try {
            execSync(`git branch -d ${branchName}`, {
                cwd: repoPath,
                stdio: 'ignore',
            });
        } catch {
            // Ignore deletion errors
        }
    }

    const result: ProcessBranchResult = {
        success: true,
        action: 'merge',
        message: `Branch '${branchName}' successfully merged into '${baseBranch}' and deleted.`,
        details: {
            current_branch: baseBranch,
            deleted_branches: [`origin/${branchName}`, ...(deletedLocal ? [branchName] : [])],
        },
        next_steps: `You are now on branch '${baseBranch}'. The child branch has been integrated and cleaned up.`,
    };

    return JSON.stringify(result);
}

/**
 * Handle the 'reject' action
 */
async function handleReject(
    branchName: string,
    repoPath: string
): Promise<string> {
    const currentBranch = getCurrentBranch(repoPath);

    let deletedFromRemote = false;
    let deletedFromLocal = false;

    // Delete from remote
    try {
        execSync(`git push origin --delete ${branchName}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
        deletedFromRemote = true;
    } catch {
        // Branch may not exist on remote, continue
    }

    // Delete from local
    if (branchExistsLocally(repoPath, branchName)) {
        try {
            execSync(`git branch -D ${branchName}`, {
                cwd: repoPath,
                stdio: 'ignore',
            });
            deletedFromLocal = true;
        } catch {
            // Ignore deletion errors
        }
    }

    const result: ProcessBranchResult = {
        success: true,
        action: 'reject',
        message: `Branch '${branchName}' has been deleted.`,
        details: {
            deleted_from_remote: deletedFromRemote,
            deleted_from_local: deletedFromLocal,
            current_branch: currentBranch,
        },
        next_steps: `The branch and its work have been discarded. You remain on branch '${currentBranch}'.`,
    };

    return JSON.stringify(result);
}

/**
 * Handle the 'checkout' action
 */
async function handleCheckout(
    branchName: string,
    repoPath: string
): Promise<string> {
    const originalBranch = getCurrentBranch(repoPath);

    // Check for uncommitted changes
    if (hasUncommittedChanges(repoPath)) {
        return JSON.stringify({
            success: false,
            action: 'checkout',
            error: 'Uncommitted changes detected',
            message: 'You have uncommitted changes in your working tree. Please commit them before switching branches.',
            details: {
                current_branch: originalBranch,
            },
        });
    }

    // Fetch the branch
    try {
        execSync(`git fetch origin ${branchName}`, {
            cwd: repoPath,
            stdio: 'ignore',
        });
    } catch (fetchError) {
        return JSON.stringify({
            success: false,
            action: 'checkout',
            error: 'Failed to fetch branch',
            message: `Could not fetch '${branchName}' from origin. Ensure the branch exists on remote.`,
        });
    }

    // Checkout the branch
    try {
        if (branchExistsLocally(repoPath, branchName)) {
            execSync(`git checkout ${branchName}`, {
                cwd: repoPath,
                stdio: 'ignore',
            });
        } else {
            execSync(`git checkout -b ${branchName} origin/${branchName}`, {
                cwd: repoPath,
                stdio: 'ignore',
            });
        }
    } catch (checkoutError) {
        return JSON.stringify({
            success: false,
            action: 'checkout',
            error: 'Failed to checkout branch',
            message: `Could not checkout branch '${branchName}'. You remain on '${originalBranch}'.`,
        });
    }

    const result: ProcessBranchResult = {
        success: true,
        action: 'checkout',
        message: `Switched to branch '${branchName}'.`,
        details: {
            previous_branch: originalBranch,
            current_branch: branchName,
            uncommitted_changes: 0,
        },
        next_steps: `You are now on branch '${branchName}'. Make your changes using file tools, then commit them. When ready, call process_branch({ branch_name: '${branchName}', action: 'merge' }) to integrate your changes. To return to '${originalBranch}' without merging, call process_branch({ branch_name: '${originalBranch}', action: 'checkout' }) or use git checkout ${originalBranch}.`,
    };

    return JSON.stringify(result);
}

// Export tool schema for MCP registration
export const process_branch_schema = {
    name: 'process_branch',
    description: `Process a child job's branch by merging, rejecting, or checking out for manual intervention.

WORKFLOW:
1. Review the branch diff (provided in your context as "Rich Context")
2. Decide: merge (approve), reject (delete), or checkout (fix issues)
3. Call this tool with your decision

ACTIONS:

• merge: Merge the child branch into the base branch and delete the child branch.
  - Use when: The diff looks good and is ready to integrate.
  - Result: Child branch merged into base, then deleted. You remain on the base branch.
  - Note: If conflicts are detected, you'll be instructed to use 'checkout' to resolve them.

• reject: Delete the child branch without merging.
  - Use when: The work is incorrect, redundant, or not worth integrating.
  - Result: Child branch deleted from remote and local. You remain on your current branch.

• checkout: Switch to the child branch for manual intervention.
  - Use when: You need to fix bugs, resolve conflicts, or make changes before merging.
  - Result: You are moved to the child branch.
  - IMPORTANT: After making changes and committing, call process_branch again with action='merge' to integrate your fixes.
  - To return to your original branch without merging, use standard git commands (git checkout <branch>).

PARAMETERS:
- branch_name: The full name of the child branch (e.g., 'job/abc-123-feature-name')
- action: Your decision (merge, reject, checkout)
- rationale: A brief explanation of why you're taking this action (for audit trail)`,
    inputSchema: process_branch_params.shape,
};
