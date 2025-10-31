import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  getSharedInfrastructure,
  resetTestEnvironment,
  createTestJob,
  waitForRequestIndexed,
  waitForJobIndexed,
  waitForDelivery,
  runWorkerOnce,
} from '../helpers/shared.js';
import { getTestGitRepo } from '../helpers/test-git-repo.js';

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
}

describe('Worker: Git Auto-Commit Flow', () => {
  const suiteId = process.env.E2E_SUITE_ID ?? `manual-suite-${process.pid}`;
  if (!process.env.E2E_SUITE_ID) {
    process.env.E2E_SUITE_ID = suiteId;
  }

  let originalCwd: string;
  let testRepo: ReturnType<typeof getTestGitRepo>;

  beforeEach(() => {
    resetTestEnvironment();

    testRepo = getTestGitRepo(suiteId);
    originalCwd = process.cwd();
    process.chdir(testRepo.repoPath);

    process.env.CODE_METADATA_REPO_ROOT = testRepo.repoPath;

    try {
      const testEnv = path.join(originalCwd, '.env.test');
      if (fs.existsSync(testEnv)) {
        process.env.JINN_ENV_PATH = testEnv;
      }
    } catch {}

    expect(process.env.MECH_WORKER_ADDRESS || process.env.MECH_ADDRESS, 'MECH_WORKER_ADDRESS required').toBeTruthy();
  });

  afterEach(() => {
    if (testRepo) {
      testRepo.cleanup();
    }

    process.chdir(originalCwd);
    delete process.env.CODE_METADATA_REPO_ROOT;
  });

  it('auto-commits file edits and pushes branch when job completes', async () => {
    const { gqlUrl, controlUrl } = getSharedInfrastructure();

    const { jobDefId, requestId } = await createTestJob({
      objective: 'Create and modify files to validate auto-commit',
      context: 'Ensures worker auto-commit logic runs after successful execution',
      instructions: `
You are working in a git repository with branch lineage tracking enabled.

Tasks:
1. Write a new file named "feature.txt" with content "Auto commit validation".
2. Append the line "Updated by worker test" to README.md.
3. Provide an \`Execution Summary\` section whose first bullet is "- Added feature.txt for auto-commit flow".
Do **not** run git commands; the worker will commit and push.
`.trim(),
      acceptanceCriteria: 'File changes and execution summary exist so the worker can commit and push',
      enabledTools: [
        'list_directory',
        'read_file',
        'write_file',
        'search_file_content',
        'replace',
        'read_many_files',
        'run_shell_command',
        'create_artifact'
      ]
    });

    await waitForRequestIndexed(gqlUrl, requestId);
    const jobDefinition = await waitForJobIndexed(gqlUrl, jobDefId);

    const expectedBranchName = jobDefinition.codeMetadata.branch.name;

    const initialCommitCount = parseInt(run(`git rev-list --count ${expectedBranchName}`, testRepo.repoPath));

    const workerProc = await runWorkerOnce(requestId, {
      gqlUrl,
      controlApiUrl: controlUrl,
      model: 'gemini-2.5-pro',
      timeout: 300_000
    });

    try {
      await workerProc;
    } catch (error) {
      console.log('[test] Worker exited with error (may be expected):', error);
    }

    await waitForDelivery(gqlUrl, requestId, {
      maxAttempts: 40,
      delayMs: 5000
    });

    // Ensure we have the latest remote commits
    run('git fetch origin', testRepo.repoPath);

    const finalCommitCount = parseInt(run(`git rev-list --count ${expectedBranchName}`, testRepo.repoPath));
    expect(finalCommitCount).toBeGreaterThan(initialCommitCount);

    const newCommits = finalCommitCount - initialCommitCount;
    const commitLog = run(`git log ${expectedBranchName} --format="%s" -n ${newCommits}`, testRepo.repoPath);
    expect(commitLog.length).toBeGreaterThan(0);
    expect(commitLog).toMatch(/Added feature\.txt for auto-commit flow/);
  }, 600_000);
});
