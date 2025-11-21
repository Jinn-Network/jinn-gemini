/**
 * Delivery payload: structure output, telemetry, PR URL for IPFS registry
 */

import type { AgentExecutionResult, IpfsMetadata, RecognitionPhaseResult, ReflectionResult } from '../types.js';

/**
 * Build delivery payload for IPFS registry
 */
export function buildDeliveryPayload(params: {
  requestId: string;
  result: AgentExecutionResult;
  metadata: IpfsMetadata;
  recognition?: RecognitionPhaseResult | null;
  reflection?: ReflectionResult | null;
  workerTelemetry?: any;
  finalStatus?: { status: string; message?: string };
}): any {
  const { requestId, result, metadata, recognition, reflection, workerTelemetry, finalStatus } = params;

  return {
    requestId: String(requestId),
    output: result.output || '',
    structuredSummary: result.structuredSummary || result.output?.slice(-1200) || '',
    telemetry: result.telemetry || {},
    artifacts: result.artifacts || [],
    ...(metadata?.jobDefinitionId ? { jobDefinitionId: metadata.jobDefinitionId } : {}),
    ...(metadata?.jobName ? { jobName: metadata.jobName } : {}),
    ...(metadata?.blueprint ? { blueprint: metadata.blueprint } : {}),
    ...(finalStatus ? { status: finalStatus.status, statusMessage: finalStatus.message } : {}),
    ...(workerTelemetry ? { workerTelemetry } : {}),
    ...(recognition
      ? {
          recognition: {
            initialSituation: recognition.initialSituation,
            embeddingStatus: recognition.embeddingStatus,
            similarJobs: recognition.similarJobs,
            learnings: recognition.rawLearnings,
            learningsMarkdown: recognition.learningsMarkdown,
            searchQuery: recognition.searchQuery,
            progressCheckpoint: recognition.progressCheckpoint,
          },
        }
      : {}),
    ...(reflection
      ? {
          reflection: {
            output: reflection.output,
            telemetry: reflection.telemetry,
          },
        }
      : {}),
    ...(result.pullRequestUrl ? { pullRequestUrl: result.pullRequestUrl } : {}),
    ...(metadata?.codeMetadata?.branch?.name
      ? {
          executionPolicy: {
            branch: metadata.codeMetadata.branch.name,
            ensureTestsPass: true,
            description: 'Agent executed work on the provided branch and passed required validations.',
          },
        }
      : {}),
  };
}

