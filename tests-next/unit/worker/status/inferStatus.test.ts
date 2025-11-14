/**
 * Unit Test: Status Inference
 * Module: worker/status/inferStatus.ts
 * Priority: P1 (HIGH)
 *
 * Tests job status inference logic based on errors, telemetry tool calls,
 * and child job delivery status. Critical for workflow correctness.
 *
 * Impact: Prevents incorrect status inference ($550/year workflow failures)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { inferJobStatus } from '../../../../worker/status/inferStatus.js';
import type { FinalStatus, ChildJobStatus } from '../../../../worker/types.js';

// Mock childJobs module
vi.mock('../../../../worker/status/childJobs.js', () => ({
  getChildJobStatus: vi.fn(),
}));

import { getChildJobStatus } from '../../../../worker/status/childJobs.js';

describe('inferJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FAILED status', () => {
    it('infers FAILED when error is present', async () => {
      const error = new Error('Execution failed');
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error,
        telemetry: {},
      });

      expect(result).toEqual({
        status: 'FAILED',
        message: 'Job failed: Execution failed',
      });
    });

    it('infers FAILED with string error', async () => {
      const error = 'Network timeout';
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error,
        telemetry: {},
      });

      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('Network timeout');
    });

    it('infers FAILED with error object without message', async () => {
      const error = { code: 500 };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error,
        telemetry: {},
      });

      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('[object Object]');
    });

    it('prioritizes FAILED over other statuses', async () => {
      const error = new Error('Critical error');
      // Has dispatch calls but should still be FAILED
      const telemetry = {
        toolCalls: [{ tool: 'dispatch_new_job', success: true }],
      };
      (getChildJobStatus as any).mockResolvedValue([
        { id: '0xchild1', delivered: false },
      ]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error,
        telemetry,
      });

      expect(result.status).toBe('FAILED');
    });
  });

  describe('DELEGATING status', () => {
    it('infers DELEGATING with dispatch_new_job calls', async () => {
      const telemetry = {
        toolCalls: [
          { tool: 'dispatch_new_job', success: true },
        ],
      };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result).toEqual({
        status: 'DELEGATING',
        message: 'Dispatched 1 child job(s)',
      });
    });

    it('infers DELEGATING with dispatch_existing_job calls', async () => {
      const telemetry = {
        toolCalls: [
          { tool: 'dispatch_existing_job', success: true },
        ],
      };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result.status).toBe('DELEGATING');
    });

    it('infers DELEGATING with multiple dispatch calls', async () => {
      const telemetry = {
        toolCalls: [
          { tool: 'dispatch_new_job', success: true },
          { tool: 'dispatch_new_job', success: true },
          { tool: 'dispatch_existing_job', success: true },
        ],
      };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result).toEqual({
        status: 'DELEGATING',
        message: 'Dispatched 3 child job(s)',
      });
    });

    it('ignores failed dispatch calls', async () => {
      const telemetry = {
        toolCalls: [
          { tool: 'dispatch_new_job', success: false },
          { tool: 'dispatch_new_job', success: true },
        ],
      };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result).toEqual({
        status: 'DELEGATING',
        message: 'Dispatched 1 child job(s)',
      });
    });

    it('handles snake_case tool_calls field', async () => {
      const telemetry = {
        tool_calls: [
          { tool: 'dispatch_new_job', success: true },
        ],
      };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result.status).toBe('DELEGATING');
    });

    it('handles missing toolCalls/tool_calls fields', async () => {
      const telemetry = {};
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result.status).not.toBe('DELEGATING');
    });

    it('ignores non-dispatch tool calls', async () => {
      const telemetry = {
        toolCalls: [
          { tool: 'read_file', success: true },
          { tool: 'write_file', success: true },
        ],
      };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result.status).not.toBe('DELEGATING');
    });

    it('uses delegated flag when telemetry is missing', async () => {
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry: {},
        delegatedThisRun: true,
      });

      expect(result).toEqual({
        status: 'DELEGATING',
        message: 'Dispatched child job(s) this run',
      });
    });
  });

  describe('WAITING status', () => {
    it('infers WAITING when child jobs are undelivered', async () => {
      const telemetry = { toolCalls: [] };
      (getChildJobStatus as any).mockResolvedValue([
        { id: '0xchild1', delivered: false },
      ]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result).toEqual({
        status: 'WAITING',
        message: 'Waiting for 1 child job(s) to deliver',
      });
    });

    it('infers WAITING with multiple undelivered children', async () => {
      const telemetry = { toolCalls: [] };
      (getChildJobStatus as any).mockResolvedValue([
        { id: '0xchild1', delivered: false },
        { id: '0xchild2', delivered: false },
        { id: '0xchild3', delivered: false },
      ]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result).toEqual({
        status: 'WAITING',
        message: 'Waiting for 3 child job(s) to deliver',
      });
    });

    it('infers WAITING when some children delivered but not all', async () => {
      const telemetry = { toolCalls: [] };
      (getChildJobStatus as any).mockResolvedValue([
        { id: '0xchild1', delivered: true },
        { id: '0xchild2', delivered: false },
        { id: '0xchild3', delivered: true },
      ]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result).toEqual({
        status: 'WAITING',
        message: 'Waiting for 1 child job(s) to deliver',
      });
    });

    it('queries child status when no dispatch calls this run', async () => {
      const telemetry = {
        toolCalls: [{ tool: 'read_file', success: true }],
      };
      (getChildJobStatus as any).mockResolvedValue([
        { id: '0xchild1', delivered: false },
      ]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(getChildJobStatus).toHaveBeenCalledWith('0x123');
      expect(result.status).toBe('WAITING');
    });
  });

  describe('COMPLETED status', () => {
    it('infers COMPLETED when all children delivered', async () => {
      const telemetry = { toolCalls: [] };
      (getChildJobStatus as any).mockResolvedValue([
        { id: '0xchild1', delivered: true },
        { id: '0xchild2', delivered: true },
      ]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result).toEqual({
        status: 'COMPLETED',
        message: 'All 2 child job(s) delivered',
      });
    });

    it('infers COMPLETED when no children exist', async () => {
      const telemetry = { toolCalls: [] };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result).toEqual({
        status: 'COMPLETED',
        message: 'Job completed direct work',
      });
    });

    it('infers COMPLETED for simple non-delegating job', async () => {
      const telemetry = {
        toolCalls: [
          { tool: 'read_file', success: true },
          { tool: 'write_file', success: true },
        ],
      };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.message).toBe('Job completed direct work');
    });

    it('infers COMPLETED with empty telemetry', async () => {
      const telemetry = {};
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result.status).toBe('COMPLETED');
    });

    it('infers COMPLETED with null telemetry', async () => {
      const telemetry = null;
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('status precedence', () => {
    it('FAILED takes precedence over DELEGATING', async () => {
      const error = new Error('Error');
      const telemetry = {
        toolCalls: [{ tool: 'dispatch_new_job', success: true }],
      };
      (getChildJobStatus as any).mockResolvedValue([]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error,
        telemetry,
      });

      expect(result.status).toBe('FAILED');
    });

    it('FAILED takes precedence over WAITING', async () => {
      const error = new Error('Error');
      const telemetry = {};
      (getChildJobStatus as any).mockResolvedValue([
        { id: '0xchild1', delivered: false },
      ]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error,
        telemetry,
      });

      expect(result.status).toBe('FAILED');
    });

    it('DELEGATING takes precedence over WAITING', async () => {
      // This run dispatched jobs, even though old children still pending
      const telemetry = {
        toolCalls: [{ tool: 'dispatch_new_job', success: true }],
      };
      (getChildJobStatus as any).mockResolvedValue([
        { id: '0xoldchild', delivered: false },
      ]);

      const result = await inferJobStatus({
        requestId: '0x123',
        error: null,
        telemetry,
      });

      expect(result.status).toBe('DELEGATING');
    });
  });
});
