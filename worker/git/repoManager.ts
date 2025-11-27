/**
 * Repository management: cloning, fetching, and root resolution
 */

import { existsSync } from 'node:fs';
import { workerLogger } from '../../logging/index.js';
import { getRepoRoot, extractRepoName, getJinnWorkspaceDir } from '../../shared/repo_utils.js';
import type { CodeMetadata } from '../../gemini-agent/shared/code_metadata.js';
import { GIT_CLONE_TIMEOUT_MS, GIT_FETCH_TIMEOUT_MS } from '../constants.js';
import { serializeError } from '../logging/errors.js';

/**
 * Result of repository clone/fetch operation
 */
export interface RepoCloneResult {
  wasAlreadyCloned: boolean;
  fetchPerformed: boolean;
}

/**
 * Ensure repository is cloned to the workspace directory
 * Clones if it doesn't exist, otherwise fetches latest refs
 * @returns Result indicating whether repo was already cloned and if fetch was performed
 */
export async function ensureRepoCloned(remoteUrl: string, targetPath: string): Promise<RepoCloneResult> {
  const { execFileSync } = await import('node:child_process');

  if (existsSync(targetPath)) {
    workerLogger.info({ targetPath }, 'Repository already cloned');
    // Always fetch branches to ensure we have latest remote refs
    let fetchPerformed = false;
    try {
      execFileSync('git', ['fetch', '--all'], {
        cwd: targetPath,
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: GIT_FETCH_TIMEOUT_MS,
        env: process.env as Record<string, string>,
      });
      workerLogger.info({ targetPath }, 'Fetched all branches');
      fetchPerformed = true;
    } catch (error: any) {
      workerLogger.warn({ targetPath, error: serializeError(error) }, 'Failed to fetch all branches (non-fatal)');
    }

    return { wasAlreadyCloned: true, fetchPerformed };
  }

  workerLogger.info({ remoteUrl, targetPath }, 'Cloning repository');

  try {
    execFileSync('git', ['clone', remoteUrl, targetPath], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: GIT_CLONE_TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ targetPath }, 'Successfully cloned repository');
  } catch (error: any) {
    const errorMessage = `Failed to clone repository: ${error.stderr || error.message}`;
    workerLogger.error({ remoteUrl, targetPath, error: serializeError(error) }, errorMessage);
    throw new Error(errorMessage);
  }

  // Fetch all branches
  let fetchPerformed = false;
  try {
    execFileSync('git', ['fetch', '--all'], {
      cwd: targetPath,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: GIT_FETCH_TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ targetPath }, 'Fetched all branches');
    fetchPerformed = true;
  } catch (error: any) {
    workerLogger.warn({ targetPath, error: serializeError(error) }, 'Failed to fetch all branches (non-fatal)');
  }

  return { wasAlreadyCloned: false, fetchPerformed };
}

/**
 * Get repository root for a given code metadata
 * Uses shared repo_utils logic
 */
export function getRepoRootForMetadata(codeMetadata?: CodeMetadata): string {
  return getRepoRoot(codeMetadata);
}

/**
 * Prepare repository for job execution
 * Clones repo if needed and returns repo root path
 */
export async function prepareRepoForJob(codeMetadata: CodeMetadata): Promise<string> {
  if (codeMetadata?.repo?.remoteUrl) {
    const repoName = extractRepoName(codeMetadata.repo.remoteUrl);
    if (repoName) {
      const workspaceDir = getJinnWorkspaceDir();
      const repoRoot = `${workspaceDir}/${repoName}`;
      await ensureRepoCloned(codeMetadata.repo.remoteUrl, repoRoot);
      return repoRoot;
    }
  }
  
  // Fallback to current working directory or env override
  return getRepoRoot(codeMetadata);
}

