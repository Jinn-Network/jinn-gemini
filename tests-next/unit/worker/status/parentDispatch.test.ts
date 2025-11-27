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
  logger: {
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
  workerLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  configLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../http/client.js', () => ({
  graphQLRequest: vi.fn(async () => ({ 
    requests: { items: [] },
    request: { workstreamId: undefined }
  })),
}));

vi.mock('../../../../gemini-agent/mcp/tools/shared/env.js', () => ({
  getPonderGraphqlUrl: vi.fn(() => 'http://example.com/graphql'),
  getOptionalControlApiUrl: vi.fn(() => undefined),
}));

vi.mock('../../../../worker/mcp/tools.js', () => ({
  withJobContext: vi.fn(async (_ctx: any, fn: any) => fn()),
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
import { graphQLRequest } from '../../../../http/client.js';
import { withJobContext } from '../../../../worker/mcp/tools.js';

describe('parentDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (graphQLRequest as any).mockResolvedValue({ 
      requests: { items: [] },
      request: { workstreamId: undefined }
    });
    (withJobContext as any).mockImplementation(async (_ctx: any, fn: any) => fn());
  });

  const makeMetadata = (parentId: string) => ({
    sourceJobDefinitionId: parentId,
    lineage: {
      dispatcherBranchName: 'main',
      dispatcherBaseBranch: 'main',
      parentDispatcherRequestId: 'req-parent',
    },
    codeMetadata: {
      baseBranch: 'main',
      branch: { name: 'main' },
      repoRoot: '/tmp/repo',
    },
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
        const metadata = makeMetadata('0xparent123');

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild456', 'Task output');

        expect(workerLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            parentJobDefId: '0xparent123',
            childRequestId: '0xchild456',
          }),
          expect.stringContaining('dispatched successfully')
        );
        expect(dispatchExistingJob).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId: '0xparent123',
            message: expect.stringContaining('Child job COMPLETED'),
            workstreamId: undefined,
            additionalContext: expect.objectContaining({
              completedChildRuns: expect.arrayContaining([
                expect.objectContaining({
                  requestId: '0xchild456',
                  status: 'COMPLETED',
                  summary: 'All tasks done',
                }),
              ]),
            }),
          })
        );
      });

      it('dispatches parent on FAILED', async () => {
        const finalStatus: FinalStatus = {
          status: 'FAILED',
          message: 'Job failed: timeout',
        };
        const metadata = makeMetadata('0xparent789');

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'Error output');

        expect(dispatchExistingJob).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId: '0xparent789',
            message: expect.stringContaining('Child job FAILED'),
            workstreamId: undefined,
            additionalContext: expect.objectContaining({
              completedChildRuns: expect.arrayContaining([
                expect.objectContaining({
                  requestId: '0xchild',
                  status: 'FAILED',
                  summary: 'Job failed: timeout',
                }),
              ]),
            }),
          })
        );
      });

      it('includes status message in dispatch', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'All 3 children delivered',
        };
        const metadata = makeMetadata('0xparent');

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        const call = (dispatchExistingJob as any).mock.calls[0][0];
        const messageContent = JSON.parse(call.message).content;
        expect(messageContent).toContain('All 3 children delivered');
        expect(call.jobId).toBe('0xparent');
        expect(call.workstreamId).toBeUndefined();
      });

      it('includes child output in dispatch', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = makeMetadata('0xparent');
        const output = 'Generated report with 50 records';

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', output);

        const call = (dispatchExistingJob as any).mock.calls[0][0];
        const messageContent = JSON.parse(call.message).content;
        expect(messageContent).toContain('Generated report with 50 records');
        expect(call.jobId).toBe('0xparent');
        expect(call.workstreamId).toBeUndefined();
      });

      it('truncates long output to 500 chars', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = makeMetadata('0xparent');
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
        const metadata = makeMetadata('0xparent');

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
        const metadata = makeMetadata('0xparent');

        (dispatchExistingJob as any).mockResolvedValue({ ok: true });
        (safeParseToolResponse as any).mockReturnValue({ ok: true, data: { request_ids: ['req-new'] } });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        expect(workerLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            parentJobDefId: '0xparent',
            childRequestId: '0xchild',
            newRequestId: 'req-new',
          }),
          expect.stringContaining('dispatched successfully')
        );
      });

      it('logs error when dispatch fails', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = makeMetadata('0xparent');

        (dispatchExistingJob as any).mockResolvedValue({ ok: false });
        (safeParseToolResponse as any).mockReturnValue({
          ok: false,
          message: 'Invalid job ID',
        });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        expect(workerLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            parentJobDefId: '0xparent',
            childRequestId: '0xchild',
            error: 'Invalid job ID',
          }),
          expect.stringContaining('Failed to dispatch parent job')
        );
      });

      it('handles dispatch exceptions gracefully', async () => {
        const finalStatus: FinalStatus = {
          status: 'COMPLETED',
          message: 'Done',
        };
        const metadata = makeMetadata('0xparent');

        // Mock withJobContext to throw on all attempts
        // The retry loop will retry 3 times with backoff (2s, 4s) = ~6s minimum
        // Then the error is caught in the outer catch block
        let callCount = 0;
        (withJobContext as any).mockImplementation(async () => {
          callCount++;
          throw new Error('Network error');
        });

        await dispatchParentIfNeeded(finalStatus, metadata, '0xchild', 'output');

        // Verify it was called multiple times (retry loop)
        expect(callCount).toBeGreaterThan(1);
        
        // The error is caught in the inner catch block, and after retries exhaust,
        // dispatchResult is undefined, so error is logged with undefined message
        expect(workerLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            parentJobDefId: '0xparent',
            childRequestId: '0xchild',
          }),
          expect.stringContaining('Failed to dispatch parent job')
        );
      }, 20000); // Increase timeout to accommodate retry loop with backoff (2s + 4s = 6s minimum)
    });
  });
});
