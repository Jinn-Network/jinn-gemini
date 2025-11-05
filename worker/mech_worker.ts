import '../env/index.js';
import { Web3 } from 'web3';
import { graphQLRequest } from '../http/client.js';
import {
  getPonderGraphqlUrl,
  getUseControlApi,
  getOptionalMechReclaimAfterMinutes,
  getEnableAutoRepost,
  getRequiredRpcUrl,
  getOptionalMechTargetRequestId,
} from '../gemini-agent/mcp/tools/shared/env.js';
// Import JSON artifact without import assertions for TS compatibility
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import agentMechArtifact from '@jinn-network/mech-client-ts/dist/abis/AgentMech.json';
import { workerLogger } from '../logging/index.js';
import { claimRequest as apiClaimRequest } from './control_api_client.js';
import { getMechAddress } from '../env/operate-profile.js';
import { dispatchExistingJob } from '../gemini-agent/mcp/tools/dispatch_existing_job.js';
import { serializeError } from './logging/errors.js';
import { safeParseToolResponse } from './tool_utils.js';
import { processOnce as processJobOnce } from './orchestration/jobRunner.js';

export { formatSummaryForPr, autoCommitIfNeeded } from './git/autoCommit.js';

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
  
  // Delegate job execution to orchestrator
  await processJobOnce(target, workerAddress);
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
