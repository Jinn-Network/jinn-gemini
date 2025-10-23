import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import { getCurrentJobContext } from './shared/context.js';
import { createJobReport as apiCreateJobReport } from '../../../worker/control_api_client.js';
import { getMechAddress } from '../../../env/operate-profile.js';
import { getCodeMetadataRepoRoot } from '../../../config/index.js';
import { workerLogger } from '../../../logging/index.js';

function getWorkerAddress(): string {
  const addr = getMechAddress();
  if (!addr) throw new Error('Service mech address not found in .operate config or environment');
  return addr;
}

/**
 * Auto-commit any uncommitted changes using the provided message
 * Returns metadata about the commit operation
 */
async function autoCommitChanges(
  commitMessage: string
): Promise<{ committed: boolean; filesChanged: number }> {
  try {
    const repoRoot = getCodeMetadataRepoRoot();

    // Check for uncommitted changes
    const statusOutput = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!statusOutput) {
      // No changes to commit - this is OK
      return { committed: false, filesChanged: 0 };
    }

    // Count files changed
    const filesChanged = statusOutput.split('\n').length;

    // Stage all changes
    execFileSync('git', ['add', '.'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 5000,
    });

    // Commit with the provided message
    execFileSync('git', ['commit', '-m', commitMessage], {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 5000,
    });

    return { committed: true, filesChanged };

  } catch (error: unknown) {
    // Log but don't fail - commit errors shouldn't block job completion
    const errorMessage = error instanceof Error ? error.message : String(error);
    workerLogger.error({ error: errorMessage }, 'Auto-commit failed');
    return { committed: false, filesChanged: 0 };
  }
}

// Schema for MCP registration - permissive to allow MCP to pass through to handler
const finalizeJobParamsBase = z.object({
  status: z.string().min(1),
  message: z.string().min(1).describe(
    'Clear statement of what was accomplished or current job state. ' +
    'For COMPLETED status, this will be used as the git commit message.'
  ),
});

// Strict validation schema for handler - now accepts all 4 work protocol statuses
export const finalizeJobParams = z.object({
  status: z.enum(['COMPLETED', 'DELEGATING', 'WAITING', 'FAILED']),
  message: z.string().min(1),
});

export const finalizeJobSchema = {
  description: `Signal the completion state of this job using the work protocol. Choose the appropriate status:

- COMPLETED: This job has fully finished its work and produced final deliverables. When you use this status, the tool automatically commits any uncommitted file changes using your message as the commit message.

- DELEGATING: You have dispatched or re-dispatched child jobs and are awaiting their results. Use this immediately after calling dispatch_new_job or dispatch_existing_job, whether this is your first delegation or a subsequent round based on partial/inadequate child results.

- WAITING: You have pending child jobs in progress, but you are not dispatching any new or re-dispatched jobs at this time. Use when you are passively waiting for existing child jobs to complete before you can proceed. Do not dispatch jobs and then use WAITING - use DELEGATING instead.

- FAILED: This job encountered a critical error or blocker that prevents completion and requires supervisor intervention.

PARAMETERS:
- status: The completion state (required)
- message: Clear statement of what was accomplished or current state (required). For COMPLETED status, this becomes the git commit message, so write it as you would a commit message.

AUTOMATIC GIT WORKFLOW:
When you call finalize_job with status=COMPLETED:
✓ Tool automatically stages and commits any uncommitted changes
✓ Your message becomes the git commit message
✓ No need to manually run git add or git commit commands
✓ If there are no changes to commit, the tool continues without error

BEFORE FINALIZING WITH COMPLETED:
✓ Have I created artifacts for all substantial outputs?
✓ Have I saved all my file changes?
✓ Is my message a clear, descriptive statement of what I accomplished?
✓ Would this message make sense as a git commit message?
✓ Are my deliverables findable via search_artifacts?

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

    // Auto-commit changes ONLY for COMPLETED status
    let commitResult = { committed: false, filesChanged: 0 };
    if (status === 'COMPLETED') {
      commitResult = await autoCommitChanges(message);
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
        raw_telemetry: JSON.stringify({
          finalized_at: new Date().toISOString(),
          auto_commit: commitResult
        })
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
          data: {
            status,
            message,
            committed: commitResult.committed,
            filesChanged: commitResult.filesChanged
          },
          meta: {
            ok: true,
            code: 'JOB_FINALIZED',
            message: `Job finalized with status ${status}${commitResult.committed ? ` (${commitResult.filesChanged} files committed)` : ''}`
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

