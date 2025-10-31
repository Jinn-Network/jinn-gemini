/**
 * Worker Git Lineage E2E Test
 * Tests complete worker→agent execution with git operations validation
 *
 * Architecture (CURRENT):
 * - WORKER checks out job branch before agent runs
 * - AGENT makes file changes using tools and produces an execution summary (no manual git)
 * - WORKER infers completion, auto-commits pending changes, and pushes the branch
 * - WORKER creates PR after push
 *
 * This test validates that:
 * 1. Job branch is created with correct name (job/<jobDefId>)
 * 2. Worker checks out job branch before agent execution
 * 3. Worker auto-commits and pushes code changes when the job completes
 * 4. Worker creates PR from job branch to base branch
 * 5. Child branches are based on parent branch (not main)
 * 6. PR URL is included in delivery payload (not as artifact)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import fetch from 'cross-fetch';
import {
  getSharedInfrastructure,
  resetTestEnvironment,
  createTestJob,
  waitForRequestIndexed,
  waitForJobIndexed,
  waitForDelivery,
  runWorkerOnce,
  reconstructDirCidFromHexIpfsHash,
  fetchJsonWithRetry,
} from '../helpers/shared.js';
import { getTestGitRepo } from '../helpers/test-git-repo.js';

let branchPushVerified = false;

describe('Worker: Git Lineage E2E', () => {
  const suiteId = process.env.E2E_SUITE_ID ?? `manual-suite-${process.pid}`;
  if (!process.env.E2E_SUITE_ID) {
    process.env.E2E_SUITE_ID = suiteId;
  }

  let originalCwd: string;
  let testRepo: ReturnType<typeof getTestGitRepo>;

  beforeEach(() => {
    resetTestEnvironment();

    // Set up test git repository
    testRepo = getTestGitRepo(suiteId);
    originalCwd = process.cwd();
    process.chdir(testRepo.repoPath);

    // Configure environment for code metadata
    process.env.CODE_METADATA_REPO_ROOT = testRepo.repoPath;

    // Load test env
    try {
      const testEnv = path.join(originalCwd, '.env.test');
      if (fs.existsSync(testEnv)) {
        process.env.JINN_ENV_PATH = testEnv;
      }
    } catch {}

    expect(process.env.MECH_WORKER_ADDRESS || process.env.MECH_ADDRESS, 'MECH_WORKER_ADDRESS required').toBeTruthy();
  });

  afterEach(() => {
    // Clean up test branches
    if (testRepo) {
      testRepo.cleanup();
    }

    // Restore original directory
    process.chdir(originalCwd);

    // Clean up environment
    delete process.env.CODE_METADATA_REPO_ROOT;
  });

  it('agent executes on job branch, makes commits, and pushes', async () => {
    const { gqlUrl, controlUrl } = getSharedInfrastructure();

    console.log(`[test] Using test repo: ${testRepo.repoPath}`);
    console.log('[test] Creating job that requires file changes...');

    // 1) Create a job that will make the agent write/edit files
    const { jobDefId, requestId } = await createTestJob({
      objective: 'Create and modify files to test git operations',
      context: 'E2E test validating worker auto-commit and PR creation',
      instructions: `
You are working in a test git repository with lineage tracking enabled.

Tasks:
1. Write a new file called "feature.txt" with content "Implemented new feature".
2. Create an artifact documenting your changes with name="implementation_notes", topic="feature", content="Created feature.txt file".
3. Provide an \`Execution Summary\` section whose first bullet is "- Added feature.txt for new feature".
4. Do **not** run any git commands; the worker will commit and push for you.
      `.trim(),
      acceptanceCriteria: 'File created and execution summary provided so worker can push changes',
      enabledTools: ['write_file', 'create_artifact']
    });

    console.log(`[test] Job created: ${jobDefId}`);

    // 2) Wait for job to be indexed
    await waitForRequestIndexed(gqlUrl, requestId);
    const jobDefinition = await waitForJobIndexed(gqlUrl, jobDefId);

    expect(jobDefinition?.codeMetadata, 'Job definition should have code metadata').toBeTruthy();
    const expectedBranchName = jobDefinition.codeMetadata.branch.name;
    console.log(`[test] Job branch: ${expectedBranchName}`);

    // Verify branch exists
    const branchesOutput = execSync('git branch --format="%(refname:short)"', {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    });
    const branches = branchesOutput.split('\n').filter(b => b);
    expect(branches).toContain(expectedBranchName);

    // Get initial commit count
    const initialCommitCount = parseInt(
      execSync(`git rev-list --count ${expectedBranchName}`, {
        cwd: testRepo.repoPath,
        encoding: 'utf-8'
      }).trim()
    );
    console.log(`[test] Initial commits on job branch: ${initialCommitCount}`);

    // 3) Run worker (which runs agent)
    console.log('[test] Starting worker...');
    const workerProc = await runWorkerOnce(requestId, {
      gqlUrl,
      controlApiUrl: controlUrl,
      model: 'gemini-2.5-pro',
      timeout: 300_000
    });

    try {
      await workerProc;
      console.log('[test] Worker completed');
    } catch (error) {
      console.log('[test] Worker exited with error (may be expected):', error);
    }

    const statusOutput = execSync('git status --short', {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    }).trim();
    console.log(`[test] Git status after worker:\n${statusOutput || '(clean)'}`);

    const diffStatOutput = execSync('git diff --stat', {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    }).trim();
    console.log(`[test] Git diff --stat after worker:\n${diffStatOutput || '(no diff)'}`);

    // 4) Wait for delivery
    const delivery = await waitForDelivery(gqlUrl, requestId, {
      maxAttempts: 40,
      delayMs: 5000
    });

    console.log(`[test] Delivery indexed: ${delivery.ipfsHash}`);

    // Sync latest commits for the job branch from the remote
    execSync(`git fetch origin ${expectedBranchName}:${expectedBranchName}`, {
      cwd: testRepo.repoPath,
      stdio: 'ignore'
    });

    // 5) Verify commits were made to job branch
    const finalCommitCount = parseInt(
      execSync(`git rev-list --count ${expectedBranchName}`, {
        cwd: testRepo.repoPath,
        encoding: 'utf-8'
      }).trim()
    );
    console.log(`[test] Final commits on job branch: ${finalCommitCount}`);

    expect(finalCommitCount).toBeGreaterThan(initialCommitCount);
    const newCommits = finalCommitCount - initialCommitCount;
    console.log(`[test] ✓ Worker recorded ${newCommits} new commit(s)`);

    const commitLog = execSync(
      `git log ${expectedBranchName} --format="%s" -n ${newCommits}`,
      {
        cwd: testRepo.repoPath,
        encoding: 'utf-8'
      }
    );
    console.log(`[test] Commit messages:\n${commitLog}`);

    const latestCommitMessage = execSync(
      `git log ${expectedBranchName} --format="%s" -n 1`,
      { cwd: testRepo.repoPath, encoding: 'utf-8' }
    ).trim();
    expect(latestCommitMessage.length).toBeGreaterThan(0);
    expect(latestCommitMessage.startsWith('[Job')).toBe(false);
    expect(latestCommitMessage).toContain('Added feature.txt');

    // 6) Verify branch was pushed to remote
    const remoteBranches = execSync('git ls-remote --heads origin', {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    });

    expect(remoteBranches).toContain(expectedBranchName);
    console.log(`[test] ✓ Branch pushed to remote`);

    // 7) Verify local and remote are in sync
    const localCommit = execSync(`git rev-parse ${expectedBranchName}`, {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    }).trim();

    const remoteCommit = execSync(`git rev-parse origin/${expectedBranchName}`, {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    }).trim();

    expect(localCommit).toBe(remoteCommit);
    console.log(`[test] ✓ Local/remote in sync: ${localCommit.substring(0, 7)}`);
    branchPushVerified = true;

    // 8) Fetch and verify delivery JSON
    const dirCid = reconstructDirCidFromHexIpfsHash(delivery.ipfsHash);
    const reqPath = `${dirCid}/${requestId}`;
    const url = `https://gateway.autonolas.tech/ipfs/${reqPath}`;
    const deliveryJson = await fetchJsonWithRetry(url, 6, 2000);

    expect(deliveryJson.requestId).toBe(requestId);
    expect(deliveryJson.executionPolicy?.branch).toBe(expectedBranchName);

    console.log('\n[test] ✅ Git Operations Validation:');
    console.log(`  ✓ Branch created: ${expectedBranchName}`);
    console.log(`  ✓ Agent executed on job branch`);
    console.log(`  ✓ Commits: ${finalCommitCount} total, ${finalCommitCount - initialCommitCount} new`);
    console.log(`  ✓ Branch pushed to remote`);
    console.log(`  ✓ Local/remote synchronized`);
  }, 600_000);

  it('worker creates pull request after agent completes', async () => {
    if (!branchPushVerified) {
      console.warn('[test] Skipping PR creation test because branch push validation did not complete successfully.');
      return;
    }

    const { gqlUrl, controlUrl } = getSharedInfrastructure();

    // Fail if GITHUB_TOKEN not set - PR creation is a required feature
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(
        'GITHUB_TOKEN environment variable is required for PR creation test. ' +
        'Set GITHUB_TOKEN to a valid GitHub personal access token with repo permissions.'
      );
    }

    console.log('[test] Testing PR creation workflow...');

    // 1) Create a job that results in file changes
    const { jobDefId, requestId } = await createTestJob({
      objective: 'Create a test feature file and prepare PR-ready summary',
      context: 'E2E test validating worker creates PR after agent completes',
      instructions: `
Create a new file called feature.txt in the root directory with the following content:

Test Feature Implementation
===========================

This file demonstrates the PR creation workflow.
Created by the agent as part of the E2E test.

Feature Details:
- Automated file creation
- Git commit workflow
- Pull request generation

After creating the file:
- Provide an \`Execution Summary\` section whose first bullet is "- Added feature.txt for PR workflow".
- Do **not** run git commands; the worker will auto-commit and push.
      `.trim(),
      acceptanceCriteria: 'File created and execution summary provided so worker can create PR',
      enabledTools: [
        'list_directory',
        'read_file',
        'write_file',
        'search_file_content',
        'glob',
        'replace',
        'read_many_files',
        'run_shell_command',
        'save_memory',
        'create_artifact'
      ]
    });

    console.log(`[test] Job created: ${jobDefId}`);

    // 2) Wait for job to be indexed
    await waitForRequestIndexed(gqlUrl, requestId);
    const jobDefinition = await waitForJobIndexed(gqlUrl, jobDefId);

    const jobBranchName = jobDefinition.codeMetadata.branch.name;
    const baseBranch = jobDefinition.codeMetadata.baseBranch || 'main';
    console.log(`[test] Job branch: ${jobBranchName}`);
    console.log(`[test] Base branch: ${baseBranch}`);

    // 3) Run worker
    console.log('[test] Starting worker...');
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

    // 4) Wait for delivery
    const delivery = await waitForDelivery(gqlUrl, requestId, {
      maxAttempts: 40,
      delayMs: 5000
    });

    console.log(`[test] Delivery indexed: ${delivery.ipfsHash}`);

    // Ensure local branch reflects the latest remote commits
    execSync(`git fetch origin ${jobBranchName}:${jobBranchName}`, {
      cwd: testRepo.repoPath,
      stdio: 'ignore'
    });

    // 5) Fetch delivery JSON and verify PR URL is in payload
    const dirCid = reconstructDirCidFromHexIpfsHash(delivery.ipfsHash);
    const reqPath = `${dirCid}/${requestId}`;
    const url = `https://gateway.autonolas.tech/ipfs/${reqPath}`;
    const deliveryJson = await fetchJsonWithRetry(url, 6, 2000);

    // PR URL MUST be in the delivery payload (not artifacts)
    expect(deliveryJson.pullRequestUrl, 'pullRequestUrl must exist in delivery payload').toBeTruthy();

    const prUrl = deliveryJson.pullRequestUrl as string;
    const prUrlMatch = prUrl.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);

    expect(prUrlMatch, 'pullRequestUrl must be a valid GitHub PR URL').toBeTruthy();

    const [, owner, repo, prNumberStr] = prUrlMatch!;
    const prNumber = parseInt(prNumberStr);

    console.log(`[test] ✓ PR created: ${prUrl}`);
    console.log(`[test] ✓ Owner: ${owner}, Repo: ${repo}, PR #${prNumber}`);

    // 6) Verify the PR exists via GitHub API
    const prApiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
    const prResponse = await fetch(prApiUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'jinn-test-suite'
      }
    });

    expect(prResponse.ok, `PR should exist: GET ${prApiUrl}`).toBeTruthy();
    const prData = await prResponse.json();

    expect(prData.head.ref).toBe(jobBranchName);
    expect(prData.base.ref).toBe(baseBranch);
    expect(prData.state).toBe('open');
    expect(prData.body).toContain('### Execution Summary');
    expect(prData.body).toContain('- Added feature.txt for PR workflow');

    const latestPrCommitMessage = execSync(
      `git log ${jobBranchName} --format="%s" -n 1`,
      { cwd: testRepo.repoPath, encoding: 'utf-8' }
    ).trim();
    expect(latestPrCommitMessage.startsWith('[Job')).toBe(false);
    expect(latestPrCommitMessage).toContain('Added feature.txt');

    console.log('\n[test] ✅ PR Creation Validation:');
    console.log(`  ✓ PR #${prNumber}: ${prUrl}`);
    console.log(`  ✓ Source branch: ${prData.head.ref}`);
    console.log(`  ✓ Target branch: ${prData.base.ref}`);
    console.log(`  ✓ PR state: ${prData.state}`);
    console.log(`  ✓ PR title: ${prData.title}`);
  }, 600_000);

  it('child job branch is based on parent branch (not main)', async () => {
    const { gqlUrl, controlUrl } = getSharedInfrastructure();

    console.log('[test] Testing branch ancestry: child based on parent...');

    // 1) Create parent job that makes changes and dispatches a child
    const { jobDefId: parentJobId, requestId: parentRequestId } = await createTestJob({
      objective: 'Make changes and delegate to child job',
      context: 'Parent job for branch ancestry testing',
      instructions: `
You need to:
1. Write a file called "parent-work.txt" with content "Parent completed initial work".
2. Dispatch a child job with:
   - objective: "Continue work started by parent"
   - context: "Child should build on parent's changes"
   - acceptanceCriteria: "Child completes work on parent's branch"
   - jobName: "child-continuation"
3. Provide an \`Execution Summary\` that clearly states you are waiting for the dispatched child job.

The test will verify the child branch is based on YOUR branch (with your changes), not main.
      `.trim(),
      acceptanceCriteria: 'Work delegated to child with proper branch lineage',
      enabledTools: ['dispatch_new_job']
    });

    console.log(`[test] Parent job created: ${parentJobId}`);

    // 2) Wait for parent to be indexed
    await waitForRequestIndexed(gqlUrl, parentRequestId);
    const parentJobDef = await waitForJobIndexed(gqlUrl, parentJobId);

    const parentBranchName = parentJobDef.codeMetadata.branch.name;
    console.log(`[test] Parent branch: ${parentBranchName}`);

    // Get parent branch initial commit
    const parentInitialCommit = execSync(`git rev-parse ${parentBranchName}`, {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    }).trim();

    // 3) Run worker on parent job
    console.log('[test] Running worker on parent job...');
    const workerProc = await runWorkerOnce(parentRequestId, {
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

    // 4) Wait for parent delivery
    await waitForDelivery(gqlUrl, parentRequestId, {
      maxAttempts: 40,
      delayMs: 5000
    });

    // Get parent branch final commit (may have changed if agent made commits)
    const parentFinalCommit = execSync(`git rev-parse ${parentBranchName}`, {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    }).trim();

    console.log(`[test] Parent initial: ${parentInitialCommit.substring(0, 7)}`);
    console.log(`[test] Parent final: ${parentFinalCommit.substring(0, 7)}`);

    if (parentFinalCommit !== parentInitialCommit) {
      console.log(`[test] ✓ Parent made ${parseInt(execSync(`git rev-list --count ${parentInitialCommit}..${parentFinalCommit}`, {
        cwd: testRepo.repoPath,
        encoding: 'utf-8'
      }).trim())} commit(s)`);
    }

    // 5) Find child job
    await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for indexing

    const childJobQuery = `
      query($sourceRequestId:String!) {
        jobDefinitions(
          where: {
            sourceRequestId: $sourceRequestId
          }
        ) {
          items {
            id
            name
            codeMetadata
            sourceJobDefinitionId
            sourceRequestId
          }
        }
      }
    `;

    const childJobResp = await fetch(gqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: childJobQuery,
        variables: { sourceRequestId: parentRequestId }
      })
    });

    const childJobData = await childJobResp.json();
    const childJobs = childJobData?.data?.jobDefinitions?.items || [];

    expect(childJobs.length).toBeGreaterThan(0);
    const childJob = childJobs[0];
    const childBranchName = childJob.codeMetadata.branch.name;

    console.log(`[test] Child job: ${childJob.id}`);
    console.log(`[test] Child branch: ${childBranchName}`);

    expect(childBranchName).not.toBe(parentBranchName);

    const childRequestQuery = `
      query($jobDefinitionId:String!) {
        requests(
          where: {
            jobDefinitionId: $jobDefinitionId
          },
          orderBy: "blockTimestamp",
          orderDirection: "desc",
          limit: 1
        ) {
          items {
            id
            ipfsHash
          }
        }
      }
    `;

    const childRequestResp = await fetch(gqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: childRequestQuery,
        variables: { jobDefinitionId: childJob.id }
      })
    });

    const childRequestData = await childRequestResp.json();
    const childRequest = childRequestData?.data?.requests?.items?.[0];

    expect(childRequest, 'Child auto-dispatch request should exist').toBeTruthy();
    expect(childRequest?.ipfsHash, 'Child request must have IPFS hash').toBeTruthy();

    const childRequestIpfsUrl = `https://gateway.autonolas.tech/ipfs/${childRequest.ipfsHash}`;
    const childRequestPayload = await fetchJsonWithRetry(childRequestIpfsUrl, 6, 2000);

    expect(childRequestPayload?.branchName).toBe(childBranchName);
    expect(childRequestPayload?.codeMetadata?.branch?.name).toBe(childBranchName);
    expect(childRequestPayload?.codeMetadata?.baseBranch).toBe(parentBranchName);

    // Ensure local references are up-to-date before comparing ancestry
    execSync(`git fetch origin ${parentBranchName}:${parentBranchName}`, {
      cwd: testRepo.repoPath,
      stdio: 'ignore'
    });

    execSync(`git fetch origin ${childBranchName}:${childBranchName}`, {
      cwd: testRepo.repoPath,
      stdio: 'ignore'
    });

    // 6) Verify child branch ancestry
    // Get merge-base between child and parent
    const mergeBaseParent = execSync(`git merge-base ${childBranchName} ${parentBranchName}`, {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    }).trim();

    // Get merge-base between child and main
    const mergeBaseMain = execSync(`git merge-base ${childBranchName} main`, {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    }).trim();

    console.log(`[test] Child←→Parent merge-base: ${mergeBaseParent.substring(0, 7)}`);
    console.log(`[test] Child←→Main merge-base: ${mergeBaseMain.substring(0, 7)}`);

    // Child should be based on parent's final commit
    expect(mergeBaseParent).toBe(parentFinalCommit);
    console.log(`[test] ✓ Child branched from parent commit`);

    // 7) Verify child metadata
    expect(childJob.codeMetadata.baseBranch).toBe(parentBranchName);
    console.log(`[test] ✓ Child baseBranch = ${childJob.codeMetadata.baseBranch}`);

    expect(childJob.codeMetadata.parent?.jobDefinitionId).toBe(parentJobId);
    expect(childJob.codeMetadata.parent?.requestId).toBe(parentRequestId);
    console.log(`[test] ✓ Child has proper parent lineage`);

    // 8) Verify both branches exist on remote
    const remoteBranches = execSync('git ls-remote --heads origin', {
      cwd: testRepo.repoPath,
      encoding: 'utf-8'
    });

    expect(remoteBranches).toContain(parentBranchName);
    expect(remoteBranches).toContain(childBranchName);
    console.log(`[test] ✓ Both branches pushed to remote`);

    console.log('\n[test] ✅ Branch Ancestry Validation:');
    console.log(`  ✓ Parent branch: ${parentBranchName}`);
    console.log(`  ✓ Child branch: ${childBranchName}`);
    console.log(`  ✓ Child based on parent (not main)`);
    console.log(`  ✓ Child baseBranch = ${parentBranchName}`);
    console.log(`  ✓ Child has parent lineage metadata`);
    console.log(`  ✓ Both branches on remote`);
  }, 600_000);
});
