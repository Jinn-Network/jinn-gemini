/**
 * Tests for LocalTransactionQueue
 * 
 * Focus on critical atomic operations and concurrency handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalTransactionQueue } from './LocalTransactionQueue.js';
import { TransactionInput, ExecutionStrategy } from './types.js';

describe('LocalTransactionQueue', () => {
  let tempDir: string;
  let queue: LocalTransactionQueue;

  beforeEach(async () => {
    // Create temporary directory for test database
    tempDir = await mkdtemp(join(tmpdir(), 'queue-test-'));
    const dbPath = join(tempDir, 'test.db');
    
    queue = new LocalTransactionQueue({
      dbPath,
      walMode: true,
      cacheSize: 1000
    });
    
    await queue.initialize();
  });

  afterEach(async () => {
    await queue.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Basic Operations', () => {
    it('should enqueue a transaction', async () => {
      const input: TransactionInput = {
        payload: {
          to: '0x1234567890123456789012345678901234567890',
          value: '1000000000000000000',
          data: '0x'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy,
        idempotencyKey: 'test-key-1'
      };

      const result = await queue.enqueue(input);

      expect(result.id).toBeDefined();
      expect(result.status).toBe('PENDING');
      expect(result.chain_id).toBe(1);
      expect(result.execution_strategy).toBe('EOA');
      expect(result.idempotency_key).toBe('test-key-1');
      expect(result.payload).toEqual(input.payload);
    });

    it('should handle duplicate enqueue with same payload hash', async () => {
      const input: TransactionInput = {
        payload: {
          to: '0x1234567890123456789012345678901234567890',
          value: '1000000000000000000'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      };

      const result1 = await queue.enqueue(input);
      const result2 = await queue.enqueue(input);

      expect(result1.id).toBe(result2.id);
      expect(result1.payload_hash).toBe(result2.payload_hash);
    });

    it('should retrieve transaction status by ID', async () => {
      const input: TransactionInput = {
        payload: {
          to: '0x1234567890123456789012345678901234567890',
          value: '1000000000000000000'
        },
        chainId: 1,
        executionStrategy: 'SAFE' as ExecutionStrategy
      };

      const enqueued = await queue.enqueue(input);
      const retrieved = await queue.getStatus(enqueued.id);

      expect(retrieved).toBeTruthy();
      expect(retrieved!.id).toBe(enqueued.id);
      expect(retrieved!.status).toBe('PENDING');
    });
  });

  describe('Atomic Claim Mechanism', () => {
    it('should claim the oldest pending transaction', async () => {
      // Enqueue multiple transactions
      const inputs = Array.from({ length: 3 }, (_, i) => ({
        payload: {
          to: `0x${i.toString().padStart(40, '0')}`,
          value: '1000000000000000000'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      }));

      const enqueued = [];
      for (const input of inputs) {
        enqueued.push(await queue.enqueue(input));
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Claim should return the first (oldest) transaction
      const claimed = await queue.claim('worker-1');

      expect(claimed).toBeTruthy();
      expect(claimed!.id).toBe(enqueued[0].id);
      expect(claimed!.status).toBe('CLAIMED');
      expect(claimed!.worker_id).toBe('worker-1');
      expect(claimed!.attempt_count).toBe(1);
      expect(claimed!.claimed_at).toBeDefined();
    });

    it('should not claim the same transaction twice', async () => {
      const input: TransactionInput = {
        payload: {
          to: '0x1234567890123456789012345678901234567890',
          value: '1000000000000000000'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      };

      await queue.enqueue(input);

      const claimed1 = await queue.claim('worker-1');
      const claimed2 = await queue.claim('worker-2');

      expect(claimed1).toBeTruthy();
      expect(claimed2).toBeNull();
    });

    it('should allow claiming expired transactions', async () => {
      const input: TransactionInput = {
        payload: {
          to: '0x1234567890123456789012345678901234567890',
          value: '1000000000000000000'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      };

      await queue.enqueue(input);

      // Claim transaction
      const claimed1 = await queue.claim('worker-1');
      expect(claimed1).toBeTruthy();

      // Manually set claimed_at to past to simulate expiration
      // In real usage, this would happen due to timeout
      await queue['db'].prepare(`
        UPDATE transaction_requests 
        SET claimed_at = ? 
        WHERE id = ?
      `).run(Date.now() - (16 * 60 * 1000), claimed1!.id); // 16 minutes ago

      // Should be able to claim the expired transaction
      const claimed2 = await queue.claim('worker-2');
      expect(claimed2).toBeTruthy();
      expect(claimed2!.id).toBe(claimed1!.id);
      expect(claimed2!.worker_id).toBe('worker-2');
      expect(claimed2!.attempt_count).toBe(2);
    });

    it('should handle concurrent claims safely', async () => {
      // Enqueue one transaction
      const input: TransactionInput = {
        payload: {
          to: '0x1234567890123456789012345678901234567890',
          value: '1000000000000000000'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      };

      await queue.enqueue(input);

      // Simulate concurrent claim attempts
      const promises = [
        queue.claim('worker-1'),
        queue.claim('worker-2'),
        queue.claim('worker-3')
      ];

      const results = await Promise.all(promises);

      // Only one should succeed
      const successful = results.filter(r => r !== null);
      const failed = results.filter(r => r === null);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });
  });

  describe('Status Updates', () => {
    it('should update transaction status', async () => {
      const input: TransactionInput = {
        payload: {
          to: '0x1234567890123456789012345678901234567890',
          value: '1000000000000000000'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      };

      const enqueued = await queue.enqueue(input);
      const claimed = await queue.claim('worker-1');

      await queue.updateStatus(claimed!.id, 'CONFIRMED', {
        tx_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        completed_at: new Date().toISOString()
      });

      const updated = await queue.getStatus(claimed!.id);
      expect(updated!.status).toBe('CONFIRMED');
      expect(updated!.tx_hash).toBe('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
      expect(updated!.completed_at).toBeDefined();
    });
  });

  describe('Metrics', () => {
    it('should return accurate queue metrics', async () => {
      // Enqueue transactions with different statuses
      const input1: TransactionInput = {
        payload: { to: '0x1111111111111111111111111111111111111111', value: '1' },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      };
      
      const input2: TransactionInput = {
        payload: { to: '0x2222222222222222222222222222222222222222', value: '2' },
        chainId: 1,
        executionStrategy: 'SAFE' as ExecutionStrategy
      };

      const tx1 = await queue.enqueue(input1);
      const tx2 = await queue.enqueue(input2);

      // Claim one transaction (should be tx1 as it's oldest)
      const claimed = await queue.claim('worker-1');

      // Complete the claimed transaction
      await queue.updateStatus(claimed!.id, 'CONFIRMED');

      const metrics = await queue.getMetrics();

      expect(metrics.pending_count).toBe(1); // tx2 is still pending
      expect(metrics.claimed_count).toBe(0); // claimed tx was completed
      expect(metrics.confirmed_count).toBe(1); // claimed tx is confirmed
      expect(metrics.failed_count).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should clean up old completed transactions', async () => {
      const input: TransactionInput = {
        payload: {
          to: '0x1234567890123456789012345678901234567890',
          value: '1000000000000000000'
        },
        chainId: 1,
        executionStrategy: 'EOA' as ExecutionStrategy
      };

      const tx = await queue.enqueue(input);
      const claimed = await queue.claim('worker-1');
      await queue.updateStatus(claimed!.id, 'CONFIRMED');

      // Set completed_at to past
      await queue['db'].prepare(`
        UPDATE transaction_requests 
        SET completed_at = ? 
        WHERE id = ?
      `).run(Date.now() - (2 * 60 * 60 * 1000), tx.id); // 2 hours ago

      const deleted = await queue.cleanup(60 * 60 * 1000); // 1 hour cutoff

      expect(deleted).toBe(1);
      
      // Transaction should be gone
      const retrieved = await queue.getStatus(tx.id);
      expect(retrieved).toBeNull();
    });
  });
});