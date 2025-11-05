/**
 * Push branch to remote with error handling
 */

import { workerLogger } from '../../logging/index.js';
import { getRepoRoot } from '../../shared/repo_utils.js';
import type { CodeMetadata } from '../../gemini-agent/shared/code_metadata.js';
import { DEFAULT_REMOTE_NAME, GIT_PUSH_TIMEOUT_MS } from '../constants.js';
import { serializeError } from '../logging/errors.js';

/**
 * Custom error for git push failures
 */
export class GitPushError extends Error {
  constructor(
    message: string,
    public readonly branchName: string,
    public readonly remote: string,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'GitPushError';
  }
}

/**
 * Push job branch to remote
 */
export async function pushJobBranch(branchName: string, codeMetadata: CodeMetadata): Promise<void> {
  // Determine repo root using shared logic
  const repoRoot = getRepoRoot(codeMetadata);
  const remoteName = DEFAULT_REMOTE_NAME;
  const { execFileSync } = await import('node:child_process');

  const pushInfo = {
    branchName,
    repoRoot,
    remoteName,
    codeMetadataRepoRoot: process.env.CODE_METADATA_REPO_ROOT,
    remoteUrl: codeMetadata?.repo?.remoteUrl,
  };
  workerLogger.info(pushInfo, 'Pushing job branch to remote');
  console.error('[WORKER-PUSH-DEBUG] Pushing job branch:', JSON.stringify(pushInfo));

  // Verify remote configuration
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', remoteName], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    workerLogger.info({ branchName, remoteName, remoteUrl }, 'Remote URL configured');
  } catch (remoteCheckError: any) {
    workerLogger.warn({ branchName, remoteName, error: serializeError(remoteCheckError) }, 'Failed to get remote URL (non-fatal)');
  }

  try {
    // Push with -u to set upstream tracking
    execFileSync('git', ['push', '-u', remoteName, `${branchName}:${branchName}`], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: GIT_PUSH_TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ branchName, remote: remoteName, repoRoot }, 'Successfully pushed branch');
    console.error('[WORKER-PUSH-DEBUG] Successfully pushed branch:', branchName, 'to', remoteName, 'in', repoRoot);
  } catch (error: any) {
    const errorMessage = `Failed to push branch ${branchName} to ${remoteName}: ${error.stderr || error.message}`;
    workerLogger.error({ branchName, remote: remoteName, error: serializeError(error) }, errorMessage);
    
    // Determine if this is a "no commits" error vs network/authentication error
    const stderr = String(error.stderr || '');
    const isNoCommitsError = stderr.includes('no commits') || stderr.includes('nothing to push');
    
    throw new GitPushError(
      errorMessage,
      branchName,
      remoteName,
      error
    );
  }
}

