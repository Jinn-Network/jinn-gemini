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
  query GetWorkstream($workstreamId: String!) {
    requests(where: { workstreamId: $workstreamId }, orderBy: "blockTimestamp", orderDirection: "asc") {
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

const DELIVERIES_QUERY = gql`
  query GetDeliveries($requestIds: [String!]!) {
    deliverys(where: { requestId_in: $requestIds }) {
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
  query GetArtifacts($requestIds: [String!]!) {
    artifacts(where: { requestId_in: $requestIds }) {
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


// --- Main ---

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 <workstream-id>')
    .demandCommand(1, 'You must provide a workstream ID')
    .help()
    .parserConfiguration({
      'parse-numbers': false,
      'parse-positional-numbers': false
    })
    .parse();
  
  const workstreamId = String(argv._[0]);
  
  console.error(`\n🔍 Inspecting workstream: ${workstreamId}`);
  console.error(`Ponder API: ${PONDER_GRAPHQL_URL}\n`);
  
  const client = new GraphQLClient(PONDER_GRAPHQL_URL);

  try {
    // 1. Fetch Requests
    console.error('Fetching requests...');
    const requestsRes = await client.request<{ requests: { items: Request[] } }>(WORKSTREAM_QUERY, { workstreamId });
    const requests = requestsRes.requests.items;
    
    if (requests.length === 0) {
      console.error('❌ No requests found for this workstream ID.');
      process.exit(1);
    }
    console.error(`✅ Found ${requests.length} requests`);

    const requestIds = requests.map(r => r.id);

    // 2. Fetch Deliveries & Artifacts
    console.error('Fetching deliveries and artifacts...');
    const [deliveriesRes, artifactsRes] = await Promise.all([
      client.request<{ deliverys: { items: Delivery[] } }>(DELIVERIES_QUERY, { requestIds }),
      client.request<{ artifacts: { items: Artifact[] } }>(ARTIFACTS_QUERY, { requestIds })
    ]);

    const deliveries = deliveriesRes.deliverys.items;
    const artifacts = artifactsRes.artifacts.items;

    console.error(`✅ Found ${deliveries.length} deliveries and ${artifacts.length} artifacts`);

    // 3. Map Data
    const deliveryMap = new Map<string, Delivery>();
    deliveries.forEach(d => deliveryMap.set(d.requestId, d));

    const artifactMap = new Map<string, Artifact[]>();
    artifacts.forEach(a => {
      if (!artifactMap.has(a.requestId)) artifactMap.set(a.requestId, []);
      artifactMap.get(a.requestId)!.push(a);
    });

    // 4. Build Tree Nodes (Flat Map first)
    console.error('\nResolving node details (this may take a moment)...');
    
    const nodeMap = new Map<string, WorkstreamNode>();
    
    for (const req of requests) {
      const delivery = deliveryMap.get(req.id);
      const reqArtifacts = artifactMap.get(req.id) || [];
      const expired = !req.delivered && isRequestExpired(req.blockTimestamp);
      
      let status: WorkstreamNode['status'] = req.delivered ? 'COMPLETED' : (expired ? 'EXPIRED' : 'PENDING');
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
          expired,
          finalStatus: actualFinalStatus
        }
      });
    }

    // 5. Assemble Tree
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

    // 6. Output
    const result = {
      workstreamId,
      stats: {
        totalJobs: requests.length,
        completed: requests.filter(r => r.delivered).length,
        pending: requests.filter(r => !r.delivered && !isRequestExpired(r.blockTimestamp)).length,
        expired: requests.filter(r => !r.delivered && isRequestExpired(r.blockTimestamp)).length,
        totalArtifacts: artifacts.length
      },
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
