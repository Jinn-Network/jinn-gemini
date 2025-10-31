/**
 * Worker Basic Execution Test
 * Tests worker claim → execution → on-chain delivery flow
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getSharedInfrastructure,
  resetTestEnvironment,
  createTestJob,
  waitForRequestIndexed,
  waitForDelivery,
  runWorkerOnce,
  reconstructDirCidFromHexIpfsHash,
  fetchJsonWithRetry,
} from '../helpers/shared.js';

describe('Worker: Basic Execution Flow', () => {
  beforeEach(() => {
    // Prefer .env.test if present to provide MECH/Safe settings under test
    try {
      const testEnv = path.join(process.cwd(), '.env.test');
      if (fs.existsSync(testEnv)) {
        process.env.JINN_ENV_PATH = testEnv;
      }
    } catch {}
    resetTestEnvironment();
    expect(process.env.MECH_WORKER_ADDRESS || process.env.MECH_ADDRESS, 'MECH_WORKER_ADDRESS required').toBeTruthy();
  });

  it('worker claims, executes, and delivers on-chain', async () => {
    const { gqlUrl, controlUrl } = getSharedInfrastructure();
    // 1) Create simple test job
    const { requestId } = await createTestJob({
      objective: 'Simple task for worker execution test',
      context: 'Basic worker execution test - no artifacts required',
      instructions: [
        'Acknowledge the task completion.',
        'Provide a brief execution summary describing what was done.',
        'Do not call any additional workflow tools.'
      ].join(' '),
      acceptanceCriteria: 'Task is acknowledged, summarized, and delivered on-chain',
      enabledTools: []
    });

    // 2) Wait for request to be indexed
    await waitForRequestIndexed(gqlUrl, requestId);

    // 3) Run worker single-shot (returns immediately as it runs in background)
    const workerProc = await runWorkerOnce(requestId, {
      gqlUrl,
      controlApiUrl: controlUrl,
      model: 'gemini-2.5-pro',
      timeout: 300_000
    });

    // Wait for worker process to complete
    try {
      await workerProc;
    } catch (error) {
      // Allow non-zero exits; delivery may still have succeeded
      console.log('[test] Worker exited with error (may be expected):', error);
    }

    // 4) Poll for delivery indexed
    const delivery = await waitForDelivery(gqlUrl, requestId, {
      maxAttempts: 40,
      delayMs: 5000
    });

    expect(delivery.id).toBe(requestId);
    expect(typeof delivery.ipfsHash).toBe('string');
    expect(typeof delivery.transactionHash).toBe('string');
    expect(typeof delivery.blockTimestamp).toBe('string');

    // 5) Fetch and verify delivery JSON from IPFS
    const dirCid = reconstructDirCidFromHexIpfsHash(delivery.ipfsHash);
    expect(dirCid, 'Should reconstruct dir CID from delivery ipfsHash').toBeTruthy();

    const reqPath = `${dirCid}/${requestId}`;
    const url = `https://gateway.autonolas.tech/ipfs/${reqPath}`;
    const deliveryJson = await fetchJsonWithRetry(url, 6, 2000);

    expect(typeof deliveryJson).toBe('object');
    expect(deliveryJson.requestId).toBe(requestId);

    // Verify output field contains actual content
    expect(deliveryJson.output, 'Delivery output should exist').toBeTruthy();
    expect(typeof deliveryJson.output).toBe('string');
    expect(deliveryJson.output.length, 'Delivery output should not be empty').toBeGreaterThan(0);
    if (deliveryJson.telemetry?.finalStatus) {
      expect(deliveryJson.telemetry.finalStatus.status).toBe('COMPLETED');
    }
  }, 600_000);
});
