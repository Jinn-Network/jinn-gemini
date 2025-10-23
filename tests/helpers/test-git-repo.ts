import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface TestGitRepo {
  repoPath: string;
  cleanup: () => void;
}

/**
 * Set up a test git repository using the real GitHub test repo
 *
 * Requires TEST_GITHUB_REPO environment variable to be set.
 *
 * Structure:
 * tests/fixtures/
 *   test-repo/          # Working directory cloned from GitHub
 */
export function setupTestGitRepo(): TestGitRepo {
  const githubRemote = process.env.TEST_GITHUB_REPO;

  if (!githubRemote) {
    throw new Error(
      'TEST_GITHUB_REPO environment variable is required. ' +
      'Set it to the GitHub repository URL (e.g., git@github.com:user/test-repo.git)'
    );
  }

  const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');
  const repoPath = path.join(fixturesDir, 'test-repo');

  // Clean up existing repo if present
  if (fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }

  // Ensure fixtures directory exists
  fs.mkdirSync(fixturesDir, { recursive: true });

  console.log(`[test-repo] Cloning from GitHub: ${githubRemote}`);

  // Clone repository from GitHub
  execSync(`git clone ${githubRemote} ${repoPath}`, {
    stdio: 'inherit',
    timeout: 30000
  });

  // Configure git user for test commits
  execSync('git config user.email "test@jinn.local"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Jinn Test"', { cwd: repoPath, stdio: 'ignore' });

  console.log('[test-repo] ✓ Test git repository ready');

  return {
    repoPath,
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
    }
  };
}

/**
 * Get or create persistent test repo (reuses existing if present)
 */
export function getTestGitRepo(): TestGitRepo {
  const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');
  const repoPath = path.join(fixturesDir, 'test-repo');

  // If repo exists and is valid, return it
  if (fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, '.git'))) {
    try {
      // Verify it's a valid repo
      execSync('git status', { cwd: repoPath, stdio: 'ignore' });
      console.log('[test-repo] Using existing test repository');

      return {
        repoPath,
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
        }
      };
    } catch {
      // Repo is corrupt, recreate it
      console.log('[test-repo] Existing repo is invalid, recreating...');
    }
  }

  // Create fresh repo
  return setupTestGitRepo();
}
