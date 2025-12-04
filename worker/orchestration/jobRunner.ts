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
import { generateBranchUrl, formatSummaryForPr, createBranchArtifact } from '../git/pr.js';
import { autoCommitIfNeeded, deriveCommitMessage, extractExecutionSummary } from '../git/autoCommit.js';
import { runRecognitionPhase } from '../recognition/runRecognition.js';
// Recognition augmentation now handled by BlueprintBuilder's RecognitionProvider
import { runAgentForRequest, consolidateArtifacts, parseTelemetry, extractOutput, mergeTelemetry, extractArtifactsFromError } from '../execution/index.js';
import { runReflection } from '../reflection/runReflection.js';
import { inferJobStatus, dispatchParentIfNeeded } from '../status/index.js';
import { storeOnchainReport } from '../delivery/report.js';
import { deliverViaSafeTransaction } from '../delivery/transaction.js';
import { createSituationArtifactForRequest } from '../situation_artifact.js';
import { createArtifact as apiCreateArtifact } from '../control_api_client.js';
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
            const cloneResult = await ensureRepoCloned(remoteUrl, repoRoot);
            telemetry.logCheckpoint('initialization', 'repo_clone', {
              remoteUrl,
              targetPath: repoRoot,
              wasAlreadyCloned: cloneResult.wasAlreadyCloned,
              fetchPerformed: cloneResult.fetchPerformed,
            });
          }
        }

        const checkoutResult = await checkoutJobBranch(metadata.codeMetadata);
        telemetry.logCheckpoint('initialization', 'branch_checkout', {
          branchName: checkoutResult.branchName,
          wasNewlyCreated: checkoutResult.wasNewlyCreated,
          checkoutMethod: checkoutResult.checkoutMethod,
          baseBranch: metadata.codeMetadata.baseBranch || DEFAULT_BASE_BRANCH,
        });
      } else {
        workerLogger.info({ requestId: target.id }, 'No code metadata - artifact-only job');
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
      recognition = await runRecognitionPhase(target.id, metadata, telemetry);
      // Recognition learnings are now handled by BlueprintBuilder's RecognitionProvider
      // Do NOT augment metadata.blueprint here - it must remain valid JSON for BlueprintBuilder
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
        metadata,
      });

      workerLogger.info({
        jobName: metadata?.jobName,
        requestId: target.id,
        status: finalStatus.status,
        message: finalStatus.message
      }, 'Execution completed - status inferred');

      // Aggregate tool metrics
      if (result?.telemetry?.toolCalls && result.telemetry.toolCalls.length > 0) {
        telemetry.setToolMetrics(result.telemetry.toolCalls);
      }

      telemetry.logCheckpoint('agent_execution', 'completed', {
        outputLength: result?.output?.length || 0,
        inputTokens: result?.telemetry?.inputTokens,
        outputTokens: result?.telemetry?.outputTokens,
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
          metadata,
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
              metadata,
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
      const reflectionArtifacts = extractMemoryArtifacts(reflection);
      const learningsCount = reflection?.telemetry?.toolCalls?.filter(
        (call: any) => call.tool === 'create_artifact' && call.success
      ).length || 0;
      
      telemetry.logCheckpoint('reflection', 'reflection_complete', {
        hasMemoryArtifacts: reflectionArtifacts.length > 0,
        learningsCount,
      });
      
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
  } catch (reflectionError: any) {
    telemetry.logError('reflection', reflectionError);
    workerLogger.warn({ requestId: target.id, error: serializeError(reflectionError) }, 'Reflection step failed (non-critical)');
  } finally {
    telemetry.endPhase('reflection');
  }

  // Situation artifact creation
  telemetry.startPhase('situation_creation');
  let situationCid: string | undefined;
  try {
    await createSituationArtifactForRequest({
      target,
      metadata: metadata!,
      result,
      finalStatus: finalStatus!,
      recognition,
    });
    
    // Extract CID from artifacts (situation artifact is added to result.artifacts)
    const situationArtifact = Array.isArray(result.artifacts) 
      ? result.artifacts.find((a: any) => a.topic === 'SITUATION' || a.type === 'SITUATION')
      : null;
    situationCid = situationArtifact?.cid;
    
    telemetry.logCheckpoint('situation_creation', 'situation_artifact_created', {
      cid: situationCid,
      hasEmbedding: true, // Embedding is always created in createSituationArtifactForRequest
    });
  } catch (situationError: any) {
    telemetry.logError('situation_creation', situationError);
    workerLogger.warn({ requestId: target.id, error: serializeError(situationError) }, 'Failed to create situation artifact');
  }
  telemetry.endPhase('situation_creation');

  // Restore environment
  restoreEnvironment(envSnapshot);

  // Git operations phase: commit, push, and branch artifact creation
  telemetry.startPhase('git_operations');
  try {
    // Prepare commit message if needed
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

    const branchName = metadata?.codeMetadata?.branch?.name;
    const branchUrl = metadata?.codeMetadata && branchName
      ? generateBranchUrl(metadata.codeMetadata, branchName)
      : null;

    if (branchName) {
      const pushProceedInfo = {
        requestId: target.id,
        branchName,
        repoRoot: getRepoRoot(metadata.codeMetadata),
        hasCommitMessage: !!commitMessageForAutoCommit,
      };
      workerLogger.info(pushProceedInfo, 'Git push conditions met - proceeding with push');

      // Auto-commit if we have changes and a commit message
      if (commitMessageForAutoCommit) {
        const commitResult = await autoCommitIfNeeded(metadata.codeMetadata, commitMessageForAutoCommit);
        if (commitResult) {
          telemetry.logCheckpoint('git_operations', 'auto_commit', {
            commitMessage: commitMessageForAutoCommit,
            repoRoot: getRepoRoot(metadata.codeMetadata),
            commitHash: commitResult.commitHash,
            filesChanged: commitResult.filesChanged,
          });
        }
      }

      // Push branch
      await pushJobBranch(branchName, metadata.codeMetadata);
      telemetry.logCheckpoint('git_operations', 'push', {
        branchName,
        remoteName: 'origin',
        success: true,
        ...(branchUrl ? { branchUrl } : {}),
      });
    } else {
      const pushSkippedInfo = {
        requestId: target.id,
        hasCodeMetadata: !!metadata?.codeMetadata,
        hasBranch: !!metadata?.codeMetadata?.branch,
        branchName: metadata?.codeMetadata?.branch?.name,
      };
      workerLogger.warn(pushSkippedInfo, 'Git push skipped - branch name missing');
      telemetry.logCheckpoint('git_operations', 'push_skipped', {
        reason: 'branch_name_missing',
      });
    }

    // Create branch artifact if completed
    if (finalStatus?.status === 'COMPLETED' && metadata?.codeMetadata) {
      const branchName = metadata.codeMetadata.branch?.name;
      const baseBranch = metadata.codeMetadata.baseBranch || DEFAULT_BASE_BRANCH;

      if (branchName) {
        // Generate branch URL for viewing on GitHub/remote
        if (branchUrl) {
          const summaryBlock = formatSummaryForPr(executionSummary);
          const branchArtifactRecord = await createBranchArtifact({
            requestId: target.id,
            branchUrl,
            branchName,
            baseBranch,
            title: `[Job ${metadata.codeMetadata.jobDefinitionId}] updates`,
            summaryBlock: summaryBlock ?? undefined,
            codeMetadata: metadata.codeMetadata,
          });

          if (branchArtifactRecord) {
            result.artifacts = [...(result.artifacts || []), branchArtifactRecord];
            // Store branch URL for backward compatibility (some code may look for this)
            result.pullRequestUrl = branchUrl;
            telemetry.logCheckpoint('git_operations', 'branch_artifact_created', {
              branchName,
              baseBranch,
              branchUrl,
              cid: branchArtifactRecord.cid,
            });
          }
        }
      }
    }
  } catch (gitError: any) {
    telemetry.logError('git_operations', gitError);
    workerLogger.error({ error: serializeError(gitError) }, 'Git operations failed');
    // Update status if push failed
    if (gitError?.message?.includes('push') || gitError?.message?.includes('Push')) {
      finalStatus = {
        status: 'FAILED',
        message: `Git push failed: ${gitError?.message || serializeError(gitError)}`
      };
    }
    throw gitError;
  } finally {
    telemetry.endPhase('git_operations');
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
        metadata,
      });
    }
    await storeOnchainReport(target, workerAddress, result, finalStatus, error, metadata!);
    telemetry.logCheckpoint('reporting', 'report_stored', { status: finalStatus.status });
  } finally {
    telemetry.endPhase('reporting');
  }

  // Dispatch parent if needed
  await dispatchParentIfNeeded(finalStatus, metadata!, target.id, result?.output || '', {
    telemetry,
    artifacts: Array.isArray(result?.artifacts) ? result.artifacts : undefined,
  });

  // Deliver via Safe
  telemetry.startPhase('delivery');
  try {
    const artifactsForDelivery = Array.isArray(result?.artifacts) ? [...result.artifacts] : [];

    telemetry.logCheckpoint('delivery', 'delivery_started', {
      artifactCount: artifactsForDelivery.length,
      artifactCids: artifactsForDelivery
        .map((artifact) => artifact.cid)
        .filter((cid): cid is string => typeof cid === 'string' && cid.length > 0),
      hasWorkerTelemetry: artifactsForDelivery.some((artifact) => artifact.topic === 'WORKER_TELEMETRY'),
    });

    const workerTelemetrySnapshot = telemetry.getLog();
    const delivery = await deliverViaSafeTransaction({
      requestId: target.id,
      request: target,
      result,
      finalStatus: finalStatus!,
      metadata: metadata!,
      recognition,
      reflection,
      workerTelemetry: workerTelemetrySnapshot,
      artifactsForDelivery,
    });

    telemetry.logCheckpoint('delivery', 'delivery_completed', {
      txHash: delivery?.tx_hash,
      status: delivery?.status,
      artifactCount: artifactsForDelivery.length,
    });
    workerLogger.info({ requestId: target.id, tx: delivery?.tx_hash, status: delivery?.status }, 'Delivered via Safe');
  } catch (e: any) {
    const message = e?.message || String(e);

    // Benign idempotency outcome: already delivered
    if (message.includes('Request already delivered')) {
      telemetry.logCheckpoint('delivery', 'delivery_already_completed', {});
      workerLogger.info(
        { requestId: target.id },
        'Delivery skipped: request already delivered on-chain',
      );
      return;
    }

    // Real failure path
    telemetry.logCheckpoint('delivery', 'delivery_failed', {
      message,
    });
    telemetry.logError('delivery', e);
    workerLogger.warn({ requestId: target.id, error: serializeError(e) }, 'Safe delivery failed');

    // Check if the error is due to a RevokeRequest event
    const isRevokeError = message.includes('revoked by the Mech contract');
    
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

  // Persist final worker telemetry snapshot (includes delivery details)
  telemetry.startPhase('telemetry_persistence');
  try {
    const workerTelemetryLog = telemetry.getLog();
    const { createArtifact: mcpCreateArtifact } = await import('../../gemini-agent/mcp/tools/create_artifact.js');
    const telemetryArtifactResponse = await mcpCreateArtifact({
      name: `worker-telemetry-${target.id}`,
      topic: 'WORKER_TELEMETRY',
      content: JSON.stringify(workerTelemetryLog, null, 2),
      type: 'WORKER_TELEMETRY',
    });
    const telemetryArtifactParsed = safeParseToolResponse(telemetryArtifactResponse);
    if (telemetryArtifactParsed.ok && telemetryArtifactParsed.data) {
      const artifactRecord = {
        cid: telemetryArtifactParsed.data.cid,
        name: telemetryArtifactParsed.data.name || `worker-telemetry-${target.id}`,
        topic: 'WORKER_TELEMETRY',
        type: 'WORKER_TELEMETRY',
        contentPreview:
          telemetryArtifactParsed.data.contentPreview
          || `Worker telemetry with ${workerTelemetryLog.events.length} events`,
      };

      // Register artifact with Control API for subgraph/indexing
      try {
        const { createArtifact: apiCreateArtifact } = await import('../control_api_client.js');
        await apiCreateArtifact(target.id, { cid: artifactRecord.cid, topic: artifactRecord.topic, content: null });
      } catch (controlError: any) {
        workerLogger.warn(
          { requestId: target.id, error: serializeError(controlError) },
          'Failed to register worker telemetry artifact (non-critical)',
        );
      }

      const existingArtifacts = Array.isArray(result.artifacts) ? [...result.artifacts] : [];
      existingArtifacts.push(artifactRecord);
      result.artifacts = existingArtifacts;

      telemetry.logCheckpoint('telemetry_persistence', 'artifact_saved', {
        cid: artifactRecord.cid,
        name: artifactRecord.name,
        events: workerTelemetryLog.events.length,
      });
    }
  } catch (telemetryArtifactError: any) {
    telemetry.logError('telemetry_persistence', telemetryArtifactError);
    workerLogger.warn(
      { requestId: target.id, error: serializeError(telemetryArtifactError) },
      'Failed to persist worker telemetry artifact (non-critical)',
    );
  } finally {
    telemetry.endPhase('telemetry_persistence');
  }
}
