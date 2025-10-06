import { z } from 'zod';
import { getCurrentJobContext } from './shared/context.js';
import { createJobReport as apiCreateJobReport } from '../../../worker/control_api_client.js';

// Schema for MCP registration - permissive to allow MCP to pass through to handler
const finalizeJobParamsBase = z.object({
  status: z.string().min(1),
  message: z.string().min(1),
});

// Strict validation schema for handler - now accepts all 4 work protocol statuses
export const finalizeJobParams = z.object({
  status: z.enum(['COMPLETED', 'DELEGATING', 'WAITING', 'FAILED']),
  message: z.string().min(1),
});

export const finalizeJobSchema = {
  description: 'Signal the completion state of this job using the work protocol. Choose the appropriate status:\n\n- COMPLETED: This job has fully finished its work and produced final deliverables. Use when all objectives are met and you have nothing more to do.\n\n- DELEGATING: You have dispatched or re-dispatched child jobs and are awaiting their results. Use this immediately after calling dispatch_new_job or dispatch_existing_job, whether this is your first delegation or a subsequent round based on partial/inadequate child results.\n\n- WAITING: You have pending child jobs in progress, but you are not dispatching any new or re-dispatched jobs at this time. Use when you are passively waiting for existing child jobs to complete before you can proceed. Do not dispatch jobs and then use WAITING - use DELEGATING instead.\n\n- FAILED: This job encountered a critical error or blocker that prevents completion and requires supervisor intervention.\n\nThe worker automatically re-invokes parent jobs when children complete. The worker also dispatches your parent job when you signal COMPLETED or FAILED.',
  inputSchema: finalizeJobParamsBase.shape,
};

export async function finalizeJob(args: unknown) {
  try {
    const parsed = finalizeJobParams.safeParse(args);
    if (!parsed.success) {
      // Extract the actual status value if provided for better error message
      const providedStatus = (args as any)?.status;
      const baseMessage = parsed.error.message;
      const helpfulMessage = providedStatus
        ? `Invalid status "${providedStatus}". The finalize_job tool accepts: "COMPLETED", "DELEGATING", "WAITING", or "FAILED". ${baseMessage}`
        : baseMessage;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: helpfulMessage
            }
          })
        }]
      };
    }

    const { status, message } = parsed.data;

    // Get current job context to obtain requestId
    const context = getCurrentJobContext();
    const requestId = context.requestId || context.jobId;

    if (!requestId) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'CONTEXT_ERROR',
              message: 'No request ID or job ID available in job context. This tool requires an active on-chain job context.'
            }
          })
        }]
      };
    }

    // Immediately record the status by creating/updating job report
    try {
      await apiCreateJobReport(requestId, {
        status,
        duration_ms: 0, // Worker will update with actual duration
        total_tokens: 0, // Worker will update with actual tokens
        final_output: message,
        tools_called: '[]', // Worker will update with actual tool calls
        raw_telemetry: JSON.stringify({ finalized_at: new Date().toISOString() })
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'STORAGE_ERROR',
              message: `Failed to record job status: ${errorMessage}`
            }
          })
        }]
      };
    }

    // Return success result
    const result = {
      status,
      message,
      finalized_at: new Date().toISOString(),
      request_id: requestId
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: result,
          meta: { ok: true }
        })
      }]
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: null,
          meta: {
            ok: false,
            code: 'EXECUTION_ERROR',
            message
          }
        })
      }]
    };
  }
}
