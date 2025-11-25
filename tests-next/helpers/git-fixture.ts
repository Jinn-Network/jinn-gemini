import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

export interface GitFixture {
  repoPath: string;
  remoteUrl: string;
  cleanup: () => void;
}

const TEMPLATE_DIR = path.resolve(process.cwd(), 'tests-next/fixtures/git-template');
const TMP_ROOT = path.join(
  os.tmpdir(),
  'jinn-gemini-tests',
  process.pid.toString(),
  'git-fixtures'
);

function assertTemplateRepo(): void {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    throw new Error(`Git template directory missing: ${TEMPLATE_DIR}`);
  }
  if (!fs.existsSync(path.join(TEMPLATE_DIR, '.git'))) {
    throw new Error(`Git template at ${TEMPLATE_DIR} is not a repository. Run 'git init' and add desired fixtures.`);
  }
}

function cleanupJobBranches(remoteUrl: string): void {
  // For real remote repos, we don't clean up branches here
  // They'll be cleaned up via GitHub API or left for manual cleanup
  // This function is kept for backward compatibility but does nothing for remote repos
  if (!remoteUrl || remoteUrl.includes('github.com') || remoteUrl.includes('git@')) {
    return;
  }
  
  // Only cleanup local template repo branches
  try {
    const result = execSync(
      `git -C ${JSON.stringify(TEMPLATE_DIR)} for-each-ref --format='%(refname:short)' 'refs/heads/job/*'`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    
    const branches = result.trim().split('\n').filter((b) => b.length > 0);

    for (const branch of branches) {
      try {
        execSync(
          `git -C ${JSON.stringify(TEMPLATE_DIR)} branch -D ${JSON.stringify(branch)}`,
          { stdio: 'ignore' }
        );
      } catch (err: any) {
        // Individual branch deletion failures are non-fatal
      }
    }
  } catch (error: any) {
    if (error.status !== 0 && error.stderr && !error.stderr.includes('no matching refs')) {
      console.warn(`Warning: Failed to cleanup job branches in template repo: ${error.message}`);
    }
  }
}

/**
 * Get the remote URL for the test repository
 * Uses TEST_GITHUB_REPO if available, otherwise falls back to template
 */
function getTestRemoteUrl(): string {
  const testRepo = process.env.TEST_GITHUB_REPO;
  if (testRepo) {
    return testRepo;
  }
  // Fallback to template (for backward compatibility)
  return TEMPLATE_DIR;
}

export function createGitFixture(): GitFixture {
  const remoteUrl = getTestRemoteUrl();
  const useRemoteRepo = remoteUrl !== TEMPLATE_DIR;
  
  if (!useRemoteRepo) {
    // Legacy path: use template repo
  assertTemplateRepo();
    cleanupJobBranches(remoteUrl);
  }
  
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const target = path.join(TMP_ROOT, `fixture-${Date.now()}-${randomUUID()}`);
  
  // Clone from remote or template
  if (useRemoteRepo) {
    // Clone from real GitHub remote
    // Use HTTPS with token if GITHUB_TOKEN is available
    const token = process.env.GITHUB_TOKEN;
    let cloneUrl = remoteUrl;
    
    // Clone with token authentication if using HTTPS
    if (token && cloneUrl.startsWith('https://')) {
      const url = new URL(cloneUrl);
      url.username = token;
      cloneUrl = url.toString();
    }
    
    execSync(`git clone ${JSON.stringify(cloneUrl)} ${JSON.stringify(target)}`, {
      stdio: ['ignore', 'pipe', 'pipe'],  // Suppress output containing token
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    
    // For HTTPS URLs with token, the remote URL already has the token embedded
    // No need to update remote URL - git already stored it with the token
  } else {
    // Legacy: clone from template
  execSync(`git clone ${JSON.stringify(TEMPLATE_DIR)} ${JSON.stringify(target)}`, { stdio: 'inherit' });
  }

  return {
    repoPath: target,
    remoteUrl,
    cleanup: () => {
      fs.rmSync(target, { recursive: true, force: true });
    },
  };
}

export async function withGitFixture<T>(
  fn: (fixture: GitFixture) => Promise<T> | T
): Promise<T> {
  const fixture = createGitFixture();
  const prevRepoRoot = process.env.CODE_METADATA_REPO_ROOT;
  process.env.CODE_METADATA_REPO_ROOT = fixture.repoPath;
  try {
    return await fn(fixture);
  } finally {
    fixture.cleanup();
    if (typeof prevRepoRoot === 'undefined') {
      delete process.env.CODE_METADATA_REPO_ROOT;
    } else {
      process.env.CODE_METADATA_REPO_ROOT = prevRepoRoot;
    }
  }
}
