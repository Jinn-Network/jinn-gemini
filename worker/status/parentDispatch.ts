/**
 * Parent dispatch: determine if parent needs to be auto-dispatched and call MCP dispatcher
 *
 * Also handles verification dispatch: when a job completes after having children,
 * it gets re-dispatched for verification before the parent is notified.
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
const MAX_VERIFICATION_ATTEMPTS = 3;

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
 * Check if a job had children by querying Ponder
 */
async function jobHadChildren(jobDefinitionId: string): Promise<boolean> {
  try {
    const ponderUrl = getPonderGraphqlUrl();
    const response = await graphQLRequest<{
      jobDefinitions: { items: Array<{ id: string }> };
    }>({
      url: ponderUrl,
      query: `query CheckJobChildren($jobDefId: String!) {
        jobDefinitions(where: { sourceJobDefinitionId: $jobDefId }, limit: 1) {
          items { id }
        }
      }`,
      variables: { jobDefId: jobDefinitionId },
      context: { operation: 'checkJobChildren', jobDefinitionId }
    });

    return (response?.jobDefinitions?.items?.length ?? 0) > 0;
  } catch (error) {
    workerLogger.warn(
      { jobDefinitionId, error: serializeError(error) },
      'Failed to check if job had children, assuming no'
    );
    return false;
  }
}

/**
 * Determine if verification is required for this job
 * Returns verification decision with context
 */
export interface VerificationDecision {
  requiresVerification: boolean;
  isVerificationRun: boolean;
  verificationAttempt: number;
  reason: string;
}

export async function shouldRequireVerification(
  finalStatus: FinalStatus | null,
  metadata: any
): Promise<VerificationDecision> {
  // Only check for COMPLETED status
  if (!finalStatus || finalStatus.status !== 'COMPLETED') {
    return {
      requiresVerification: false,
      isVerificationRun: false,
      verificationAttempt: 0,
      reason: 'Not a COMPLETED status'
    };
  }

  const additionalContext = metadata?.additionalContext;
  const isVerificationRun = additionalContext?.verificationRequired === true;
  const verificationAttempt = additionalContext?.verificationAttempt ?? 0;

  // If this is already a verification run, no further verification needed
  if (isVerificationRun) {
    return {
      requiresVerification: false,
      isVerificationRun: true,
      verificationAttempt,
      reason: 'Already a verification run'
    };
  }

  // Check if THIS job had children it dispatched
  // NOTE: completedChildRuns indicates children that completed and triggered re-dispatch of this job
  // This is the correct signal that this job reviewed completed children
  // DO NOT use hierarchy - that's the parent's context passed down, not this job's children
  const hadChildrenFromContext =
    (additionalContext?.completedChildRuns?.length ?? 0) > 0;

  // Also query Ponder to check if this job dispatched any children
  const jobDefinitionId = metadata?.jobDefinitionId;
  const hadChildrenFromQuery = jobDefinitionId ? await jobHadChildren(jobDefinitionId) : false;

  const hadChildren = hadChildrenFromContext || hadChildrenFromQuery;

  workerLogger.debug({
    jobDefinitionId,
    hadChildrenFromContext,
    hadChildrenFromQuery,
    hadChildren,
    completedChildRunsCount: additionalContext?.completedChildRuns?.length ?? 0,
  }, 'Verification check: did this job have children?');

  if (!hadChildren) {
    return {
      requiresVerification: false,
      isVerificationRun: false,
      verificationAttempt: 0,
      reason: 'Job had no children - direct execution, no verification needed'
    };
  }

  // Job completed after having children - needs verification
  return {
    requiresVerification: true,
    isVerificationRun: false,
    verificationAttempt: 0,
    reason: 'Job completed after reviewing children - verification required'
  };
}

/**
 * Dispatch job for verification (re-dispatch self with verificationRequired flag)
 */
async function dispatchForVerification(
  metadata: any,
  requestId: string,
  telemetry?: WorkerTelemetryService
): Promise<boolean> {
  const jobDefinitionId = metadata?.jobDefinitionId;
  if (!jobDefinitionId) {
    workerLogger.error({ requestId }, 'Cannot dispatch for verification: missing jobDefinitionId');
    return false;
  }

  const additionalContext = metadata?.additionalContext ?? {};
  const currentAttempt = additionalContext?.verificationAttempt ?? 0;
  const nextAttempt = currentAttempt + 1;

  if (nextAttempt > MAX_VERIFICATION_ATTEMPTS) {
    workerLogger.error(
      { requestId, jobDefinitionId, attempts: nextAttempt },
      'Max verification attempts exceeded - job requires human review'
    );
    // Don't dispatch for verification, let it complete (will dispatch parent with unverified status)
    return false;
  }

  workerLogger.info(
    { requestId, jobDefinitionId, verificationAttempt: nextAttempt },
    'Dispatching job for verification'
  );

  if (telemetry) {
    telemetry.startPhase('verification_dispatch');
    telemetry.logCheckpoint('verification_dispatch', 'dispatching_for_verification', {
      jobDefinitionId,
      verificationAttempt: nextAttempt
    });
  }

  try {
    const lineageInfo = metadata?.lineage;
    const baseBranch =
      lineageInfo?.dispatcherBranchName ||
      lineageInfo?.dispatcherBaseBranch ||
      metadata?.codeMetadata?.baseBranch ||
      metadata?.codeMetadata?.branch?.name ||
      undefined;
    const mechAddress = metadata?.workerAddress || metadata?.mech || undefined;

    // Build verification context - preserve existing context and add verification flag
    const verificationContext = {
      ...additionalContext,
      verificationRequired: true,
      verificationAttempt: nextAttempt,
      verificationTriggeredAt: new Date().toISOString(),
      verificationSourceRequestId: requestId
    };

    const rawResult = await withJobContext(
      {
        requestId: lineageInfo?.parentDispatcherRequestId || undefined,
        jobDefinitionId,
        baseBranch,
        mechAddress,
        branchName: lineageInfo?.dispatcherBranchName || metadata?.codeMetadata?.branch?.name || undefined,
      },
      async () =>
        dispatchExistingJob({
          jobId: jobDefinitionId,
          message: JSON.stringify({
            content: `Verification run ${nextAttempt}/${MAX_VERIFICATION_ATTEMPTS}: verify merged child work satisfies all assertions`,
            type: 'verification'
          }),
          additionalContext: verificationContext
        })
    );

    const dispatchResult = safeParseToolResponse(rawResult);

    if (dispatchResult.ok) {
      if (telemetry) {
        telemetry.logCheckpoint('verification_dispatch', 'dispatch_success', {
          jobDefinitionId,
          verificationAttempt: nextAttempt,
          newRequestId: dispatchResult.data?.request_ids?.[0]
        });
      }
      workerLogger.info(
        {
          jobDefinitionId,
          verificationAttempt: nextAttempt,
          newRequestId: dispatchResult.data?.request_ids?.[0]
        },
        'Verification dispatch successful'
      );
      return true;
    } else {
      if (telemetry) {
        telemetry.logError('verification_dispatch', dispatchResult?.message || 'Unknown error');
      }
      workerLogger.error(
        { jobDefinitionId, error: dispatchResult?.message },
        'Failed to dispatch for verification'
      );
      return false;
    }
  } catch (error) {
    if (telemetry) {
      telemetry.logError('verification_dispatch', error instanceof Error ? error.message : String(error));
    }
    workerLogger.error(
      { jobDefinitionId, error: serializeError(error) },
      'Error dispatching for verification'
    );
    return false;
  } finally {
    if (telemetry) {
      telemetry.endPhase('verification_dispatch');
    }
  }
}

// Ponder indexing lag tolerance: poll up to N times before deciding children are incomplete
const PONDER_INDEX_POLL_COUNT = Number(process.env.PONDER_INDEX_POLL_COUNT ?? 10);
const PONDER_INDEX_POLL_DELAY_MS = Number(process.env.PONDER_INDEX_POLL_DELAY_MS ?? 1000);

/**
 * Determine if parent should be dispatched
 */
export async function shouldDispatchParent(
  finalStatus: FinalStatus | null,
  metadata: any
): Promise<ParentDispatchDecision> {
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

  // Check if ALL direct children of the parent are complete
  // Poll Ponder multiple times to allow for indexing lag
  try {
    const ponderUrl = getPonderGraphqlUrl();
    
    // Query all job definitions that have this parent
    const childrenQuery = `query GetParentChildren($parentJobDefId: String!) {
      jobDefinitions(where: { sourceJobDefinitionId: $parentJobDefId }) {
        items {
          id
          name
          lastStatus
        }
      }
    }`;
    
    let children: Array<{ id: string; name: string; lastStatus: string }> = [];
    let incompleteChildren: typeof children = [];
    
    for (let poll = 0; poll < PONDER_INDEX_POLL_COUNT; poll++) {
      const childrenData = await graphQLRequest<{
        jobDefinitions: { items: Array<{ id: string; name: string; lastStatus: string }> };
      }>({
        url: ponderUrl,
        query: childrenQuery,
        variables: { parentJobDefId },
        context: { operation: 'checkParentChildrenComplete', parentJobDefId, poll }
      });
      
      children = childrenData?.jobDefinitions?.items || [];
      
      if (children.length === 0) {
        // No children found, allow parent dispatch (this shouldn't happen in normal flow)
        workerLogger.debug({ parentJobDefId }, 'No children found for parent, allowing dispatch');
        return { shouldDispatch: true, parentJobDefId };
      }
      
      // Check if all children are in terminal state (COMPLETED or FAILED)
      incompleteChildren = children.filter(
        child => child.lastStatus !== 'COMPLETED' && child.lastStatus !== 'FAILED'
      );
      
      if (incompleteChildren.length === 0) {
        // All children complete - exit poll loop
        break;
      }
      
      // Still have incomplete children - wait and poll again (unless this is last poll)
      if (poll < PONDER_INDEX_POLL_COUNT - 1) {
        workerLogger.debug({
          parentJobDefId,
          poll: poll + 1,
          maxPolls: PONDER_INDEX_POLL_COUNT,
          incompleteCount: incompleteChildren.length
        }, 'Waiting for Ponder to index child status...');
        await new Promise(r => setTimeout(r, PONDER_INDEX_POLL_DELAY_MS));
      }
    }
    
    if (incompleteChildren.length > 0) {
      const incompleteNames = incompleteChildren
        .map(c => `${c.name} (${c.lastStatus})`)
        .slice(0, 3)
        .join(', ');
      
      workerLogger.info({
        parentJobDefId,
        totalChildren: children.length,
        incompleteChildren: incompleteChildren.length,
        examples: incompleteNames,
        pollsAttempted: PONDER_INDEX_POLL_COUNT
      }, 'Parent dispatch blocked - waiting for all children to complete (after polling)');
      
      return {
        shouldDispatch: false,
        reason: `Waiting for ${incompleteChildren.length}/${children.length} children to complete: ${incompleteNames}`,
      };
    }
    
    // All children are complete
    workerLogger.info({
      parentJobDefId,
      totalChildren: children.length
    }, 'All children complete - dispatching parent');
    
    return {
      shouldDispatch: true,
      parentJobDefId,
    };
  } catch (error) {
    workerLogger.warn({
      parentJobDefId,
      error: serializeError(error)
    }, 'Failed to check children completion status - blocking parent dispatch for safety');
    
    return {
      shouldDispatch: false,
      reason: 'Failed to verify children completion status',
    };
  }
}

/**
 * Dispatch parent job when child completes or fails (Work Protocol)
 *
 * This function also handles verification dispatch:
 * - If a job completes after having children (review phase), it gets re-dispatched
 *   for verification before the parent is notified.
 * - Only after verification passes (or max attempts exceeded) does the parent get dispatched.
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
  // First, check if this job needs verification before we can dispatch parent
  const verificationDecision = await shouldRequireVerification(finalStatus, metadata);

  workerLogger.debug({
    requestId,
    verificationDecision: {
      requiresVerification: verificationDecision.requiresVerification,
      isVerificationRun: verificationDecision.isVerificationRun,
      verificationAttempt: verificationDecision.verificationAttempt,
      reason: verificationDecision.reason
    }
  }, 'Verification decision for job');

  if (verificationDecision.requiresVerification) {
    // Job completed after reviewing children - dispatch for verification instead of parent
    workerLogger.info(
      { requestId, jobDefinitionId: metadata?.jobDefinitionId },
      'Job completed after review - dispatching for verification before parent dispatch'
    );

    const dispatched = await dispatchForVerification(metadata, requestId, options?.telemetry);
    if (dispatched) {
      // Verification dispatch succeeded - don't dispatch parent yet
      return;
    }
    // If verification dispatch failed, fall through to dispatch parent
    // (better to complete with unverified work than to hang)
    workerLogger.warn(
      { requestId },
      'Verification dispatch failed - proceeding with parent dispatch'
    );
  }

  const decision = await shouldDispatchParent(finalStatus, metadata);

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
