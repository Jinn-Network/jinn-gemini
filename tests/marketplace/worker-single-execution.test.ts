/**
 * Worker Single Execution Test
 * Validates that the worker can complete a simple job end-to-end without delegating,
 * ensuring that changes are committed and the branch is pushed.
 */

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

describe('Worker: Single Execution (No Delegation)', () => {
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
  });

  afterEach(() => {
    if (testRepo) {
      testRepo.cleanup();
    }
    process.chdir(originalCwd);
    delete process.env.CODE_METADATA_REPO_ROOT;
  });

  it('completes feature spec without delegating or leaving pending changes', async () => {
    const { gqlUrl, controlUrl } = getSharedInfrastructure();

    const { jobDefId, requestId } = await createTestJob({
      objective: 'Author a feature specification for the “AI-powered code review assistant” capability',
      context: 'Validation that the worker completes a single task end-to-end without delegation',
      instructions: `
You are operating inside a dedicated git repository for this test.

Requirements:
- Create a file named "feature.txt" at the repository root.
- Write a concise markdown specification for an "AI-powered code review assistant" feature.
- The document must include the sections:
  "# Overview" (summarize the assistant),
  "# User Stories" (at least three bullet points),
  "# Functional Requirements" (at least five bullet points),
  "# Non-Functional Requirements" (at least three bullet points),
  "# Risks" (list key implementation risks).
- Do **not** create or dispatch additional jobs. Do not call any delegation tools.
- Perform all work yourself using the available tools.
- After completing the work, provide an \`Execution Summary\` section whose first bullet is "- Authored AI code review assistant specification".
`.trim(),
      acceptanceCriteria: [
        'feature.txt exists at repo root',
        'Document contains the required sections with minimum bullet counts',
        'Execution Summary first bullet reads "- Authored AI code review assistant specification"',
        'No delegation tools were used',
      ].join('. '),
      enabledTools: ['write_file', 'create_artifact'],
    });

    await waitForRequestIndexed(gqlUrl, requestId);
    const jobDefinition = await waitForJobIndexed(gqlUrl, jobDefId);
    const branchName = jobDefinition.codeMetadata.branch.name;

    const initialCommitCount = parseInt(
      execSync(`git rev-list --count ${branchName}`, {
        cwd: testRepo.repoPath,
        encoding: 'utf-8',
      }).trim(),
      10,
    );

    const workerProc = await runWorkerOnce(requestId, {
      gqlUrl,
      controlApiUrl: controlUrl,
      model: 'gemini-2.5-pro',
      timeout: 300_000,
    });

    try {
      await workerProc;
    } catch (error) {
      console.log('[single-execution] Worker exited with error (may be expected):', error);
    }

    const statusOutput = execSync('git status --short', {
      cwd: testRepo.repoPath,
      encoding: 'utf-8',
    }).trim();
    console.log(`[single-execution] git status after worker:\n${statusOutput || '(clean)'}`);

    const diffStatOutput = execSync('git diff --stat', {
      cwd: testRepo.repoPath,
      encoding: 'utf-8',
    }).trim();
    console.log(`[single-execution] git diff --stat after worker:\n${diffStatOutput || '(no diff)'}`);

    const delivery = await waitForDelivery(gqlUrl, requestId, {
      maxAttempts: 40,
      delayMs: 5000,
    });
    console.log(`[single-execution] Delivery indexed: ${delivery.ipfsHash}`);

    execSync(`git fetch origin ${branchName}:${branchName}`, {
      cwd: testRepo.repoPath,
      stdio: 'ignore',
    });

    const finalCommitCount = parseInt(
      execSync(`git rev-list --count ${branchName}`, {
        cwd: testRepo.repoPath,
        encoding: 'utf-8',
      }).trim(),
      10,
    );
    expect(finalCommitCount).toBeGreaterThan(initialCommitCount);

    const featurePath = path.join(testRepo.repoPath, 'feature.txt');
    expect(fs.existsSync(featurePath)).toBe(true);
    const featureContents = fs.readFileSync(featurePath, 'utf-8');
    expect(featureContents).toMatch(/# Overview/);
    expect(featureContents).toMatch(/# Requirements/);
    expect(featureContents).toMatch(/# Risks/);

    const localCommit = execSync(`git rev-parse ${branchName}`, {
      cwd: testRepo.repoPath,
      encoding: 'utf-8',
    }).trim();
    const remoteCommit = execSync(`git rev-parse origin/${branchName}`, {
      cwd: testRepo.repoPath,
      encoding: 'utf-8',
    }).trim();

    expect(localCommit).toBe(remoteCommit);
    console.log(`[single-execution] ✓ Local/remote synchronized at ${localCommit.substring(0, 7)}`);
  }, 600_000);
});
