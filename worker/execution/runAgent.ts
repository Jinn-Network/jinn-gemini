/**
 * Agent execution: spawn Gemini CLI, handle stdout/stderr, capture telemetry
 */

import { Agent } from '../../gemini-agent/agent.js';
import { getOptionalMechModel } from '../../gemini-agent/mcp/tools/shared/env.js';
import { buildEnhancedPrompt } from '../metadata/prompt.js';
import { setJobContext, clearJobContext, snapshotJobContext, restoreJobContext } from '../metadata/jobContext.js';
import { didDispatchChild } from '../status/dispatchUtils.js';
import type { UnclaimedRequest, IpfsMetadata, AgentExecutionResult } from '../types.js';

/**
 * Execution context for agent run
 */
export interface ExecutionContext {
  request: UnclaimedRequest;
  metadata: IpfsMetadata;
}

/**
 * Run agent for a request with proper environment context
 * 
 * Tool configuration is handled centrally via gemini-agent/toolPolicy.ts.
 * The Agent class computes MCP include/exclude lists and CLI whitelists
 * based on the enabledTools passed here, ensuring consistency across the system.
 */
function extractCompletedChildRequestIds(additionalContext: any): string[] {
  if (!additionalContext || typeof additionalContext !== 'object') {
    return [];
  }
  const hierarchy = Array.isArray(additionalContext.hierarchy)
    ? additionalContext.hierarchy
    : [];
  const ids = new Set<string>();
  hierarchy
    .filter((job: any) => job && job.level > 0 && job.status === 'completed')
    .forEach((job: any) => {
      if (Array.isArray(job.requestIds)) {
        job.requestIds.forEach((id: any) => {
          if (typeof id === 'string' && id.length > 0) {
            ids.add(id);
          }
        });
      }
    });
  return Array.from(ids);
}

export async function runAgentForRequest(
  request: UnclaimedRequest,
  metadata: IpfsMetadata
): Promise<AgentExecutionResult> {
  // Prefer explicit model, then environment default, otherwise flash for speed
  const model = metadata?.model || getOptionalMechModel() || 'gemini-2.5-flash';
  const enabledTools = Array.isArray(metadata?.enabledTools) ? metadata.enabledTools : [];
  const completedChildRequestIds = extractCompletedChildRequestIds(metadata?.additionalContext);
  
  // For artifact-only jobs (no code), pass null to prevent loading external repos
  const codeWorkspace = metadata?.codeMetadata ? undefined : null;
  
  const agent = new Agent(
    model,
    enabledTools,
    {
      jobId: request.id,
      jobDefinitionId: metadata?.jobDefinitionId || null,
      jobName: metadata?.jobName || 'job',
      phase: 'execution',
      projectRunId: null,
      sourceEventId: null,
      projectDefinitionId: null
    },
    codeWorkspace
  );

  // Build enhanced prompt from blueprint and context
  // Fallback to generic prompt if no blueprint exists (shouldn't happen in normal flow)
  const prompt = buildEnhancedPrompt(
    metadata,
    `Process request ${request.id} for mech ${request.mech}`
  );

  // Snapshot and set job context for downstream tools
  const prevContext = snapshotJobContext();
  try {
    setJobContext({
      requestId: request.id,
      mechAddress: request.mech,
      jobDefinitionId: metadata?.jobDefinitionId || undefined,
      baseBranch:
        metadata?.codeMetadata?.baseBranch ||
        metadata?.codeMetadata?.branch?.name ||
        undefined,
      workstreamId: metadata?.workstreamId || request.id, // Fallback to requestId for root jobs
      parentRequestId: metadata?.sourceRequestId || undefined,
      branchName: metadata?.codeMetadata?.branch?.name || undefined,
      completedChildRequestIds,
    });
    
    const result = await agent.run(prompt);
    const telemetry = result.telemetry || {};
    const delegated = didDispatchChild(telemetry);
    
    return {
      output: result.output || '',
      telemetry,
      delegated,
    };
  } finally {
    restoreJobContext(prevContext);
  }
}
