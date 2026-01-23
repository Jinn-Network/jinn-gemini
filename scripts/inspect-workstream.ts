#!/usr/bin/env tsx

/**
 * inspect-workstream: Workstream Execution Graph Inspector
 * 
 * Visualizes the complete execution graph of a workstream, showing parent/child relationships,
 * status, and key artifacts without overwhelming detail.
 * 
 * Usage:
 *   yarn inspect-workstream <workstream-id>
 * 
 * Output:
 *   JSON structure to stdout
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { GraphQLClient, gql } from 'graphql-request';

const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'https://jinn-gemini-production.up.railway.app/graphql';
const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || 'https://gateway.autonolas.tech/ipfs/';

// --- Types ---

interface Request {
  id: string;
  mech: string;
  sender: string;
  workstreamId?: string;
  jobDefinitionId?: string;
  sourceRequestId?: string;
  sourceJobDefinitionId?: string;
  requestData?: string;
  ipfsHash?: string;
  deliveryIpfsHash?: string;
  blockNumber: string;
  blockTimestamp: string;
  delivered: boolean;
  jobName?: string;
  enabledTools?: string[];
}

interface Delivery {
  id: string;
  requestId: string;
  ipfsHash?: string;
  blockTimestamp: string;
}

interface Artifact {
  id: string;
  requestId: string;
  name: string;
  cid: string;
  topic: string;
  type?: string;
  tags?: string[];
}

interface WorkstreamNode {
  id: string; // requestId
  jobName?: string;
  jobDefinitionId?: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  timestamp: string;
  duration?: number;
  summary?: string; // Short summary from delivery or inference
  error?: string;
  children: WorkstreamNode[];
  artifacts: { name: string; topic: string; type?: string }[];
  // Minimal details to keep context small
  _debug?: {
    delivered: boolean;
    hasDelivery: boolean;
    finalStatus?: string; // The actual finalStatus.status from delivery for debugging
  };
}

// --- Queries ---

const WORKSTREAM_QUERY = gql`
  query GetWorkstream($workstreamId: String!, $limit: Int!, $offset: Int!) {
    requests(
      where: { workstreamId: $workstreamId }
      orderBy: "blockTimestamp"
      orderDirection: "asc"
      limit: $limit
      offset: $offset
    ) {
      items {
        id
        mech
        workstreamId
        jobDefinitionId
        sourceRequestId
        sourceJobDefinitionId
        ipfsHash
        deliveryIpfsHash
        blockTimestamp
        delivered
        jobName
        enabledTools
      }
    }
  }
`;

const JOB_DEFINITIONS_QUERY = gql`
  query GetJobDefinitions($jobDefIds: [String!]!, $limit: Int!) {
    jobDefinitions(where: { id_in: $jobDefIds }, limit: $limit) {
      items {
        id
        name
        lastStatus
        lastInteraction
        sourceJobDefinitionId
      }
    }
  }
`;

const DELIVERIES_QUERY = gql`
  query GetDeliveries($requestIds: [String!]!, $limit: Int!, $offset: Int!) {
    deliverys(where: { requestId_in: $requestIds }, limit: $limit, offset: $offset) {
      items {
        id
        requestId
        ipfsHash
        blockTimestamp
      }
    }
  }
`;

const ARTIFACTS_QUERY = gql`
  query GetArtifacts($requestIds: [String!]!, $limit: Int!, $offset: Int!) {
    artifacts(where: { requestId_in: $requestIds }, limit: $limit, offset: $offset) {
      items {
        id
        requestId
        name
        cid
        topic
        type
        tags
      }
    }
  }
`;

// --- Helpers ---

async function fetchIpfsContent(cid: string, requestIdForDelivery?: string): Promise<any> {
  let url = `${IPFS_GATEWAY_URL}${cid}`;
  
  // Delivery directory reconstruction
  if (requestIdForDelivery && cid.startsWith('f01551220')) {
    const digestHex = cid.replace(/^f01551220/i, '');
    try {
      const digestBytes: number[] = [];
      for (let i = 0; i < digestHex.length; i += 2) {
        digestBytes.push(parseInt(digestHex.slice(i, i + 2), 16));
      }
      const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digestBytes];
      const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
      let bitBuffer = 0;
      let bitCount = 0;
      let out = '';
      for (const b of cidBytes) {
        bitBuffer = (bitBuffer << 8) | (b & 0xff);
        bitCount += 8;
        while (bitCount >= 5) {
          const idx = (bitBuffer >> (bitCount - 5)) & 0x1f;
          bitCount -= 5;
          out += base32Alphabet[idx];
        }
      }
      if (bitCount > 0) {
        const idx = (bitBuffer << (5 - bitCount)) & 0x1f;
        out += base32Alphabet[idx];
      }
      const dirCid = 'b' + out;
      url = `${IPFS_GATEWAY_URL}${dirCid}/${requestIdForDelivery}`;
    } catch (e) {
      console.error(`  Failed to reconstruct directory CID: ${e}`);
    }
  }
  
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(parseInt(process.env.IPFS_FETCH_TIMEOUT_MS || '7000', 10))
    });
    if (!response.ok) return null;
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error) {
    return null;
  }
}

function truncate(str: string, maxLength: number = 100): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  if (size <= 0) return chunks;
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchPaged<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
  pageSize: number,
  maxItems?: number
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;

  while (true) {
    const remaining = maxItems ? maxItems - results.length : pageSize;
    if (maxItems && remaining <= 0) break;
    const limit = Math.min(pageSize, remaining);
    const page = await fetchPage(limit, offset);
    if (page.length === 0) break;
    results.push(...page);
    offset += page.length;
    if (page.length < limit) break;
  }

  return results;
}


// --- Main ---

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 <workstream-id>')
    .demandCommand(1, 'You must provide a workstream ID')
    .option('limit', {
      type: 'string',
      describe: 'Max requests to fetch (default: all)'
    })
    .option('page-size', {
      type: 'string',
      describe: 'Page size for GraphQL pagination (default: 200)'
    })
    .help()
    .parserConfiguration({
      'parse-numbers': false,
      'parse-positional-numbers': false
    })
    .parse();
  
  const workstreamId = String(argv._[0]);
  const rawLimit = argv.limit ? Number(argv.limit) : undefined;
  const requestLimit = rawLimit && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  const rawPageSize = argv['page-size'] ? Number(argv['page-size']) : 200;
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : 200;
  
  console.error(`\n🔍 Inspecting workstream: ${workstreamId}`);
  console.error(`Ponder API: ${PONDER_GRAPHQL_URL}\n`);
  console.error(`Pagination: pageSize=${pageSize}${requestLimit ? ` limit=${requestLimit}` : ''}\n`);
  
  const client = new GraphQLClient(PONDER_GRAPHQL_URL);

  try {
    // 1. First fetch all requests in the workstream
    console.error('Fetching requests...');
    const requests = await fetchPaged<Request>(
      async (limit, offset) => {
        const requestsRes = await client.request<{ requests: { items: Request[] } }>(WORKSTREAM_QUERY, {
          workstreamId,
          limit,
          offset
        });
        return requestsRes.requests.items;
      },
      pageSize,
      requestLimit
    );
    
    if (requests.length === 0) {
      console.error('❌ No requests found for this workstream ID.');
      process.exit(1);
    }
    
    // 2. Extract unique job definition IDs from requests
    const uniqueJobDefIds = [...new Set(requests.map(r => r.jobDefinitionId).filter(Boolean))];
    
    console.error(`Fetching ${uniqueJobDefIds.length} job definitions for ${requests.length} requests...`);
    const jobDefinitions: Array<{ id: string; name: string; lastStatus: string; lastInteraction: string; sourceJobDefinitionId: string }> = [];
    const jobDefChunks = chunkArray(uniqueJobDefIds, pageSize);
    for (const chunk of jobDefChunks) {
      const jobDefsRes = await client.request<{ jobDefinitions: { items: Array<{ id: string; name: string; lastStatus: string; lastInteraction: string; sourceJobDefinitionId: string }> } }>(
        JOB_DEFINITIONS_QUERY,
        { jobDefIds: chunk, limit: chunk.length }
      );
      jobDefinitions.push(...jobDefsRes.jobDefinitions.items);
    }
    console.error(`✅ Found ${jobDefinitions.length} unique jobs with ${requests.length} total job runs`);

    const requestIds = requests.map(r => r.id);

    // 3. Fetch Deliveries & Artifacts
    console.error('Fetching deliveries and artifacts...');
    const requestIdChunks = chunkArray(requestIds, pageSize);
    const deliveries: Delivery[] = [];
    const artifacts: Artifact[] = [];
    for (const chunk of requestIdChunks) {
      const [chunkDeliveries, chunkArtifacts] = await Promise.all([
        fetchPaged<Delivery>(
          async (limit, offset) => {
            const deliveriesRes = await client.request<{ deliverys: { items: Delivery[] } }>(DELIVERIES_QUERY, {
              requestIds: chunk,
              limit,
              offset
            });
            return deliveriesRes.deliverys.items;
          },
          pageSize
        ),
        fetchPaged<Artifact>(
          async (limit, offset) => {
            const artifactsRes = await client.request<{ artifacts: { items: Artifact[] } }>(ARTIFACTS_QUERY, {
              requestIds: chunk,
              limit,
              offset
            });
            return artifactsRes.artifacts.items;
          },
          pageSize
        )
      ]);
      deliveries.push(...chunkDeliveries);
      artifacts.push(...chunkArtifacts);
    }

    console.error(`✅ Found ${deliveries.length} deliveries and ${artifacts.length} artifacts`);

    // 4. Map Data
    const deliveryMap = new Map<string, Delivery>();
    deliveries.forEach(d => deliveryMap.set(d.requestId, d));

    const artifactMap = new Map<string, Artifact[]>();
    artifacts.forEach(a => {
      if (!artifactMap.has(a.requestId)) artifactMap.set(a.requestId, []);
      artifactMap.get(a.requestId)!.push(a);
    });

    // 5. Build Tree Nodes (Flat Map first)
    console.error('\nResolving node details (this may take a moment)...');
    
    const nodeMap = new Map<string, WorkstreamNode>();
    
    for (const req of requests) {
      const delivery = deliveryMap.get(req.id);
      const reqArtifacts = artifactMap.get(req.id) || [];
      
      let status: WorkstreamNode['status'] = req.delivered ? 'COMPLETED' : 'PENDING';
      let summary: string | undefined;
      let error: string | undefined;
      let actualFinalStatus: string | undefined;

      // Try to fetch delivery content for summary/status if delivered
      if (req.delivered && delivery?.ipfsHash) {
        // We only fetch key delivery data to keep it light
        const content = await fetchIpfsContent(delivery.ipfsHash, req.id);
        if (content) {
            // Use status field from delivery payload (job-centric status)
            if (content.status) {
                actualFinalStatus = content.status;
                const finalStatusValue = content.status.toUpperCase();
                if (finalStatusValue === 'COMPLETED') {
                    status = 'COMPLETED';
                } else if (finalStatusValue === 'FAILED') {
                    status = 'FAILED';
                    error = content.statusMessage || content.errorMessage || content.error || "Job failed";
                } else if (finalStatusValue === 'WAITING' || finalStatusValue === 'DELEGATING') {
                    status = 'PENDING'; // Map WAITING/DELEGATING to PENDING for workstream view
                }
            }
            // Fallback: Check for explicit error
            else if (content.error || content.errorMessage) {
                status = 'FAILED';
                error = content.errorMessage || content.error || "Unknown error";
            }
            
            // Extract summary
            if (content.structuredSummary) {
                summary = truncate(content.structuredSummary, 300);
            } else if (content.output) {
                summary = truncate(content.output, 200);
            }
        }
      }

      nodeMap.set(req.id, {
        id: req.id,
        jobName: req.jobName,
        jobDefinitionId: req.jobDefinitionId,
        status,
        timestamp: new Date(Number(req.blockTimestamp) * 1000).toISOString(),
        summary,
        error,
        children: [],
        artifacts: reqArtifacts.map(a => ({ name: a.name, topic: a.topic, type: a.type })),
        _debug: { 
          delivered: req.delivered, 
          hasDelivery: !!delivery,
          finalStatus: actualFinalStatus
        }
      });
    }

    // 6. Assemble Tree
    const rootNodes: WorkstreamNode[] = [];
    
    for (const req of requests) {
      const node = nodeMap.get(req.id)!;
      
      // Logic for root detection:
      // 1. It is the workstream root if id == workstreamId
      // 2. OR if sourceRequestId is null (top level)
      // 3. OR if sourceRequestId is NOT in our dataset (external parent?)
      
      if (req.id === workstreamId || !req.sourceRequestId) {
        rootNodes.push(node);
      } else {
        const parent = nodeMap.get(req.sourceRequestId);
        if (parent) {
          parent.children.push(node);
        } else {
          // Orphaned in this context (shouldn't happen if query is correct)
          rootNodes.push(node);
        }
      }
    }

    // 6. Build job execution summary
    const jobRunsByDefinition = new Map<string, Request[]>();
    requests.forEach(req => {
      if (!req.jobDefinitionId) return;
      if (!jobRunsByDefinition.has(req.jobDefinitionId)) {
        jobRunsByDefinition.set(req.jobDefinitionId, []);
      }
      jobRunsByDefinition.get(req.jobDefinitionId)!.push(req);
    });

    const jobExecutionSummary = jobDefinitions.map(jobDef => ({
      id: jobDef.id,
      name: jobDef.name,
      lastStatus: jobDef.lastStatus,
      executionCount: jobRunsByDefinition.get(jobDef.id)?.length || 0,
      runs: jobRunsByDefinition.get(jobDef.id)?.map(r => ({
        requestId: r.id,
        delivered: r.delivered,
        timestamp: new Date(Number(r.blockTimestamp) * 1000).toISOString()
      })) || []
    }));

    // 7. Output
    const result = {
      workstreamId,
      stats: {
        uniqueJobs: jobDefinitions.length,
        totalJobRuns: requests.length,
        completedRuns: requests.filter(r => r.delivered).length,
        pendingRuns: requests.filter(r => !r.delivered).length,
        totalArtifacts: artifacts.length,
        jobsInWaiting: jobDefinitions.filter(j => j.lastStatus === 'WAITING').length,
        jobsCompleted: jobDefinitions.filter(j => j.lastStatus === 'COMPLETED').length
      },
      jobs: jobExecutionSummary,
      tree: rootNodes.length === 1 ? rootNodes[0] : rootNodes
    };

    console.error('\n✅ Workstream graph built successfully\n');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('\n❌ Error inspecting workstream:', error);
    process.exit(1);
  }
}

main();
