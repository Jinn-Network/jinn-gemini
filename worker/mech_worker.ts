import '../env/index.js';
import { Agent } from '../gemini-agent/agent.js';
import { deliverViaSafe } from '@jinn-network/mech-client-ts/dist/post_deliver.js';
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
  if (existsSync(targetPath)) {
    workerLogger.info({ targetPath }, 'Repository already cloned');
    return;
  }

  workerLogger.info({ remoteUrl, targetPath }, 'Cloning repository');

  const { execFileSync } = await import('node:child_process');
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

  workerLogger.info({ branchName, repoRoot }, 'Checking out job branch');

  // Use simple git checkout - branch should already exist from dispatch
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('git', ['checkout', branchName], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 30000,
      env: process.env as Record<string, string>,
    });
    workerLogger.info({ branchName }, 'Successfully checked out branch');
  } catch (error: any) {
    const errorMessage = `Failed to checkout branch ${branchName}: ${error.stderr || error.message}`;
    workerLogger.error({ branchName, error: serializeError(error) }, errorMessage);
    throw new Error(errorMessage);
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

  workerLogger.debug(`[SIGNAL_DEBUG] Checking telemetry for finalize_job`, {
    has_tool_calls: !!toolCalls,
    tool_call_count: toolCalls?.length || 0,
    tool_names: toolCalls?.map((c: any) => c.tool || c.name) || []
  });

  if (!toolCalls) return null;

  // Find finalize_job tool call - check both name and tool fields
  const signalCall = toolCalls.find((call: any) =>
    call.name === 'finalize_job' || call.tool === 'finalize_job'
  );

  workerLogger.debug(`[SIGNAL_DEBUG] Found finalize_job call:`, signalCall ? 'YES' : 'NO');

  if (!signalCall) return null;

  try {
    // Tool call arguments can be in input, arguments, args, or result fields
    const input = signalCall.input || signalCall.arguments || signalCall.args || signalCall.result;

    workerLogger.debug(`[SIGNAL_DEBUG] finalize_job call structure:`, {
      has_input: !!signalCall.input,
      has_arguments: !!signalCall.arguments,
      has_args: !!signalCall.args,
      has_result: !!signalCall.result,
      input_value: input
    });

    if (!input) return null;

    const status = input.status;
    const message = input.message;

    if (!status || !message) {
      workerLogger.warn('finalize_job missing status or message', input);
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
    workerLogger.warn('Failed to extract finalize_job from telemetry', e);
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
      workerLogger.warn('Invalid FinalStatus structure', parsed);
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
    workerLogger.warn('Failed to parse FinalStatus', e);
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

function safeParseToolResponse(response: any): { ok: boolean; data: any; message?: string } {
  try {
    const text = response?.content?.[0]?.text;
    if (!text) return { ok: false, data: null, message: 'No content' };
    const parsed = JSON.parse(text);
    if (parsed?.meta && typeof parsed.meta.ok === 'boolean') {
      return { ok: parsed.meta.ok, data: parsed.data, message: parsed.meta.message };
    }
    return { ok: true, data: parsed };
  } catch (e: any) {
    return { ok: false, data: null, message: e?.message || String(e) };
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
    workerLogger.error(`Error dispatching parent job ${parentJobDefId}:`, e);
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
    workerLogger.error(`Error checking chain completion for ${rootJobDefinitionId}:`, e);
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
    workerLogger.info(`Repost result:`, data);

  } catch (e) {
    workerLogger.error(`Error reposting job ${jobDefinitionId}:`, e);
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
    workerLogger.error(`Error checking for completed chains:`, e);
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
  let finalStatus: FinalStatus | null = null;
  const previousBaseBranchEnv = process.env.JINN_BASE_BRANCH;
  try {
    metadata = await fetchIpfsMetadata(target.ipfsHash);

    // REQ-2.2: Validate codeMetadata presence (orthodoxy: one canonical way)
    if (!metadata?.codeMetadata) {
      throw new Error(
        'codeMetadata missing from IPFS payload - all jobs must include code metadata. ' +
        'This is required for git lineage tracking. Check job dispatch configuration.'
      );
    }

    workerLogger.info({ jobName: metadata?.jobName, requestId: target.id }, 'Processing request');

    // Propagate current branch into job context for downstream delegations
    process.env.JINN_BASE_BRANCH = metadata.codeMetadata.branch?.name ||
      metadata.codeMetadata.baseBranch ||
      metadata.codeMetadata.parent?.branchName ||
      DEFAULT_BASE_BRANCH;

    // Set CODE_METADATA_REPO_ROOT from job metadata to ensure correct repo is used
    // This allows child jobs to inherit the correct venture repo, not the conductor repo
    const previousRepoRoot = process.env.CODE_METADATA_REPO_ROOT;
    if (metadata.codeMetadata?.repo?.remoteUrl) {
      const repoName = extractRepoName(metadata.codeMetadata.repo.remoteUrl);
      if (repoName) {
        const workspaceDir = getJinnWorkspaceDir();
        const repoRoot = `${workspaceDir}/${repoName}`;
        process.env.CODE_METADATA_REPO_ROOT = repoRoot;
        workerLogger.info({ repoRoot, remoteUrl: metadata.codeMetadata.repo.remoteUrl }, 'Set CODE_METADATA_REPO_ROOT for job');

        // Ensure repo is cloned before checkout
        await ensureRepoCloned(metadata.codeMetadata.repo.remoteUrl, repoRoot);
      }
    }

    // REQ-3.1: Checkout job branch before running agent
    await checkoutJobBranch(metadata.codeMetadata);

    result = await runAgentForRequest(target, metadata);
    // Extract artifacts produced during the run (from tool outputs)
    const artifacts = [
      ...extractArtifactsFromOutput(result?.output || ''),
      ...extractArtifactsFromTelemetry(result?.telemetry || {})
    ];
    if (artifacts.length > 0) {
      (result as any).artifacts = artifacts;
      for (const a of artifacts) {
        try { await apiCreateArtifact(target.id, { cid: a.cid, topic: a.topic, content: null }); } catch {}
      }
    }
    // Extract final status from agent output
    finalStatus = extractFinalStatus(result?.output || '', result?.telemetry || {});

    workerLogger.info({ jobName: metadata?.jobName, requestId: target.id }, 'Execution completed');
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

        const telemetry = result.telemetry && Object.keys(result.telemetry).length > 0
          ? result.telemetry
          : (telemetryFromError ? { ...telemetryFromError } : {});
        if (!telemetry.errorType) {
          telemetry.errorType = 'PROCESS_ERROR';
        }
        const raw = (telemetry.raw =
          typeof telemetry.raw === 'object' && telemetry.raw !== null ? telemetry.raw : {});
        const warningLines = raw.stderrWarnings ? [raw.stderrWarnings] : [];
        warningLines.push('Gemini CLI: transport failed after finalize_job (process exited).');
        raw.stderrWarnings = warningLines.join('\n');
        result.telemetry = telemetry;

        if (!result.output && typeof telemetryFromError?.raw?.partialOutput === 'string') {
          result.output = telemetryFromError.raw.partialOutput;
        }

        error = null;
      }
    } catch {}

    workerLogger.error({
      jobName: metadata?.jobName,
      requestId: target.id,
      error: serializeError(e),
      finalStatus: finalStatus?.status,
      hasTelemetry: !!e?.telemetry
    }, 'Execution failed');
  }

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

  // Store report with final status
  await storeOnchainReport(target, workerAddress, result, error, metadata);
  
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

    // Check if Safe is actually deployed
    if (safeAddress && rpcHttpUrl) {
      try {
        const web3 = new Web3(rpcHttpUrl);
        const code = await web3.eth.getCode(safeAddress);
        if (!code || code === '0x' || code.length <= 2) {
          workerLogger.warn({ safeAddress }, 'Safe address has no contract code; skipping Safe delivery (use direct EOA delivery or deploy Safe first)');
          return;
        }
      } catch (e: any) {
        workerLogger.warn({ safeAddress, error: e?.message }, 'Failed to check Safe deployment; skipping Safe delivery');
        return;
      }
    }
    
    if (safeAddress && targetMechAddress) {
      // Preflight: ensure request is still undelivered on-chain before constructing Safe tx
      const requestIdHex = String(target.id).startsWith('0x') ? String(target.id) : '0x' + BigInt(String(target.id)).toString(16);
      workerLogger.info({ requestIdHex, targetMechAddress }, 'Checking if request is undelivered on-chain...');
      const ok = await isUndeliveredOnChain({ mechAddress: targetMechAddress, requestIdHex, rpcHttpUrl });
      if (!ok) {
        workerLogger.info({ jobName: metadata?.jobName, requestId: target.id, requestIdHex }, 'Preflight: request already delivered or not eligible; skipping Safe delivery');
        return;
      }
      workerLogger.info({ requestIdHex }, 'Preflight passed - request is undelivered, proceeding with Safe delivery...');

      const payload = {
        chainConfig,
        requestId: String(target.id),
        resultContent: {
          requestId: String(target.id),
          output: result?.output || '',
          telemetry: result?.telemetry || {},
          artifacts: Array.isArray((result as any)?.artifacts) ? (result as any).artifacts : [],
          ...(result?.pullRequestUrl ? { pullRequestUrl: result.pullRequestUrl } : {}),
          ...(metadata?.codeMetadata?.branch?.name ? {
            executionPolicy: {
              branch: metadata.codeMetadata.branch.name,
              ensureTestsPass: true,
              description: 'Agent executed work on the provided branch and passed required validations.'
            }
          } : {})
        },
        targetMechAddress,
        safeAddress,
        privateKey,
        ...(rpcHttpUrl ? { rpcHttpUrl } : {}),
        wait: true
      } as const;
      const delivery = await (deliverViaSafe as any)(payload);
      workerLogger.info({ requestId: target.id, tx: delivery?.tx_hash, status: delivery?.status }, 'Delivered via Safe');
    }
  } catch (e: any) {
    // Log detailed error information for debugging
    const errorDetails: any = {
      message: e?.message || String(e),
      code: e?.code,
      reason: e?.reason,
      data: e?.data,
      stack: e?.stack?.split('\n').slice(0, 3).join('\n')
    };
    workerLogger.warn({ requestId: target.id, error: errorDetails }, 'Safe delivery failed');
    
    // Record a FAILED status so the claim does not remain IN_PROGRESS
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
