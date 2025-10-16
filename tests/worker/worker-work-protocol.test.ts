/**
 * Worker Work Protocol Test
 * Tests finalize_job(COMPLETED) triggering automatic parent job dispatch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fetch from 'cross-fetch';
import fs from 'node:fs';
import path from 'node:path';
import {
  getSharedInfrastructure,
  resetTestEnvironment,
  createTestJob,
  waitForJobIndexed,
  waitForRequestIndexed,
  runWorkerOnce,
  pollGraphQL,
  getMcpClient,
} from '../helpers/shared.js';

describe('Worker: Work Protocol', () => {
  beforeEach(() => {
    // Prefer .env.test if present to provide MECH/Safe settings under test
    try {
      const testEnv = path.join(process.cwd(), '.env.test');
      if (fs.existsSync(testEnv)) {
        process.env.JINN_ENV_PATH = testEnv;
      }
    } catch {}
    // Don't call resetTestEnvironment here - it would clear env before MCP reconnect in afterEach
    expect(process.env.MECH_WORKER_ADDRESS || process.env.MECH_ADDRESS, 'MECH_WORKER_ADDRESS required').toBeTruthy();
  });

  afterEach(async () => {
    // Clean up lineage env vars that this test sets
    delete process.env.JINN_REQUEST_ID;
    delete process.env.JINN_JOB_DEFINITION_ID;

    // Note: We used to disconnect/reconnect MCP client here to pick up env changes,
    // but tests do this inline when needed (see disconnect/connect within test body)
  });

  it('child calls finalize_job(COMPLETED) → parent auto-dispatched with message', async () => {
    const { gqlUrl, controlUrl } = getSharedInfrastructure();

    // 1) Create parent job
    const { jobDefId: parentJobId, requestId: parentRequestId } = await createTestJob({
      objective: 'Coordinate child job execution',
      context: 'Parent job for Work Protocol testing',
      acceptanceCriteria: 'Child completes and parent is auto-dispatched'
    });

    await waitForJobIndexed(gqlUrl, parentJobId);

    // 2) Create child job with lineage via env (production-like)
    // Ensure MCP process inherits updated env by reconnecting
    await getMcpClient().disconnect();
    process.env.JINN_REQUEST_ID = parentRequestId;
    process.env.JINN_JOB_DEFINITION_ID = parentJobId;
    await getMcpClient().connect();
    const { requestId: childRequestId } = await createTestJob({
      objective: 'Create a test artifact and finalize with COMPLETED status',
      context: 'Child job testing Work Protocol auto-dispatch behavior',
      instructions: 'Call create_artifact with name="test_artifact", topic="test", content="Test data". Then call finalize_job tool with status=COMPLETED. Then provide brief text output.',
      acceptanceCriteria: 'Artifact created and finalize_job called with COMPLETED status'
    });

    // Clear env variables after child job creation
    delete process.env.JINN_REQUEST_ID;
    delete process.env.JINN_JOB_DEFINITION_ID;

    // 3) Wait for child request to be indexed
    await waitForRequestIndexed(gqlUrl, childRequestId);

    // 4) Run worker single-shot on child job
    const workerProc = await runWorkerOnce(childRequestId, {
      gqlUrl: gqlUrl,
      controlApiUrl: controlUrl,
      model: 'gemini-2.5-pro',
      timeout: 300_000
    });

    // Wait for worker process to complete
    try {
      await workerProc;
    } catch (error) {
      // Allow non-zero exits; parent dispatch may still have succeeded
      console.log('[test] Worker exited with error (may be expected):', error);
    }

    // 5) Poll for parent job auto-dispatch
    // Query for requests that were auto-dispatched due to child completion
    // These have jobDefinitionId == parentJobId (dispatched by Work Protocol)
    const query = `
      query($parentJobId:String!) {
        requests(
          where: {
            jobDefinitionId: $parentJobId
          },
          orderBy: "blockTimestamp",
          orderDirection: "desc"
        ) {
          items {
            id
            blockTimestamp
            sourceJobDefinitionId
            sourceRequestId
            additionalContext
          }
        }
      }
    `;

    const autoDispatchedRequest = await pollGraphQL(
      gqlUrl,
      query,
      { parentJobId },
      (jr) => {
        const requests = jr?.data?.requests?.items || [];
        // Find requests for the parent job that have additionalContext with message (auto-dispatched)
        // Skip the original parent request (which won't have additionalContext)
        return requests.find((r: any) => {
          if (!r.additionalContext) return false;
          
          // Check if additionalContext has a message
          let hasMessage = false;
          if (typeof r.additionalContext === 'object' && r.additionalContext.message) {
            hasMessage = true;
          } else if (typeof r.additionalContext === 'string') {
            try {
              const parsed = JSON.parse(r.additionalContext);
              hasMessage = parsed.message && (
                typeof parsed.message === 'string' ? JSON.parse(parsed.message) : parsed.message
              );
            } catch {
              // Message parsing failed
            }
          }
          
          return hasMessage;
        }) || null;
      },
      { maxAttempts: 25, delayMs: 3000 }
    );

    expect(autoDispatchedRequest, 'Parent should be auto-dispatched after child COMPLETED').toBeTruthy();
    expect(autoDispatchedRequest.additionalContext).toBeTruthy();

    // 6) Verify message structure
    const additionalContext = autoDispatchedRequest.additionalContext;
    let workProtocolMessage: any = null;

    if (typeof additionalContext === 'object' && additionalContext.message) {
      workProtocolMessage = additionalContext.message;
    } else if (typeof additionalContext === 'string') {
      try {
        const parsed = JSON.parse(additionalContext);
        workProtocolMessage =
          typeof parsed.message === 'string' ? JSON.parse(parsed.message) : parsed.message;
      } catch {
        // Message extraction failed
      }
    }

    expect(workProtocolMessage, 'Work Protocol message should be present').toBeTruthy();
    expect(workProtocolMessage.content).toContain('Child job COMPLETED');
    expect(workProtocolMessage.to).toBe(parentJobId);
    expect(workProtocolMessage.from).toBe(childRequestId);

    console.log('Work Protocol verification:', {
      parentAutoDispatched: true,
      messageFormat: 'standardized',
      protocolWorking: true
    });
  }, 600_000);

  it('child with WAITING status does NOT trigger parent dispatch', async () => {
    const { gqlUrl, controlUrl } = getSharedInfrastructure();

    // 1) Create parent job
    const { jobDefId: parentJobId, requestId: parentRequestId } = await createTestJob({
      objective: 'Parent job - should NOT be auto-dispatched for non-terminal child states',
      context: 'Parent for testing NO auto-dispatch when child uses WAITING status',
      acceptanceCriteria: 'Only manual dispatches exist'
    });

    await waitForJobIndexed(gqlUrl, parentJobId);

    // 2) Create child that will finalize with WAITING status (non-terminal)
    // Ensure MCP process inherits updated env by reconnecting
    await getMcpClient().disconnect();
    process.env.JINN_REQUEST_ID = parentRequestId;
    process.env.JINN_JOB_DEFINITION_ID = parentJobId;
    await getMcpClient().connect();
    const { requestId: childRequestId } = await createTestJob({
      objective: 'Analyze data and wait for additional inputs',
      context: 'Child job testing non-terminal finalization status',
      instructions: 'Call create_artifact with simple analysis data. Then call finalize_job tool with status=WAITING and message="Waiting for additional data". Then provide brief text output.',
      acceptanceCriteria: 'Finalize with WAITING status to signal you need more data',
      enabledTools: ['create_artifact']
    });

    // Clear env variables after child job creation
    delete process.env.JINN_REQUEST_ID;
    delete process.env.JINN_JOB_DEFINITION_ID;

    await waitForRequestIndexed(gqlUrl, childRequestId);

    // 3) Run worker
    const workerProc = await runWorkerOnce(childRequestId, {
      gqlUrl: gqlUrl,
      controlApiUrl: controlUrl,
      model: 'gemini-2.5-pro',
      timeout: 300_000
    });

    try {
      await workerProc;
    } catch (error) {
      // Allow non-zero exits
      console.log('[test] Worker exited with error (may be expected):', error);
    }

    // 4) Wait a bit for any potential auto-dispatch
    await new Promise(r => setTimeout(r, 10_000));

    // 5) Verify NO auto-dispatch occurred
    // Query for requests that were auto-dispatched due to a child completion
    // (i.e., requests with sourceJobDefinitionId pointing to this parent)
    const autoDispatchQuery = `
      query($parentJobId:String!) {
        requests(
          where: {
            jobDefinitionId: $parentJobId,
            sourceJobDefinitionId: $parentJobId
          },
          orderBy: "blockTimestamp",
          orderDirection: "desc"
        ) {
          items {
            id
            sourceJobDefinitionId
          }
        }
      }
    `;

    const resp = await fetch(gqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: autoDispatchQuery, variables: { parentJobId } })
    });

    const jr = await resp.json();
    const autoDispatched = jr?.data?.requests?.items || [];

    // Debug: show what we found
    console.log('[test] Auto-dispatch check:', {
      parentJobId,
      parentRequestId,
      autoDispatchedCount: autoDispatched.length,
      autoDispatchedRequests: autoDispatched.map((r: any) => ({
        id: r.id,
        sourceJobDefId: r.sourceJobDefinitionId
      }))
    });

    // Should be NO auto-dispatched requests (child used WAITING status, not COMPLETED/FAILED)
    expect(autoDispatched.length).toBe(0);

    console.log('Work Protocol verification:', {
      parentAutoDispatched: false,
      reason: 'Child finalized with WAITING status (non-terminal)',
      protocolWorking: true
    });
  }, 600_000);
});
