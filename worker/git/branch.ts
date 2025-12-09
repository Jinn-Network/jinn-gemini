/**
 * Branch management: checkout, creation, and naming
 */

import { workerLogger } from '../../logging/index.js';
import { getRepoRoot } from '../../shared/repo_utils.js';
import type { CodeMetadata } from '../../gemini-agent/shared/code_metadata.js';
import { buildJobBranchName as buildBranchNameFromMetadata } from '../../gemini-agent/shared/code_metadata.js';
import { DEFAULT_BASE_BRANCH, GIT_CHECKOUT_TIMEOUT_MS } from '../constants.js';
import { serializeError } from '../logging/errors.js';

/**
 * Method used to checkout the branch
 */
export type CheckoutMethod = 'local' | 'remote_tracking' | 'new_from_base';

/**
 * Result of branch checkout/creation
 */
export interface BranchCheckoutResult {
  branchName: string;
  wasNewlyCreated: boolean;
  checkoutMethod: CheckoutMethod;
}

/**
 * Check if a local branch exists
 */
function localBranchExists(repoRoot: string, branchName: string, execFileSync: typeof import('node:child_process').execFileSync): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', branchName], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return true;
  } catch {
    // Expected: git rev-parse fails when branch doesn't exist - this IS the signal
    return false;
  }
}

/**
 * Check if a remote branch exists
 */
function remoteBranchExists(repoRoot: string, branchName: string, execFileSync: typeof import('node:child_process').execFileSync): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', `origin/${branchName}`], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return true;
  } catch {
    // Expected: git rev-parse fails when remote branch doesn't exist - this IS the signal
    return false;
  }
}

/**
 * Checkout job branch, creating it if needed
 */
export async function checkoutJobBranch(codeMetadata: CodeMetadata): Promise<BranchCheckoutResult> {
  const branchName = codeMetadata.branch?.name;
  if (!branchName) {
    throw new Error('codeMetadata.branch.name is required for checkout');
  }

  // Determine repo root using shared logic
  const repoRoot = getRepoRoot(codeMetadata);
  const baseBranch = codeMetadata.baseBranch || DEFAULT_BASE_BRANCH;

  workerLogger.info({ branchName, repoRoot }, 'Checking out job branch');

  const { execFileSync } = await import('node:child_process');
  
  // Check what exists BEFORE attempting checkout to pick the right strategy
  const hasLocalBranch = localBranchExists(repoRoot, branchName, execFileSync);
  const hasRemoteBranch = remoteBranchExists(repoRoot, branchName, execFileSync);
  
  workerLogger.debug({ branchName, hasLocalBranch, hasRemoteBranch }, 'Branch existence check');

  // Case 1: Local branch exists - just checkout
  if (hasLocalBranch) {
    try {
      execFileSync('git', ['checkout', branchName], {
        cwd: repoRoot,
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: GIT_CHECKOUT_TIMEOUT_MS,
        env: process.env as Record<string, string>,
      });
      workerLogger.info({ branchName }, 'Successfully checked out existing local branch');
      return { branchName, wasNewlyCreated: false, checkoutMethod: 'local' };
    } catch (localCheckoutError: any) {
      const errorMessage = `Failed to checkout existing local branch ${branchName}: ${localCheckoutError.stderr || localCheckoutError.message}`;
      workerLogger.error({ branchName, error: serializeError(localCheckoutError) }, errorMessage);
      throw new Error(errorMessage);
    }
  }

  // Case 2: Remote branch exists but local doesn't - create tracking branch
  if (hasRemoteBranch) {
    try {
      execFileSync('git', ['checkout', '-b', branchName, `origin/${branchName}`], {
        cwd: repoRoot,
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: GIT_CHECKOUT_TIMEOUT_MS,
        env: process.env as Record<string, string>,
      });
      workerLogger.info({ branchName }, 'Successfully created local tracking branch from origin');
      return { branchName, wasNewlyCreated: false, checkoutMethod: 'remote_tracking' };
    } catch (remoteCheckoutError: any) {
      const errorMessage = `Failed to create tracking branch ${branchName} from origin: ${remoteCheckoutError.stderr || remoteCheckoutError.message}`;
      workerLogger.error({ branchName, error: serializeError(remoteCheckoutError) }, errorMessage);
      throw new Error(errorMessage);
    }
  }

  // Case 3: Neither exists - create new branch from baseBranch
  workerLogger.info({ branchName, baseBranch }, 'Creating new branch from baseBranch');
  try {
    execFileSync('git', ['checkout', '-b', branchName, baseBranch], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: GIT_CHECKOUT_TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ branchName, baseBranch }, 'Successfully created branch from baseBranch');
    return { branchName, wasNewlyCreated: true, checkoutMethod: 'new_from_base' };
  } catch (fallbackError: any) {
    const errorMessage = `Failed to create branch ${branchName} from ${baseBranch}: ${fallbackError.stderr || fallbackError.message}`;
    workerLogger.error({ branchName, baseBranch, error: serializeError(fallbackError) }, errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * Build job branch name from job definition ID and optional job name
 * Uses the same logic as gemini-agent/shared/code_metadata.ts
 */
export function buildJobBranchName(options: {
  jobDefinitionId: string;
  jobName?: string | null;
  maxSlugLength?: number;
}): string {
  return buildBranchNameFromMetadata(options);
}

/**
 * Ensure job branch exists and is checked out
 * Wrapper around checkoutJobBranch for consistency
 */
export async function ensureJobBranch(codeMetadata: CodeMetadata): Promise<BranchCheckoutResult> {
  return checkoutJobBranch(codeMetadata);
}

/**
 * Result of syncing with a branch
 */
export interface SyncBranchResult {
  /** Whether the sync completed (merge or no-op) */
  synced: boolean;
  /** Whether there are merge conflicts in the working tree */
  hasConflicts: boolean;
  /** List of files with conflicts (if any) */
  conflictingFiles: string[];
  /** The branch that was merged from */
  sourceBranch: string;
}

/**
 * Sync current branch with a target branch by merging it in
 *
 * If conflicts occur, they are LEFT in the working tree for the agent to resolve.
 * This enables the agent to see and fix conflicts as part of its task.
 *
 * @param repoRoot - Repository root path
 * @param targetBranch - Branch to merge from (e.g., 'origin/job/dep-branch')
 * @returns Result indicating success and any conflicts
 */
export async function syncWithBranch(
  repoRoot: string,
  targetBranch: string
): Promise<SyncBranchResult> {
  const { execFileSync } = await import('node:child_process');

  workerLogger.info({ targetBranch, repoRoot }, 'Syncing with branch');

  // First check if the target branch exists
  const hasLocal = localBranchExists(repoRoot, targetBranch, execFileSync);
  const hasRemote = remoteBranchExists(repoRoot, targetBranch.replace('origin/', ''), execFileSync);

  // Determine the actual ref to merge
  let mergeRef = targetBranch;
  if (!hasLocal && hasRemote && !targetBranch.startsWith('origin/')) {
    mergeRef = `origin/${targetBranch}`;
  } else if (!hasLocal && !hasRemote) {
    workerLogger.warn({ targetBranch }, 'Target branch does not exist, skipping sync');
    return {
      synced: true,
      hasConflicts: false,
      conflictingFiles: [],
      sourceBranch: targetBranch,
    };
  }

  try {
    // Attempt merge - this may fail with conflicts
    execFileSync('git', ['merge', mergeRef, '--no-edit'], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: GIT_CHECKOUT_TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });

    workerLogger.info({ targetBranch, mergeRef }, 'Successfully merged branch');
    return {
      synced: true,
      hasConflicts: false,
      conflictingFiles: [],
      sourceBranch: targetBranch,
    };
  } catch (mergeError: any) {
    // Check if this is a merge conflict (exit code 1 with conflict markers)
    const stderr = mergeError.stderr || '';
    const stdout = mergeError.stdout || '';

    if (stderr.includes('CONFLICT') || stdout.includes('CONFLICT') || stderr.includes('Automatic merge failed')) {
      // Get the list of conflicting files
      const conflictingFiles = getConflictingFiles(repoRoot, execFileSync);

      workerLogger.warn(
        { targetBranch, mergeRef, conflictCount: conflictingFiles.length, conflictingFiles },
        'Merge conflicts detected - leaving in working tree for agent resolution'
      );

      return {
        synced: false,
        hasConflicts: true,
        conflictingFiles,
        sourceBranch: targetBranch,
      };
    }

    // Some other merge error - log and re-throw
    const errorMessage = `Failed to merge ${mergeRef}: ${stderr || mergeError.message}`;
    workerLogger.error({ targetBranch, mergeRef, error: serializeError(mergeError) }, errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * Get list of files with merge conflicts
 */
function getConflictingFiles(
  repoRoot: string,
  execFileSync: typeof import('node:child_process').execFileSync
): string[] {
  try {
    // git diff --name-only --diff-filter=U lists unmerged (conflicting) files
    const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return output.trim().split('\n').filter(Boolean);
  } catch {
    // If this fails, return empty array - merge status is already tracked
    return [];
  }
}

