import { z } from 'zod';
import { getCurrentJobContext } from './shared/context.js';
import { createJobReport as apiCreateJobReport } from '../../../worker/control_api_client.js';
import { getMechAddress } from '../../../env/operate-profile.js';

function getWorkerAddress(): string {
  const addr = getMechAddress();
  if (!addr) throw new Error('Service mech address not found in .operate config or environment');
  return addr;
}

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
  description: `Signal the completion state of this job using the work protocol. Choose the appropriate status:

- COMPLETED: This job has fully finished its work and produced final deliverables. Use when all objectives are met and you have nothing more to do.

- DELEGATING: You have dispatched or re-dispatched child jobs and are awaiting their results. Use this immediately after calling dispatch_new_job or dispatch_existing_job, whether this is your first delegation or a subsequent round based on partial/inadequate child results.

- WAITING: You have pending child jobs in progress, but you are not dispatching any new or re-dispatched jobs at this time. Use when you are passively waiting for existing child jobs to complete before you can proceed. Do not dispatch jobs and then use WAITING - use DELEGATING instead.

- FAILED: This job encountered a critical error or blocker that prevents completion and requires supervisor intervention.

BEFORE FINALIZING WITH COMPLETED:
✓ Have I created artifacts for all substantial outputs?
✓ Are my deliverables findable via search_artifacts?
✓ Is my execution summary focused on process, not echoing artifact content?

The worker automatically re-invokes parent jobs when children complete. The worker also dispatches your parent job when you signal COMPLETED or FAILED.`,
  inputSchema: finalizeJobParamsBase.shape,
};

/**
 * Tool handler for finalize_job
 * 
 * This tool signals the completion state of a job using the Work Protocol.
 * It immediately records the status via Control API, enabling the worker to:
 * - Trigger parent job dispatch for COMPLETED/FAILED statuses
 * - Track job state for DELEGATING/WAITING statuses
 * - Coordinate multi-agent workflows
 */
export async function finalizeJob(args: unknown) {
  try {
    // Parse and validate params with permissive base schema for MCP
    const parsed = finalizeJobParamsBase.parse(args);
    
    // Strict validation for handler logic
    const validated = finalizeJobParams.parse(parsed);
    const { status, message } = validated;

    // Get job context
    const context = getCurrentJobContext();
    const requestId = context.requestId;

    if (!requestId) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'MISSING_CONTEXT',
              message: 'No active job context found'
            }
          })
        }]
      };
    }

    // Immediately record the status by creating/updating job report
    try {
      const workerAddress = getWorkerAddress();
      await apiCreateJobReport(requestId, {
        status,
        duration_ms: 0, // Worker will update with actual duration
        total_tokens: 0, // Worker will update with actual token count
        final_output: message,
        tools_called: '[]', // Worker will update with actual tool calls
        raw_telemetry: JSON.stringify({ finalized_at: new Date().toISOString() })
      }, workerAddress);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'API_ERROR',
              message: `Failed to record finalization in Control API: ${errorMessage}`
            }
          })
        }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: { status, message },
          meta: {
            ok: true,
            code: 'JOB_FINALIZED',
            message: `Job finalized with status ${status}`
          }
        })
      }]
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: null,
          meta: {
            ok: false,
            code: 'INTERNAL_ERROR',
            message: errorMessage
          }
        })
      }]
    };
  }
}

/**
 * Tool configuration for MCP server registration
 */
export const finalizeJobTool = {
  name: 'finalize_job',
  schema: finalizeJobSchema,
  handler: finalizeJob,
};

