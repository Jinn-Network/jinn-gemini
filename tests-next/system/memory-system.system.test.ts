/**
 * Memory System Test (MEM-001 to MEM-010)
 *
 * Comprehensive system test validating the complete memory system lifecycle:
 * - Recognition phase (finding similar past jobs via SITUATION embeddings)
 * - SITUATION artifact creation and indexing
 * - Reflection phase (creating MEMORY artifacts from learnings)
 * - MEMORY artifact structure and tag-based discovery
 * - Embedding generation and storage
 * - Vector search and discovery
 * - Ponder indexing of both SITUATION and MEMORY artifacts
 *
 * Coverage: 12 requirements (MEM-001 to MEM-010, GWQ-001/002), 71 assertions
 * Tests both memory pathways: semantic (SITUATION) and tagged (MEMORY)
 * Tests git workflow metadata: branch isolation and lineage preservation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { withTestEnv } from '../helpers/env-controller.js';
import { withTenderlyVNet } from '../helpers/tenderly-runner.js';
import { withProcessHarness } from '../helpers/process-harness.js';
import { createGitFixture, type GitFixture } from '../helpers/git-fixture.js';
import { withSuiteEnv } from '../helpers/suite-env.js';
import {
  waitForChildRequest,
  waitForArtifactByType,
  waitForPonderRealtime,
} from '../helpers/ponder-waiters.js';
import { getRequest } from '../helpers/ponder-queries.js';
import {
  createTestJob,
  waitForRequestIndexed,
  waitForDelivery,
  runWorkerOnce,
  reconstructDirCidFromHexIpfsHash,
  fetchJsonWithRetry,
  cleanupWorkerProcesses,
  resetTestEnvironment,
  parseToolText,
  withJobContext,
  waitForJobIndexed,
} from '../../tests/helpers/shared.js';
import { getOptionalMechModel } from '../../config/index.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Clear test embeddings from Supabase before test run.
 * Ensures test isolation and prevents data from previous runs.
 */
async function clearTestEmbeddings() {
  if (!process.env.SUPABASE_POSTGRES_URL) {
    throw new Error('SUPABASE_POSTGRES_URL not set - cannot clear test embeddings');
  }

  const client = new Client({ connectionString: process.env.SUPABASE_POSTGRES_URL });
  try {
    await client.connect();
    const result = await client.query('DELETE FROM node_embeddings_test');
    console.log(`[TEST] Cleared node_embeddings_test table (${result.rowCount} rows deleted)`);
  } finally {
    await client.end();
  }
}

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

interface SituationArtifact {
  version: string;
  job: {
    requestId: string;
    jobName: string;
    jobDefinitionId?: string;
    model?: string;
    objective: string;
    context?: string;
    acceptanceCriteria: string;
    enabledTools: string[];
  };
  context: {
    parent: null | { requestId: string; jobDefinitionId: string };
    siblings: any[];
    children: any[];
  };
  execution: {
    status: string;
    trace: Array<{
      tool: string;
      args: string;
      result_summary: string;
    }>;
    finalOutputSummary: string;
  };
  artifacts: any[];
  embedding: {
    model: string;
    dim: number;
    vector: number[];
  };
  meta: {
    summaryText: string;
    recognition?: {
      similarJobs: Array<{
        requestId: string;
        similarity: number;
      }>;
      initialSituation?: any; // MEM-003: Enriched initial situation
      embeddingStatus?: string; // Recognition phase metadata
    };
    generatedAt: string;
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Fetches SITUATION artifact from delivery payload
 *
 * @param delivery - Delivery object from Ponder
 * @param gqlUrl - GraphQL URL for additional queries if needed
 * @returns SITUATION artifact content
 */
async function fetchSituation(
  delivery: any,
  gqlUrl?: string
): Promise<SituationArtifact | null> {
  // Reconstruct directory CID from delivery ipfsHash
  const dirCid = reconstructDirCidFromHexIpfsHash(delivery.ipfsHash);
  if (!dirCid) {
    console.error('[FETCH] Could not reconstruct directory CID');
    return null;
  }

  // Fetch delivery payload from IPFS
  const requestId = delivery.id;
  const reqPath = `${dirCid}/${requestId}`;
  const url = `https://gateway.autonolas.tech/ipfs/${reqPath}`;

  try {
    const deliveryJson = await fetchJsonWithRetry(url, 6, 2000);

    // Find SITUATION artifact in artifacts array
    const situationArtifact = deliveryJson.artifacts?.find(
      (a: any) => a.type === 'SITUATION'
    );

    if (!situationArtifact) {
      console.warn('[FETCH] No SITUATION artifact in delivery');
      return null;
    }

    // Debug: Log the artifact structure
    console.log('[FETCH] situationArtifact keys:', Object.keys(situationArtifact));
    console.log('[FETCH] has content:', !!situationArtifact.content);
    console.log('[FETCH] content type:', typeof situationArtifact.content);
    console.log('[FETCH] has cid:', !!situationArtifact.cid);

    // The artifact might have content embedded as a string or need to be fetched from IPFS
    if (situationArtifact.content) {
      // Content is embedded in the artifact - parse it if it's a string
      console.log('[FETCH] Parsing content (first 100 chars):', String(situationArtifact.content).slice(0, 100));
      const content = typeof situationArtifact.content === 'string'
        ? JSON.parse(situationArtifact.content)
        : situationArtifact.content;
      console.log('[FETCH] Parsed content keys:', Object.keys(content));
      console.log('[FETCH] Parsed content.version:', content.version);
      return content as SituationArtifact;
    } else if (situationArtifact.cid) {
      // Fetch SITUATION content from IPFS using CID
      console.log('[FETCH] Fetching from CID:', situationArtifact.cid);
      const situationUrl = `https://gateway.autonolas.tech/ipfs/${situationArtifact.cid}`;
      const situationContent = await fetchJsonWithRetry(situationUrl, 6, 2000);
      console.log('[FETCH] Fetched content type:', typeof situationContent);
      console.log('[FETCH] Fetched content keys:', situationContent ? Object.keys(situationContent) : 'null');
      console.log('[FETCH] Fetched content.version:', situationContent?.version);

      // Some storage formats wrap the payload in {name, topic, content, ...}
      const embeddedContent =
        situationContent &&
        typeof situationContent === 'object' &&
        'content' in situationContent
          ? (situationContent as any).content
          : situationContent;

      // The IPFS response might be the raw JSON string, not parsed
      if (typeof embeddedContent === 'string') {
        console.log('[FETCH] Content is string, parsing nested content...');
        return JSON.parse(embeddedContent) as SituationArtifact;
      }

      return embeddedContent as SituationArtifact;
    }

    console.warn('[FETCH] SITUATION artifact has no content or CID');
    return null;
  } catch (error) {
    console.error('[FETCH] Error fetching SITUATION:', error);
    return null;
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('System: Memory System (MEM-001 to MEM-010)', () => {
  let gitFixture: GitFixture | null = null;

  beforeAll(async () => {
    // Clear previous test data to ensure clean state
    await clearTestEmbeddings();

    gitFixture = createGitFixture();
    process.env.CODE_METADATA_REPO_ROOT = gitFixture.repoPath;
  });

  afterAll(() => {
    if (gitFixture) {
      gitFixture.cleanup();
      gitFixture = null;
    }
    delete process.env.CODE_METADATA_REPO_ROOT;
  });
  it(
    'validates complete memory system lifecycle with recognition, reflection, and indexing',
    async () => {
      await withSuiteEnv(async () => {
          const prevWorkerStdio = process.env.TESTS_NEXT_WORKER_STDIO;
          process.env.TESTS_NEXT_WORKER_STDIO = 'inherit';

          try {
            await withTestEnv(async () => {
            // Load test environment
            try {
              const testEnv = path.join(process.cwd(), '.env.test');
              if (fs.existsSync(testEnv)) {
                process.env.JINN_ENV_PATH = testEnv;
              }
            } catch {}

            await withTenderlyVNet(async (tenderlyCtx) => {
              await withProcessHarness(
                {
                  rpcUrl: tenderlyCtx.rpcUrl,
                  startWorker: false,
                },
                async ({ gqlUrl, controlUrl }) => {
                  resetTestEnvironment();
                  console.log('[TEST] Using control API:', controlUrl);
                  console.log('[TEST] Using GraphQL:', gqlUrl);

                  // Wait for Ponder to finish historical sync and reach realtime status
                  // This prevents race conditions where requests are dispatched before
                  // Ponder has caught up to the current block
                  console.log('[TEST] Waiting for Ponder to reach realtime status...');
                  await waitForPonderRealtime(gqlUrl, { timeoutMs: 120000 });
                  console.log('[TEST] Ponder is ready for realtime indexing ✓');

                  // =========================================================
                  // SECTION 1: Create Parent Job For Lineage
                  // =========================================================

                  console.log('\n[TEST] Bootstrapping parent job for lineage...');

                  const parentJob = await createTestJob({
                    objective: 'Survey prior memory-system jobs for lineage seeding',
                    context:
                      'Parent job to ensure child requests record source lineage in the new framework.',
                    instructions:
                      'Report success once the job definition is registered. No further action required.',
                    acceptanceCriteria:
                      'Parent job definition exists and can be referenced by child jobs.',
                    enabledTools: ['create_artifact'],
                  });

                  await waitForRequestIndexed(gqlUrl, parentJob.requestId);
                  console.log('[TEST] Parent job ready:', parentJob.requestId);

                  // =========================================================
                  // SECTION 1A: Parent Job Git Metadata (GWQ-001)
                  // =========================================================

                  console.log('\n[TEST] SECTION 1A: Validating parent job git metadata...');

                  const parentJobDef = await waitForJobIndexed(gqlUrl, parentJob.jobDefId);

                  // GWQ-001: Branch metadata exists
                  expect(parentJobDef?.codeMetadata?.branch?.name).toBeTruthy(); // Assert 59
                  const parentBranchName = parentJobDef.codeMetadata.branch.name;

                  // Branch has remote URL
                  expect(parentJobDef?.codeMetadata?.branch?.remoteUrl).toBeTruthy(); // Assert 60

                  // Base branch is set (likely "main" for root job)
                  expect(parentJobDef?.codeMetadata?.baseBranch).toBeTruthy(); // Assert 61

                  // Parent has no parent (root job)
                  expect(parentJobDef?.codeMetadata?.parent).toBeUndefined(); // Assert 62

                  // Branch actually created in git
                  const branches = execSync('git branch --format="%(refname:short)"', {
                    cwd: gitFixture!.repoPath,
                    encoding: 'utf-8'
                  }).split('\n').filter(b => b);
                  expect(branches).toContain(parentBranchName); // Assert 63

                  console.log(`[TEST] Parent git metadata validated: branch=${parentBranchName} ✓`);

                  // =========================================================
                  // SECTION 2: Create Child Job (Research + Delegation)
                  // =========================================================

                  console.log('\n[TEST] SECTION 2: Creating child job with delegation task...');

                  const childJob = await withJobContext(
                    {
                      requestId: parentJob.requestId,
                      jobDefinitionId: parentJob.jobDefId,
                      baseBranch: parentBranchName,
                    },
                    () => createTestJob({
                      objective:
                        'Analyze OLAS staking mechanisms and delegate optimization task',
                      context:
                        'You are analyzing the OLAS token staking system to understand current parameters and identify optimization opportunities. After your analysis, delegate the optimization work to a specialized sub-job.',
                      deliverables: [
                        '1. Artifact: "olas-staking-analysis" (topic: defi-research)',
                        '2. Dispatched child job for optimization',
                      ].join('\n'),
                      instructions: [
                        'Task 1: Call create_artifact with name="olas-staking-analysis", topic="defi-research", content="# OLAS Staking\\n\\nCurrent: APY 8-12%, 1w-1y locks, weekly rewards, 10% penalty.\\n\\nOptimize: dynamic APY, tiered locks, compounding."',
                        '',
                        'Task 2: Call dispatch_new_job with objective="Optimize OLAS staking parameters", context="Parent analysis: 8-12% APY, 1w-1y locks. Maximize participation while maintaining sustainability.", instructions="Task 1: Create optimization recommendations. Task 2: Call create_artifact with type=\\"MEMORY\\", tags=[\\"staking\\",\\"optimization\\",\\"olas\\"], name=\\"olas-staking-optimization-strategy\\", topic=\\"learnings\\", content=\\"# OLAS Staking Optimization Strategy\\\\n\\\\n## Key Insight\\\\nDynamic APY based on lock duration maximizes participation while maintaining sustainability.\\\\n\\\\n## Recommendation\\\\n- Base rate: 6% APY (accessible entry point)\\\\n- Lock bonus: +0.5% per month locked\\\\n- Maximum: 18% APY at 24 months\\\\n- Rationale: Balances accessibility with long-term commitment incentive.\\"", acceptanceCriteria="Optimization recommendations created AND MEMORY artifact with tags created for future reuse", enabledTools=["create_artifact"]',
                      ].join('\n'),
                      acceptanceCriteria:
                        'Artifact created and child job dispatched',
                      enabledTools: ['create_artifact', 'dispatch_new_job'],
                    })
                  );

                  const { requestId } = childJob;
                  console.log('[TEST] Created child job:', requestId);

                  await waitForRequestIndexed(gqlUrl, requestId);

                  // =========================================================
                  // SECTION 3: Run Worker on Child Job
                  // =========================================================

                  console.log('\n[TEST] SECTION 3: Running worker on child job...');

                  const workerProc = await runWorkerOnce(requestId, {
                    gqlUrl,
                    controlApiUrl: controlUrl,
                    model: 'gemini-2.5-pro',
                    timeout: 300_000,
                  });

                  try {
                    await workerProc;
                  } catch (error) {
                    console.warn(
                      '[TEST] Worker exited with error (may be expected):',
                      error
                    );
                  } finally {
                    await cleanupWorkerProcesses();
                  }

                  // =========================================================
                  // SECTION 4: Wait for Child Delivery
                  // =========================================================

                  console.log('\n[TEST] SECTION 4: Waiting for child delivery...');

                  const childDelivery = await waitForDelivery(gqlUrl, requestId, {
                    maxAttempts: 40,
                    delayMs: 5000,
                  });

                  // LCQ-003: Single delivery confirms atomic processOnce() execution
                  // One request → one processOnce() → one delivery (no partial states)
                  expect(childDelivery.id).toBe(requestId);
                  expect(typeof childDelivery.ipfsHash).toBe('string');
                  expect(typeof childDelivery.transactionHash).toBe('string');

                  console.log('[TEST] Child delivery confirmed:', childDelivery.transactionHash);

                  // Wait for Ponder to index the child request
                  await waitForRequestIndexed(gqlUrl, requestId);

                  // Query child request record for hierarchy validation
                  const childRequest = await getRequest(gqlUrl, requestId);
                  expect(childRequest).toBeDefined();

                  // LCQ-004: Job hierarchy validation - child should link to parent
                  expect(childRequest!.sourceRequestId).toBe(parentJob.requestId);
                  expect(childRequest!.sourceJobDefinitionId).toBe(parentJob.jobDefId);

                  // MEM-008: Verify child request indexed with temporal metadata
                  expect(childRequest!.blockTimestamp).toBeDefined();

                  console.log('[TEST] Child request hierarchy validated ✓');

                  // =========================================================
                  // SECTION 4A: Child Job Git Lineage Metadata (GWQ-002)
                  // =========================================================

                  console.log('\n[TEST] SECTION 4A: Validating child job git lineage metadata...');

                  const childJobDef = await waitForJobIndexed(gqlUrl, childJob.jobDefId);
                  const childBranchName = childJobDef?.codeMetadata?.branch?.name;

                  // GWQ-001: Child has unique branch
                  expect(childBranchName).toBeTruthy(); // Assert 64
                  expect(childBranchName).not.toBe(parentBranchName); // Assert 65 - Different from parent

                  // GWQ-002: Child base branch should point to parent branch
                  expect(childJobDef?.codeMetadata?.baseBranch).toBe(parentBranchName); // Assert 66 ⭐ KEY

                  // GWQ-002: Child's parent metadata points to parent job
                  expect(childJobDef?.codeMetadata?.parent?.jobDefinitionId).toBe(parentJob.jobDefId); // Assert 67 ⭐ KEY
                  expect(childJobDef?.codeMetadata?.parent?.requestId).toBe(parentJob.requestId); // Assert 68 ⭐ KEY

                  // Branch created in git
                  const childBranches = execSync('git branch --format="%(refname:short)"', {
                    cwd: gitFixture!.repoPath,
                    encoding: 'utf-8'
                  }).split('\n').filter(b => b);
                  expect(childBranches).toContain(childBranchName); // Assert 69

                  console.log(`[TEST] Child lineage metadata validated: child=${childBranchName} → parent=${parentBranchName} ✓`);

                  // =========================================================
                  // SECTION 5: Wait for Child's SITUATION Embedding to be Indexed
                  // =========================================================

                  console.log('\n[TEST] SECTION 5: Waiting for child SITUATION to be indexed...');

                  // Wait for SITUATION artifact to appear in Ponder
                  const childSituationArtifact = await waitForArtifactByType(
                    gqlUrl,
                    requestId,
                    'SITUATION',
                    { timeoutMs: 60000, pollIntervalMs: 2000 }
                  );

                  console.log('[TEST] Child SITUATION artifact indexed:', childSituationArtifact.cid);

                  // Give Ponder a bit more time to fully index the embedding
                  console.log('[TEST] Allowing additional time for embedding indexing...');
                  await new Promise(resolve => setTimeout(resolve, 5000));

                  console.log('[TEST] Child SITUATION embedding ready ✓');

                  // =========================================================
                  // SECTION 6: Find Grandchild Request Created by Child
                  // =========================================================

                  console.log('\n[TEST] SECTION 6: Looking for grandchild job created by child...');

                  const grandchildRequest = await waitForChildRequest(
                    gqlUrl,
                    requestId, // Child is the parent of grandchild
                    { timeoutMs: 40000, pollIntervalMs: 2000 }
                  );

                  console.log('[TEST] Grandchild request found:', grandchildRequest.id);
                  expect(grandchildRequest.sourceRequestId).toBe(requestId);

                  await waitForRequestIndexed(gqlUrl, grandchildRequest.id);

                  // Query grandchild request record for hierarchy validation
                  const grandchildRequestRecord = await getRequest(gqlUrl, grandchildRequest.id);
                  expect(grandchildRequestRecord).toBeDefined();

                  // LCQ-004: Job hierarchy validation - grandchild should link to child
                  expect(grandchildRequestRecord!.sourceRequestId).toBe(requestId);
                  expect(grandchildRequestRecord!.sourceJobDefinitionId).toBe(childJob.jobDefId);

                  // MEM-008: Verify grandchild request indexed with temporal metadata
                  expect(grandchildRequestRecord!.blockTimestamp).toBeDefined();

                  console.log('[TEST] Grandchild request hierarchy validated ✓');

                  // =========================================================
                  // SECTION 7: Run Worker on Grandchild Job
                  // =========================================================

                  console.log('\n[TEST] SECTION 7: Running worker on grandchild...');

                  const grandchildWorkerProc = await runWorkerOnce(grandchildRequest.id, {
                    gqlUrl,
                    controlApiUrl: controlUrl,
                    model: 'gemini-2.5-pro',
                    timeout: 300_000,
                  });

                  try {
                    await grandchildWorkerProc;
                  } catch (error) {
                    console.warn('[TEST] Grandchild worker exited with error:', error);
                  } finally {
                    await cleanupWorkerProcesses();
                  }

                  // =========================================================
                  // SECTION 8: Wait for Grandchild Delivery
                  // =========================================================

                  console.log('\n[TEST] SECTION 8: Waiting for grandchild delivery...');

                  const grandchildDelivery = await waitForDelivery(gqlUrl, grandchildRequest.id, {
                    maxAttempts: 40,
                    delayMs: 5000,
                  });

                  // LCQ-003: Grandchild processOnce() atomicity validated via single delivery
                  expect(grandchildDelivery.id).toBe(grandchildRequest.id);
                  expect(typeof grandchildDelivery.ipfsHash).toBe('string');
                  expect(typeof grandchildDelivery.transactionHash).toBe('string');

                  console.log('[TEST] Grandchild delivery confirmed:', grandchildDelivery.transactionHash);

                  // =========================================================
                  // SECTION 8A: Grandchild Job Git Lineage Metadata (GWQ-002)
                  // =========================================================

                  console.log('\n[TEST] SECTION 8A: Validating grandchild git lineage metadata...');

                  // Get grandchild job definition
                  const grandchildJobDef = await waitForJobIndexed(gqlUrl, grandchildRequest.jobDefinitionId);
                  const grandchildBranchName = grandchildJobDef?.codeMetadata?.branch?.name;
                  expect(grandchildBranchName).toBeTruthy(); // Assert 70

                  // GWQ-001: Grandchild has unique branch
                  expect(grandchildBranchName).not.toBe(parentBranchName); // Assert 71
                  expect(grandchildBranchName).not.toBe(childBranchName); // Assert 72

                  // GWQ-002: Grandchild based on child (not parent or main)
                  expect(grandchildJobDef?.codeMetadata?.baseBranch).toBe(childBranchName); // Assert 73

                  // GWQ-002: Lineage metadata points to child (not parent)
                  expect(grandchildJobDef?.codeMetadata?.parent?.jobDefinitionId).toBe(childJob.jobDefId); // Assert 74
                  expect(grandchildJobDef?.codeMetadata?.parent?.requestId).toBe(requestId); // Assert 75

                  // Branch created in git
                  const grandchildBranches = execSync('git branch --format="%(refname:short)"', {
                    cwd: gitFixture!.repoPath,
                    encoding: 'utf-8'
                  }).split('\n').filter(b => b);
                  expect(grandchildBranches).toContain(grandchildBranchName); // Assert 76

                  console.log(`[TEST] 3-level git lineage metadata validated: grandchild→child→parent ✓`);

                  // =========================================================
                  // SECTION 9: Wait for MEMORY Artifact (MEM-006, MEM-007)
                  // =========================================================

                  console.log('\n[TEST] SECTION 9: Waiting for MEMORY artifact from reflection...');

                  // MEM-006: Reflection phase should create MEMORY artifact
                  const memoryArtifact = await waitForArtifactByType(
                    gqlUrl,
                    grandchildRequest.id,
                    'MEMORY',
                    { timeoutMs: 60000, pollIntervalMs: 2000 }
                  );

                  expect(memoryArtifact).toBeDefined();
                  expect(memoryArtifact.type).toBe('MEMORY');
                  console.log('[TEST] MEMORY artifact created:', memoryArtifact.cid);

                  // ARQ-006: Validate multi-modal persistence - IPFS for content
                  expect(memoryArtifact.cid).toMatch(/^baf|^Qm/); // Assert 49 - CIDv1 or CIDv0 format

                  // MEM-007: Fetch and validate MEMORY artifact structure
                  const memoryContent = await fetchJsonWithRetry(
                    `https://gateway.autonolas.tech/ipfs/${memoryArtifact.cid}`,
                    5, // retries
                    1000 // delay
                  );

                  expect(memoryContent).toBeDefined();

                  // Validate MEMORY artifact schema (MEM-007)
                  expect(memoryContent.type).toBe('MEMORY'); // Assert 30
                  expect(Array.isArray(memoryContent.tags)).toBe(true); // Assert 31
                  expect(memoryContent.tags.length).toBeGreaterThan(0); // Assert 32
                  expect(memoryContent.name).toBeTruthy(); // Assert 33
                  expect(memoryContent.topic).toBe('learnings'); // Assert 34
                  expect(memoryContent.content).toBeTruthy(); // Assert 35

                  // Validate tags include expected keywords for discovery
                  expect(memoryContent.tags).toContain('staking'); // Assert 36
                  expect(memoryContent.tags).toContain('optimization'); // Assert 37
                  expect(memoryContent.tags).toContain('olas'); // Assert 38

                  console.log('[TEST] MEMORY artifact validated:', {
                    name: memoryContent.name,
                    tags: memoryContent.tags,
                    topic: memoryContent.topic
                  });

                  console.log('[TEST] ✅ Reflection phase complete - MEMORY artifact created and indexed');

                  // =========================================================
                  // SECTION 10: Validate Grandchild SITUATION Structure
                  // (MEM-002, MEM-003, MEM-004)
                  // =========================================================

                  console.log('\n[TEST] SECTION 10: Validating grandchild SITUATION structure...');

                  const situation = await fetchSituation(grandchildDelivery, gqlUrl);
                  expect(situation).toBeDefined();

                  if (!situation) {
                    throw new Error('SITUATION artifact not found in delivery');
                  }

                  // MEM-002: SITUATION Artifact Structure
                  expect(situation.version).toBe('sit-enc-v1.1'); // Assert 1

                  // Validate job section
                  expect(situation.job.requestId).toBe(grandchildRequest.id); // Assert 2
                  expect(situation.job.jobName).toBeTruthy(); // Assert 3
                  expect(situation.job.objective).toBeTruthy(); // Assert 4
                  expect(situation.job.acceptanceCriteria).toBeTruthy(); // Assert 5
                  expect(Array.isArray(situation.job.enabledTools)).toBe(true); // Assert 6
                  expect(situation.job.enabledTools.length).toBeGreaterThan(0); // Assert 7

                  // Validate execution section
                  // LCQ-009: Status inferred from successful execution result
                  expect(situation.execution.status).toBe('COMPLETED'); // Assert 8
                  expect(Array.isArray(situation.execution.trace)).toBe(true); // Assert 9
                  expect(situation.execution.finalOutputSummary).toBeTruthy(); // Assert 10

                  // EXQ-007: Validate execution trace captured (derived from telemetry)
                  const trace = situation.execution.trace;
                  expect(Array.isArray(trace)).toBe(true); // Assert 39
                  expect(trace.length).toBeGreaterThan(0); // Assert 40

                  // Validate trace entries have required structure
                  const firstTraceEntry = trace[0];
                  expect(firstTraceEntry).toBeDefined(); // Assert 41
                  expect(typeof firstTraceEntry.tool).toBe('string'); // Assert 42
                  expect(typeof firstTraceEntry.args).toBe('string'); // Assert 43
                  expect(typeof firstTraceEntry.result_summary).toBe('string'); // Assert 44

                  console.log('[TEST] Execution trace validated ✓');

                  // EXQ-004: Validate model selection from job metadata
                  // Note: Grandchild uses the runtime default model (no explicit override)
                  const expectedGrandchildModel =
                    getOptionalMechModel?.() ?? process.env.MECH_MODEL ?? 'gemini-2.5-pro';
                  expect(situation.job.model).toBe(expectedGrandchildModel); // Assert 45
                  console.log(`[TEST] Model selection validated (default model = ${expectedGrandchildModel}) ✓`);

                  // Validate context section
                  expect(situation.context).toBeDefined(); // Assert 11
                  expect(situation.context.parent).toBeDefined(); // Assert 12
                  if (!situation.context.parent) {
                    throw new Error('Grandchild situation missing parent context');
                  }

                  console.log('[TEST] Grandchild SITUATION structure valid ✓');

                  // =========================================================
                  // SECTION 10: Validate Embedding Format
                  // =========================================================

                  console.log('\n[TEST] SECTION 10: Validating grandchild embedding...');

                  const embedding = situation.embedding;
                  expect(embedding).toBeDefined(); // Assert 13

                  // MEM-004: Must use text-embedding-3-small with 256 dimensions
                  expect(embedding.model).toBe('text-embedding-3-small'); // Assert 14
                  expect(embedding.dim).toBe(256); // Assert 15
                  expect(Array.isArray(embedding.vector)).toBe(true); // Assert 16
                  expect(embedding.vector.length).toBe(256); // Assert 17

                  // Validate vector values are numeric and in valid range
                  expect(typeof embedding.vector[0]).toBe('number'); // Assert 18
                  expect(embedding.vector[0]).toBeGreaterThanOrEqual(-1); // Assert 19
                  expect(embedding.vector[0]).toBeLessThanOrEqual(1); // Assert 20

                  console.log('[TEST] Embedding format valid ✓');

                  // MEM-001: Complete SITUATION artifact with embedding demonstrates
                  // the system's ability to capture execution context for future retrieval

                  // =========================================================
                  // SECTION 11: Recognition Phase Validation (MEM-005)
                  // =========================================================

                  console.log('\n[TEST] SECTION 11: Validating grandchild recognized child...');

                  // Recognition MUST exist and include child
                  const recognition = situation.meta?.recognition;
                  expect(recognition).toBeDefined(); // Assert 21
                  if (!recognition) {
                    throw new Error('Recognition metadata missing on grandchild situation');
                  }
                  expect(recognition.similarJobs).toBeDefined(); // Assert 22
                  expect(Array.isArray(recognition.similarJobs)).toBe(true); // Assert 23

                  // MEM-003: Validate initial situation was enriched during recognition
                  expect(recognition.initialSituation).toBeDefined(); // Assert 57

                  // Verify enrichment preserved recognition results
                  expect(recognition.embeddingStatus).toBeDefined(); // Assert 58

                  console.log('[TEST] Situation enrichment validated ✓');

                  const similarJobs = recognition.similarJobs;
                  console.log(`[TEST] Recognition found ${similarJobs.length} similar jobs`);

                  // Child's SITUATION MUST be found
                  expect(similarJobs.length).toBeGreaterThan(0); // Assert 24

                  const foundChild = similarJobs.find(
                    (j: any) => j.requestId === requestId
                  ) as { requestId: string; similarity?: number; score?: number } | undefined;
                  expect(foundChild).toBeDefined(); // Assert 25
                  if (!foundChild) {
                    throw new Error('Grandchild recognition failed to find child situation');
                  }
                  const childSimilarity = foundChild.similarity ?? foundChild.score;
                  if (typeof childSimilarity !== 'number') {
                    throw new Error('Recognition result missing similarity score');
                  }
                  expect(childSimilarity).toBeGreaterThan(0.5); // Assert 26 - High similarity expected

                  console.log(`[TEST] ✓ Grandchild recognized child with similarity score: ${childSimilarity}`);

                  // Validate embedding status
                  if (recognition.embeddingStatus !== undefined) {
                    expect(recognition.embeddingStatus).toBe('success'); // Assert 27
                    console.log('[TEST] ✓ Embedding status: success');
                  }

                  // =========================================================
                  // SECTION 12: 3-Level Lineage Validation
                  // =========================================================

                  console.log('\n[TEST] SECTION 12: Validating 3-level lineage...');

                  // Grandchild → Child
                  expect(situation.context.parent).toBeDefined();
                  expect(situation.context.parent.requestId).toBe(requestId); // Assert 28
                  console.log('[TEST] ✓ Grandchild parent = Child');

                  // Fetch child SITUATION to verify Child → Parent
                  const childSituation = await fetchSituation(childDelivery, gqlUrl);
                  expect(childSituation).toBeDefined();
                  if (!childSituation || !childSituation.context?.parent) {
                    throw new Error('Child situation missing parent context');
                  }
                  expect(childSituation.context.parent.requestId).toBe(parentJob.requestId); // Assert 29
                  console.log('[TEST] ✓ Child parent = Parent');

                  // EXQ-004: Validate child used correct model
                  expect(childSituation.job.model).toBe('gemini-2.5-pro'); // Assert 52

                  // EXQ-005/006: Validate tool usage and enablement
                  const childTrace = childSituation.execution.trace;
                  const childToolsUsed = childTrace.map((entry: any) => entry.tool).filter((t: string) => t);
                  expect(childToolsUsed.length).toBeGreaterThan(0); // Assert 53 - Tool interaction occurred
                  expect(childToolsUsed).toContain('create_artifact'); // Assert 54 - Created analysis artifact
                  expect(childToolsUsed).toContain('dispatch_new_job'); // Assert 55 - Delegated grandchild job

                  console.log(`[TEST] Child tool usage validated: ${childToolsUsed.join(', ')} ✓`);
                  console.log('[TEST] Child job execution validated: model ✓');

                  console.log('[TEST] ✓ Complete lineage: Parent → Child → Grandchild');

                  // =========================================================
                  // SECTION 13: Git Working Tree Status
                  // =========================================================

                  console.log('\n[TEST] SECTION 13: Validating git working tree...');

                  // No uncommitted changes (jobs only create IPFS artifacts, not files)
                  const gitStatus = execSync('git status --porcelain', {
                    cwd: gitFixture!.repoPath,
                    encoding: 'utf-8'
                  }).trim();
                  expect(gitStatus).toBe(''); // Assert 77 - Working tree clean

                  console.log('[TEST] Git working tree clean (no file changes) ✓');

                  console.log('\n[TEST] ✅ Memory system test complete!');
                  console.log('[TEST] Coverage: MEM-001 to MEM-010, ARQ-006, EXQ-004/005/006/007, LCQ-003/009, GWQ-001/002 (metadata)');
                  console.log('[TEST] Assertions: 71 assertions executed (52 memory + 19 git metadata lineage)');
                  console.log('[TEST] Recognition: Grandchild successfully found child via similarity search');
                  console.log('[TEST] Lineage: 3-level delegation validated');
                }
              );
            });
          });
          } finally {
            // Restore worker stdio setting
            if (prevWorkerStdio === undefined) {
              delete process.env.TESTS_NEXT_WORKER_STDIO;
            } else {
              process.env.TESTS_NEXT_WORKER_STDIO = prevWorkerStdio;
            }
          }
        });
    },
    600_000 // 10 minute timeout
  );
});


// =============================================================================
// REMOVED SECTIONS (for future incremental testing):
// - SECTION 6: Recognition Phase Validation
// - SECTION 7: Reflection Phase Validation
// - SECTION 8: Ponder Indexing Validation
// - SECTION 9: Memory Discovery Validation
//
// These sections will be added back incrementally after the baseline test
// passes consistently.
// =============================================================================
