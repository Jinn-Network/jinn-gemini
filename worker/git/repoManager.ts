/**
 * Repository management: cloning, fetching, and root resolution
 */

import { existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

    // Ensure GEMINI.md exists (may have been added after initial clone)
    copyGeminiMdToRepo(targetPath);
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

  // Copy GEMINI.md to venture repo so agents receive operating instructions
  copyGeminiMdToRepo(targetPath);

  return { wasAlreadyCloned: false, fetchPerformed };
}

/**
 * Copy GEMINI.md from main repo to venture repo
 * This ensures agents receive Jinn's operating system instructions
 */
function copyGeminiMdToRepo(targetPath: string): void {
  try {
    // Resolve path to source GEMINI.md (in gemini-agent/ directory of main repo)
    const currentFile = fileURLToPath(import.meta.url);
    const mainRepoRoot = join(dirname(currentFile), '..', '..');
    const sourcePath = join(mainRepoRoot, 'gemini-agent', 'GEMINI.md');
    const destPath = join(targetPath, 'GEMINI.md');

    // Only copy if source exists and dest doesn't exist
    if (existsSync(sourcePath)) {
      if (!existsSync(destPath)) {
        copyFileSync(sourcePath, destPath);
        workerLogger.info({ sourcePath, destPath }, 'Copied GEMINI.md to venture repo');
      } else {
        workerLogger.debug({ destPath }, 'GEMINI.md already exists in venture repo');
      }
    } else {
      workerLogger.warn({ sourcePath }, 'Source GEMINI.md not found - venture repo will not have agent instructions');
    }
  } catch (error: any) {
    workerLogger.warn({ targetPath, error: serializeError(error) }, 'Failed to copy GEMINI.md (non-fatal)');
  }
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

