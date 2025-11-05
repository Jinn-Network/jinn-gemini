/**
 * Status inference: pure function to infer final status from telemetry and child jobs
 */

import { getChildJobStatus } from './childJobs.js';
import type { FinalStatus, ChildJobStatus } from '../types.js';

/**
 * Infer job status from observable execution signals.
 *
 * Simple rule: A job is COMPLETED if it has no undelivered children.
 * - FAILED: Error occurred
 * - DELEGATING: Dispatched children this run
 * - WAITING: Has undelivered children
 * - COMPLETED: No undelivered children (either never delegated, or all delivered)
 */
export async function inferJobStatus(params: {
  requestId: string;
  error: any;
  telemetry: any;
}): Promise<FinalStatus> {
  const { requestId, error, telemetry } = params;

  // 1. FAILED: Execution error
  if (error) {
    const errorMessage = error?.message || String(error);
    return {
      status: 'FAILED',
      message: `Job failed: ${errorMessage}`
    };
  }

  // 2. DELEGATING: Dispatched children this run
  const toolCalls = telemetry?.toolCalls || telemetry?.tool_calls || [];
  const dispatchCalls = toolCalls.filter(
    (tc: any) => tc.success && (tc.tool === 'dispatch_new_job' || tc.tool === 'dispatch_existing_job')
  );

  if (dispatchCalls.length > 0) {
    return {
      status: 'DELEGATING',
      message: `Dispatched ${dispatchCalls.length} child job(s)`
    };
  }

  // 3. Check for undelivered children
  const childJobs = await getChildJobStatus(requestId);
  const undeliveredChildren = childJobs.filter(c => !c.delivered);

  if (undeliveredChildren.length > 0) {
    return {
      status: 'WAITING',
      message: `Waiting for ${undeliveredChildren.length} child job(s) to deliver`
    };
  }

  // 4. COMPLETED: No undelivered children
  // (Either job never delegated, or all children are delivered)
  const completionReason = childJobs.length > 0
    ? `All ${childJobs.length} child job(s) delivered`
    : 'Job completed direct work';

  return {
    status: 'COMPLETED',
    message: completionReason
  };
}

