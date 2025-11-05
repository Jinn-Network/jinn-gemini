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
 * Result of branch checkout/creation
 */
export interface BranchCheckoutResult {
  branchName: string;
  wasNewlyCreated: boolean;
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
  
  let wasNewlyCreated = false;

  // First, try to checkout existing local branch
  try {
    execFileSync('git', ['checkout', branchName], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: GIT_CHECKOUT_TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ branchName }, 'Successfully checked out existing local branch');
    return { branchName, wasNewlyCreated: false };
  } catch (localCheckoutError: any) {
    // Branch doesn't exist locally, try to create tracking branch from origin
    workerLogger.debug({ branchName }, 'Local branch not found, checking for remote branch');
  }

  // Check if remote branch exists and create local tracking branch
  try {
    execFileSync('git', ['checkout', '-b', branchName, `origin/${branchName}`], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: GIT_CHECKOUT_TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ branchName }, 'Successfully created local tracking branch from origin');
    return { branchName, wasNewlyCreated: false };
  } catch (remoteCheckoutError: any) {
    // Remote branch doesn't exist, create from baseBranch as fallback
    workerLogger.warn({ branchName, baseBranch }, 'Remote branch not found, creating from baseBranch');
    try {
      execFileSync('git', ['checkout', '-b', branchName, baseBranch], {
        cwd: repoRoot,
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: GIT_CHECKOUT_TIMEOUT_MS,
        env: process.env as Record<string, string>,
      });
      workerLogger.info({ branchName, baseBranch }, 'Successfully created branch from baseBranch');
      wasNewlyCreated = true;
      return { branchName, wasNewlyCreated: true };
    } catch (fallbackError: any) {
      const errorMessage = `Failed to checkout branch ${branchName}: ${fallbackError.stderr || fallbackError.message}`;
      workerLogger.error({ branchName, baseBranch, error: serializeError(fallbackError) }, errorMessage);
      throw new Error(errorMessage);
    }
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

