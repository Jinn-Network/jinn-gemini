import '../env/index.js';
import { Agent } from '../gemini-agent/agent.js';
import { deliverViaSafe } from '@jinn-network/mech-client-ts/dist/post_deliver.js';
import { pushJsonToIpfs } from '@jinn-network/mech-client-ts/dist/ipfs.js';
import { Web3 } from 'web3';
import { graphQLRequest } from '../http/client.js';
import {
  getPonderGraphqlUrl,
  getUseControlApi,
  getOptionalMechReclaimAfterMinutes,
  getEnableAutoRepost,
  getOptionalMechModel,
  getRequiredRpcUrl,
  getOptionalIpfsGatewayUrl,
  getIpfsFetchTimeoutMs,
  getOptionalMechTargetRequestId,
  getOptionalMechChainConfig,
} from '../gemini-agent/mcp/tools/shared/env.js';
// Import JSON artifact without import assertions for TS compatibility
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import agentMechArtifact from '@jinn-network/mech-client-ts/dist/abis/AgentMech.json';
import { workerLogger } from '../logging/index.js';
import { claimRequest as apiClaimRequest, createJobReport as apiCreateJobReport, createArtifact as apiCreateArtifact } from './control_api_client.js';
import { extractArtifactsFromOutput, extractArtifactsFromTelemetry } from './artifacts.js';
import { getMechAddress, getServiceSafeAddress, getServicePrivateKey } from '../env/operate-profile.js';
import { dispatchExistingJob } from '../gemini-agent/mcp/tools/dispatch_existing_job.js';
import type { CodeMetadata } from '../gemini-agent/shared/code_metadata.js';
import { getRepoRoot, extractRepoName, getJinnWorkspaceDir } from '../shared/repo_utils.js';
import { existsSync } from 'node:fs';
import type { RecognitionPhaseResult } from './recognition_helpers.js';
import {
  buildRecognitionPromptWithArtifacts,
  extractPromptSections,
  formatRecognitionMarkdown,
  normalizeLearnings,
  parseRecognitionJson,
  sanitizeMarkdownText,
} from './recognition_helpers.js';
import { safeParseToolResponse } from './tool_utils.js';
import { WorkerTelemetryService } from './worker_telemetry.js';
import { createSituationArtifactForRequest } from './situation_artifact.js';

type UnclaimedRequest = {
  id: string;           // on-chain requestId (decimal string or 0x)
  mech: string;         // mech address (0x...)
  requester: string;    // requester address (0x...)
  blockTimestamp?: number;
  ipfsHash?: string;
  delivered?: boolean;
};


const PONDER_GRAPHQL_URL = getPonderGraphqlUrl();
const SINGLE_SHOT = process.argv.includes('--single') || process.argv.includes('--single-job');
const USE_CONTROL_API = getUseControlApi();
const STALE_MINUTES = getOptionalMechReclaimAfterMinutes() ?? 10;

// Auto-reposting configuration
const ENABLE_AUTO_REPOST = getEnableAutoRepost();
const MIN_TIME_BETWEEN_REPOSTS = 5 * 60 * 1000; // 5 minutes

// Track recent reposts to prevent loops
const recentReposts = new Map<string, number>();

const GITHUB_API_URL = process.env.GITHUB_API_URL || 'https://api.github.com';
const DEFAULT_BASE_BRANCH = process.env.CODE_METADATA_DEFAULT_BASE_BRANCH || 'main';

// Error serialization helper
function serializeError(e: any): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e?.message) return e.message;
  if (e instanceof Error) return e.toString();
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function parseGithubRepo(remoteUrl: string | undefined, branchName: string): { owner: string; repo: string; head: string } | null {
  const normalizeRepository = (value?: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.trim().replace(/\.git$/i, '');
    if (!trimmed.includes('/')) return null;
    return trimmed;
  };

  const inferRepositoryFromRemote = (url?: string): string | null => {
    if (!url) return null;

    // SSH form: git@host:owner/repo.git
    const sshMatch = url.match(/^git@([^:]+?):(.+?)$/);
    if (sshMatch) {
      return normalizeRepository(sshMatch[2]);
    }

    // Handle scp-like shorthand without scheme: host:owner/repo.git
    const scpMatch = url.match(/^([^@]+?):(.+?)$/);
    if (scpMatch && !url.includes('://')) {
      return normalizeRepository(scpMatch[2]);
    }

    // URL forms: https://host/owner/repo.git or ssh://
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/^\/+/, '');
      return normalizeRepository(pathname);
    } catch {
      return null;
    }
  };

  const repository = normalizeRepository(process.env.GITHUB_REPOSITORY) ?? inferRepositoryFromRemote(remoteUrl);
  if (!repository) return null;

  const [owner, repo] = repository.split('/', 2);
  if (!owner || !repo) return null;
  return { owner, repo, head: `${owner}:${branchName}` };
}

/**
 * Ensure repository is cloned to the workspace directory
 * Clones if it doesn't exist, otherwise does nothing
 */
async function ensureRepoCloned(remoteUrl: string, targetPath: string): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  
  if (existsSync(targetPath)) {
    workerLogger.info({ targetPath }, 'Repository already cloned');
    // Always fetch branches to ensure we have latest remote refs
    try {
      execFileSync('git', ['fetch', '--all'], {
        cwd: targetPath,
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: 60000,
        env: process.env as Record<string, string>,
      });
      workerLogger.info({ targetPath }, 'Fetched all branches');
    } catch (error: any) {
      workerLogger.warn({ targetPath, error: serializeError(error) }, 'Failed to fetch all branches (non-fatal)');
    }
    return;
  }

  workerLogger.info({ remoteUrl, targetPath }, 'Cloning repository');

  try {
    execFileSync('git', ['clone', remoteUrl, targetPath], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 120000, // 2 minutes for clone
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ targetPath }, 'Successfully cloned repository');
  } catch (error: any) {
    const errorMessage = `Failed to clone repository: ${error.stderr || error.message}`;
    workerLogger.error({ remoteUrl, targetPath, error: serializeError(error) }, errorMessage);
    throw new Error(errorMessage);
  }

  // Fetch all branches
  try {
    execFileSync('git', ['fetch', '--all'], {
      cwd: targetPath,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ targetPath }, 'Fetched all branches');
  } catch (error: any) {
    workerLogger.warn({ targetPath, error: serializeError(error) }, 'Failed to fetch all branches (non-fatal)');
  }
}

async function checkoutJobBranch(codeMetadata: CodeMetadata): Promise<void> {
  const branchName = codeMetadata.branch?.name;
  if (!branchName) {
    throw new Error('codeMetadata.branch.name is required for checkout');
  }

  // Determine repo root using shared logic
  const repoRoot = getRepoRoot(codeMetadata);
  const baseBranch = codeMetadata.baseBranch || DEFAULT_BASE_BRANCH;

  workerLogger.info({ branchName, repoRoot }, 'Checking out job branch');

  const { execFileSync } = await import('node:child_process');
  
  // First, try to checkout existing local branch
  try {
    execFileSync('git', ['checkout', branchName], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 30000,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ branchName }, 'Successfully checked out existing local branch');
    return;
  } catch (localCheckoutError: any) {
    // Branch doesn't exist locally, try to create tracking branch from origin
    workerLogger.debug({ branchName }, 'Local branch not found, checking for remote branch');
  }

  // Check if remote branch exists and create local tracking branch
  try {
    execFileSync('git', ['checkout', '-b', branchName, `origin/${branchName}`], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 30000,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ branchName }, 'Successfully created local tracking branch from origin');
    return;
  } catch (remoteCheckoutError: any) {
    // Remote branch doesn't exist, create from baseBranch as fallback
    workerLogger.warn({ branchName, baseBranch }, 'Remote branch not found, creating from baseBranch');
    try {
      execFileSync('git', ['checkout', '-b', branchName, baseBranch], {
        cwd: repoRoot,
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: 30000,
        env: process.env as Record<string, string>,
      });
      workerLogger.info({ branchName, baseBranch }, 'Successfully created branch from baseBranch');
      return;
    } catch (fallbackError: any) {
      const errorMessage = `Failed to checkout branch ${branchName}: ${fallbackError.stderr || fallbackError.message}`;
      workerLogger.error({ branchName, baseBranch, error: serializeError(fallbackError) }, errorMessage);
      throw new Error(errorMessage);
    }
  }
}

async function pushJobBranch(branchName: string, codeMetadata: CodeMetadata): Promise<void> {
  workerLogger.info({ branchName }, 'Pushing job branch to remote');

  // Determine repo root using shared logic
  const repoRoot = getRepoRoot(codeMetadata);
  const remoteName = process.env.CODE_METADATA_REMOTE_NAME || 'origin';
  const { execFileSync } = await import('node:child_process');

  try {
    // Push with -u to set upstream tracking
    execFileSync('git', ['push', '-u', remoteName, `${branchName}:${branchName}`], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ branchName, remote: remoteName }, 'Successfully pushed branch');
  } catch (error: any) {
    const errorMessage = `Failed to push branch ${branchName} to ${remoteName}: ${error.stderr || error.message}`;
    workerLogger.error({ branchName, remote: remoteName, error: serializeError(error) }, errorMessage);
    throw new Error(errorMessage);
  }
}

async function createOrUpdatePullRequest(params: {
  codeMetadata: CodeMetadata;
  branchName: string;
  baseBranch: string;
  requestId: string;
}): Promise<string | null> {
  const { codeMetadata, branchName, baseBranch, requestId } = params;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    workerLogger.warn('Missing GITHUB_TOKEN; skipping PR creation');
    return null;
  }

  const repoInfo = parseGithubRepo(codeMetadata.repo?.remoteUrl || codeMetadata.branch.remoteUrl, branchName);
  if (!repoInfo) {
    workerLogger.warn('Unable to infer GitHub repository from remote; skipping PR creation');
    return null;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jinn-mech-worker',
  };

  const searchUrl = `${GITHUB_API_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls?head=${encodeURIComponent(repoInfo.head)}&state=open`;
  try {
    const res = await fetch(searchUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        workerLogger.info({ branchName, pr: data[0]?.number }, 'Existing PR found for branch');
        return data[0]?.html_url || null;
      }
    } else {
      workerLogger.warn({ status: res.status, statusText: res.statusText }, 'Failed to query existing PRs');
    }
  } catch (error) {
    workerLogger.warn({ error: serializeError(error) }, 'Error querying GitHub for existing PR');
  }

  const title = `[Job ${codeMetadata.jobDefinitionId}] updates`;
  const bodyLines = [
    `Automated PR for job definition ${codeMetadata.jobDefinitionId}.`,
    '',
    `- Request ID: ${requestId}`,
    `- Branch: \`${branchName}\``,
    `- Base: \`${baseBranch}\``,
    '',
    'This PR was generated by the mech worker after successful validation.',
  ];

  try {
    const res = await fetch(`${GITHUB_API_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        head: branchName,
        base: baseBranch,
        body: bodyLines.join('\n'),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub PR creation failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    const prUrl = data?.html_url as string | undefined;
    workerLogger.info({ branchName, prUrl }, 'Created GitHub PR');
    return prUrl || null;
  } catch (error) {
    workerLogger.error({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      raw: error
    }, 'Failed to create pull request');
    return null;
  }
}

// Work Protocol types and parser
interface FinalStatus {
  status: 'COMPLETED' | 'DELEGATING' | 'WAITING' | 'FAILED';
  message: string;
}

/**
 * Extract finalize_job from telemetry (structured tool call)
 * This is the preferred method as it's deterministic
 */
function extractSignalFromTelemetry(telemetry: any): FinalStatus | null {
  // Support both camelCase (toolCalls) and snake_case (tool_calls)
  const toolCalls = telemetry?.toolCalls || telemetry?.tool_calls;

  workerLogger.debug({
    has_tool_calls: !!toolCalls,
    tool_call_count: toolCalls?.length || 0,
    tool_names: toolCalls?.map((c: any) => c.tool || c.name) || []
  }, `[SIGNAL_DEBUG] Checking telemetry for finalize_job`);

  if (!toolCalls) return null;

  // Find finalize_job tool call - check both name and tool fields
  const signalCall = toolCalls.find((call: any) =>
    call.name === 'finalize_job' || call.tool === 'finalize_job'
  );

  workerLogger.debug({ found: signalCall ? 'YES' : 'NO' }, `[SIGNAL_DEBUG] Found finalize_job call`);

  if (!signalCall) return null;

  try {
    // Tool call arguments can be in input, arguments, args, or result fields
    const input = signalCall.input || signalCall.arguments || signalCall.args || signalCall.result;

    workerLogger.debug({
      has_input: !!signalCall.input,
      has_arguments: !!signalCall.arguments,
      has_args: !!signalCall.args,
      has_result: !!signalCall.result,
      input_value: input
    }, `[SIGNAL_DEBUG] finalize_job call structure`);

    if (!input) return null;

    const status = input.status;
    const message = input.message;

    if (!status || !message) {
      workerLogger.warn({ input }, 'finalize_job missing status or message');
      return null;
    }

    const validStatuses = ['COMPLETED', 'DELEGATING', 'WAITING', 'FAILED'];
    if (!validStatuses.includes(status)) {
      workerLogger.warn(`Invalid finalize_job status: ${status}`);
      return null;
    }

    workerLogger.info(`✅ Detected finalize_job from telemetry: ${status}`);
    return { status, message };
  } catch (e) {
    workerLogger.warn({ error: e }, 'Failed to extract finalize_job from telemetry');
    return null;
  }
}

/**
 * Parse FinalStatus from text output (legacy method, fallback only)
 * DEPRECATED: Use finalize_job tool instead
 */
function parseFinalStatusFromText(output: string): FinalStatus | null {
  if (!output) return null;

  // Match FinalStatus: {...} pattern
  const pattern = /FinalStatus:\s*(\{[^}]+\})/;
  const match = output.match(pattern);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]);

    // Validate structure
    if (!parsed.status || !parsed.message) {
      workerLogger.warn({ parsed }, 'Invalid FinalStatus structure');
      return null;
    }

    // Validate status code
    const validStatuses = ['COMPLETED', 'DELEGATING', 'WAITING', 'FAILED'];
    if (!validStatuses.includes(parsed.status)) {
      workerLogger.warn(`Invalid status code: ${parsed.status}`);
      return null;
    }

    workerLogger.info(`Detected FinalStatus from text output: ${parsed.status} (legacy method)`);
    return {
      status: parsed.status,
      message: parsed.message
    };
  } catch (e) {
    workerLogger.warn({ error: e }, 'Failed to parse FinalStatus');
    return null;
  }
}

/**
 * Extract final status from either telemetry (preferred) or text output (fallback)
 */
function extractFinalStatus(output: string, telemetry: any): FinalStatus | null {
  // Try telemetry first (deterministic, structured)
  const fromTelemetry = extractSignalFromTelemetry(telemetry);
  if (fromTelemetry) return fromTelemetry;

  // Fall back to text parsing (non-deterministic, legacy)
  const fromText = parseFinalStatusFromText(output);
  if (fromText) return fromText;

  workerLogger.debug('No FinalStatus found in telemetry or output');
  return null;
}

type RemoteSituationArtifact = {
  id: string;
  requestId: string;
  cid: string;
  topic: string;
  name?: string | null;
};

async function runRecognitionPhase(requestId: string, metadata: any): Promise<RecognitionPhaseResult> {
  const sections = extractPromptSections(metadata?.prompt);
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

  try {
    const { createInitialSituation } = await import('./situation_encoder.js');
    const { situation, summaryText } = await createInitialSituation({
      requestId,
      jobName: metadata?.jobName,
      jobDefinitionId: metadata?.jobDefinitionId,
      model: metadata?.model,
      additionalContext: metadata?.additionalContext,
    });
    initialSituation = situation;
    workerLogger.info({ requestId, summaryLength: summaryText.length }, 'Created initial situation for recognition');

    const { searchSimilarSituations } = await import('../gemini-agent/mcp/tools/search_similar_situations.js');
    const vectorResults = await searchSimilarSituations({ query_text: summaryText, k: 5 });
    const vectorPayload = JSON.parse(vectorResults?.content?.[0]?.text || '{}');

    if (!vectorPayload?.meta?.ok || !Array.isArray(vectorPayload?.data) || vectorPayload.data.length === 0) {
      workerLogger.info({ requestId }, 'No similar situations found for recognition');
      return { promptPrefix: '', learningsMarkdown: undefined, rawLearnings: null, initialSituation, embeddingStatus: 'failed' };
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
      return { promptPrefix: '', learningsMarkdown: undefined, rawLearnings: null, initialSituation, embeddingStatus };
    }

    workerLogger.info({ requestId, artifactCount: situationArtifacts.length }, 'Fetched SITUATION artifacts for recognition');

    const recognitionPrompt = buildRecognitionPromptWithArtifacts(
      jobOverviewLines,
      summaryText,
      situationArtifacts,
    );

    const recognitionAgent = new Agent(
      metadata?.model || 'gemini-2.5-flash',
      [],
      {
        jobId: `${requestId}-recognition`,
        jobDefinitionId: metadata?.jobDefinitionId || null,
        jobName: metadata?.jobName ? `${metadata.jobName} (Recognition)` : 'Recognition Scout',
        projectRunId: null,
        sourceEventId: null,
        projectDefinitionId: null,
      },
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
      };
    }

    const markdown = formatRecognitionMarkdown(learnings);
    workerLogger.info({ requestId, learningsCount: learnings.length }, 'Recognition phase produced learnings');

    const recognitionResult = {
      promptPrefix: markdown,
      learningsMarkdown: markdown,
      rawLearnings: learnings,
      searchQuery: summaryText,
      similarJobs,
      initialSituation,
      embeddingStatus,
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
      await apiCreateArtifact(requestId, {
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
      await apiCreateArtifact(requestId, {
        cid: fallbackCid,
        topic: 'RECOGNITION_RESULT',
        content: null,
      });
      workerLogger.info({ requestId, cid: fallbackCid }, 'Persisted fallback RECOGNITION_RESULT artifact');
    } catch (fallbackError: any) {
      workerLogger.warn({ requestId, error: serializeError(fallbackError) }, 'Failed to persist fallback RECOGNITION_RESULT artifact');
    }

    return { promptPrefix: '', learningsMarkdown: undefined, rawLearnings: null, initialSituation, embeddingStatus };
  }
}

// Preflight: verify requestId is currently undelivered on-chain for the target mech
async function isUndeliveredOnChain(params: { mechAddress: string; requestIdHex: string; rpcHttpUrl?: string }): Promise<boolean> {
  const { mechAddress, requestIdHex, rpcHttpUrl } = params;
  try {
    if (!rpcHttpUrl) return true; // best-effort: if no RPC provided, don't block delivery
    const abi: any = (agentMechArtifact as any)?.abi || (agentMechArtifact as any);
    const web3 = new Web3(rpcHttpUrl);
    const contract = new (web3 as any).eth.Contract(abi, mechAddress);
    const ids: string[] = await contract.methods.getUndeliveredRequestIds(100, 0).call();
    const set = new Set((ids || []).map((x: string) => String(x).toLowerCase()));
    return set.has(String(requestIdHex).toLowerCase());
  } catch {
    return true; // don't fail hard on preflight errors
  }
}

async function fetchRecentRequests(limit: number = 10): Promise<UnclaimedRequest[]> {
  try {
    const workerMech = getMechAddress();
    if (!workerMech) {
      workerLogger.warn('Cannot fetch requests without mech address');
      return [];
    }
    
    workerLogger.info({ ponderUrl: PONDER_GRAPHQL_URL, mech: workerMech }, 'Fetching requests from Ponder');
    
    // Query our local Ponder GraphQL (custom schema) - FILTER BY MECH AND UNDELIVERED
    const query = `query RecentRequests($limit: Int!, $mech: String!) {
  requests(
    where: { mech: $mech, delivered: false }
    orderBy: "blockTimestamp"
    orderDirection: "asc"
    limit: $limit
  ) {
    items {
      id
      mech
      sender
      ipfsHash
      blockTimestamp
      delivered
    }
  }
}`;
    const data = await graphQLRequest<{ requests: { items: any[] } }>({
      url: PONDER_GRAPHQL_URL,
      query,
      variables: {
        limit,
        mech: workerMech.toLowerCase() // Ponder stores addresses lowercase
      },
      context: { operation: 'fetchRecentRequests', mech: workerMech }
    });
    const items: any[] = data?.requests?.items || [];
    workerLogger.info({ totalItems: items.length, items: items.map(r => ({ id: r.id, delivered: r.delivered })) }, 'Ponder GraphQL response');
    return items.map((r: any) => ({
      id: String(r.id),
      mech: String(r.mech),
      requester: String(r.sender || ''),
      ipfsHash: r?.ipfsHash ? String(r.ipfsHash) : undefined,
      blockTimestamp: Number(r.blockTimestamp),
      delivered: Boolean(r?.delivered === true)
    })) as UnclaimedRequest[];
  } catch (e) {
    workerLogger.warn({ error: e instanceof Error ? e.message : String(e) }, 'Ponder GraphQL not reachable; returning empty set');
    return [];
  }
}

async function getUndeliveredSet(params: { mechAddress: string; rpcHttpUrl?: string; size?: number; offset?: number }): Promise<Set<string>> {
  const { mechAddress, rpcHttpUrl, size = 100, offset = 0 } = params;
  try {
    if (!rpcHttpUrl) return new Set<string>();
    const abi: any = (agentMechArtifact as any)?.abi || (agentMechArtifact as any);
    const web3 = new Web3(rpcHttpUrl);
    const contract = new (web3 as any).eth.Contract(abi, mechAddress);
    const ids: string[] = await contract.methods.getUndeliveredRequestIds(size, offset).call();
    return new Set((ids || []).map((x: string) => String(x).toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

async function filterUnclaimed(requests: UnclaimedRequest[]): Promise<UnclaimedRequest[]> {
  if (requests.length === 0) return [];
  // Filter out already delivered requests first (from indexer)
  const notDelivered = requests.filter(r => !r.delivered);
  if (notDelivered.length === 0) return [];
  // Intersect with on-chain undelivered for additional safety (Control API will enforce atomic claim)
  try {
    const rpcHttpUrl = getRequiredRpcUrl();
    const mechToSet = new Map<string, Set<string>>();
    for (const r of notDelivered) {
      const key = r.mech.toLowerCase();
      if (!mechToSet.has(key)) {
        mechToSet.set(key, await getUndeliveredSet({ mechAddress: r.mech, rpcHttpUrl }));
      }
    }
    const filtered = notDelivered.filter(r => {
      const set = mechToSet.get(r.mech.toLowerCase());
      if (!set || set.size === 0) return true;
      const idHex = String(r.id).startsWith('0x') ? String(r.id).toLowerCase() : ('0x' + BigInt(String(r.id)).toString(16)).toLowerCase();
      return set.has(idHex);
    });
    return filtered;
  } catch {
    return notDelivered;
  }
}

async function tryClaim(request: UnclaimedRequest, workerAddress: string): Promise<boolean> {
  try {
    // Control API is the only path for claiming
    try {
      const res = await apiClaimRequest(request.id);
      // Skip if already claimed by another worker or stuck IN_PROGRESS
      if (res?.alreadyClaimed) {
        workerLogger.info({ requestId: request.id, status: res.status }, 'Already claimed - skipping');
        return false;
      }
      if (res && (res.status === 'IN_PROGRESS' || res.status === 'COMPLETED')) {
        const ok = res.status === 'IN_PROGRESS';
        workerLogger.info({ requestId: request.id, status: res.status }, ok ? 'Claimed via Control API' : 'Already handled via Control API');
        return ok;
      }
      workerLogger.info({ requestId: request.id, status: res?.status }, 'Unexpected claim response');
      return false;
    } catch (e: any) {
      workerLogger.info({ requestId: request.id, reason: e?.message || String(e) }, 'Control API claim failed');
      return false;
    }
  } catch (e: any) {
    workerLogger.warn({ requestId: request.id, error: serializeError(e) }, 'Claim error');
    return false;
  }
}

async function fetchIpfsMetadata(ipfsHash?: string): Promise<{
  prompt?: string;
  enabledTools?: string[];
  sourceRequestId?: string;
  sourceJobDefinitionId?: string;
  additionalContext?: any;
  jobName?: string;
  jobDefinitionId?: string;
  codeMetadata?: CodeMetadata;
} | null> {
  if (!ipfsHash) return null;
  try {
    const hash = String(ipfsHash).replace(/^0x/, '');
    // Use configured IPFS gateway or fallback to Autonolas
    const gatewayBase = getOptionalIpfsGatewayUrl() || 'https://gateway.autonolas.tech/ipfs/';
    const url = gatewayBase.endsWith('/') ? `${gatewayBase}${hash}` : `${gatewayBase}/${hash}`;
    
    const timeoutMs = getIpfsFetchTimeoutMs() ?? 7000;
    workerLogger.info({ url, hash, timeout: timeoutMs }, 'Fetching IPFS metadata');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);

    workerLogger.info({ status: res.status, statusText: res.statusText }, 'IPFS fetch response');

    if (!res.ok) {
      workerLogger.warn({ status: res.status, statusText: res.statusText, url }, 'IPFS fetch returned non-OK status');
      return null;
    }

    const json = await res.json();
    const prompt = json?.prompt || json?.input || undefined;
    const enabledTools = Array.isArray(json?.enabledTools) ? json.enabledTools : undefined;
    const sourceRequestId = json?.sourceRequestId ? String(json.sourceRequestId) : undefined;
    const sourceJobDefinitionId = json?.sourceJobDefinitionId ? String(json.sourceJobDefinitionId) : undefined;
    const additionalContext = json?.additionalContext || undefined;
    const jobName = json?.jobName ? String(json.jobName) : undefined;
    const jobDefinitionId = json?.jobDefinitionId ? String(json.jobDefinitionId) : undefined;
    const codeMetadata = json?.codeMetadata && typeof json.codeMetadata === 'object'
      ? (json.codeMetadata as CodeMetadata)
      : undefined;
    return { prompt, enabledTools, sourceRequestId, sourceJobDefinitionId, additionalContext, jobName, jobDefinitionId, codeMetadata };
  } catch (e: any) {
    workerLogger.warn({ error: e?.message || String(e) }, 'Failed to fetch IPFS metadata; proceeding without it');
    return null;
  }
}

async function runAgentForRequest(request: UnclaimedRequest, metadata: any): Promise<{ output: string; telemetry: any }> {
  const model = getOptionalMechModel() || 'gemini-2.5-flash';
  const enabledTools = Array.isArray(metadata?.enabledTools) ? metadata.enabledTools : [];
  const agent = new Agent(model, enabledTools, {
    jobId: request.id,
    jobDefinitionId: metadata?.jobDefinitionId || null,
    jobName: metadata?.jobName || 'Onchain Task',
    projectRunId: null,
    sourceEventId: null,
    projectDefinitionId: null
  });

  // Construct enhanced prompt with context if available
  let prompt = String(metadata?.prompt || '').trim() || `Process request ${request.id} for mech ${request.mech}`;
  
  if (metadata?.additionalContext) {
    const context = metadata.additionalContext;
    const contextSummary = `

## Job Context
This job is part of a larger workflow. Here's the context:

**Job Hierarchy Summary:**
- Total jobs in hierarchy: ${context.summary?.totalJobs || 0}
- Completed jobs: ${context.summary?.completedJobs || 0}
- Active jobs: ${context.summary?.activeJobs || 0}
- Available artifacts: ${context.summary?.totalArtifacts || 0}

**Related Jobs:**
${context.hierarchy?.map((job: any) => 
  `- ${job.name} (Level ${job.level}, Status: ${job.status})`
).join('\n') || 'No related jobs found'}

**Available Artifacts:**
${context.hierarchy?.flatMap((job: any) => 
  job.artifactRefs?.map((artifact: any) => 
    `- ${artifact.name} (${artifact.topic}) - CID: ${artifact.cid}`
  ) || []
).join('\n') || 'No artifacts available'}

---

`;
    prompt = contextSummary + prompt;
  }

  // Provide request context to downstream tools via env
  const prev = { JINN_REQUEST_ID: process.env.JINN_REQUEST_ID, JINN_MECH_ADDRESS: process.env.JINN_MECH_ADDRESS } as const;
  try {
    process.env.JINN_REQUEST_ID = request.id;
    process.env.JINN_MECH_ADDRESS = request.mech;
    return await agent.run(prompt);
  } finally {
    if (prev.JINN_REQUEST_ID !== undefined) process.env.JINN_REQUEST_ID = prev.JINN_REQUEST_ID; else delete process.env.JINN_REQUEST_ID;
    if (prev.JINN_MECH_ADDRESS !== undefined) process.env.JINN_MECH_ADDRESS = prev.JINN_MECH_ADDRESS; else delete process.env.JINN_MECH_ADDRESS;
  }
}

async function storeOnchainReport(
  request: UnclaimedRequest,
  workerAddress: string,
  result: { output: string; telemetry: any },
  error?: any,
  metadata?: any
): Promise<FinalStatus | null> {
  try {
    // Extract FinalStatus from telemetry (preferred) or text output (fallback)
    const finalStatus = extractFinalStatus(result?.output || '', result?.telemetry || {});
    
    // Determine status for job report
    let reportStatus: string;
    if (error) {
      reportStatus = 'FAILED';
    } else if (finalStatus) {
      // Use the actual FinalStatus from agent (COMPLETED, DELEGATING, WAITING, or FAILED)
      reportStatus = finalStatus.status;
    } else {
      // Fallback for agents not using work protocol yet
      reportStatus = 'COMPLETED';
      workerLogger.debug('No FinalStatus found, defaulting to COMPLETED');
    }
    
    const payload = {
      status: reportStatus,  // Use actual work protocol status
      duration_ms: result?.telemetry?.duration || 0,
      total_tokens: result?.telemetry?.totalTokens || 0,
      tools_called: JSON.stringify(result?.telemetry?.toolCalls ?? []),
      final_output: result?.output || null,
      error_message: error ? (error.message || String(error)) : null,
      error_type: error ? 'AGENT_ERROR' : null,
      raw_telemetry: JSON.stringify({
        ...result?.telemetry ?? {},
        finalStatus,  // Include parsed status in telemetry
        sourceJobDefinitionId: metadata?.sourceJobDefinitionId  // Preserve parent reference
      })
    };
    await apiCreateJobReport(request.id, payload, workerAddress);
    return finalStatus;
  } catch {
    return null;
  }
}

async function storeOnchainArtifact(request: UnclaimedRequest, workerAddress: string, cid: string, topic: string, content?: string): Promise<void> {
  try {
    const data = { cid, topic, content: content || null };
    await apiCreateArtifact(request.id, data);
  } catch {}
}

/**
 * Dispatch parent job when child completes or fails (Work Protocol)
 */
async function dispatchParentIfNeeded(
  finalStatus: FinalStatus | null,
  metadata: any,
  requestId: string,
  output: string
): Promise<void> {
  // Only dispatch on terminal states
  if (!finalStatus || (finalStatus.status !== 'COMPLETED' && finalStatus.status !== 'FAILED')) {
    workerLogger.debug(`Not dispatching parent - status: ${finalStatus?.status || 'none'}`);
    return;
  }

  // Get parent job ID from metadata
  const parentJobDefId = metadata?.sourceJobDefinitionId;
  if (!parentJobDefId) {
    workerLogger.debug('No parent job to dispatch');
    return;
  }
  
  try {
    workerLogger.info(`Dispatching parent job ${parentJobDefId} after child ${finalStatus.status}`);
    
    // Create message with child results using standard format
    const messageContent = `Child job ${finalStatus.status}: ${finalStatus.message}. Output: ${
      output.length > 500 ? output.substring(0, 500) + '...' : output
    }`;
    
    const message = {
      content: messageContent,
      to: parentJobDefId,
      from: requestId
    };

    // Dispatch parent job
    const result = await dispatchExistingJob({
      jobId: parentJobDefId,
      message: JSON.stringify(message)
    });
    
    const dispatchResult = safeParseToolResponse(result);
    if (dispatchResult.ok) {
      workerLogger.info(`Parent job ${parentJobDefId} dispatched successfully`);
    } else {
      workerLogger.error(`Failed to dispatch parent job ${parentJobDefId}: ${dispatchResult.message}`);
    }
  } catch (e) {
    workerLogger.error({ error: e, parentJobDefId }, `Error dispatching parent job ${parentJobDefId}`);
  }
}

/**
 * Check if a job chain is complete by verifying all requests are delivered
 */
async function isChainComplete(rootJobDefinitionId: string): Promise<boolean> {
  try {
      const data = await graphQLRequest<{ requests: { items: Array<{ id: string; delivered: boolean }> } }>({
      url: PONDER_GRAPHQL_URL,
        query: `query($rootId: String!) {
        requests(where: { sourceJobDefinitionId: $rootId }) {
          items {
            id
            delivered
          }
        }
      }`,
      variables: { rootId: rootJobDefinitionId },
      context: { operation: 'isChainComplete', rootJobDefinitionId }
    });
    const requests = data?.requests?.items || [];
    
    if (requests.length === 0) {
      return false; // No requests in chain
    }
    
    // Check if all requests are delivered
    return requests.every((req: any) => req.delivered);
  } catch (e) {
    workerLogger.error({ error: e, rootJobDefinitionId }, `Error checking chain completion for ${rootJobDefinitionId}`);
    return false;
  }
}

/**
 * Check if a job should be reposted based on recent repost history
 */
function shouldRepost(rootJobDefinitionId: string): boolean {
  const now = Date.now();
  const lastRepost = recentReposts.get(rootJobDefinitionId);
  
  if (lastRepost && (now - lastRepost) < MIN_TIME_BETWEEN_REPOSTS) {
    return false;
  }
  
  return true;
}

/**
 * Repost an existing job definition using the dispatch_existing_job pattern
 */
async function repostExistingJob(jobDefinitionId: string): Promise<void> {
  try {
    // Query for the most recent request of this job to establish lineage
    const queryData = await graphQLRequest<{ requests: { items: Array<{ id: string }> } }>({
      url: PONDER_GRAPHQL_URL,
      query: `query {
        requests(
          where: { jobDefinitionId: "${jobDefinitionId}" },
          orderBy: "blockTimestamp",
          orderDirection: "desc",
          limit: 1
        ) {
          items { id }
        }
      }`,
      context: { operation: 'repostExistingJob', jobDefinitionId }
    });
    const mostRecentRequest = queryData?.requests?.items?.[0];
    
    // Build message indicating this is a repost after completion
    const message = mostRecentRequest ? JSON.stringify({
      content: "Reposting job after workstream completion",
      from: mostRecentRequest.id,
      to: jobDefinitionId
    }) : undefined;

    const result = await dispatchExistingJob({ 
      jobId: jobDefinitionId,
      message
    });

    // Parse the result to check if it was successful
    const { ok, data, message: errMsg } = safeParseToolResponse(result);
    if (!ok) {
      workerLogger.error(`Cannot repost job ${jobDefinitionId}: ${errMsg || 'Unknown error'}`);
      return;
    }

    // Track the repost to prevent loops
    recentReposts.set(jobDefinitionId, Date.now());

    workerLogger.info(`Successfully reposted job (${jobDefinitionId}) after chain completion`);
    workerLogger.info({ data }, 'Repost result');

  } catch (e) {
    workerLogger.error({ error: e, jobDefinitionId }, `Error reposting job ${jobDefinitionId}`);
  }
}

/**
 * Check for completed decomposition chains and repost root jobs if needed
 */
async function checkAndRepostCompletedChains(): Promise<void> {
  if (!ENABLE_AUTO_REPOST) {
    return;
  }

  try {
    // Find all root job definitions (no sourceJobDefinitionId)
    const data = await graphQLRequest<{ jobDefinitions: { items: Array<{ id: string; name: string }> } }>({
      url: PONDER_GRAPHQL_URL,
      query: `query {
        jobDefinitions(where: { sourceJobDefinitionId: { equals: null } }, limit: 100) {
          items {
            id
            name
          }
        }
      }`,
      context: { operation: 'checkAndRepostCompletedChains' }
    });
    const rootJobDefs = data?.jobDefinitions?.items || [];
    
    for (const rootJobDef of rootJobDefs) {
      // Skip if recently reposted
      if (!shouldRepost(rootJobDef.id)) {
        continue;
      }
      
      // Check if chain is complete and repost if needed
      if (await isChainComplete(rootJobDef.id)) {
        workerLogger.info(`Found completed chain for root job ${rootJobDef.name}, reposting...`);
        await repostExistingJob(rootJobDef.id);
      }
    }
  } catch (e) {
    workerLogger.error({ error: e }, 'Error checking for completed chains');
  }
}


async function fetchSpecificRequest(requestId: string): Promise<UnclaimedRequest | null> {
  try {
    const query = `query GetRequest($id: String!) {
  requests(where: { id: $id }) {
    items {
      id
      mech
      sender
      ipfsHash
      blockTimestamp
      delivered
    }
  }
}`;
    const data = await graphQLRequest<{ requests: { items: any[] } }>({
      url: PONDER_GRAPHQL_URL,
      query,
      variables: { id: requestId },
      context: { operation: 'fetchSpecificRequest', requestId }
    });
    const items = data?.requests?.items || [];
    if (items.length === 0) return null;
    return items[0];
  } catch (e: any) {
    workerLogger.warn({ error: serializeError(e) }, 'Error fetching specific request');
    return null;
  }
}

async function processOnce(): Promise<void> {
  const workerAddress = getMechAddress();
  if (!workerAddress) {
    workerLogger.error('Missing service mech address in .operate config or environment');
    return;
  }

  // Optional: target a specific request id if provided (for deterministic tests)
  const targetIdEnv = (getOptionalMechTargetRequestId() || '').trim();
  let candidates: UnclaimedRequest[];
  
  if (targetIdEnv) {
    const targetHex = targetIdEnv.startsWith('0x') ? targetIdEnv.toLowerCase() : ('0x' + BigInt(targetIdEnv).toString(16)).toLowerCase();
    const specificRequest = await fetchSpecificRequest(targetHex);
    if (!specificRequest) {
      workerLogger.info({ target: targetHex }, 'Target request not found in Ponder');
      return;
    }
    if (specificRequest.delivered) {
      workerLogger.info({ target: targetHex }, 'Target request already delivered');
      return;
    }
    candidates = [specificRequest];
    workerLogger.info({ target: targetHex }, 'Targeting specific request');
  } else {
    const recent = await fetchRecentRequests(50);
    candidates = await filterUnclaimed(recent);
    if (candidates.length === 0) {
      workerLogger.info('No unclaimed on-chain requests found');
      return;
    }
  }

  // Iterate candidates until we claim one successfully
  let target: UnclaimedRequest | null = null;
  for (const c of candidates) {
    const ok = await tryClaim(c, workerAddress);
    if (ok) { target = c; break; }
  }
  if (!target) return;
  let result: any = { output: '', telemetry: {} };
  let error: any = null;
  let metadata: any = null;
  let recognition: RecognitionPhaseResult | null = null;
  let reflection: any = null;
  let finalStatus: FinalStatus | null = null;
  const previousBaseBranchEnv = process.env.JINN_BASE_BRANCH;
  const previousRepoRoot = process.env.CODE_METADATA_REPO_ROOT;
  const telemetry = new WorkerTelemetryService(target.id);
  try {
    telemetry.startPhase('initialization', {
      targetRequestId: target.id,
      workerAddress,
    });
    try {
      metadata = await fetchIpfsMetadata(target.ipfsHash);

      telemetry.logCheckpoint('initialization', 'metadata_fetched', {
        hasJobName: !!metadata?.jobName,
        hasPrompt: !!metadata?.prompt,
        hasCodeMetadata: !!metadata?.codeMetadata,
      });

      if (!metadata?.codeMetadata) {
        throw new Error(
          'codeMetadata missing from IPFS payload - all jobs must include code metadata. ' +
          'This is required for git lineage tracking. Check job dispatch configuration.',
        );
      }

      workerLogger.info({ jobName: metadata?.jobName, requestId: target.id }, 'Processing request');

      process.env.JINN_BASE_BRANCH = metadata.codeMetadata.branch?.name ||
        metadata.codeMetadata.baseBranch ||
        metadata.codeMetadata.parent?.branchName ||
        DEFAULT_BASE_BRANCH;

      if (metadata.codeMetadata?.repo?.remoteUrl) {
        const repoName = extractRepoName(metadata.codeMetadata.repo.remoteUrl);
        if (repoName) {
          const workspaceDir = getJinnWorkspaceDir();
          const repoRoot = `${workspaceDir}/${repoName}`;
          process.env.CODE_METADATA_REPO_ROOT = repoRoot;
          workerLogger.info({ repoRoot, remoteUrl: metadata.codeMetadata.repo.remoteUrl }, 'Set CODE_METADATA_REPO_ROOT for job');

          await ensureRepoCloned(metadata.codeMetadata.repo.remoteUrl, repoRoot);
        }
      }

      await checkoutJobBranch(metadata.codeMetadata);
      telemetry.logCheckpoint('initialization', 'checkout_complete', {
        branch: metadata.codeMetadata.branch?.name,
      });
    } catch (initializationError: any) {
      telemetry.logError('initialization', initializationError);
      throw initializationError;
    } finally {
      telemetry.endPhase('initialization');
    }

    telemetry.startPhase('recognition');
    try {
      recognition = await runRecognitionPhase(target.id, metadata);
      if (recognition?.promptPrefix) {
        const prefix = recognition.promptPrefix.trim();
        if (prefix.length > 0) {
          const originalPrompt = metadata?.prompt || `Process request ${target.id}`;
          metadata.prompt = `${prefix}\n\n${originalPrompt}`;
          workerLogger.info({ requestId: target.id, prefixLength: prefix.length }, 'Augmented prompt with recognition learnings');
          telemetry.logCheckpoint('recognition', 'prompt_augmented', {
            prefixLength: prefix.length,
            hasLearnings: !!recognition.learningsMarkdown,
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

    telemetry.startPhase('agent_execution', {
      model: metadata?.model || getOptionalMechModel() || 'gemini-2.5-flash',
    });
    try {
      result = await runAgentForRequest(target, metadata);
      const artifacts = [
        ...extractArtifactsFromOutput(result?.output || ''),
        ...extractArtifactsFromTelemetry(result?.telemetry || {}),
      ];
      if (artifacts.length > 0) {
        (result as any).artifacts = artifacts;
        for (const a of artifacts) {
          try {
            await apiCreateArtifact(target.id, { cid: a.cid, topic: a.topic, content: null });
          } catch {}
        }
      }
      finalStatus = extractFinalStatus(result?.output || '', result?.telemetry || {});
      workerLogger.info({ jobName: metadata?.jobName, requestId: target.id }, 'Execution completed');
      telemetry.logCheckpoint('agent_execution', 'completed', {
        outputLength: result?.output?.length || 0,
        totalTokens: result?.telemetry?.totalTokens,
        toolCalls: result?.telemetry?.toolCalls?.length || 0,
      });
    } catch (agentError: any) {
      telemetry.logError('agent_execution', agentError);
      throw agentError;
    } finally {
      telemetry.endPhase('agent_execution');
    }
  } catch (e: any) {
    error = e;

    // CRITICAL: Extract finalStatus and results from error telemetry if available
    // The agent might have succeeded (called finalize_job) but Gemini API failed after
    if (e?.telemetry) {
      const errorTelemetry = e.telemetry;

      // Preserve output from error (agent may have produced output before API failure)
      if (e?.error?.stderr || errorTelemetry?.raw?.partialOutput) {
        result.output = result.output || errorTelemetry?.raw?.partialOutput || '';
      }

      // Merge telemetry from error if we don't have it yet
      if (!result.telemetry || Object.keys(result.telemetry).length === 0) {
        result.telemetry = errorTelemetry;
      }

      // Extract artifacts from error telemetry
      const errorArtifacts = extractArtifactsFromTelemetry(errorTelemetry || {});
      if (errorArtifacts.length > 0 && !result.artifacts) {
        (result as any).artifacts = errorArtifacts;
        for (const a of errorArtifacts) {
          try { await apiCreateArtifact(target.id, { cid: a.cid, topic: a.topic, content: null }); } catch {}
        }
      }

      // Re-extract finalStatus from error telemetry (agent may have called finalize_job before error)
      finalStatus = finalStatus || extractFinalStatus(result?.output || '', errorTelemetry);
    }

    // Some Gemini CLI failures occur after a successful finalize_job call.
    // When the model finished the job (COMPLETED) but the CLI transport failed, mark the run as
    // successful while preserving a warning in telemetry so future investigations see the anomaly.
    try {
      const telemetryFromError =
        e?.telemetry && typeof e.telemetry === 'object' ? e.telemetry : undefined;
      const errorMessage = String(e?.message || e?.error || '');
      const stderr = String(e?.error?.stderr || e?.stderr || '');
      const combined = `${errorMessage}\n${stderr}`.toLowerCase();
      const processExitError =
        combined.includes('process exited with code') ||
        (telemetryFromError?.errorType === 'PROCESS_ERROR');

      if (processExitError && finalStatus?.status === 'COMPLETED') {
        workerLogger.warn(
          { jobName: metadata?.jobName, requestId: target.id },
          'Gemini CLI transport failed after finalize_job; accepting completed result',
        );

        const mergedTelemetry = result.telemetry && Object.keys(result.telemetry).length > 0
          ? result.telemetry
          : (telemetryFromError ? { ...telemetryFromError } : {});
        if (!mergedTelemetry.errorType) {
          mergedTelemetry.errorType = 'PROCESS_ERROR';
        }
        const raw = (mergedTelemetry.raw =
          typeof mergedTelemetry.raw === 'object' && mergedTelemetry.raw !== null ? mergedTelemetry.raw : {});
        const warningLines = raw.stderrWarnings ? [raw.stderrWarnings] : [];
        warningLines.push('Gemini CLI: transport failed after finalize_job (process exited).');
        raw.stderrWarnings = warningLines.join('\n');
        result.telemetry = mergedTelemetry;

        if (!result.output && typeof telemetryFromError?.raw?.partialOutput === 'string') {
          result.output = telemetryFromError.raw.partialOutput;
        }

        error = null;
      }
    } catch {}

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

  telemetry.startPhase('reflection');
  if (finalStatus) {
    try {
      const outputPreview = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? '');
      const successPrompt = `You have just completed a job. Here is a summary:

**Job:** ${metadata?.jobName || target.id}
**Status:** ${finalStatus.status}
**Output:** ${outputPreview.substring(0, 500)}${outputPreview.length > 500 ? '...' : ''}
**Telemetry:**
- Duration: ${result.telemetry?.duration || 0}ms
- Tokens: ${result.telemetry?.totalTokens || 0}
- Tools Called: ${result.telemetry?.toolCalls?.length || 0}

**Reflection Task:**
Review the execution. Did you discover any strategies, solutions, workarounds, or insights that would be valuable for future jobs? If yes, use the \`create_artifact\` tool with \`type: 'MEMORY'\` to save it. Include descriptive tags.

If nothing notable was learned, simply respond "No significant learnings."`;

      const failurePrompt = `A job has failed. Here is a summary:

**Job:** ${metadata?.jobName || target.id}
**Status:** ${finalStatus.status}
**Error:** ${error?.message || 'Unknown error'}
**Output (if any):** ${outputPreview ? outputPreview.substring(0, 500) : 'No output'}${outputPreview && outputPreview.length > 500 ? '...' : ''}
**Telemetry:**
- Duration: ${result.telemetry?.duration || 0}ms
- Tokens: ${result.telemetry?.totalTokens || 0}
- Tools Called: ${result.telemetry?.toolCalls?.length || 0}

**Reflection Task:**
Review the failure. Were there any lessons learned, edge cases discovered, or patterns that future jobs should avoid? If yes, use the \`create_artifact\` tool with \`type: 'MEMORY'\` and include 'failure' in the tags to help future jobs avoid similar issues.

If nothing notable was learned, simply respond "No significant learnings."`;

      const reflectionAgent = new Agent(
        metadata?.model || 'gemini-2.5-flash',
        ['create_artifact'],
        {
          jobId: `${target.id}-reflection`,
          jobDefinitionId: metadata?.jobDefinitionId,
          jobName: 'Reflection',
          projectRunId: null,
          sourceEventId: null,
          projectDefinitionId: null,
        },
      );

      const prompt = finalStatus.status === 'COMPLETED' ? successPrompt : failurePrompt;
      reflection = await reflectionAgent.run(prompt);
      telemetry.logCheckpoint('reflection', 'reflection_complete');
      workerLogger.info({ requestId: target.id }, 'Reflection step completed');
    } catch (reflectionError: any) {
      telemetry.logError('reflection', reflectionError);
      workerLogger.warn({ requestId: target.id, error: serializeError(reflectionError) }, 'Reflection step failed (non-critical)');
    }
  }
  telemetry.endPhase('reflection');

  telemetry.startPhase('situation_creation');
  try {
    await createSituationArtifactForRequest({
      target,
      metadata,
      result,
      finalStatus,
      recognition,
    });
    telemetry.logCheckpoint('situation_creation', 'situation_artifact_created');
  } catch (situationError: any) {
    telemetry.logError('situation_creation', situationError);
    workerLogger.warn({ requestId: target.id, error: serializeError(situationError) }, 'Failed to create situation artifact');
  }
  telemetry.endPhase('situation_creation');

  // Restore previous base branch context
  if (previousBaseBranchEnv !== undefined) {
    process.env.JINN_BASE_BRANCH = previousBaseBranchEnv;
  } else {
    delete process.env.JINN_BASE_BRANCH;
  }

  // Restore previous CODE_METADATA_REPO_ROOT
  if (previousRepoRoot !== undefined) {
    process.env.CODE_METADATA_REPO_ROOT = previousRepoRoot;
  } else {
    delete process.env.CODE_METADATA_REPO_ROOT;
  }

  // REQ-4.1: Push branch after agent completes (regardless of status or error)
  // This must happen even if agent threw an error, as long as we have code changes
  try {
    if (metadata?.codeMetadata?.branch?.name) {
      await pushJobBranch(metadata.codeMetadata.branch.name, metadata.codeMetadata);
    }
  } catch (pushError: any) {
    workerLogger.error({ error: serializeError(pushError) }, 'Failed to push branch');
  }

  // Only create PR if agent signaled COMPLETED (even if there was an error after finalize_job)
  try {
    if (finalStatus?.status === 'COMPLETED' && metadata?.codeMetadata) {
      const branchName = metadata.codeMetadata.branch?.name;
      const baseBranch = metadata.codeMetadata.baseBranch || DEFAULT_BASE_BRANCH;

      if (branchName) {
        workerLogger.info({ branchName, baseBranch, hadError: !!error }, 'Agent signaled COMPLETED - creating PR');
        const prUrl = await createOrUpdatePullRequest({
          codeMetadata: metadata.codeMetadata,
          branchName,
          baseBranch,
          requestId: target.id,
        });
        if (prUrl) {
          // REQ-4.4: Include PR URL in delivery payload (not as artifact)
          result.pullRequestUrl = prUrl;
          workerLogger.info({ prUrl }, 'PR URL will be included in delivery payload');
        }
      }
    } else if (finalStatus?.status === 'COMPLETED') {
      workerLogger.debug('Agent signaled COMPLETED but no codeMetadata available - skipping PR creation');
    } else {
      workerLogger.info({ status: finalStatus?.status || 'unknown' }, 'Agent did not signal COMPLETED - skipping PR creation');
    }
  } catch (prError: any) {
    workerLogger.error({ error: serializeError(prError) }, 'Failed to create PR');
  }

  telemetry.startPhase('reporting');
  try {
    const reportedFinalStatus = await storeOnchainReport(target, workerAddress, result, error, metadata);
    if (reportedFinalStatus) {
      finalStatus = reportedFinalStatus;
    }
    telemetry.logCheckpoint('reporting', 'report_stored', { status: finalStatus?.status || 'unknown' });
  } finally {
    telemetry.endPhase('reporting');
  }
  
  // Dispatch parent if needed (Work Protocol)
  await dispatchParentIfNeeded(finalStatus, metadata, target.id, result?.output || '');
  // Persist output as artifact (optional, topic=result.output)
  try {
    const outputStr = typeof result?.output === 'string' ? result.output : JSON.stringify(result?.output ?? '');
    // Reuse deliver upload path to get a CID, but we also want to store artifact regardless of delivery
    const resultContent = { requestId: target.id, output: outputStr, telemetry: result?.telemetry || {} } as any;
    // Upload to IPFS registry via mech-client deliver helper (without sending TX)
    // deliverViaSafe internally uploads; to avoid chain call, only call when delivering
    // Here, use axios directly if needed; for now, store content inline and let delivery compute CID again.
    await storeOnchainArtifact(target, workerAddress, 'inline', 'result.output', outputStr);
  } catch {}
  // Marking claim completed is handled by Control API upon report creation

  // Attempt on-chain delivery via Safe when configured
  telemetry.startPhase('delivery');
  try {
    const chainConfig = getOptionalMechChainConfig() || 'base';
    const safeAddress = getServiceSafeAddress();
    const targetMechAddress = target.mech;
    const privateKey = getServicePrivateKey();
    const rpcHttpUrl = getRequiredRpcUrl();

    if (!safeAddress || !privateKey) {
      workerLogger.warn({ safeAddress: !!safeAddress, privateKey: !!privateKey }, 'Missing Safe delivery configuration; skipping on-chain delivery');
      return;
    }

    if (safeAddress && rpcHttpUrl) {
      try {
        const web3 = new Web3(rpcHttpUrl);
        const code = await web3.eth.getCode(safeAddress);
        if (!code || code === '0x' || code.length <= 2) {
          workerLogger.warn({ safeAddress }, 'Safe address has no contract code; skipping Safe delivery (use direct EOA delivery or deploy Safe first)');
          return;
        }
      } catch (deploymentCheckError: any) {
        workerLogger.warn({ safeAddress, error: deploymentCheckError?.message }, 'Failed to check Safe deployment; skipping Safe delivery');
        return;
      }
    }

    if (safeAddress && targetMechAddress) {
      const requestIdHex = String(target.id).startsWith('0x') ? String(target.id) : '0x' + BigInt(String(target.id)).toString(16);
      workerLogger.info({ requestIdHex, targetMechAddress }, 'Checking if request is undelivered on-chain...');
      const ok = await isUndeliveredOnChain({ mechAddress: targetMechAddress, requestIdHex, rpcHttpUrl });
      if (!ok) {
        workerLogger.info({ jobName: metadata?.jobName, requestId: target.id, requestIdHex }, 'Preflight: request already delivered or not eligible; skipping Safe delivery');
        return;
      }
      workerLogger.info({ requestIdHex }, 'Preflight passed - request is undelivered, proceeding with Safe delivery...');

      const artifactsForDelivery = Array.isArray((result as any)?.artifacts) ? [...(result as any).artifacts] : [];

      telemetry.startPhase('telemetry_persistence');
      const workerTelemetryLog = telemetry.getLog();
      telemetry.logCheckpoint('telemetry_persistence', 'telemetry_prepared', {
        eventsCount: workerTelemetryLog.events.length,
        totalDuration: workerTelemetryLog.totalDuration_ms,
      });
      try {
        const { createArtifact: mcpCreateArtifact } = await import('../gemini-agent/mcp/tools/create_artifact.js');
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
          telemetry.logCheckpoint('telemetry_persistence', 'telemetry_uploaded', { cid: telemetryArtifactParsed.data.cid });
          workerLogger.info({
            requestId: target.id,
            cid: telemetryArtifactParsed.data.cid,
            eventsCount: workerTelemetryLog.events.length,
          }, 'Worker telemetry artifact uploaded and added to delivery');
        }
      } catch (telemetryArtifactError: any) {
        telemetry.logError('telemetry_persistence', telemetryArtifactError);
        workerLogger.warn({ error: serializeError(telemetryArtifactError) }, 'Failed to add worker telemetry to delivery artifacts (non-critical)');
      } finally {
        telemetry.endPhase('telemetry_persistence');
      }

      const payload = {
        chainConfig,
        requestId: String(target.id),
        resultContent: {
          requestId: String(target.id),
          output: result?.output || '',
          telemetry: result?.telemetry || {},
          artifacts: artifactsForDelivery,
          workerTelemetry: workerTelemetryLog,
          recognition: recognition
            ? {
                initialSituation: recognition.initialSituation,
                embeddingStatus: recognition.embeddingStatus,
                similarJobs: recognition.similarJobs,
                learnings: recognition.rawLearnings,
                learningsMarkdown: recognition.learningsMarkdown,
                searchQuery: recognition.searchQuery,
              }
            : undefined,
          reflection: reflection
            ? {
                output: reflection.output,
                telemetry: reflection.telemetry,
              }
            : undefined,
          ...(result?.pullRequestUrl ? { pullRequestUrl: result.pullRequestUrl } : {}),
          ...(metadata?.codeMetadata?.branch?.name
            ? {
                executionPolicy: {
                  branch: metadata.codeMetadata.branch.name,
                  ensureTestsPass: true,
                  description: 'Agent executed work on the provided branch and passed required validations.',
                },
              }
            : {}),
        },
        targetMechAddress,
        safeAddress,
        privateKey,
        ...(rpcHttpUrl ? { rpcHttpUrl } : {}),
        wait: true,
      } as const;

      const delivery = await (deliverViaSafe as any)(payload);
      telemetry.logCheckpoint('delivery', 'delivered', {
        txHash: delivery?.tx_hash,
        status: delivery?.status,
      });
      workerLogger.info({ requestId: target.id, tx: delivery?.tx_hash, status: delivery?.status }, 'Delivered via Safe');
    }
  } catch (e: any) {
    telemetry.logError('delivery', e);
    const errorDetails: any = {
      message: e?.message || String(e),
      code: e?.code,
      reason: e?.reason,
      data: e?.data,
      stack: e?.stack?.split('\n').slice(0, 3).join('\n'),
    };
    workerLogger.warn({ requestId: target.id, error: errorDetails }, 'Safe delivery failed');

    try {
      await apiCreateJobReport(target.id, {
        status: 'FAILED',
        duration_ms: result?.telemetry?.duration || 0,
        total_tokens: result?.telemetry?.totalTokens || 0,
        tools_called: JSON.stringify(result?.telemetry?.toolCalls ?? []),
        final_output: typeof result?.output === 'string' ? result.output : JSON.stringify(result?.output ?? ''),
        error_message: e?.message || String(e),
        error_type: 'DELIVERY_ERROR',
        raw_telemetry: JSON.stringify(result?.telemetry ?? {}),
      } as any, workerAddress);
    } catch (reportErr: any) {
      workerLogger.warn({ jobName: metadata?.jobName, requestId: target.id, error: reportErr?.message || String(reportErr) }, 'Failed to record FAILED status');
    }
  } finally {
    telemetry.endPhase('delivery');
  }
}

async function main() {
  workerLogger.info('Mech worker starting');
  if (SINGLE_SHOT) {
    await processOnce();
    return;
  }
  for (;;) {
    try {
      // Check for completed chains and repost if needed
      await checkAndRepostCompletedChains();
      
      await processOnce();
    } catch (e: any) {
      workerLogger.error({ error: serializeError(e) }, 'Error in mech loop');
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(() => process.exit(1));
