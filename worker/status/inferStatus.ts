/**
 * Status inference: pure function to infer final status from telemetry and child jobs
 */

import { getChildJobStatus } from './childJobs.js';
import { countSuccessfulDispatchCalls } from './dispatchUtils.js';
import type { FinalStatus, IpfsMetadata, HierarchyJob } from '../types.js';

/**
 * Extract child job statuses from hierarchy for job-level completeness checking
 */
function extractChildrenFromHierarchy(
  hierarchy: HierarchyJob[] | undefined,
  currentJobDefinitionId: string | undefined
): { active: HierarchyJob[]; failed: HierarchyJob[]; completed: HierarchyJob[] } {
  const result = { active: [] as HierarchyJob[], failed: [] as HierarchyJob[], completed: [] as HierarchyJob[] };
  
  if (!hierarchy || !Array.isArray(hierarchy) || !currentJobDefinitionId) {
    return result;
  }

  // Find descendants of the current job definition
  const children = hierarchy.filter(
    (job) => job.level && job.level > 0 && job.sourceJobDefinitionId === currentJobDefinitionId
  );

  for (const child of children) {
    const status = (child.status || '').toLowerCase();
    
    if (status === 'completed' || status === 'delivered' || status === 'success') {
      result.completed.push(child);
    } else if (status === 'failed' || status === 'error') {
      result.failed.push(child);
    } else {
      // Everything else is active (waiting, pending, etc.)
      result.active.push(child);
    }
  }

  return result;
}

/**
 * Infer job status from observable execution signals.
 *
 * Job-centric rule: A job is COMPLETED only if all its children (across all runs) are complete.
 * - FAILED: Error occurred
 * - DELEGATING: Dispatched children this run
 * - WAITING: Has undelivered/failed children (job-level view)
 * - COMPLETED: No outstanding children (either never delegated, or all delivered)
 */
export async function inferJobStatus(params: {
  requestId: string;
  error: any;
  telemetry: any;
  delegatedThisRun?: boolean;
  metadata?: IpfsMetadata;
}): Promise<FinalStatus> {
  const { requestId, error, telemetry, delegatedThisRun, metadata } = params;

  // 1. FAILED: Execution error
  if (error) {
    const errorMessage = error?.message || String(error);
    return {
      status: 'FAILED',
      message: `Job failed: ${errorMessage}`
    };
  }

  // 2. DELEGATING: Dispatched children this run
  const dispatchCalls = countSuccessfulDispatchCalls(telemetry);
  if (delegatedThisRun || dispatchCalls > 0) {
    return {
      status: 'DELEGATING',
      message: dispatchCalls > 0
        ? `Dispatched ${dispatchCalls} child job(s)`
        : 'Dispatched child job(s) this run',
    };
  }

  // 3. Check for undelivered children using job-level hierarchy if available
  const hierarchy = metadata?.additionalContext?.hierarchy;
  const jobDefinitionId = metadata?.jobDefinitionId;

  if (hierarchy && jobDefinitionId) {
    // Job-centric view: check all children across all runs of this job
    const children = extractChildrenFromHierarchy(hierarchy, jobDefinitionId);
    
    // Block completion if there are failed children (require remediation)
    if (children.failed.length > 0) {
      const failedJobNames = children.failed
        .map(j => j.jobName || j.name || 'unknown')
        .slice(0, 3)
        .join(', ');
      return {
        status: 'WAITING',
        message: `${children.failed.length} child job(s) failed and need remediation: ${failedJobNames}`
      };
    }

    // Block completion if there are active children
    if (children.active.length > 0) {
      return {
        status: 'WAITING',
        message: `Waiting for ${children.active.length} active child job(s) to complete`
      };
    }

    // All children completed or none exist
    const completionReason = children.completed.length > 0
      ? `All ${children.completed.length} child job(s) completed`
      : 'Job completed direct work';

    return {
      status: 'COMPLETED',
      message: completionReason
    };
  }

  // 4. Fallback: Use legacy per-request child checking (for older runs without hierarchy)
  const childJobResult = await getChildJobStatus(requestId);
  const childJobs = childJobResult.childJobs || [];
  const undeliveredChildren = childJobs.filter(c => !c.delivered);

  if (undeliveredChildren.length > 0) {
    return {
      status: 'WAITING',
      message: `Waiting for ${undeliveredChildren.length} child job(s) to deliver`
    };
  }

  // COMPLETED: No undelivered children
  const completionReason = childJobs.length > 0
    ? `All ${childJobs.length} child job(s) delivered`
    : 'Job completed direct work';

  return {
    status: 'COMPLETED',
    message: completionReason
  };
}

