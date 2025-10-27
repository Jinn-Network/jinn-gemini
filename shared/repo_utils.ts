import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import type { CodeMetadata } from '../gemini-agent/shared/code_metadata.js';
import { getJinnWorkspaceDir as getConfigJinnWorkspaceDir } from '../config/index.js';

/**
 * Extract repository name from a remote URL
 *
 * Supports various formats:
 * - git@github.com:user/repo.git -> repo
 * - git@host:user/repo.git -> repo
 * - https://github.com/user/repo.git -> repo
 * - https://github.com/user/repo -> repo
 *
 * @param remoteUrl - Git remote URL
 * @returns Repository name or null if cannot be extracted
 */
export function extractRepoName(remoteUrl: string): string | null {
  if (!remoteUrl) return null;

  // Match patterns like:
  // git@github.com:user/repo.git
  // git@host:user/repo.git
  // https://github.com/user/repo.git
  // https://github.com/user/repo
  const match = remoteUrl.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);

  if (!match || !match[2]) return null;

  return match[2];
}

/**
 * Get the Jinn workspace directory where ventures are cloned
 * Expands ~ to home directory and creates directory if needed
 *
 * @returns Absolute path to workspace directory
 */
export function getJinnWorkspaceDir(): string {
  const workspaceDir = getConfigJinnWorkspaceDir() || '~/jinn-repos';

  // Expand ~ to home directory
  const expandedPath = workspaceDir.startsWith('~')
    ? join(homedir(), workspaceDir.slice(1))
    : workspaceDir;

  // Create directory if it doesn't exist
  if (!existsSync(expandedPath)) {
    mkdirSync(expandedPath, { recursive: true });
  }

  return expandedPath;
}

/**
 * Determine the repository root directory for a job
 *
 * Priority order:
 * 1. CODE_METADATA_REPO_ROOT environment variable (for tests/local development override)
 * 2. If codeMetadata.repo.remoteUrl is provided: {JINN_WORKSPACE_DIR}/{repo-name}
 * 3. process.cwd() (fallback)
 *
 * @param codeMetadata - Code metadata containing repository information
 * @returns Absolute path to repository root
 */
export function getRepoRoot(codeMetadata?: CodeMetadata): string {
  // Priority 1: CODE_METADATA_REPO_ROOT env var (tests/local development override)
  if (process.env.CODE_METADATA_REPO_ROOT) {
    return process.env.CODE_METADATA_REPO_ROOT;
  }

  // Priority 2: Derive from remoteUrl (preferred for ventures)
  if (codeMetadata?.repo?.remoteUrl) {
    const repoName = extractRepoName(codeMetadata.repo.remoteUrl);
    if (repoName) {
      const workspaceDir = getJinnWorkspaceDir();
      return join(workspaceDir, repoName);
    }
  }

  // Priority 3: Current working directory (fallback)
  return process.cwd();
}
