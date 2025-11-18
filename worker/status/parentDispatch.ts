/**
 * Parent dispatch: determine if parent needs to be auto-dispatched and call MCP dispatcher
 */

import { workerLogger } from '../../logging/index.js';
import { dispatchExistingJob } from '../../gemini-agent/mcp/tools/dispatch_existing_job.js';
import { safeParseToolResponse } from '../tool_utils.js';
import type { FinalStatus, ParentDispatchDecision } from '../types.js';

/**
 * Determine if parent should be dispatched
 */
export function shouldDispatchParent(
  finalStatus: FinalStatus | null,
  metadata: any
): ParentDispatchDecision {
  // Only dispatch on terminal states
  if (!finalStatus || (finalStatus.status !== 'COMPLETED' && finalStatus.status !== 'FAILED')) {
    return {
      shouldDispatch: false,
      reason: `Status is not terminal: ${finalStatus?.status || 'none'}`,
    };
  }

  // Get parent job ID from metadata
  const parentJobDefId = metadata?.sourceJobDefinitionId;
  if (!parentJobDefId) {
    return {
      shouldDispatch: false,
      reason: 'No parent job in metadata',
    };
  }

  return {
    shouldDispatch: true,
    parentJobDefId,
  };
}

/**
 * Dispatch parent job when child completes or fails (Work Protocol)
 */
export async function dispatchParentIfNeeded(
  finalStatus: FinalStatus | null,
  metadata: any,
  requestId: string,
  output: string
): Promise<void> {
  const decision = shouldDispatchParent(finalStatus, metadata);
  
  if (!decision.shouldDispatch) {
    workerLogger.debug(`Not dispatching parent - ${decision.reason}`);
    return;
  }

  const parentJobDefId = decision.parentJobDefId!;
  
  try {
    workerLogger.info(`Dispatching parent job ${parentJobDefId} after child ${finalStatus!.status}`);
    
    // Create message with child results using standard format
    const messageContent = `Child job ${finalStatus!.status}: ${finalStatus!.message}. Output: ${
      output.length > 500 ? output.substring(0, 500) + '...' : output
    }`;
    
    const message = {
      content: messageContent,
      to: parentJobDefId,
      from: requestId
    };

    // Dispatch parent job
    let result;
    const maxRetries = 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt) * 2000;
        workerLogger.info({ parentJobDefId, attempt, backoffMs }, 'Retrying parent dispatch');
        await new Promise(r => setTimeout(r, backoffMs));
      }

      try {
        result = await dispatchExistingJob({
          jobId: parentJobDefId,
          message: JSON.stringify(message)
        });
        
        const check = safeParseToolResponse(result);
        if (check.ok) break; // Success
        
        // If not ok, check if it's a recoverable error
        if (check.message?.includes('Transaction not found') || check.message?.includes('timeout')) {
            workerLogger.warn({ parentJobDefId, error: check.message }, 'Parent dispatch transient failure');
            continue;
        }
        
        // Not recoverable (e.g. validation error, subgraph error that isn't transient)
        break;
      } catch (e) {
         // Should not happen as tool catches errors, but safe guard
         workerLogger.warn({ parentJobDefId, error: e }, 'Parent dispatch execution error');
         if (attempt < maxRetries - 1) continue;
      }
    }
    
    const dispatchResult = safeParseToolResponse(result);
    if (dispatchResult.ok) {
      workerLogger.info(`Parent job ${parentJobDefId} dispatched successfully`);
    } else {
      workerLogger.error(`Failed to dispatch parent job ${parentJobDefId}: ${dispatchResult.message}`);
    }
  } catch (e) {
    workerLogger.error({ error: e, parentJobDefId }, `Error dispatching parent job ${parentJobDefId}`);
  }
}

