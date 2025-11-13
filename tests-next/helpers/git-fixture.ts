import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

export interface GitFixture {
  repoPath: string;
  cleanup: () => void;
}

const TEMPLATE_DIR = path.resolve(process.cwd(), 'tests-next/fixtures/git-template');
const TMP_ROOT = path.resolve(process.cwd(), 'tests-next', '.tmp', 'git-fixtures');

function assertTemplateRepo(): void {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    throw new Error(`Git template directory missing: ${TEMPLATE_DIR}`);
  }
  if (!fs.existsSync(path.join(TEMPLATE_DIR, '.git'))) {
    throw new Error(`Git template at ${TEMPLATE_DIR} is not a repository. Run 'git init' and add desired fixtures.`);
  }
}

function cleanupJobBranches(): void {
  try {
    // List all job/* branches and delete them one by one to avoid command-line length limits
    const result = execSync(
      `git -C ${JSON.stringify(TEMPLATE_DIR)} for-each-ref --format='%(refname:short)' 'refs/heads/job/*'`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    
    const branches = result.trim().split('\n').filter((b) => b.length > 0);

    // Delete branches one at a time to avoid command-line length issues
    for (const branch of branches) {
      try {
        execSync(
          `git -C ${JSON.stringify(TEMPLATE_DIR)} branch -D ${JSON.stringify(branch)}`,
          { stdio: 'ignore' }
        );
      } catch (err: any) {
        // Individual branch deletion failures are non-fatal (branch might not exist)
        // Continue with other branches
      }
    }
  } catch (error: any) {
    // If there are no branches, for-each-ref exits with non-zero status - that's fine
    // Only log unexpected errors
    if (error.status !== 0 && error.stderr && !error.stderr.includes('no matching refs')) {
      // Log but don't throw - we don't want to fail the test if cleanup fails
      console.warn(`Warning: Failed to cleanup job branches in template repo: ${error.message}`);
    }
  }
}

export function createGitFixture(): GitFixture {
  assertTemplateRepo();
  // Clean up any leftover job/* branches from previous test runs
  cleanupJobBranches();
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const target = path.join(TMP_ROOT, `fixture-${Date.now()}-${randomUUID()}`);
  execSync(`git clone ${JSON.stringify(TEMPLATE_DIR)} ${JSON.stringify(target)}`, { stdio: 'inherit' });

  return {
    repoPath: target,
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
