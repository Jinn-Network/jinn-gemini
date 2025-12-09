import '../env/index.js';
import { Web3 } from 'web3';
import { graphQLRequest } from '../http/client.js';
import {
  getPonderGraphqlUrl,
  getUseControlApi,
  getEnableAutoRepost,
  getRequiredRpcUrl,
  getOptionalMechTargetRequestId,
  getOptionalControlApiUrl,
} from '../gemini-agent/mcp/tools/shared/env.js';
// Import JSON artifact without import assertions for TS compatibility
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import agentMechArtifact from '@jinn-network/mech-client-ts/dist/abis/AgentMech.json';
import { workerLogger } from '../logging/index.js';
import { claimRequest as apiClaimRequest } from './control_api_client.js';
import { getMechAddress, getServicePrivateKey, getMechChainConfig } from '../env/operate-profile.js';
import { dispatchExistingJob } from '../gemini-agent/mcp/tools/dispatch_existing_job.js';
import { serializeError } from './logging/errors.js';
import { safeParseToolResponse } from './tool_utils.js';
import { processOnce as processJobOnce } from './orchestration/jobRunner.js';
import { fetchIpfsMetadata } from './metadata/fetchIpfsMetadata.js';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';

export { formatSummaryForPr, autoCommitIfNeeded } from './git/autoCommit.js';

type UnclaimedRequest = {
  id: string;           // on-chain requestId (decimal string or 0x)
  mech: string;         // mech address (0x...)
  requester: string;    // requester address (0x...)
  workstreamId?: string; // workstream context for dependency resolution
  blockTimestamp?: number;
  dependencies?: string[];  // job definition IDs or names that must be delivered first
  ipfsHash?: string;
  delivered?: boolean;
};


const PONDER_GRAPHQL_URL = getPonderGraphqlUrl();
const CONTROL_API_URL = getOptionalControlApiUrl() || 'http://localhost:4001/graphql';
const SINGLE_SHOT = process.argv.includes('--single') || process.argv.includes('--single-job');
const USE_CONTROL_API = getUseControlApi();

// Parse --runs=<N> flag for controlled execution cycles
const MAX_RUNS = (() => {
  if (SINGLE_SHOT) return 1; // --single is equivalent to --runs=1
  const arg = process.argv.find(arg => arg.startsWith('--runs='));
  if (!arg) return undefined; // Infinite loop (default behavior)
  const value = parseInt(arg.split('=')[1], 10);
  return isNaN(value) || value < 1 ? undefined : value;
})();

// Workstream filtering: parse --workstream=<id> flag
const WORKSTREAM_FILTER = (() => {
  const arg = process.argv.find(arg => arg.startsWith('--workstream='));
  return arg ? arg.split('=')[1] : undefined;
})();

// Auto-reposting configuration
const ENABLE_AUTO_REPOST = getEnableAutoRepost();
const MIN_TIME_BETWEEN_REPOSTS = 5 * 60 * 1000; // 5 minutes

// Track recent reposts to prevent loops
const recentReposts = new Map<string, number>();

const DEFAULT_BASE_BRANCH = process.env.CODE_METADATA_DEFAULT_BASE_BRANCH || 'main';

// Job processing logic has been moved to worker/orchestration/jobRunner.ts
// This file now serves as a CLI wrapper that handles request discovery, claiming, and orchestration delegation

async function fetchRecentRequests(limit: number = 10): Promise<UnclaimedRequest[]> {
  try {
    const workerMech = getMechAddress();
    if (!workerMech) {
      workerLogger.warn('Cannot fetch requests without mech address');
      return [];
    }
    
    workerLogger.info({ 
      ponderUrl: PONDER_GRAPHQL_URL, 
      mech: workerMech,
      workstreamFilter: WORKSTREAM_FILTER || 'none'
    }, 'Fetching requests from Ponder');
    
    const whereConditions: string[] = ['mech: $mech', 'delivered: false'];
    if (WORKSTREAM_FILTER) {
      whereConditions.push('workstreamId: $workstreamId');
    }
    const whereClause = `{ ${whereConditions.join(', ')} }`;
    
    // Query our local Ponder GraphQL (custom schema) - FILTER BY MECH AND UNDELIVERED (and optionally WORKSTREAM)
    const query = `query RecentRequests($limit: Int!, $mech: String!${WORKSTREAM_FILTER ? ', $workstreamId: String!' : ''}) {
  requests(
    where: ${whereClause}
    orderBy: "blockTimestamp"
    orderDirection: "asc"
    limit: $limit
  ) {
    items {
      id
      mech
      sender
      workstreamId
      ipfsHash
      blockTimestamp
      delivered
      dependencies
    }
  }
}`;
    
    const variables: any = {
      limit,
      mech: workerMech.toLowerCase() // Ponder stores addresses lowercase
    };
    if (WORKSTREAM_FILTER) {
      variables.workstreamId = WORKSTREAM_FILTER;
    }
    
    const data = await graphQLRequest<{ requests: { items: any[] } }>({
      url: PONDER_GRAPHQL_URL,
      query,
      variables,
      context: { operation: 'fetchRecentRequests', mech: workerMech }
    });
    const items: any[] = data?.requests?.items || [];
    workerLogger.info({ totalItems: items.length, items: items.map(r => ({ id: r.id, delivered: r.delivered, dependencies: r.dependencies })) }, 'Ponder GraphQL response');
    return items.map((r: any) => ({
      id: String(r.id),
      mech: String(r.mech),
      requester: String(r.sender || ''),
      workstreamId: r?.workstreamId ? String(r.workstreamId) : undefined,
      ipfsHash: r?.ipfsHash ? String(r.ipfsHash) : undefined,
      blockTimestamp: Number(r.blockTimestamp),
      delivered: Boolean(r?.delivered === true),
      dependencies: Array.isArray(r?.dependencies) ? r.dependencies.map((dep: any) => String(dep)) : undefined
    })) as UnclaimedRequest[];
  } catch (e) {
    workerLogger.warn({ error: e instanceof Error ? e.message : String(e) }, 'Ponder GraphQL not reachable; returning empty set');
    return [];
  }
}

async function getUndeliveredSet(params: { mechAddress: string; rpcHttpUrl?: string; size?: number; offset?: number }): Promise<Set<string> | null> {
  const { mechAddress, rpcHttpUrl, size = 1000, offset = 0 } = params;
  try {
    if (!rpcHttpUrl) return new Set<string>();
    
    // Step 1: Get requests pending in YOUR mech's queue
    const abi: any = (agentMechArtifact as any)?.abi || (agentMechArtifact as any);
    const web3 = new Web3(rpcHttpUrl);
    const mechContract = new (web3 as any).eth.Contract(abi, mechAddress);
    const requestIds: string[] = await mechContract.methods.getUndeliveredRequestIds(size, offset).call();
    
    if (!requestIds || requestIds.length === 0) {
      return new Set<string>();
    }
    
    // Step 2: Filter out requests that have been delivered by OTHER mechs in the marketplace
    // This prevents wasted gas on delivery attempts that will be revoked
    const MARKETPLACE_ADDRESS = '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020';
    // Dynamic import with require to avoid TypeScript module resolution issues
    const marketplaceAbi = require('../ponder/abis/MechMarketplace.json');
    const marketplace = new (web3 as any).eth.Contract(marketplaceAbi, MARKETPLACE_ADDRESS);
    
    const undeliveredSet = new Set<string>();
    
    // Check each request in the marketplace to see if it's actually still undelivered
    for (const requestId of requestIds) {
      try {
        const requestInfo = await marketplace.methods.mapRequestIdInfos(requestId).call();
        const isDelivered = requestInfo.deliveryMech !== '0x0000000000000000000000000000000000000000';
        
        if (!isDelivered) {
          // Request is still undelivered in marketplace - safe to attempt delivery
          undeliveredSet.add(String(requestId).toLowerCase());
        } else {
          // Request was delivered by another mech - skip it
          workerLogger.debug({ 
            requestId, 
            deliveredByMech: requestInfo.deliveryMech 
          }, 'Request already delivered in marketplace by another mech - filtering out');
        }
      } catch (err) {
        // If we can't check marketplace status for this specific request, be conservative and include it
        workerLogger.warn({ requestId, error: err instanceof Error ? err.message : String(err) }, 'Failed to check marketplace status for request; including in set');
        undeliveredSet.add(String(requestId).toLowerCase());
      }
    }
    
    return undeliveredSet;
  } catch (err) {
    workerLogger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to get undelivered set; returning null');
    return null;
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
    const mechToSet = new Map<string, Set<string> | null>();
    for (const r of notDelivered) {
      const key = r.mech.toLowerCase();
      if (!mechToSet.has(key)) {
        // Fetch a large batch to ensure we don't miss recent requests due to pagination
        mechToSet.set(key, await getUndeliveredSet({ mechAddress: r.mech, rpcHttpUrl, size: 1000 }));
      }
    }
    const filtered = notDelivered.filter(r => {
      const set = mechToSet.get(r.mech.toLowerCase());
      
      // If we failed to get the set (null), we default to TRUSTING Ponder (return true)
      // This prevents blocking if RPC is flaky, but might cause a revert on claim if actually delivered.
      if (set === null) {
        workerLogger.debug({ requestId: r.id }, 'RPC check failed (null set), falling back to Ponder status (keeping request)');
        return true;
      }
      
      const idHex = String(r.id).startsWith('0x') ? String(r.id).toLowerCase() : ('0x' + BigInt(String(r.id)).toString(16)).toLowerCase();
      const inSet = set.has(idHex);
      
      if (!inSet) {
        workerLogger.debug({ 
          requestId: r.id, 
          mech: r.mech,
          onChainSetSize: set.size 
        }, 'Request filtered out - not found in on-chain undelivered set (already delivered)');
      }
      
      return inSet;
    });
    return filtered;
  } catch (e) {
    workerLogger.warn({ error: e instanceof Error ? e.message : String(e) }, 'Error checking on-chain status, falling back to Ponder status');
    return notDelivered;
  }
}

/**
 * Resolve a dependency identifier to a job definition ID.
 * If the identifier is already a UUID, return it as-is.
 * If the identifier is a job name, try to resolve it within the workstream context.
 */
async function resolveJobDefinitionId(
  workstreamId: string | undefined,
  identifier: string
): Promise<string> {
  // Check if identifier is already a UUID
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID_REGEX.test(identifier)) {
    return identifier;
  }

  // If no workstream context, can't resolve - return original
  if (!workstreamId) {
    workerLogger.debug({ identifier }, 'Cannot resolve dependency without workstream context');
    return identifier;
  }

  try {
    // Try to resolve by querying for requests with this job name in the workstream
    const query = `query ResolveJobDef($workstreamId: String!, $jobName: String!) {
      requests(
        where: { workstreamId: $workstreamId, jobName: $jobName }
        orderBy: "blockTimestamp"
        orderDirection: "desc"
        limit: 1
      ) {
        items {
          jobDefinitionId
        }
      }
    }`;

    const data = await graphQLRequest<{
      requests: { items: Array<{ jobDefinitionId?: string }> };
    }>({
      url: PONDER_GRAPHQL_URL,
      query,
      variables: { workstreamId, jobName: identifier },
      context: { operation: 'resolveJobDefinitionId', identifier, workstreamId }
    });

    const requests = data?.requests?.items || [];
    if (requests.length > 0 && requests[0].jobDefinitionId) {
      const resolvedId = requests[0].jobDefinitionId;
      workerLogger.debug({
        identifier,
        resolvedId,
        workstreamId
      }, 'Resolved job name to definition ID');
      return resolvedId;
    }

    // Not found - return original identifier
    workerLogger.debug({
      identifier,
      workstreamId
    }, 'Could not resolve job name - no matching requests found');
    return identifier;
  } catch (e: any) {
    workerLogger.warn({
      identifier,
      workstreamId,
      error: e instanceof Error ? e.message : String(e)
    }, 'Failed to resolve dependency identifier');
    return identifier;
  }
}

/**
 * Check if a job definition has at least one successfully delivered request.
 * This does NOT check child jobs - dependencies are shallow by design.
 * 
 * Rationale: Jobs only deliver when their agent decides they're complete.
 * If children are critical, the parent waits for them before delivering.
 * Dependencies just need to know "did this job finish?" (delivered = yes).
 */
export async function isJobDefinitionComplete(jobDefinitionId: string): Promise<boolean> {
  try {
    // Query job definition's lastStatus from Ponder
    const query = `query CheckJobDefCompletion($jobDefId: String!) {
      jobDefinitions(where: { id: $jobDefId }) {
        items {
          id
          lastStatus
        }
      }
    }`;

    const data = await graphQLRequest<{
      jobDefinitions: { items: Array<{ id: string; lastStatus: string }> };
    }>({
      url: PONDER_GRAPHQL_URL,
      query,
      variables: { jobDefId: jobDefinitionId },
      context: { operation: 'isJobDefinitionComplete', jobDefinitionId }
    });

    const jobDef = data?.jobDefinitions?.items?.[0];
    
    if (!jobDef) {
      workerLogger.debug({ jobDefinitionId }, 'Job definition not found');
      return false;
    }
    
    // Job definition is complete only if lastStatus is terminal (COMPLETED/FAILED)
    // DELEGATING and WAITING mean work is still in progress
    const isComplete = jobDef.lastStatus === 'COMPLETED' || jobDef.lastStatus === 'FAILED';
    
    workerLogger.debug({ 
      jobDefinitionId, 
      lastStatus: jobDef.lastStatus,
      isComplete 
    }, 'Job definition completion check (status-based)');
    
    return isComplete;
  } catch (e: any) {
    workerLogger.warn({ 
      jobDefinitionId,
      error: e instanceof Error ? e.message : String(e) 
    }, 'Failed to check job definition completion - assuming not complete');
    return false;
  }
}

/**
 * Check if all job definition dependencies for a request are complete
 */
async function checkDependenciesMet(request: UnclaimedRequest): Promise<boolean> {
  // If no dependencies, job can proceed
  if (!request.dependencies || request.dependencies.length === 0) {
    return true;
  }

  try {
    // Resolve each dependency (name to ID if needed) and check completion
    const results = await Promise.all(
      request.dependencies.map(async (identifier) => {
        const resolvedId = await resolveJobDefinitionId(request.workstreamId, identifier);
        const isComplete = await isJobDefinitionComplete(resolvedId);
        return { identifier, resolvedId, isComplete };
      })
    );
    
    const allComplete = results.every(r => r.isComplete);
    
    if (!allComplete) {
      const incomplete = results.filter(r => !r.isComplete);
      workerLogger.info({ 
        requestId: request.id, 
        totalDeps: request.dependencies.length,
        incompleteDeps: incomplete.map(r => ({
          identifier: r.identifier,
          resolvedId: r.resolvedId,
          wasResolved: r.identifier !== r.resolvedId  // Shows if name→UUID resolution happened
        })),
      }, 'Dependencies not met - waiting for job definitions to complete');
    }
    
    return allComplete;
  } catch (e: any) {
    workerLogger.warn({ 
      requestId: request.id, 
      error: e instanceof Error ? e.message : String(e) 
    }, 'Failed to check dependencies - assuming not met');
    return false;
  }
}

/**
 * Filter requests to only include those with met dependencies
 */
async function filterByDependencies(requests: UnclaimedRequest[]): Promise<UnclaimedRequest[]> {
  const results = await Promise.all(
    requests.map(async (request) => ({
      request,
      canProceed: await checkDependenciesMet(request)
    }))
  );
  
  return results.filter(r => r.canProceed).map(r => r.request);
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


/**
 * Get branch information for a job definition by looking up its GIT_BRANCH artifact
 * Returns the branch name and base branch from the most recent delivered request
 */
export async function getDependencyBranchInfo(jobDefinitionId: string): Promise<{
  branchName?: string;
  baseBranch?: string;
} | null> {
  try {
    // Query for artifacts of type GIT_BRANCH from this job definition
    const query = `query GetBranchArtifact($jobDefId: String!) {
      artifacts(
        where: {
          sourceJobDefinitionId: $jobDefId,
          topic: "GIT_BRANCH"
        },
        orderBy: "blockTimestamp",
        orderDirection: "desc",
        limit: 1
      ) {
        items {
          cid
          contentPreview
        }
      }
    }`;

    const data = await graphQLRequest<{
      artifacts: { items: Array<{ cid: string; contentPreview?: string }> };
    }>({
      url: PONDER_GRAPHQL_URL,
      query,
      variables: { jobDefId: jobDefinitionId },
      context: { operation: 'getDependencyBranchInfo', jobDefinitionId }
    });

    const artifact = data?.artifacts?.items?.[0];
    if (!artifact) {
      workerLogger.debug({ jobDefinitionId }, 'No GIT_BRANCH artifact found for dependency');
      return null;
    }

    // Parse the content preview to extract branch info
    // Content preview format: "Branch: job/xxx-yyy based on main\nDiff summary: ..."
    const contentPreview = artifact.contentPreview || '';
    const branchMatch = contentPreview.match(/Branch:\s*([^\s]+)\s+based\s+on\s+([^\s\n]+)/i);

    if (branchMatch) {
      return {
        branchName: branchMatch[1],
        baseBranch: branchMatch[2],
      };
    }

    // Try alternative parsing - just look for branch name pattern
    const simpleBranchMatch = contentPreview.match(/job\/[a-f0-9-]+(?:-[a-z0-9-]+)?/i);
    if (simpleBranchMatch) {
      return {
        branchName: simpleBranchMatch[0],
        baseBranch: DEFAULT_BASE_BRANCH,
      };
    }

    workerLogger.debug({ jobDefinitionId, contentPreview }, 'Could not parse branch info from artifact');
    return null;
  } catch (e: any) {
    workerLogger.warn({
      jobDefinitionId,
      error: e instanceof Error ? e.message : String(e)
    }, 'Failed to get dependency branch info');
    return null;
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
      dependencies
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
    const r = items[0];
    return {
      id: String(r.id),
      mech: String(r.mech),
      requester: String(r.sender || ''),
      ipfsHash: r?.ipfsHash ? String(r.ipfsHash) : undefined,
      blockTimestamp: Number(r.blockTimestamp),
      delivered: Boolean(r?.delivered === true),
      dependencies: Array.isArray(r?.dependencies) ? r.dependencies.map((dep: any) => String(dep)) : undefined
    };
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
    
    // Check dependencies even for targeted requests
    const depsMet = await checkDependenciesMet(specificRequest);
    if (!depsMet) {
      workerLogger.info({ target: targetHex }, 'Target request dependencies not met - skipping');
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
    
    // Filter by dependencies - only process jobs whose dependencies are met
    candidates = await filterByDependencies(candidates);
    if (candidates.length === 0) {
      workerLogger.info('No requests with met dependencies found');
      return;
    }
  }

  // Try to claim a request
  let target: UnclaimedRequest | null = null;
  for (const c of candidates) {
    const ok = await tryClaim(c, workerAddress);
    if (ok) { 
      target = c; 
      break; 
    }
  }
  
  if (!target) return;
  
  // Delegate job execution to orchestrator
  await processJobOnce(target, workerAddress);
}

/**
 * Health check for Control API at startup
 */
async function checkControlApiHealth(): Promise<void> {
  if (!USE_CONTROL_API) {
    return; // Control API disabled, skip check
  }

  try {
    // Simple health check query
    const query = `query { __typename }`;
    await graphQLRequest({
      url: CONTROL_API_URL,
      query,
      maxRetries: 0,
      context: { operation: 'healthCheck' }
    });
    workerLogger.info({ controlApiUrl: CONTROL_API_URL }, 'Control API health check passed');
  } catch (e: any) {
    workerLogger.error({ 
      error: serializeError(e),
      controlApiUrl: CONTROL_API_URL
    }, 'Control API is not running - worker cannot start');
    throw new Error('Control API health check failed: ' + (e?.message || String(e)) + '\n\nPlease start Control API with: yarn control:dev');
  }
}

async function main() {
  workerLogger.info('Mech worker starting');
  
  // Verify Control API is running before processing any jobs
  await checkControlApiHealth();
  
  if (SINGLE_SHOT) {
    await processOnce();
    return;
  }
  
  let runCount = 0;
  for (;;) {
    try {
      // Check for completed chains and repost if needed
      await checkAndRepostCompletedChains();
      
      await processOnce();
      
      // Check if we've reached the max runs limit
      if (MAX_RUNS !== undefined) {
        runCount++;
        if (runCount >= MAX_RUNS) {
          workerLogger.info({ totalRuns: runCount, maxRuns: MAX_RUNS }, 'Reached maximum runs - stopping worker');
          return;
        }
      }
    } catch (e: any) {
      workerLogger.error({ error: serializeError(e) }, 'Error in mech loop');
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(() => process.exit(1));
