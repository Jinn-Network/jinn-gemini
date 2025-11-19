/**
 * Job runner: orchestrates a single job execution through all phases
 * 
 * This module orchestrates the complete job lifecycle:
 * - Fetch metadata/IPFS payload
 * - Run recognition phase
 * - Execute agent
 * - Run reflection
 * - Infer final status
 * - Git operations (branch, commit, push, PR)
 * - Delivery/telemetry storage
 * - Parent dispatch decisions
 */

import { workerLogger } from '../../logging/index.js';
import { WorkerTelemetryService } from '../worker_telemetry.js';
import { serializeError } from '../logging/errors.js';
import { snapshotEnvironment, restoreEnvironment } from './env.js';
import { fetchIpfsMetadata } from '../metadata/fetchIpfsMetadata.js';
import { ensureRepoCloned } from '../git/repoManager.js';
import { checkoutJobBranch } from '../git/branch.js';
import { pushJobBranch } from '../git/push.js';
import { createOrUpdatePullRequest, formatSummaryForPr } from '../git/pr.js';
import { autoCommitIfNeeded, deriveCommitMessage, extractExecutionSummary } from '../git/autoCommit.js';
import { runRecognitionPhase } from '../recognition/runRecognition.js';
import { augmentPromptWithRecognition } from '../recognition/telemetryAugment.js';
import { runAgentForRequest, consolidateArtifacts, parseTelemetry, extractOutput, mergeTelemetry, extractArtifactsFromError } from '../execution/index.js';
import { runReflection } from '../reflection/runReflection.js';
import { inferJobStatus, dispatchParentIfNeeded } from '../status/index.js';
import { storeOnchainReport } from '../delivery/report.js';
import { deliverViaSafeTransaction } from '../delivery/transaction.js';
import { createSituationArtifactForRequest } from '../situation_artifact.js';
import { safeParseToolResponse } from '../tool_utils.js';
import { getJinnWorkspaceDir, extractRepoName, getRepoRoot } from '../../shared/repo_utils.js';
import { getOptionalMechModel } from '../../gemini-agent/mcp/tools/shared/env.js';
import { extractMemoryArtifacts } from '../reflection/memoryArtifacts.js';
import type { UnclaimedRequest, IpfsMetadata, AgentExecutionResult, FinalStatus, ExecutionSummaryDetails, RecognitionPhaseResult, ReflectionResult } from '../types.js';

const DEFAULT_BASE_BRANCH = process.env.CODE_METADATA_DEFAULT_BASE_BRANCH || 'main';

/**
 * Process a single job request
 * 
 * This is the main orchestration function that runs a job through all phases.
 * It handles all error cases and ensures proper cleanup.
 */
export async function processOnce(
  target: UnclaimedRequest,
  workerAddress: string
): Promise<void> {
  let result: AgentExecutionResult = { output: '', telemetry: {} };
  let error: any = null;
  let metadata: IpfsMetadata | null = null;
  let recognition: RecognitionPhaseResult | null = null;
  let reflection: ReflectionResult | null = null;
  let finalStatus: FinalStatus | null = null;
  let executionSummary: ExecutionSummaryDetails | null = null;
  
  const envSnapshot = snapshotEnvironment();
  const telemetry = new WorkerTelemetryService(target.id);

  try {
    // Initialize: fetch metadata and set up repo
    telemetry.startPhase('initialization');
    try {
      metadata = await fetchIpfsMetadata(target.ipfsHash!);
      if (!metadata) {
        metadata = {};
      }
      // Use model from job metadata if available, otherwise fallback to env var or default
      if (!metadata.model) {
        metadata.model = getOptionalMechModel() || 'gemini-2.5-flash';
      }

      telemetry.logCheckpoint('initialization', 'metadata_fetched', {
        hasJobName: !!metadata?.jobName,
        hasBlueprint: !!metadata?.blueprint,
        hasCodeMetadata: !!metadata?.codeMetadata,
      });

      workerLogger.info({ jobName: metadata?.jobName, requestId: target.id }, 'Processing request');

      // Handle code metadata if present (artifact-only jobs may not have it)
      if (metadata?.codeMetadata) {
        process.env.JINN_BASE_BRANCH = metadata.codeMetadata.branch?.name ||
          metadata.codeMetadata.baseBranch ||
          DEFAULT_BASE_BRANCH;

        const remoteUrl = metadata.codeMetadata?.repo?.remoteUrl;
        if (remoteUrl) {
          let repoRoot = process.env.CODE_METADATA_REPO_ROOT;

          if (repoRoot) {
            workerLogger.info({ repoRoot, remoteUrl }, 'Using existing CODE_METADATA_REPO_ROOT');
          } else {
            const repoName = extractRepoName(remoteUrl);
            if (repoName) {
              const workspaceDir = getJinnWorkspaceDir();
              repoRoot = `${workspaceDir}/${repoName}`;
              process.env.CODE_METADATA_REPO_ROOT = repoRoot;
              workerLogger.info({ repoRoot, remoteUrl }, 'Set CODE_METADATA_REPO_ROOT for job');
            }
          }

          if (repoRoot) {
            await ensureRepoCloned(remoteUrl, repoRoot);
          }
        }

        await checkoutJobBranch(metadata.codeMetadata);
      } else {
        workerLogger.info({ requestId: target.id }, 'No code metadata - artifact-only job');
      }
      
      if (metadata?.codeMetadata) {
        telemetry.logCheckpoint('initialization', 'checkout_complete', {
          branch: metadata.codeMetadata.branch?.name,
        });
      }
    } catch (initializationError: any) {
      telemetry.logError('initialization', initializationError);
      throw initializationError;
    } finally {
      telemetry.endPhase('initialization');
    }

    // Recognition phase
    telemetry.startPhase('recognition');
    try {
      recognition = await runRecognitionPhase(target.id, metadata);
      metadata = augmentPromptWithRecognition(metadata, recognition);
      if (recognition?.promptPrefix) {
        const prefix = recognition.promptPrefix.trim();
        if (prefix.length > 0) {
          const rawLearnings = Array.isArray(recognition.rawLearnings) ? recognition.rawLearnings : [];
          workerLogger.info({ 
            requestId: target.id, 
            prefixLength: prefix.length,
            learningsCount: rawLearnings.length,
            similarJobsCount: recognition.similarJobs?.length || 0,
            promptPreview: prefix.substring(0, 200)
          }, 'Augmented prompt with recognition learnings');
          telemetry.logCheckpoint('recognition', 'prompt_augmented', {
            prefixLength: prefix.length,
            hasLearnings: !!recognition.learningsMarkdown,
            learningsCount: rawLearnings.length,
          });
        }
      }
      metadata.recognition = recognition;
    } catch (recognitionError: any) {
      telemetry.logError('recognition', recognitionError);
      workerLogger.warn({ requestId: target.id, error: serializeError(recognitionError) }, 'Recognition phase failed (continuing without learnings)');
    } finally {
      telemetry.endPhase('recognition');
    }

    // Agent execution
    telemetry.startPhase('agent_execution', {
      model: metadata?.model || getOptionalMechModel() || 'gemini-2.5-flash',
    });
    try {
      result = await runAgentForRequest(target, metadata);
      result = await consolidateArtifacts(result, target.id);
      
      finalStatus = await inferJobStatus({
        requestId: target.id,
        error: null,
        telemetry: result.telemetry || {},
        delegatedThisRun: result.delegated,
      });

      workerLogger.info({
        jobName: metadata?.jobName,
        requestId: target.id,
        status: finalStatus.status,
        message: finalStatus.message
      }, 'Execution completed - status inferred');

      telemetry.logCheckpoint('agent_execution', 'completed', {
        outputLength: result?.output?.length || 0,
        totalTokens: result?.telemetry?.totalTokens,
        toolCalls: result?.telemetry?.toolCalls?.length || 0,
        inferredStatus: finalStatus.status,
      });
    } catch (agentError: any) {
      telemetry.logError('agent_execution', agentError);
      throw agentError;
    } finally {
      telemetry.endPhase('agent_execution');
    }
  } catch (e: any) {
    error = e;

    // Extract status and results from error telemetry if available
    if (e?.telemetry) {
      const parsed = parseTelemetry(result, e);
      
      const extractedOutput = extractOutput(result, e);
      if (extractedOutput) {
        result.output = result.output || extractedOutput;
      }

      result.telemetry = mergeTelemetry(result, e);

      const errorArtifacts = await extractArtifactsFromError(parsed.telemetry, target.id);
      if (errorArtifacts.length > 0 && !result.artifacts) {
        result.artifacts = errorArtifacts;
      }

      if (!finalStatus) {
        finalStatus = await inferJobStatus({
          requestId: target.id,
          error: e,
          telemetry: parsed.telemetry || result?.telemetry || {},
          delegatedThisRun: result.delegated,
        });
      }

      if (parsed.processExitError) {
        if (!finalStatus || finalStatus.status === 'FAILED') {
          try {
            finalStatus = await inferJobStatus({
              requestId: target.id,
              error: null,
              telemetry: parsed.telemetry,
              delegatedThisRun: result.delegated,
            });
          } catch (statusInferenceError) {
            workerLogger.warn(
              { requestId: target.id, error: serializeError(statusInferenceError) },
              'Failed to re-infer job status after Gemini transport error',
            );
          }
        }

        if (finalStatus?.status === 'COMPLETED') {
          workerLogger.warn(
            { jobName: metadata?.jobName, requestId: target.id },
            'Gemini CLI transport failed after agent completed; accepting completed result',
          );

          const mergedTelemetry = result.telemetry && Object.keys(result.telemetry).length > 0
            ? result.telemetry
            : (parsed.telemetry ? { ...parsed.telemetry } : {});
          if (!mergedTelemetry.errorType) {
            mergedTelemetry.errorType = 'PROCESS_ERROR';
          }
          const raw = (mergedTelemetry.raw =
            typeof mergedTelemetry.raw === 'object' && mergedTelemetry.raw !== null ? mergedTelemetry.raw : {});
          const warningLines = raw.stderrWarnings ? [raw.stderrWarnings] : [];
          warningLines.push('Gemini CLI: transport failed after agent completed (process exited).');
          raw.stderrWarnings = warningLines.join('\n');
          result.telemetry = mergedTelemetry;

          if (!result.output && typeof parsed.telemetry?.raw?.partialOutput === 'string') {
            result.output = parsed.telemetry.raw.partialOutput;
          }

          error = null;
        }
      }
    }

    if (error) {
      workerLogger.error({
        jobName: metadata?.jobName,
        requestId: target.id,
        error: serializeError(error),
        finalStatus: finalStatus?.status,
        hasTelemetry: !!e?.telemetry
      }, 'Execution failed');
    }
  }

  // Reflection phase
  telemetry.startPhase('reflection');
  try {
    reflection = await runReflection(target, metadata!, finalStatus, result, error);
    if (reflection) {
      telemetry.logCheckpoint('reflection', 'reflection_complete');
    }
  } catch (reflectionError: any) {
    telemetry.logError('reflection', reflectionError);
    workerLogger.warn({ requestId: target.id, error: serializeError(reflectionError) }, 'Reflection step failed (non-critical)');
  } finally {
    telemetry.endPhase('reflection');
  }

  if (reflection) {
    const reflectionArtifacts = extractMemoryArtifacts(reflection);
    if (reflectionArtifacts.length > 0) {
      const existing = Array.isArray(result.artifacts) ? [...result.artifacts] : [];
      const seen = new Set(existing.map((artifact) => `${artifact.cid}|${artifact.topic}`));
      for (const artifact of reflectionArtifacts) {
        const key = `${artifact.cid}|${artifact.topic}`;
        if (seen.has(key)) continue;
        existing.push(artifact);
        seen.add(key);
      }
      result.artifacts = existing;
    }
  }

  // Situation artifact creation
  telemetry.startPhase('situation_creation');
  try {
    await createSituationArtifactForRequest({
      target,
      metadata: metadata!,
      result,
      finalStatus: finalStatus!,
      recognition,
    });
    telemetry.logCheckpoint('situation_creation', 'situation_artifact_created');
  } catch (situationError: any) {
    telemetry.logError('situation_creation', situationError);
    workerLogger.warn({ requestId: target.id, error: serializeError(situationError) }, 'Failed to create situation artifact');
  }
  telemetry.endPhase('situation_creation');

  // Restore environment
  restoreEnvironment(envSnapshot);

  // Git operations: commit and push
  if (finalStatus?.status === 'COMPLETED') {
    const outputText = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output ?? '');
    executionSummary = executionSummary ?? extractExecutionSummary(outputText);
  }
  
  let commitMessageForAutoCommit: string | null = null;
  if (finalStatus?.status === 'COMPLETED' && metadata?.codeMetadata) {
    commitMessageForAutoCommit = deriveCommitMessage(executionSummary, finalStatus, {
      jobId: target.id,
      jobDefinitionId: metadata?.jobDefinitionId,
    });
  }

  // Log push attempt details (both logger and console for test visibility)
  const pushDebugInfo = {
    requestId: target.id,
    finalStatus: finalStatus?.status,
    hasCodeMetadata: !!metadata?.codeMetadata,
    branchName: metadata?.codeMetadata?.branch?.name,
    repoRoot: getRepoRoot(metadata?.codeMetadata),
    codeMetadataRepoRoot: process.env.CODE_METADATA_REPO_ROOT,
  };
  workerLogger.info(pushDebugInfo, 'Git push attempt - checking conditions');
  console.error('[WORKER-PUSH-DEBUG] Git push attempt:', JSON.stringify(pushDebugInfo));

  try {
    if (metadata?.codeMetadata?.branch?.name) {
      const pushProceedInfo = {
        requestId: target.id,
        branchName: metadata.codeMetadata.branch.name,
        repoRoot: getRepoRoot(metadata.codeMetadata),
        hasCommitMessage: !!commitMessageForAutoCommit,
      };
      workerLogger.info(pushProceedInfo, 'Git push conditions met - proceeding with push');
      console.error('[WORKER-PUSH-DEBUG] Git push conditions met:', JSON.stringify(pushProceedInfo));
      
      if (commitMessageForAutoCommit) {
        await autoCommitIfNeeded(metadata.codeMetadata, commitMessageForAutoCommit);
      }
      await pushJobBranch(metadata.codeMetadata.branch.name, metadata.codeMetadata);
    } else {
      const pushSkippedInfo = {
        requestId: target.id,
        hasCodeMetadata: !!metadata?.codeMetadata,
        hasBranch: !!metadata?.codeMetadata?.branch,
        branchName: metadata?.codeMetadata?.branch?.name,
      };
      workerLogger.warn(pushSkippedInfo, 'Git push skipped - branch name missing');
      console.error('[WORKER-PUSH-DEBUG] Git push skipped:', JSON.stringify(pushSkippedInfo));
    }
  } catch (pushError: any) {
    workerLogger.error({ error: serializeError(pushError) }, 'Failed to push branch');
    finalStatus = {
      status: 'FAILED',
      message: `Git push failed: ${pushError?.message || serializeError(pushError)}`
    };
    throw pushError;
  }

  // Create PR if completed
  try {
    if (finalStatus?.status === 'COMPLETED' && metadata?.codeMetadata) {
      const branchName = metadata.codeMetadata.branch?.name;
      const baseBranch = metadata.codeMetadata.baseBranch || DEFAULT_BASE_BRANCH;

      if (branchName) {
        const summaryBlock = formatSummaryForPr(executionSummary);
        const prUrl = await createOrUpdatePullRequest({
          codeMetadata: metadata.codeMetadata,
          branchName,
          baseBranch,
          requestId: target.id,
          summaryBlock: summaryBlock ?? undefined,
        });
        if (prUrl) {
          result.pullRequestUrl = prUrl;
        }
      }
    }
  } catch (prError: any) {
    workerLogger.error({ error: serializeError(prError) }, 'Failed to create PR');
  }

  // Store report
  telemetry.startPhase('reporting');
  try {
    if (!finalStatus) {
      finalStatus = await inferJobStatus({
        requestId: target.id,
        error,
        telemetry: result?.telemetry || {},
        delegatedThisRun: result.delegated,
      });
    }
    await storeOnchainReport(target, workerAddress, result, finalStatus, error, metadata!);
    telemetry.logCheckpoint('reporting', 'report_stored', { status: finalStatus.status });
  } finally {
    telemetry.endPhase('reporting');
  }
  
  // Dispatch parent if needed
  await dispatchParentIfNeeded(finalStatus, metadata!, target.id, result?.output || '', telemetry);

  // Deliver via Safe
  telemetry.startPhase('delivery');
  try {
    const artifactsForDelivery = Array.isArray(result?.artifacts) ? [...result.artifacts] : [];

    // Persist worker telemetry as artifact
    telemetry.startPhase('telemetry_persistence');
    const workerTelemetryLog = telemetry.getLog();
    try {
      const { createArtifact: mcpCreateArtifact } = await import('../../gemini-agent/mcp/tools/create_artifact.js');
      const telemetryArtifactResponse = await mcpCreateArtifact({
        name: `worker-telemetry-${target.id}`,
        topic: 'WORKER_TELEMETRY',
        content: JSON.stringify(workerTelemetryLog, null, 2),
        type: 'WORKER_TELEMETRY',
      });
      const telemetryArtifactParsed = safeParseToolResponse(telemetryArtifactResponse);
      if (telemetryArtifactParsed.ok && telemetryArtifactParsed.data) {
        artifactsForDelivery.push({
          cid: telemetryArtifactParsed.data.cid,
          name: `worker-telemetry-${target.id}`,
          topic: 'WORKER_TELEMETRY',
          type: 'WORKER_TELEMETRY',
          contentPreview: `Worker telemetry with ${workerTelemetryLog.events.length} events`,
        });
      }
    } catch (telemetryArtifactError: any) {
      telemetry.logError('telemetry_persistence', telemetryArtifactError);
      workerLogger.warn({ error: serializeError(telemetryArtifactError) }, 'Failed to add worker telemetry to delivery artifacts (non-critical)');
    } finally {
      telemetry.endPhase('telemetry_persistence');
    }

    const delivery = await deliverViaSafeTransaction({
      requestId: target.id,
      request: target,
      result,
      finalStatus: finalStatus!,
      metadata: metadata!,
      recognition,
      reflection,
      workerTelemetry: workerTelemetryLog,
      artifactsForDelivery,
    });

    telemetry.logCheckpoint('delivery', 'delivered', {
      txHash: delivery?.tx_hash,
      status: delivery?.status,
    });
    workerLogger.info({ requestId: target.id, tx: delivery?.tx_hash, status: delivery?.status }, 'Delivered via Safe');
  } catch (e: any) {
    telemetry.logError('delivery', e);
    workerLogger.warn({ requestId: target.id, error: serializeError(e) }, 'Safe delivery failed');

    // Check if the error is due to a RevokeRequest event
    const isRevokeError = e?.message?.includes('revoked by the Mech contract');
    
    if (isRevokeError && metadata?.jobDefinitionId) {
      workerLogger.warn({ 
        requestId: target.id, 
        jobDefinitionId: metadata.jobDefinitionId,
        jobName: metadata.jobName 
      }, 'Request was revoked - automatic re-dispatch recommended');
      
      // Store failure status with revoke context
      try {
        await storeOnchainReport(target, workerAddress, result, {
          status: 'FAILED',
          message: `Delivery revoked by Mech contract. Job should be re-dispatched: ${metadata.jobName || metadata.jobDefinitionId}`,
        }, e, metadata!);
      } catch (reportErr: any) {
        workerLogger.warn({ jobName: metadata?.jobName, requestId: target.id, error: serializeError(reportErr) }, 'Failed to record REVOKE_FAILURE status');
      }
    } else {
      // Standard failure handling
      try {
        await storeOnchainReport(target, workerAddress, result, {
          status: 'FAILED',
          message: `Delivery failed: ${e?.message || String(e)}`,
        }, e, metadata!);
      } catch (reportErr: any) {
        workerLogger.warn({ jobName: metadata?.jobName, requestId: target.id, error: serializeError(reportErr) }, 'Failed to record FAILED status');
      }
    }
  } finally {
    telemetry.endPhase('delivery');
  }
}

