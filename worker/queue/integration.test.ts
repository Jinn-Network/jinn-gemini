/**
 * Integration test for local transaction queue
 * 
 * Demonstrates the complete flow from enqueue to processing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TransactionQueueFactory } from './TransactionQueueFactory.js';
import { TransactionProcessor } from '../TransactionProcessor.js';
import { TransactionInput, ExecutionStrategy, QueueConfig } from './types.js';

// Mock executors for testing
class MockSafeExecutor {
  async processTransactionRequest(request: any): Promise<void> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 10));
    console.log(`Mock Safe processing: ${request.id}`);
  }
}

class MockEoaExecutor {
  async processTransactionRequest(request: any): Promise<void> {
    // Simulate processing delay  
    await new Promise(resolve => setTimeout(resolve, 10));
    console.log(`Mock EOA processing: ${request.id}`);
  }
}

describe('Local Queue Integration', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'queue-integration-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle complete transaction lifecycle with local queue', async () => {
    // Create local queue configuration
    const config: QueueConfig = {
      type: 'local',
      local: {
        dbPath,
        walMode: true
      }
    };

    const queue = TransactionQueueFactory.create(config);
    await queue.initialize();

    // Test 1: Enqueue transaction
    const transactionInput: TransactionInput = {
      payload: {
        to: '0x1234567890123456789012345678901234567890',
        value: '1000000000000000000',
        data: '0xa9059cbb000000000000000000000000742d35cc6cf7f64c8b6cf8af2c64f3aa4b5fb7d0000000000000000000000000000000000000000000000000de0b6b3a7640000'
      },
      chainId: 1,
      executionStrategy: 'EOA' as ExecutionStrategy,
      idempotencyKey: crypto.randomUUID()
    };

    const enqueued = await queue.enqueue(transactionInput);
    expect(enqueued.id).toBeDefined();
    expect(enqueued.status).toBe('PENDING');

    // Test 2: Create and test transaction processor
    // Note: We can't easily test the real executors without blockchain setup,
    // but we can test the queue interaction
    
    const workerId = 'test-worker-1';
    
    // Test claiming
    const claimed = await queue.claim(workerId);
    expect(claimed).toBeTruthy();
    expect(claimed!.id).toBe(enqueued.id);
    expect(claimed!.status).toBe('CLAIMED');
    expect(claimed!.worker_id).toBe(workerId);

    // Test status update (simulate successful processing)
    await queue.updateStatus(claimed!.id, 'CONFIRMED', {
      tx_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      completed_at: new Date().toISOString()
    });

    // Verify final state
    const final = await queue.getStatus(claimed!.id);
    expect(final!.status).toBe('CONFIRMED');
    expect(final!.tx_hash).toBe('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');

    // Test metrics
    const metrics = await queue.getMetrics();
    expect(metrics.confirmed_count).toBe(1);
    expect(metrics.pending_count).toBe(0);
    expect(metrics.claimed_count).toBe(0);

    await queue.close();
  });

  it('should handle multiple workers without conflicts', async () => {
    const config: QueueConfig = {
      type: 'local',
      local: { dbPath, walMode: true }
    };

    const queue = TransactionQueueFactory.create(config);
    await queue.initialize();

    // Enqueue multiple transactions
    const transactions = [];
    for (let i = 0; i < 5; i++) {
      const tx = await queue.enqueue({
        payload: {
          to: `0x${i.toString().padStart(40, '0')}`,
          value: '1000000000000000000',
          data: '0x'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      });
      transactions.push(tx);
    }

    // Simulate multiple workers claiming
    const workers = ['worker-1', 'worker-2', 'worker-3'];
    const claims = await Promise.all(
      workers.map(workerId => queue.claim(workerId))
    );

    // Should have exactly 3 successful claims (one per worker)
    const successfulClaims = claims.filter(c => c !== null);
    expect(successfulClaims).toHaveLength(3);

    // Each claim should have a different transaction ID  
    const claimedIds = new Set(successfulClaims.map(c => c!.id));
    expect(claimedIds.size).toBe(3);

    // Verify remaining transactions are still pending
    const metrics = await queue.getMetrics();
    expect(metrics.pending_count).toBe(2); // 5 total - 3 claimed
    expect(metrics.claimed_count).toBe(3);

    await queue.close();
  });

  it('should demonstrate queue factory environment selection', async () => {
    // Test factory with explicit local config
    const localQueue = TransactionQueueFactory.create({
      type: 'local',
      local: { dbPath }
    });
    await localQueue.initialize();
    expect(localQueue).toBeDefined();

    // Test that we can enqueue and claim
    const tx = await localQueue.enqueue({
      payload: {
        to: '0x1234567890123456789012345678901234567890',
        data: '0x',
        value: '0'
      },
      chainId: 1,
      executionStrategy: 'EOA' as ExecutionStrategy
    });

    const claimed = await localQueue.claim('test-worker');
    expect(claimed!.id).toBe(tx.id);

    await localQueue.close();
  });
});

// Add crypto polyfill for Node.js environments that don't have it globally
if (typeof crypto === 'undefined') {
  const { webcrypto } = require('crypto');
  global.crypto = webcrypto as Crypto;
}