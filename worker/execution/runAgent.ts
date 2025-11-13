/**
 * Agent execution: spawn Gemini CLI, handle stdout/stderr, capture telemetry
 */

import { Agent } from '../../gemini-agent/agent.js';
import { getOptionalMechModel } from '../../gemini-agent/mcp/tools/shared/env.js';
import { buildEnhancedPrompt } from '../metadata/prompt.js';
import { setJobContext, clearJobContext, snapshotJobContext, restoreJobContext } from '../metadata/jobContext.js';
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
export async function runAgentForRequest(
  request: UnclaimedRequest,
  metadata: IpfsMetadata
): Promise<AgentExecutionResult> {
  // Use model from job metadata if available, otherwise fallback to env var or default
  const model = metadata?.model || getOptionalMechModel() || 'gemini-2.5-flash';
  const enabledTools = Array.isArray(metadata?.enabledTools) ? metadata.enabledTools : [];
  
  const agent = new Agent(model, enabledTools, {
    jobId: request.id,
    jobDefinitionId: metadata?.jobDefinitionId || null,
    jobName: metadata?.jobName || 'Onchain Task',
    projectRunId: null,
    sourceEventId: null,
    projectDefinitionId: null
  });

  // Build enhanced prompt with context if available
  const prompt = buildEnhancedPrompt(
    metadata,
    String(metadata?.prompt || '').trim() || `Process request ${request.id} for mech ${request.mech}`
  );

  // Snapshot and set job context for downstream tools
  const prevContext = snapshotJobContext();
  try {
    setJobContext({
      requestId: request.id,
      mechAddress: request.mech,
      jobDefinitionId: metadata?.jobDefinitionId || undefined,
      baseBranch:
        metadata?.codeMetadata?.branch?.name ||
        metadata?.codeMetadata?.baseBranch ||
        undefined,
    });
    
    const result = await agent.run(prompt);
    
    return {
      output: result.output || '',
      telemetry: result.telemetry || {},
    };
  } finally {
    restoreJobContext(prevContext);
  }
}

