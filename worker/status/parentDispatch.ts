/**
 * Parent dispatch: determine if parent needs to be auto-dispatched and call MCP dispatcher
 */

import { workerLogger } from '../../logging/index.js';
import { dispatchExistingJob } from '../../gemini-agent/mcp/tools/dispatch_existing_job.js';
import { safeParseToolResponse } from '../tool_utils.js';
import type { FinalStatus, ParentDispatchDecision } from '../types.js';
import type { WorkerTelemetryService } from '../worker_telemetry.js';
import { graphQLRequest } from '../../http/client.js';
import { getPonderGraphqlUrl } from '../../gemini-agent/mcp/tools/shared/env.js';

const DISPATCH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes - long enough for jobs to process

/**
 * Check if parent was already dispatched for this child by querying on-chain state.
 * This survives worker restarts, unlike in-memory tracking.
 */
async function wasRecentlyDispatched(
  parentJobDefId: string, 
  childRequestId: string
): Promise<boolean> {
  try {
    const ponderUrl = getPonderGraphqlUrl();
    
    // Query for recent requests of this parent that were triggered by this child
    const response = await graphQLRequest<{ 
      requests: { items: Array<{ id: string; blockTimestamp: string }> } 
    }>({
      url: ponderUrl,
      query: `query CheckRecentDispatch($jobDefId: String!, $sourceReqId: String!) {
        requests(
          where: { 
            jobDefinitionId: $jobDefId,
            sourceRequestId: $sourceReqId
          },
          orderBy: "blockTimestamp",
          orderDirection: "desc",
          limit: 1
        ) {
          items {
            id
            blockTimestamp
          }
        }
      }`,
      variables: { 
        jobDefId: parentJobDefId,
        sourceReqId: childRequestId 
      },
      context: { operation: 'checkRecentDispatch', parentJobDefId, childRequestId }
    });

    const recentRequest = response?.requests?.items?.[0];
    if (!recentRequest) return false;

    // Already dispatched from this child within cooldown period
    const dispatchTime = Number(recentRequest.blockTimestamp) * 1000;
    const timeSince = Date.now() - dispatchTime;

    if (timeSince < DISPATCH_COOLDOWN_MS) {
      workerLogger.debug({ 
        parentJobDefId, 
        childRequestId, 
        recentRequestId: recentRequest.id,
        timeSince 
      }, 'Found recent dispatch from this child');
      return true;
    }

    return false;
  } catch (error) {
    workerLogger.warn({ error, parentJobDefId, childRequestId }, 'Failed to check recent dispatch, allowing dispatch (fail-open)');
    return false; // Fail open - allow dispatch on query error
  }
}

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
  output: string,
  telemetry?: WorkerTelemetryService
): Promise<void> {
  const decision = shouldDispatchParent(finalStatus, metadata);
  
  if (!decision.shouldDispatch) {
    workerLogger.debug(`Not dispatching parent - ${decision.reason}`);
    return;
  }

  const parentJobDefId = decision.parentJobDefId!;
  
  // Check for duplicate dispatch using on-chain state (survives worker restarts)
  if (await wasRecentlyDispatched(parentJobDefId, requestId)) {
    workerLogger.info({ parentJobDefId, childRequestId: requestId }, 'Skipping duplicate parent dispatch (found recent on-chain dispatch from this child)');
    return;
  }
  
  // Query child request's workstreamId to preserve it in parent re-dispatch
  let workstreamId: string | undefined;
  try {
    const ponderUrl = getPonderGraphqlUrl();
    const response = await graphQLRequest<{ request: { workstreamId?: string } | null }>({
      url: ponderUrl,
      query: `query GetWorkstreamId($id: String!) {
        request(id: $id) {
          workstreamId
        }
      }`,
      variables: { id: requestId },
      context: { operation: 'getChildWorkstreamId', requestId }
    });
    workstreamId = response?.request?.workstreamId;
    if (workstreamId) {
      workerLogger.debug({ requestId, workstreamId }, 'Retrieved workstream ID from child request');
    }
  } catch (error) {
    workerLogger.warn({ requestId, error }, 'Failed to query child workstream ID, will proceed without it');
  }
  
  // Track in telemetry
  if (telemetry) {
    telemetry.startPhase('parent_dispatch');
    telemetry.logCheckpoint('parent_dispatch', 'dispatching_parent', {
      parentJobDefId,
      childRequestId: requestId,
      childStatus: finalStatus!.status,
      workstreamId,
      reason: 'child_terminal_state'
    });
  }
  
  try {
    // Log detailed dispatch decision
    workerLogger.info({ 
      parentJobDefId, 
      childRequestId: requestId,
      childStatus: finalStatus!.status, 
      workstreamId,
      dispatchReason: 'Child job reached terminal state'
    }, `Dispatching parent job ${parentJobDefId} after child ${finalStatus!.status}`);
    
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
          message: JSON.stringify(message),
          workstreamId
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
      if (telemetry) {
        telemetry.logCheckpoint('parent_dispatch', 'dispatch_success', {
          parentJobDefId,
          childRequestId: requestId,
          newRequestId: dispatchResult.data?.request_ids?.[0]
        });
      }
      workerLogger.info({ 
        parentJobDefId, 
        childRequestId: requestId,
        newRequestId: dispatchResult.data?.request_ids?.[0] 
      }, `Parent job ${parentJobDefId} dispatched successfully`);
    } else {
      if (telemetry) {
        telemetry.logError('parent_dispatch', dispatchResult.message || 'Unknown error');
      }
      workerLogger.error({ 
        parentJobDefId, 
        childRequestId: requestId,
        error: dispatchResult.message 
      }, `Failed to dispatch parent job ${parentJobDefId}: ${dispatchResult.message}`);
    }
  } catch (e) {
    if (telemetry) {
      telemetry.logError('parent_dispatch', e instanceof Error ? e.message : String(e));
    }
    workerLogger.error({ error: e, parentJobDefId }, `Error dispatching parent job ${parentJobDefId}`);
  } finally {
    if (telemetry) {
      telemetry.endPhase('parent_dispatch');
    }
  }
}

