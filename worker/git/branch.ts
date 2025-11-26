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

