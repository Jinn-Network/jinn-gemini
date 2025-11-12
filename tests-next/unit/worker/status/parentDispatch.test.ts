/**
 * Unit Test: Parent Job Dispatch
 * Module: worker/status/parentDispatch.ts
 * Priority: P1 (HIGH)
 *
 * Tests parent job dispatch decision logic and execution for Work Protocol.
 * Ensures child jobs correctly notify parent jobs upon completion/failure.
 *
 * Impact: Prevents workflow stalls from missing parent dispatches
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  shouldDispatchParent,
  dispatchParentIfNeeded,
} from '../../../../worker/status/parentDispatch.js';
import type { FinalStatus, ParentDispatchDecision } from '../../../../worker/types.js';

// Mock dependencies
vi.mock('../../../../logging/index.js', () => ({
  workerLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../gemini-agent/mcp/tools/dispatch_existing_job.js', () => ({
  dispatchExistingJob: vi.fn(),
}));

vi.mock('../../../../worker/tool_utils.js', () => ({
  safeParseToolResponse: vi.fn(),
}));

import { workerLogger } from '../../../../logging/index.js';
import { dispatchExistingJob } from '../../../../gemini-agent/mcp/tools/dispatch_existing_job.js';
import { safeParseToolResponse } from '../../../../worker/tool_utils.js';

describe('parentDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldDispatchParent', () => {
    describe('should dispatch', () => {
      it('dispatches when status is COMPLETED and parent exists', () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Job completed',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent123',
        };

        const result = shouldDispatchParent(finalStatus, metadata);

        expect(result).toEqual({
          shouldDispatch: true,
          parentJobDefId: '0xparent123',
        });
      });

      it('dispatches when status is FAILED and parent exists', () => {
        const finalStatus: FinalStatus = {
          status: 'FAILED',
          message: 'Job failed',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent456',
        };

        const result = shouldDispatchParent(finalStatus, metadata);

        expect(result).toEqual({
          shouldDispatch: true,
          parentJobDefId: '0xparent456',
        });
      });
    });

    describe('should not dispatch', () => {
      it('does not dispatch when status is WAITING', () => {
        const finalStatus: FinalStatus = {
          status: 'WAITING',
          message: 'Waiting for children',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent123',
        };

        const result = shouldDispatchParent(finalStatus, metadata);

        expect(result.shouldDispatch).toBe(false);
        expect(result.reason).toContain('not terminal');
      });

      it('does not dispatch when status is DELEGATING', () => {
        const finalStatus: FinalStatus = {
          status: 'DELEGATING',
          message: 'Dispatched children',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent123',
        };

        const result = shouldDispatchParent(finalStatus, metadata);

        expect(result.shouldDispatch).toBe(false);
        expect(result.reason).toContain('not terminal');
      });

      it('does not dispatch when finalStatus is null', () => {
        const metadata = {
          sourceJobDefinitionId: '0xparent123',
        };

        const result = shouldDispatchParent(null, metadata);

        expect(result.shouldDispatch).toBe(false);
        expect(result.reason).toContain('not terminal');
      });

      it('does not dispatch when parent job ID is missing', () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Job completed',
        };
        const metadata = {};

        const result = shouldDispatchParent(finalStatus, metadata);

        expect(result.shouldDispatch).toBe(false);
        expect(result.reason).toBe('No parent job in metadata');
      });

      it('does not dispatch when metadata is null', () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Job completed',
        };

        const result = shouldDispatchParent(finalStatus, null);

        expect(result.shouldDispatch).toBe(false);
        expect(result.reason).toBe('No parent job in metadata');
      });

      it('does not dispatch when sourceJobDefinitionId is undefined', () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Job completed',
        };
        const metadata = {
          sourceJobDefinitionId: undefined,
        };

        const result = shouldDispatchParent(finalStatus, metadata);

        expect(result.shouldDispatch).toBe(false);
        expect(result.reason).toBe('No parent job in metadata');
      });
    });
  });

  describe('dispatchParentIfNeeded', () => {
    describe('skips dispatch', () => {
      it('skips when should not dispatch', async () => {
        const finalStatus: FinalStatus = {
          status: 'WAITING',
          message: 'Waiting',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent123',
        };

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        expect(workerLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Not dispatching parent')
        );
        expect(dispatchExistingJob).not.toHaveBeenCalled();
      });

      it('skips when no parent job', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Completed',
        };
        const metadata = {};

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        expect(dispatchExistingJob).not.toHaveBeenCalled();
      });
    });

    describe('performs dispatch', () => {
      beforeEach(() => {
        (safeParseToolResponse as any).mockReturnValue({ ok: true });
      });

      it('dispatches parent on COMPLETED', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'All tasks done',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent123',
        };

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild456', 'Task output');

        expect(workerLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Dispatching parent job 0xparent123')
        );
        expect(dispatchExistingJob).toHaveBeenCalledWith({
          jobId: '0xparent123',
          message: expect.stringContaining('Child job COMPLETED'),
        });
      });

      it('dispatches parent on FAILED', async () => {
        const finalStatus: FinalStatus = {
          status: 'FAILED',
          message: 'Job failed: timeout',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent789',
        };

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'Error output');

        expect(dispatchExistingJob).toHaveBeenCalledWith({
          jobId: '0xparent789',
          message: expect.stringContaining('Child job FAILED'),
        });
      });

      it('includes status message in dispatch', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'All 3 children delivered',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent',
        };

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        expect(dispatchExistingJob).toHaveBeenCalledWith({
          jobId: '0xparent',
          message: expect.stringContaining('All 3 children delivered'),
        });
      });

      it('includes child output in dispatch', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent',
        };
        const output = 'Generated report with 50 records';

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', output);

        expect(dispatchExistingJob).toHaveBeenCalledWith({
          jobId: '0xparent',
          message: expect.stringContaining('Generated report with 50 records'),
        });
      });

      it('truncates long output to 500 chars', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent',
        };
        const longOutput = 'x'.repeat(600);

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', longOutput);

        const call = (dispatchExistingJob as any).mock.calls[0][0];
        const messageContent = JSON.parse(call.message).content;

        expect(messageContent).toContain('...');
        expect(messageContent.length).toBeLessThan(600);
      });

      it('creates message with correct structure', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent',
        };

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild123', 'output');

        const call = (dispatchExistingJob as any).mock.calls[0][0];
        const message = JSON.parse(call.message);

        expect(message).toMatchObject({
          to: '0xparent',
          from: '0xchild123',
        });
        expect(message.content).toBeDefined();
      });

      it('logs success when dispatch succeeds', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent',
        };

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });
        (safeParseToolResponse as any).mockReturnValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        expect(workerLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('dispatched successfully')
        );
      });

      it('logs error when dispatch fails', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent',
        };

        (dispatchExistingJob as any).mockResolvedValue({ ok: false });
        (safeParseToolResponse as any).mockReturnValue({
          ok: false,
          message: 'Invalid job ID',
        });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        expect(workerLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to dispatch parent job')
        );
      });

      it('handles dispatch exceptions gracefully', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = {
          sourceJobDefinitionId: '0xparent',
        };

        (dispatchExistingJob as any).mockRejectedValue(new Error('Network error'));

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        expect(workerLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.any(Error),
            parentJobDefId: '0xparent',
          }),
          expect.stringContaining('Error dispatching parent job')
        );
      });
    });
  });
});
