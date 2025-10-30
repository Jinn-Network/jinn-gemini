import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { extractRepoName, getJinnWorkspaceDir } from '../../shared/repo_utils.js';

export interface TestGitRepo {
  repoPath: string;
  workspacePath: string;
  cleanup: () => void;
}

/**
 * Set up a test git repository using the real GitHub test repo
 *
 * Requires TEST_GITHUB_REPO environment variable to be set.
 *
 * Structure:
 * tests/fixtures/
 *   test-repo-${suiteId}/          # Working directory cloned from GitHub
 */
export function setupTestGitRepo(repoPath: string): TestGitRepo {
  const githubRemote = process.env.TEST_GITHUB_REPO;

  if (!githubRemote) {
    throw new Error(
      'TEST_GITHUB_REPO environment variable is required. ' +
      'Set it to the GitHub repository URL (e.g., git@github.com:user/test-repo.git)'
    );
  }

  // Clean up existing repo if present
  if (fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(repoPath);
  fs.mkdirSync(parentDir, { recursive: true });

  console.log(`[test-repo] Cloning from GitHub: ${githubRemote}`);

  // Clone repository from GitHub
  execSync(`git clone ${githubRemote} ${repoPath}`, {
    stdio: 'inherit',
    timeout: 30000
  });

  // Configure git user for test commits
  execSync('git config user.email "test@jinn.local"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Jinn Test"', { cwd: repoPath, stdio: 'ignore' });

  const workspacePath = ensureWorkspaceWorktree(repoPath, githubRemote);

  console.log('[test-repo] ✓ Test git repository ready');

  return {
    repoPath,
    workspacePath,
    cleanup: () => {
      // Clean up test branches (but keep main)
      try {
        const branches = execSync('git branch --format="%(refname:short)"', {
          cwd: repoPath,
          encoding: 'utf-8'
        }).split('\n').filter(b => b && b !== 'main' && b.startsWith('job/'));

        for (const branch of branches) {
          try {
            execSync(`git branch -D ${branch}`, { cwd: repoPath, stdio: 'ignore' });
            execSync(`git push origin --delete ${branch}`, { cwd: repoPath, stdio: 'ignore' });
          } catch {
            // Branch may not exist on remote, that's ok
          }
        }

        // Switch back to main
        execSync('git checkout main', { cwd: repoPath, stdio: 'ignore' });
        console.log('[test-repo] Cleaned up test branches');
      } catch (e: any) {
        console.warn('[test-repo] Cleanup warning:', e.message);
      }

      removeWorkspaceWorktree(repoPath, workspacePath);
    }
  };
}

/**
 * Get or create persistent test repo (reuses existing if present)
 *
 * Requires TEST_GITHUB_REPO environment variable to be set.
 *
 * @param suiteId - Unique suite identifier for parallel test isolation
 */
export function getTestGitRepo(suiteId: string): TestGitRepo {
  const remoteHint = process.env.TEST_GITHUB_REPO;

  if (!remoteHint) {
    throw new Error(
      'TEST_GITHUB_REPO environment variable is required. ' +
      'Set it to your test repository URL (e.g., git@github.com:user/test-repo.git)'
    );
  }

  return getOrCreateGitHubTestRepo(remoteHint, suiteId);
}

/**
 * Get or create a full GitHub test repo (for tests that need push/PR)
 */
function getOrCreateGitHubTestRepo(remoteHint: string, suiteId: string): TestGitRepo {
  const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');
  const repoPath = path.join(fixturesDir, `test-repo-${suiteId}`);

  // If repo exists and is valid, return it
  if (fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, '.git'))) {
    try {
      // Verify it's a valid repo
      execSync('git status', { cwd: repoPath, stdio: 'ignore' });
      console.log('[test-repo] Using existing GitHub test repository');

      const workspacePath = ensureWorkspaceWorktree(repoPath, remoteHint);

      return {
        repoPath,
        workspacePath,
        cleanup: () => {
          // Same cleanup logic
          try {
            const branches = execSync('git branch --format="%(refname:short)"', {
              cwd: repoPath,
              encoding: 'utf-8'
            }).split('\n').filter(b => b && b !== 'main' && b.startsWith('job/'));

            for (const branch of branches) {
              try {
                execSync(`git branch -D ${branch}`, { cwd: repoPath, stdio: 'ignore' });
                execSync(`git push origin --delete ${branch}`, { cwd: repoPath, stdio: 'ignore' });
              } catch {}
            }

            execSync('git checkout main', { cwd: repoPath, stdio: 'ignore' });
            console.log('[test-repo] Cleaned up test branches');
          } catch (e: any) {
            console.warn('[test-repo] Cleanup warning:', e.message);
          }

          removeWorkspaceWorktree(repoPath, workspacePath);
        }
      };
    } catch {
      // Repo is corrupt, recreate it
      console.log('[test-repo] Existing repo is invalid, recreating...');
    }
  }

  // Create fresh repo
  return setupTestGitRepo(repoPath);
}

function ensureWorkspaceWorktree(repoPath: string, remoteHint?: string | null): string {
  const repoName = deriveRepoName(repoPath, remoteHint);
  const workspaceDir = getJinnWorkspaceDir();
  const workspacePath = path.join(workspaceDir, repoName);

  try {
    const list = execSync('git worktree list --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8'
    });
    const hasWorktree = list
      .split('\n')
      .some(line => line.startsWith('worktree ') && line.slice('worktree '.length).trim() === workspacePath);

    if (!hasWorktree) {
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
      execSync(`git worktree add --force --detach ${workspacePath}`, {
        cwd: repoPath,
        stdio: 'ignore'
      });
    }
  } catch (error) {
    console.warn('[test-repo] Failed to ensure workspace worktree:', error instanceof Error ? error.message : error);
  }

  return workspacePath;
}

function removeWorkspaceWorktree(repoPath: string, workspacePath: string): void {
  try {
    const list = execSync('git worktree list --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8'
    });
    const hasWorktree = list
      .split('\n')
      .some(line => line.startsWith('worktree ') && line.slice('worktree '.length).trim() === workspacePath);

    if (hasWorktree) {
      execSync(`git worktree remove --force ${workspacePath}`, {
        cwd: repoPath,
        stdio: 'ignore'
      });
    }
  } catch (error) {
    console.warn('[test-repo] Failed to remove workspace worktree:', error instanceof Error ? error.message : error);
  }

  try {
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('[test-repo] Failed to delete workspace mirror path:', error instanceof Error ? error.message : error);
  }
}

function deriveRepoName(repoPath: string, remoteHint?: string | null): string {
  const remoteUrl = remoteHint ?? detectRemoteUrl(repoPath);
  return extractRepoName(remoteUrl || '') ?? path.basename(repoPath);
}

function detectRemoteUrl(repoPath: string): string | null {
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim();
    return remote || null;
  } catch {
    return null;
  }
}
