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
  description: 'Finalize this job by recording its current status in the work protocol. Use this tool to signal any of the following states: COMPLETED (work finished successfully), DELEGATING (dispatched child jobs, awaiting their completion), WAITING (paused, waiting for sibling jobs to complete), or FAILED (encountered error requiring supervisor intervention). This immediately records the status and the worker will use it to determine workflow actions like parent job dispatch.',
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
