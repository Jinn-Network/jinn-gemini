/**
 * MCP dispatcher: wrap dispatch_new_job / dispatch_existing_job tool calls with proper job context
 */

import { dispatchExistingJob } from '../../gemini-agent/mcp/tools/dispatch_existing_job.js';
import { setJobContext, clearJobContext, snapshotJobContext, restoreJobContext } from '../metadata/jobContext.js';
import { safeParseToolResponse } from '../tool_utils.js';

/**
 * Dispatch existing job with proper context management
 */
export async function dispatchExistingJobWithContext(params: {
  jobId: string;
  message?: string;
  requestId?: string;
  mechAddress?: string;
}): Promise<any> {
  const prevContext = snapshotJobContext();
  
  try {
    if (params.requestId) {
      setJobContext({
        requestId: params.requestId,
        mechAddress: params.mechAddress,
      });
    }
    
    const result = await dispatchExistingJob({
      jobId: params.jobId,
      message: params.message,
    });
    
    return safeParseToolResponse(result);
  } finally {
    restoreJobContext(prevContext);
  }
}

