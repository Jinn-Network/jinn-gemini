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
  return toolCalls.reduce((count, call) => {
    if (!call || !call.success) {
      return count;
    }
    const toolName = typeof call.tool === 'string' ? call.tool : '';
    if (toolName && DISPATCH_TOOL_NAMES.has(toolName)) {
      return count + 1;
    }
    return count;
  }, 0);
}

export function didDispatchChild(telemetry: any): boolean {
  return countSuccessfulDispatchCalls(telemetry) > 0;
}

