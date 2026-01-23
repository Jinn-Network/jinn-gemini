/**
 * Repository management: cloning, fetching, and root resolution
 */

import { existsSync } from 'node:fs';
import { workerLogger } from '../../logging/index.js';
import { getRepoRoot, extractRepoName, getJinnWorkspaceDir } from '../../shared/repo_utils.js';
import type { CodeMetadata } from '../../gemini-agent/shared/code_metadata.js';
import { GIT_CLONE_TIMEOUT_MS, GIT_FETCH_TIMEOUT_MS } from '../constants.js';
import { serializeError } from '../logging/errors.js';
// Repo setup (gitignore, beads) now happens in jobRunner after branch checkout

function buildGithubHttpsUrl(remoteUrl: string): string | null {
  if (!remoteUrl) return null;
  if (remoteUrl.startsWith('https://github.com/')) {
    return remoteUrl;
  }
  if (remoteUrl.startsWith('git@github.com:')) {
    const path = remoteUrl.slice('git@github.com:'.length);
    return `https://github.com/${path}`;
  }
  return null;
}

/**
 * Normalize SSH URL to use local host alias if configured.
 * This allows workers to use a custom SSH host (e.g., 'ritsukai' instead of 'github.com')
 * when the user has a non-default SSH key setup.
 * 
 * Set SSH_HOST_ALIAS=ritsukai in .env to rewrite git@github.com: to git@ritsukai:
 */
function normalizeSshUrl(url: string): string {
  const sshHostAlias = process.env.SSH_HOST_ALIAS;
  if (sshHostAlias && url.startsWith('git@github.com:')) {
    const normalizedUrl = url.replace('git@github.com:', `git@${sshHostAlias}:`);
    workerLogger.debug({ originalUrl: url, normalizedUrl, sshHostAlias }, 'Normalized SSH URL using host alias');
    return normalizedUrl;
  }
  return url;
}

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

  // URL should already be normalized at dispatch time (stored in IPFS metadata)
  // Clone using the URL as-is from the job metadata
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

  // For HTTPS GitHub URLs, embed token if available for private repo access
  let cloneUrl = normalizeSshUrl(remoteUrl);
  const token = process.env.GITHUB_TOKEN;
  if (token && remoteUrl.startsWith('https://github.com/')) {
    cloneUrl = remoteUrl.replace('https://', `https://${token}@`);
    workerLogger.debug({ targetPath }, 'Using GITHUB_TOKEN for HTTPS clone');
  }

  try {
    execFileSync('git', ['clone', cloneUrl, targetPath], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: GIT_CLONE_TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ targetPath }, 'Successfully cloned repository');
  } catch (error: any) {
    const stderr = String(error.stderr || '');
    const authFailed = stderr.includes('Permission denied (publickey)') || stderr.includes('publickey');

    if (authFailed) {
      const httpsUrl = buildGithubHttpsUrl(remoteUrl);
      const token = process.env.GITHUB_TOKEN;
      const authUrl = httpsUrl && token ? httpsUrl.replace('https://', `https://${token}@`) : httpsUrl;

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9fd4337f-5218-4559-b6d9-8556e77bd112', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'worker/git/repoManager.ts:83', message: 'ssh clone failed; https fallback decision', data: { remoteUrl, httpsUrl, hasToken: !!token, targetPath }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'H4' }) }).catch(() => { });
      // #endregion

      if (authUrl) {
        try {
          execFileSync('git', ['clone', authUrl, targetPath], {
            stdio: 'pipe',
            encoding: 'utf-8',
            timeout: GIT_CLONE_TIMEOUT_MS,
            env: process.env as Record<string, string>,
          });
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/9fd4337f-5218-4559-b6d9-8556e77bd112', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'worker/git/repoManager.ts:100', message: 'https fallback clone succeeded', data: { httpsUrl, hasToken: !!token, targetPath }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'H4' }) }).catch(() => { });
          // #endregion
          workerLogger.info({ targetPath, httpsUrl }, 'Successfully cloned repository via HTTPS');
          return { wasAlreadyCloned: false, fetchPerformed: false };
        } catch (fallbackError: any) {
          const fallbackStderr = String(fallbackError.stderr || '').slice(0, 300);
          const fallbackStatus403 = fallbackStderr.includes('error: 403') || fallbackStderr.includes('Write access to repository not granted');
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/9fd4337f-5218-4559-b6d9-8556e77bd112', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'worker/git/repoManager.ts:108', message: 'https fallback clone failed', data: { httpsUrl, hasToken: !!token, targetPath, stderrSample: fallbackStderr, is403: fallbackStatus403 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'H4' }) }).catch(() => { });
          // #endregion
          const fallbackMessage = fallbackStatus403
            ? 'Failed to clone repository via HTTPS: token lacks access to repository (403).'
            : `Failed to clone repository via HTTPS: ${fallbackError.stderr || fallbackError.message}`;
          workerLogger.error({ httpsUrl, targetPath, error: serializeError(fallbackError) }, fallbackMessage);
        }
      }
    }

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

