/**
 * Integration Test: Control API Validation Gateway
 *
 * Tests the critical validation boundary between Worker → Control API → Supabase
 * Validates ARQ-005 and ARQ-008: Control API MUST validate requestId against Ponder
 * before allowing writes to Supabase.
 *
 * This test validates JINN-195 fix: Control API as validation gateway preventing
 * invalid lineage and malformed data from reaching the database.
 *
 * Architecture tested:
 * - Worker calls Control API (GraphQL mutations)
 * - Control API validates requestId exists in Ponder
 * - Control API injects lineage fields (request_id, worker_address)
 * - Control API writes to Supabase ONLY if validation passes
 *
 * What makes this a TRUE integration test:
 * ✅ Real Control API server (via ProcessHarness)
 * ✅ Real Supabase database (test schema or cleared tables)
 * ✅ Real Ponder for validation queries
 * ✅ Real HTTP requests (no mocks of boundary)
 * ❌ Mocked blockchain (use Tenderly VNet, not full node)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { withTestEnv } from '../../helpers/env-controller.js';
import { withProcessHarness } from '../../helpers/process-harness.js';
import { withTenderlyVNet } from '../../helpers/tenderly-runner.js';
import { createGitFixture, type GitFixture } from '../../helpers/git-fixture.js';
import { createTestJob } from '../../helpers/mcp-client.js';
import { waitForRequestIndexed, waitForPonderReady } from '../../helpers/ponder-waiters.js';
import { getRequest } from '../../helpers/ponder-queries.js';
import fetch from 'cross-fetch';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

describe.sequential('Control API: Validation Gateway Integration', () => {
  let gitFixture: GitFixture | null = null;

  beforeAll(() => {
    gitFixture = createGitFixture();
    process.env.CODE_METADATA_REPO_ROOT = gitFixture.repoPath;
  });

  afterAll(async () => {
    if (gitFixture) {
      gitFixture.cleanup();
      gitFixture = null;
    }
    delete process.env.CODE_METADATA_REPO_ROOT;
  });

  // Cleanup MCP client after each test to ensure new VNet RPC is picked up
  afterEach(async () => {
    // Force disconnect MCP client so next test gets fresh subprocess with correct RPC_URL
    const { disconnectMcpClient } = await import('../../helpers/mcp-client.js');
    await disconnectMcpClient();
  });

  // Test configuration
  const TEST_WORKER_ADDRESS = '0x1234567890123456789012345678901234567890';

  /**
   * Helper to call Control API GraphQL mutation
   */
  async function callControlApi(
    controlUrl: string,
    mutation: string,
    workerAddress: string = TEST_WORKER_ADDRESS
  ): Promise<any> {
    const response = await fetch(`${controlUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-address': workerAddress
      },
      body: JSON.stringify({ query: mutation })
    });

    const result = await response.json();
    return result;
  }

  /**
   * Helper to query Supabase directly (bypass Control API)
   */
  function getSupabaseClient() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
    }

    return createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Test 1: Control API BLOCKS writes when requestId not found in Ponder
   *
   * This is the CRITICAL test from JINN-195 - validates that Control API
   * prevents invalid writes before they reach Supabase.
   */
  it('blocks claim when requestId not found in Ponder', async () => {
    await withTestEnv(async () => {
      await withProcessHarness(
        {
          rpcUrl: 'http://127.0.0.1:8545', // Mock RPC (no VNet needed, empty Ponder)
          startWorker: false
        },
        async (ctx) => {
          // 1. Wait for Ponder to be ready (but empty - no requests seeded)
          await waitForPonderReady(ctx.gqlUrl);

          // 2. Attempt to claim a request that doesn't exist in Ponder
          const invalidRequestId = `0x${randomUUID().replace(/-/g, '')}`;

          const result = await callControlApi(
            ctx.controlUrl,
            `
              mutation {
                claimRequest(requestId: "${invalidRequestId}") {
                  request_id
                  worker_address
                  status
                }
              }
            `
          );

          // 3. Assert: Control API returned error
          expect(result.errors).toBeDefined();
          expect(result.errors.length).toBeGreaterThan(0);
          // Control API returns generic "Unexpected error." for validation failures
          // The actual validation error is logged but not exposed to client
          expect(result.errors[0].message).toBeDefined();

          // 4. Assert: NO write occurred in Supabase
          const supabase = getSupabaseClient();
          const { data: claims } = await supabase
            .from('onchain_request_claims')
            .select('*')
            .eq('request_id', invalidRequestId);

          expect(claims).toHaveLength(0); // Critical: No database pollution!
        }
      );
    });
  }, 60000); // 60s timeout for Ponder startup

  /**
   * Test 2: Control API ALLOWS writes when requestId exists in Ponder
   *
   * Validates the happy path: valid requestId → validation passes → write succeeds
   */
  it('allows claim when requestId exists in Ponder', async () => {
    await withTestEnv(async () => {
      await withTenderlyVNet(async (tenderly) => {
        await withProcessHarness(
          {
            rpcUrl: tenderly.rpcUrl,
            startWorker: false
          },
          async (ctx) => {
            // 1. Wait for Ponder to be ready
            await waitForPonderReady(ctx.gqlUrl, { timeoutMs: 60000 });

            // 2. Create a real test job via MCP (dispatches to blockchain)
            const { requestId, jobDefId } = await createTestJob({
              objective: 'Validate Control API allows writes for valid requests',
              context: 'Integration test for Control API validation gateway',
              acceptanceCriteria: 'Control API accepts claim and writes to Supabase'
            });

            console.log(`[Test 2] Created test job: ${jobDefId}, request: ${requestId}`);

            // 3. Wait for Ponder to index the request
            await waitForRequestIndexed(ctx.gqlUrl, requestId, { timeoutMs: 45000 });

            // 4. Verify request exists in Ponder before calling Control API
            const ponderRequest = await getRequest(ctx.gqlUrl, requestId);
            expect(ponderRequest).toBeTruthy();
            expect(ponderRequest?.id).toBe(requestId);

            // 5. Call Control API to claim the request
            const result = await callControlApi(ctx.controlUrl, `
              mutation {
                claimRequest(requestId: "${requestId}") {
                  request_id
                  worker_address
                  status
                }
              }
            `);

            // 6. Assert: Control API accepted the claim (no errors)
            expect(result.errors).toBeUndefined();
            expect(result.data?.claimRequest).toBeDefined();
            expect(result.data.claimRequest.request_id).toBe(requestId);
            expect(result.data.claimRequest.worker_address).toBe(TEST_WORKER_ADDRESS);

            // 7. Assert: Write occurred in Supabase
            const supabase = getSupabaseClient();
            const { data: claims, error } = await supabase
              .from('onchain_request_claims')
              .select('*')
              .eq('request_id', requestId);

            expect(error).toBeNull();
            expect(claims).toHaveLength(1);
            expect(claims![0].request_id).toBe(requestId);
            expect(claims![0].worker_address).toBe(TEST_WORKER_ADDRESS);
          }
        );
      });
    });
  }, 240000); // 240s timeout for Git + Tenderly + Ponder + job creation

  /**
   * Test 3: Control API handles idempotent claims correctly
   *
   * Validates that claiming the same request twice doesn't create duplicates.
   * Tests ON CONFLICT DO NOTHING logic in Supabase.
   */
  it('handles idempotent claims (same request claimed twice)', async () => {
    await withTestEnv(async () => {
      await withTenderlyVNet(async (tenderly) => {
        await withProcessHarness(
          {
            rpcUrl: tenderly.rpcUrl,
            startWorker: false
          },
          async (ctx) => {
            // 1. Wait for Ponder to be ready
            await waitForPonderReady(ctx.gqlUrl, { timeoutMs: 60000 });

            // 2. Create a real test job via MCP
            const { requestId, jobDefId } = await createTestJob({
              objective: 'Test idempotent claims in Control API',
              context: 'Integration test for idempotency handling',
              acceptanceCriteria: 'Same request can be claimed multiple times without duplicates'
            });

            console.log(`[Test 3] Created test job: ${jobDefId}, request: ${requestId}`);

            // 3. Wait for Ponder to index the request
            await waitForRequestIndexed(ctx.gqlUrl, requestId, { timeoutMs: 45000 });

            const claimMutation = `
              mutation {
                claimRequest(requestId: "${requestId}") {
                  request_id
                  worker_address
                  status
                }
              }
            `;

            // 4. Claim the request FIRST time
            const result1 = await callControlApi(ctx.controlUrl, claimMutation);
            expect(result1.errors).toBeUndefined();
            expect(result1.data?.claimRequest?.request_id).toBe(requestId);
            console.log('[Test 3] First claim succeeded');

            // 5. Claim the request SECOND time (idempotent operation)
            const result2 = await callControlApi(ctx.controlUrl, claimMutation);
            expect(result2.errors).toBeUndefined();
            expect(result2.data?.claimRequest?.request_id).toBe(requestId);
            console.log('[Test 3] Second claim succeeded (idempotent)');

            // 6. Verify only ONE claim in database (no duplicates)
            const supabase = getSupabaseClient();
            const { data: claims, error } = await supabase
              .from('onchain_request_claims')
              .select('*')
              .eq('request_id', requestId);

            expect(error).toBeNull();
            expect(claims).toHaveLength(1); // Critical: Only ONE claim!
            expect(claims![0].request_id).toBe(requestId);
            expect(claims![0].worker_address).toBe(TEST_WORKER_ADDRESS);

            console.log('[Test 3] Verified: Only 1 claim in database (idempotency works!)');
          }
        );
      });
    });
  }, 240000); // 240s timeout

  /**
   * Test 4: Control API injects lineage fields automatically
   *
   * Validates that request_id and worker_address are injected by Control API,
   * not manually constructed by worker.
   */
  it('injects lineage fields (request_id, worker_address)', async () => {
    await withTestEnv(async () => {
      await withTenderlyVNet(async (tenderly) => {
        await withProcessHarness(
          {
            rpcUrl: tenderly.rpcUrl,
            startWorker: false
          },
          async (ctx) => {
            // 1. Wait for Ponder to be ready
            await waitForPonderReady(ctx.gqlUrl, { timeoutMs: 60000 });

            // 2. Create a real test job via MCP
            const { requestId, jobDefId } = await createTestJob({
              objective: 'Test Control API lineage field injection',
              context: 'Integration test for automatic lineage tracking',
              acceptanceCriteria: 'Control API injects request_id and worker_address automatically'
            });

            console.log(`[Test 4] Created test job: ${jobDefId}, request: ${requestId}`);

            // 3. Wait for Ponder to index the request
            await waitForRequestIndexed(ctx.gqlUrl, requestId, { timeoutMs: 45000 });

            // 4. Call Control API - NOTE: We do NOT pass request_id or worker_address as parameters
            const result = await callControlApi(
              ctx.controlUrl,
              `
                mutation {
                  claimRequest(requestId: "${requestId}") {
                    request_id
                    worker_address
                    status
                  }
                }
              `,
              TEST_WORKER_ADDRESS // Passed via header
            );

            expect(result.errors).toBeUndefined();
            expect(result.data?.claimRequest).toBeDefined();

            // 5. Verify lineage fields were INJECTED by Control API (not sent by worker)
            const supabase = getSupabaseClient();
            const { data: claims, error } = await supabase
              .from('onchain_request_claims')
              .select('*')
              .eq('request_id', requestId);

            expect(error).toBeNull();
            expect(claims).toHaveLength(1);

            // 6. Assert: request_id and worker_address were injected correctly
            const claim = claims![0];
            expect(claim.request_id).toBe(requestId);
            expect(claim.worker_address).toBe(TEST_WORKER_ADDRESS);

            // 7. Additional assertions on injected fields
            expect(claim.request_id).toMatch(/^0x[0-9a-f]{64}$/); // Valid hex string
            expect(claim.worker_address).toMatch(/^0x[0-9a-f]{40}$/i); // Valid Ethereum address

            console.log('[Test 4] Verified: Lineage fields injected correctly!');
            console.log(`  - request_id: ${claim.request_id}`);
            console.log(`  - worker_address: ${claim.worker_address}`);
          }
        );
      });
    });
  }, 240000); // 240s timeout
});
