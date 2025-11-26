/**
 * Parent dispatch: determine if parent needs to be auto-dispatched and call MCP dispatcher
 */

import { workerLogger } from '../../logging/index.js';
import { dispatchExistingJob } from '../../gemini-agent/mcp/tools/dispatch_existing_job.js';
import { withJobContext } from '../mcp/tools.js';
import { safeParseToolResponse } from '../tool_utils.js';
import type { FinalStatus, ParentDispatchDecision } from '../types.js';
import { fetchBranchDetails } from '../git/pr.js';
import type { ExtractedArtifact } from '../artifacts.js';
import { graphQLRequest } from '../../http/client.js';
import { getPonderGraphqlUrl } from '../../gemini-agent/mcp/tools/shared/env.js';
import type { WorkerTelemetryService } from '../worker_telemetry.js';
import { serializeError } from '../logging/errors.js';

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
    workerLogger.warn({ error: serializeError(error), parentJobDefId, childRequestId }, 'Failed to check recent dispatch, allowing dispatch (fail-open)');
    return false;
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
  options?: {
    telemetry?: WorkerTelemetryService;
    artifacts?: ExtractedArtifact[];
  }
): Promise<void> {
  const decision = shouldDispatchParent(finalStatus, metadata);

  if (!decision.shouldDispatch) {
    workerLogger.debug(`Not dispatching parent - ${decision.reason}`);
    return;
  }

  const parentJobDefId = decision.parentJobDefId!;

  if (await wasRecentlyDispatched(parentJobDefId, requestId)) {
    workerLogger.info({ parentJobDefId, childRequestId: requestId }, 'Skipping duplicate parent dispatch (found recent on-chain dispatch from this child)');
    return;
  }

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
    workerLogger.warn({ requestId, error: serializeError(error) }, 'Failed to query child workstream ID, will proceed without it');
  }

  const telemetry = options?.telemetry;
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
    const lineageInfo = metadata?.lineage;
    if (!lineageInfo) {
      throw new Error('Lineage metadata missing from job; cannot auto-dispatch parent');
    }

    const lineageRequestId = lineageInfo.parentDispatcherRequestId || undefined;
    const baseBranch =
      lineageInfo.dispatcherBranchName ||
      lineageInfo.dispatcherBaseBranch ||
      metadata?.codeMetadata?.baseBranch ||
      metadata?.codeMetadata?.branch?.name ||
      undefined;
    const mechAddress = metadata?.workerAddress || metadata?.mech || undefined;

    const messageContent = `Child job ${finalStatus!.status}: ${finalStatus!.message}. Output: ${output.length > 500 ? output.substring(0, 500) + '...' : output}`;
    
    const message = {
      content: messageContent,
      to: parentJobDefId,
      from: requestId
    };

    // Extract branch info from metadata or GIT_BRANCH artifact
    let childBranchName: string | undefined;
    let childBaseBranch: string | undefined;

    // First check metadata for branch info
    childBranchName = metadata?.codeMetadata?.branch?.name;
    childBaseBranch = metadata?.codeMetadata?.baseBranch;

    const deterministicChildRun = {
      requestId,
      jobDefinitionId: metadata?.jobDefinitionId,
      jobName: metadata?.jobName,
      status: finalStatus?.status,
      summary: finalStatus?.message,
      branchName: childBranchName,
      baseBranch: childBaseBranch,
      artifacts: await Promise.all((options?.artifacts || []).map(async (artifact, index) => {
        let details = undefined;
        if (artifact.type === 'GIT_BRANCH' || artifact.topic === 'git/branch') {
          // Parse the artifact content to extract branch information
          if ((artifact as any).content) {
            try {
              const parsed = JSON.parse((artifact as any).content);
              const headBranch = parsed.headBranch;
              const baseBranch = parsed.baseBranch;

              // Use artifact branch info if not already set from metadata
              if (!childBranchName && headBranch) {
                childBranchName = headBranch;
              }
              if (!childBaseBranch && baseBranch) {
                childBaseBranch = baseBranch;
              }

              if (headBranch && baseBranch) {
                const repoPath = metadata?.codeMetadata?.repoRoot || process.env.CODE_METADATA_REPO_ROOT;
                if (repoPath) {
                  details = await fetchBranchDetails({ headBranch, baseBranch, repoPath });
                }
              }
            } catch (e) {
              workerLogger.warn({ error: serializeError(e), artifact: artifact.name }, 'Failed to parse PR artifact content');
            }
          }
        }

        return {
          id: `${requestId}:${index}`,
          name: artifact.name || `artifact-${index + 1}`,
          topic: artifact.topic,
          cid: artifact.cid,
          details,
        };
      })),
    };

    // Update branchName/baseBranch after artifact processing (may have been extracted from GIT_BRANCH artifact)
    if (childBranchName && !deterministicChildRun.branchName) {
      (deterministicChildRun as any).branchName = childBranchName;
    }
    if (childBaseBranch && !deterministicChildRun.baseBranch) {
      (deterministicChildRun as any).baseBranch = childBaseBranch;
    }

    const deterministicContext =
      deterministicChildRun.requestId || deterministicChildRun.artifacts.length > 0
        ? { completedChildRuns: [deterministicChildRun] }
        : undefined;

    const maxRetries = 3;
    let dispatchResult: ReturnType<typeof safeParseToolResponse> | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt) * 2000;
        workerLogger.info({ parentJobDefId, attempt, backoffMs }, 'Retrying parent dispatch');
        await new Promise(r => setTimeout(r, backoffMs));
      }

      try {
        const rawResult = await withJobContext(
          {
            requestId: lineageRequestId,
            jobDefinitionId: parentJobDefId,
            baseBranch,
            mechAddress,
            branchName: lineageInfo.dispatcherBranchName || undefined,
          },
          async () =>
            dispatchExistingJob({
              jobId: parentJobDefId,
              message: JSON.stringify(message),
              workstreamId,
              ...(deterministicContext ? { additionalContext: deterministicContext } : {}),
            })
        );

        dispatchResult = safeParseToolResponse(rawResult);
        if (dispatchResult.ok) {
          break;
        }

        // Check for transient blockchain errors that warrant retry
        if (dispatchResult.message?.includes('Transaction not found') || dispatchResult.message?.includes('timeout')) {
          workerLogger.warn({ parentJobDefId, error: dispatchResult.message }, 'Parent dispatch transient failure');
          continue;
        }

        break;
      } catch (e) {
        workerLogger.warn({ parentJobDefId, error: serializeError(e) }, 'Parent dispatch execution error');
        if (attempt < maxRetries - 1) continue;
      }
    }

    if (dispatchResult?.ok) {
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
        telemetry.logError('parent_dispatch', dispatchResult?.message || 'Unknown error');
      }
      workerLogger.error({ 
        parentJobDefId, 
        childRequestId: requestId,
        error: dispatchResult?.message 
      }, `Failed to dispatch parent job ${parentJobDefId}: ${dispatchResult?.message}`);
    }
  } catch (e) {
    if (telemetry) {
      telemetry.logError('parent_dispatch', e instanceof Error ? e.message : String(e));
    }
    workerLogger.error({ error: serializeError(e), parentJobDefId }, `Error dispatching parent job ${parentJobDefId}`);
    throw e;  // Propagate Work Protocol failure
  } finally {
    if (telemetry) {
      telemetry.endPhase('parent_dispatch');
    }
  }
}
