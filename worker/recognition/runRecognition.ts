/**
 * Recognition phase orchestrator
 */

import { workerLogger } from '../../logging/index.js';
import { graphQLRequest } from '../../http/client.js';
import { getPonderGraphqlUrl, getOptionalIpfsGatewayUrl } from '../../gemini-agent/mcp/tools/shared/env.js';
import { pushJsonToIpfs } from '@jinn-network/mech-client-ts/dist/ipfs.js';
import { Agent } from '../../gemini-agent/agent.js';
import { createArtifact } from '../control_api_client.js';
import type { RecognitionPhaseResult } from '../recognition_helpers.js';
import {
  buildRecognitionPromptWithArtifacts,
  extractPromptSections,
  sanitizeMarkdownText,
  parseRecognitionJson,
  normalizeLearnings,
  formatRecognitionMarkdown,
} from '../recognition_helpers.js';
import { serializeError } from '../logging/errors.js';
import type { IpfsMetadata } from '../types.js';
import { buildProgressCheckpoint, type ProgressCheckpoint } from './progressCheckpoint.js';

type RemoteSituationArtifact = {
  id: string;
  requestId: string;
  cid: string;
  topic: string;
  name?: string | null;
};

/**
 * Run recognition phase: create initial situation, search similar jobs, fetch artifacts, generate learnings
 */
export async function runRecognitionPhase(requestId: string, metadata: IpfsMetadata): Promise<RecognitionPhaseResult> {
  const sections = extractPromptSections(metadata?.blueprint);
  const parentMessage = metadata?.additionalContext?.message?.content || metadata?.additionalContext?.message;

  const jobOverviewLines = [
    `Request ID: ${requestId}`,
    metadata?.jobName ? `Job Name: ${metadata.jobName}` : null,
    sections['Objective'] ? `Objective: ${sections['Objective']}` : null,
    sections['Acceptance Criteria'] ? `Acceptance Criteria: ${sections['Acceptance Criteria']}` : null,
    sections['Context'] ? `Context: ${sections['Context']}` : null,
    parentMessage ? `Parent Message: ${sanitizeMarkdownText(parentMessage, 280)}` : null,
  ].filter((line): line is string => Boolean(line));

  let initialSituation: any = null;
  let embeddingStatus: 'success' | 'failed' = 'failed';
  let progressCheckpoint: ProgressCheckpoint | null = null;

  // Build progress checkpoint (workstream-wide awareness with AI summarization)
  try {
    // Extract objective for AI summarization
    const objective = sections['Objective'] || metadata?.additionalContext?.objective || 'Complete assigned work';
    
    progressCheckpoint = await buildProgressCheckpoint(
      requestId,
      {
        sourceRequestId: metadata?.sourceRequestId,
        jobDefinitionId: metadata?.jobDefinitionId,
      },
      objective,
      metadata?.jobName
    );
    
    if (progressCheckpoint) {
      workerLogger.info({
        requestId,
        completedJobs: progressCheckpoint.stats.completedJobs,
        summaryLength: progressCheckpoint.checkpointSummary.length,
      }, 'Progress checkpoint built with AI summary');
    }
  } catch (checkpointError: any) {
    workerLogger.warn({
      requestId,
      error: serializeError(checkpointError),
    }, 'Failed to build progress checkpoint (non-critical)');
  }

  try {
    const { createInitialSituation } = await import('../situation_encoder.js');
    const { situation, summaryText } = await createInitialSituation({
      requestId,
      jobName: metadata?.jobName,
      jobDefinitionId: metadata?.jobDefinitionId,
      model: metadata?.model,
      additionalContext: metadata?.additionalContext,
    });
    initialSituation = situation;
    workerLogger.info({ requestId, summaryLength: summaryText.length }, 'Created initial situation for recognition');

    const { searchSimilarSituations } = await import('../../gemini-agent/mcp/tools/search_similar_situations.js');
    const vectorResults = await searchSimilarSituations({ query_text: summaryText, k: 5 });
    const vectorPayload = JSON.parse(vectorResults?.content?.[0]?.text || '{}');

    if (!vectorPayload?.meta?.ok || !Array.isArray(vectorPayload?.data) || vectorPayload.data.length === 0) {
      workerLogger.info({ requestId }, 'No similar situations found for recognition');
      return { promptPrefix: '', learningsMarkdown: undefined, rawLearnings: null, initialSituation, embeddingStatus: 'failed', progressCheckpoint };
    }

    embeddingStatus = 'success';
    const matches = vectorPayload.data;
    workerLogger.info({ requestId, matchCount: matches.length }, 'Found similar situations');

    const similarJobs = matches.slice(0, 3).map((match: any) => ({
      requestId: match.nodeId,
      score: typeof match.score === 'number' ? match.score : Number(match.score || 0),
      jobName: match.jobName || undefined,
    }));

    const situationArtifacts: Array<{ sourceRequestId: string; score: number; situation: any }> = [];
    const PONDER_GRAPHQL_URL = getPonderGraphqlUrl();

    for (const match of matches.slice(0, 3)) {
      try {
        const artifactData = await graphQLRequest<{
          artifacts: { items: RemoteSituationArtifact[] };
        }>({
          url: PONDER_GRAPHQL_URL,
          query: `
            query RecognitionSituationArtifacts($requestId: String!) {
              artifacts(where: { requestId: $requestId, topic: "SITUATION" }, limit: 1) {
                items {
                  id
                  requestId
                  cid
                  topic
                  name
                }
              }
            }
          `,
          variables: { requestId: match.nodeId },
          context: {
            operation: 'recognitionFetchSituationArtifacts',
            matchRequestId: match.nodeId,
            parentRequestId: requestId,
          },
        });

        const artifacts = artifactData?.artifacts?.items || [];
        if (artifacts.length === 0) {
          workerLogger.debug({ requestId, matchNodeId: match.nodeId }, 'No SITUATION artifact found for similar job');
          continue;
        }

        const situationArtifact = artifacts[0];
        const gatewayBase = (getOptionalIpfsGatewayUrl() || 'https://gateway.autonolas.tech/ipfs/').replace(/\/+$/, '');
        const ipfsUrl = `${gatewayBase}/${situationArtifact.cid}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const ipfsResponse = await fetch(ipfsUrl, { signal: controller.signal });
          if (!ipfsResponse.ok) {
            workerLogger.warn({ requestId, cid: situationArtifact.cid, status: ipfsResponse.status }, 'Failed to fetch SITUATION artifact from IPFS');
            continue;
          }

          let situationData: any = await ipfsResponse.json();
          if (situationData?.content && typeof situationData.content === 'string') {
            try {
              situationData = JSON.parse(situationData.content);
            } catch (parseError: any) {
              workerLogger.warn({ requestId, cid: situationArtifact.cid, error: serializeError(parseError) }, 'Failed to parse wrapped SITUATION content');
            }
          }

          situationArtifacts.push({
            sourceRequestId: match.nodeId,
            score: typeof match.score === 'number' ? match.score : Number(match.score || 0),
            situation: situationData,
          });

          workerLogger.info({ requestId, sourceRequestId: match.nodeId, cid: situationArtifact.cid }, 'Fetched SITUATION artifact for recognition');
        } finally {
          clearTimeout(timeout);
        }
      } catch (fetchError: any) {
        workerLogger.warn({ requestId, matchNodeId: match.nodeId, error: serializeError(fetchError) }, 'Failed to fetch SITUATION artifact for match');
      }
    }

    if (situationArtifacts.length === 0) {
      workerLogger.info({ requestId }, 'Recognition phase: no SITUATION artifacts available for similar jobs');
      return { promptPrefix: '', learningsMarkdown: undefined, rawLearnings: null, initialSituation, embeddingStatus, progressCheckpoint };
    }

    workerLogger.info({ requestId, artifactCount: situationArtifacts.length }, 'Fetched SITUATION artifacts for recognition');

    const recognitionPrompt = buildRecognitionPromptWithArtifacts(
      jobOverviewLines,
      summaryText,
      situationArtifacts,
    );

    const recognitionAgent = new Agent(
      'gemini-2.5-flash', // Always use flash for faster recognition
      [],
      {
        jobId: `${requestId}-recognition`,
        jobDefinitionId: metadata?.jobDefinitionId || null,
        jobName: metadata?.jobName || 'job',
        phase: 'recognition',
        projectRunId: null,
        sourceEventId: null,
        projectDefinitionId: null,
      },
      null, // No codeWorkspace for recognition agents
    );

    const agentResult = await recognitionAgent.run(recognitionPrompt);
    const parsed = parseRecognitionJson(agentResult?.output || '');
    const learnings = normalizeLearnings(parsed);

    if (!learnings || learnings.length === 0) {
      workerLogger.info({ requestId }, 'Recognition phase completed with no actionable learnings');
      return {
        promptPrefix: '',
        learningsMarkdown: undefined,
        rawLearnings: parsed,
        searchQuery: summaryText,
        similarJobs,
        initialSituation,
        embeddingStatus,
        progressCheckpoint,
      };
    }

    const markdown = formatRecognitionMarkdown(learnings);
    workerLogger.info({ requestId, learningsCount: learnings.length }, 'Recognition phase produced learnings');

    // Add review-first reminder if completed children exist
    let enhancedMarkdown = markdown;
    const childRequestIds = initialSituation?.context?.childRequestIds || [];
    const hasCompletedChildren = metadata?.additionalContext?.hierarchy?.some((job: any) => 
      job.level > 0 && job.status === 'completed'
    ) || false;
    const hasWorkProtocolMessage = metadata?.additionalContext?.message && 
      (typeof metadata.additionalContext.message === 'string' 
        ? metadata.additionalContext.message.includes('Child job COMPLETED') || metadata.additionalContext.message.includes('Child job completed')
        : metadata.additionalContext.message.content?.includes('Child job COMPLETED') || metadata.additionalContext.message.content?.includes('Child job completed'));

    if ((childRequestIds.length > 0 || hasCompletedChildren || hasWorkProtocolMessage) && markdown) {
      enhancedMarkdown = markdown + '\n\n**Note:** You have completed child job(s) in your hierarchy. Before delegating additional work, review their deliverables (artifacts, execution summaries, PR links) and evaluate whether their output satisfies your objective. Only dispatch new child jobs if you can clearly identify remaining gaps.';
    }

    const recognitionResult = {
      promptPrefix: enhancedMarkdown,
      learningsMarkdown: enhancedMarkdown,
      rawLearnings: learnings,
      searchQuery: summaryText,
      similarJobs,
      initialSituation,
      embeddingStatus,
      progressCheckpoint,
    };

    try {
      const recognitionArtifactPayload = {
        initialSituation,
        embeddingStatus,
        similarJobs,
        learnings: markdown,
        searchQuery: summaryText,
        timestamp: new Date().toISOString(),
      };
      const [, recognitionCid] = await pushJsonToIpfs(recognitionArtifactPayload);
      await createArtifact(requestId, {
        cid: recognitionCid,
        topic: 'RECOGNITION_RESULT',
        content: null,
      });
      workerLogger.info({ requestId, cid: recognitionCid }, 'Persisted RECOGNITION_RESULT artifact');
    } catch (artifactError: any) {
      workerLogger.warn({ requestId, error: serializeError(artifactError) }, 'Failed to persist RECOGNITION_RESULT artifact');
    }

    return recognitionResult;
  } catch (recognitionError: any) {
    workerLogger.error({ requestId, error: serializeError(recognitionError) }, 'Recognition phase failed');

    try {
      const fallbackPayload = {
        initialSituation,
        embeddingStatus,
        error: recognitionError?.message || String(recognitionError),
        timestamp: new Date().toISOString(),
      };
      const [, fallbackCid] = await pushJsonToIpfs(fallbackPayload);
      await createArtifact(requestId, {
        cid: fallbackCid,
        topic: 'RECOGNITION_RESULT',
        content: null,
      });
      workerLogger.info({ requestId, cid: fallbackCid }, 'Persisted fallback RECOGNITION_RESULT artifact');
    } catch (fallbackError: any) {
      workerLogger.warn({ requestId, error: serializeError(fallbackError) }, 'Failed to persist fallback RECOGNITION_RESULT artifact');
    }

    return { promptPrefix: '', learningsMarkdown: undefined, rawLearnings: null, initialSituation, embeddingStatus, progressCheckpoint };
  }
}

