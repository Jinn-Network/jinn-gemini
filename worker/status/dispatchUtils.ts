/**
 * Helpers for detecting delegation tool usage in telemetry
 */

const DISPATCH_TOOL_NAMES = new Set(['dispatch_new_job', 'dispatch_existing_job']);

function getToolCalls(telemetry: any): any[] {
  if (!telemetry) {
    return [];
  }
  if (Array.isArray(telemetry.toolCalls)) {
    return telemetry.toolCalls;
  }
  if (Array.isArray(telemetry.tool_calls)) {
    return telemetry.tool_calls;
  }
  return [];
}

export function countSuccessfulDispatchCalls(telemetry: any): number {
  const toolCalls = getToolCalls(telemetry);
  // Track unique job definition IDs to avoid counting retries
  const uniqueJobDefs = new Set<string>();
  
  toolCalls.forEach(call => {
    if (!call || !call.success) {
      return;
    }
    const toolName = typeof call.tool === 'string' ? call.tool : '';
    if (toolName && DISPATCH_TOOL_NAMES.has(toolName)) {
      // Extract job definition ID from result
      const jobDefId = call.result?.data?.jobDefinitionId || 
                       call.result?.data?.id ||
                       call.result?.jobDefinitionId;
      if (jobDefId) {
        uniqueJobDefs.add(jobDefId);
      } else {
        // Fallback: count as unique if no ID (shouldn't happen in practice)
        uniqueJobDefs.add(`unknown-${Math.random()}`);
      }
    }
  });
  
  return uniqueJobDefs.size;
}

export function didDispatchChild(telemetry: any): boolean {
  return countSuccessfulDispatchCalls(telemetry) > 0;
}

