#!/usr/bin/env tsx

/**
 * inspect-job: Comprehensive Job Definition Inspector
 * 
 * Fetches and displays the complete story of a job definition including:
 * - Job definition metadata (name, blueprint, tools, lineage)
 * - All execution runs with IPFS-resolved content
 * - Child jobs created by each run
 * - Artifacts and deliveries for all runs
 * - Workstream relationships
 * 
 * Usage:
 *   yarn inspect-job <job-definition-id>
 * 
 * Output:
 *   JSON structure with fully resolved IPFS content to stdout
 *   Progress messages to stderr
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { GraphQLClient, gql } from 'graphql-request';

const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'https://jinn-gemini-production.up.railway.app/graphql';
const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || 'https://gateway.autonolas.tech/ipfs/';

interface JobDefinition {
  id: string;
  name: string;
  enabledTools?: string[];
  blueprint?: string;
  sourceJobDefinitionId?: string;
  sourceRequestId?: string;
  codeMetadata?: any;
  createdAt?: string;
  lastInteraction?: string;
  lastStatus?: string;
}

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
  transactionHash?: string;
  blockNumber: string;
  blockTimestamp: string;
  delivered: boolean;
  jobName?: string;
  enabledTools?: string[];
  additionalContext?: any;
  dependencies?: string[];
}

interface Delivery {
  id: string;
  requestId: string;
  mech: string;
  mechServiceMultisig: string;
  deliveryRate: string;
  ipfsHash?: string;
  transactionHash: string;
  blockNumber: string;
  blockTimestamp: string;
}

interface Artifact {
  id: string;
  requestId: string;
  name: string;
  cid: string;
  topic: string;
  contentPreview?: string;
}

const JOB_DEFINITION_QUERY = gql`
  query GetJobDefinition($jobDefinitionId: String!) {
    jobDefinition(id: $jobDefinitionId) {
      id
      name
      enabledTools
      blueprint
      sourceJobDefinitionId
      sourceRequestId
      codeMetadata
      createdAt
      lastInteraction
      lastStatus
    }
  }
`;

const RUNS_QUERY = gql`
  query GetJobRuns($jobDefinitionId: String!) {
    requests(where: { jobDefinitionId: $jobDefinitionId }, orderBy: "blockTimestamp", orderDirection: "asc") {
      items {
        id
        mech
        sender
        workstreamId
        jobDefinitionId
        sourceRequestId
        sourceJobDefinitionId
        requestData
        ipfsHash
        deliveryIpfsHash
        transactionHash
        blockNumber
        blockTimestamp
        delivered
        jobName
        enabledTools
        additionalContext
        dependencies
      }
    }
  }
`;

const CHILD_JOBS_QUERY = gql`
  query GetChildJobs($sourceJobDefinitionId: String!) {
    requests(where: { sourceJobDefinitionId: $sourceJobDefinitionId }, orderBy: "blockTimestamp", orderDirection: "asc") {
      items {
        id
        mech
        sender
        workstreamId
        jobDefinitionId
        sourceRequestId
        sourceJobDefinitionId
        requestData
        ipfsHash
        deliveryIpfsHash
        transactionHash
        blockNumber
        blockTimestamp
        delivered
        jobName
        enabledTools
        additionalContext
        dependencies
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
        mech
        mechServiceMultisig
        deliveryRate
        ipfsHash
        transactionHash
        blockNumber
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
        contentPreview
      }
    }
  }
`;

async function fetchIpfsContent(cid: string, requestIdForDelivery?: string): Promise<any> {
  let url = `${IPFS_GATEWAY_URL}${cid}`;
  
  // Special handling for delivery IPFS hashes: reconstruct directory path
  // Delivery uses wrap-with-directory, so CID points to directory structure bytes
  // We need to fetch: {dir-CID}/{requestId}
  // Implementation matches ponder/src/index.ts:304-334
  if (requestIdForDelivery && cid.startsWith('f01551220')) {
    const digestHex = cid.replace(/^f01551220/i, '');
    
    try {
      // Convert hex digest to bytes
      const digestBytes: number[] = [];
      for (let i = 0; i < digestHex.length; i += 2) {
        digestBytes.push(parseInt(digestHex.slice(i, i + 2), 16));
      }
      
      // Build CIDv1 bytes: [0x01] + [0x70] (dag-pb) + multihash: [0x12, 0x20] + digest
      const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digestBytes];
      
      // Base32 encode (lowercase, no padding)
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
      console.error(`  Reconstructed directory CID: ${dirCid}`);
    } catch (e) {
      console.error(`  Failed to reconstruct directory CID: ${e}`);
    }
  }
  
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(parseInt(process.env.IPFS_FETCH_TIMEOUT_MS || '7000', 10))
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const text = await response.text();
    
    try {
      return JSON.parse(text);
    } catch {
      // Not JSON, return raw text
      return text;
    }
  } catch (error) {
    console.error(`Failed to fetch IPFS content for ${cid}:`, error);
    return { _error: `Failed to fetch: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function tryParseNestedJson(value: any): any {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      // Recursively parse nested JSON strings
      return tryParseNestedJson(parsed);
    } catch {
      return value;
    }
  }
  
  if (Array.isArray(value)) {
    return value.map(tryParseNestedJson);
  }
  
  if (value !== null && typeof value === 'object') {
    const result: any = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = tryParseNestedJson(val);
    }
    return result;
  }
  
  return value;
}

async function resolveRunIpfsReferences(
  run: Request,
  delivery?: Delivery,
  artifacts?: Artifact[]
): Promise<any> {
  const resolved: any = {
    ...run,
    resolvedRequestContent: null,
    resolvedDeliveryContent: null,
    resolvedArtifacts: []
  };
  
  // Resolve request IPFS hash
  if (run.ipfsHash) {
    console.error(`  Resolving request IPFS hash: ${run.ipfsHash}`);
    const content = await fetchIpfsContent(run.ipfsHash);
    resolved.resolvedRequestContent = tryParseNestedJson(content);
  }
  
  // Resolve delivery IPFS hash (with directory reconstruction)
  if (delivery?.ipfsHash) {
    console.error(`  Resolving delivery IPFS hash: ${delivery.ipfsHash}`);
    const content = await fetchIpfsContent(delivery.ipfsHash, delivery.requestId);
    resolved.resolvedDeliveryContent = tryParseNestedJson(content);
  }
  
  // Resolve delivery IPFS hash from request (alternative location)
  if (run.deliveryIpfsHash && run.deliveryIpfsHash !== delivery?.ipfsHash) {
    console.error(`  Resolving request delivery IPFS hash: ${run.deliveryIpfsHash}`);
    const content = await fetchIpfsContent(run.deliveryIpfsHash, run.id);
    resolved.resolvedDeliveryContent = tryParseNestedJson(content);
  }
  
  // Resolve all artifact CIDs
  if (artifacts && artifacts.length > 0) {
    for (const artifact of artifacts) {
      console.error(`  Resolving artifact ${artifact.name} (${artifact.topic}): ${artifact.cid}`);
      const content = await fetchIpfsContent(artifact.cid);
      const parsedContent = tryParseNestedJson(content);
      
      resolved.resolvedArtifacts.push({
        ...artifact,
        resolvedContent: parsedContent
      });
    }
  }
  
  return resolved;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 <job-definition-id>')
    .demandCommand(1, 'You must provide a job definition ID')
    .help()
    .alias('h', 'help')
    .parserConfiguration({
      'parse-numbers': false,
      'parse-positional-numbers': false
    })
    .parse();
  
  const jobDefinitionId = String(argv._[0]);
  
  console.error(`\n🔍 Inspecting job definition: ${jobDefinitionId}\n`);
  console.error(`Ponder API: ${PONDER_GRAPHQL_URL}`);
  console.error(`IPFS Gateway: ${IPFS_GATEWAY_URL}\n`);
  
  const client = new GraphQLClient(PONDER_GRAPHQL_URL);
  
  try {
    // Step 1: Fetch Job Definition
    console.error('Fetching job definition...');
    const jobDefResponse = await client.request<{
      jobDefinition?: JobDefinition;
    }>(JOB_DEFINITION_QUERY, { jobDefinitionId });
    
    if (!jobDefResponse.jobDefinition) {
      console.error(`\n❌ Job definition ${jobDefinitionId} not found in Ponder\n`);
      process.exit(1);
    }
    
    const jobDefinition = jobDefResponse.jobDefinition;
    console.error(`✅ Found job definition: ${jobDefinition.name}`);
    
    // Step 2: Fetch all runs for this job definition
    console.error('\nFetching job runs...');
    const runsResponse = await client.request<{
      requests: { items: Request[] };
    }>(RUNS_QUERY, { jobDefinitionId });
    
    const runs = runsResponse.requests.items;
    console.error(`✅ Found ${runs.length} run(s)`);
    
    // Step 3: Fetch all child jobs (requests created by this job)
    console.error('\nFetching child jobs...');
    const childJobsResponse = await client.request<{
      requests: { items: Request[] };
    }>(CHILD_JOBS_QUERY, { sourceJobDefinitionId: jobDefinitionId });
    
    const childJobs = childJobsResponse.requests.items;
    console.error(`✅ Found ${childJobs.length} child job(s)`);
    
    // Step 4: Fetch deliveries and artifacts for all runs
    const allRequestIds = [...runs.map(r => r.id), ...childJobs.map(c => c.id)];
    
    let deliveries: Delivery[] = [];
    let artifacts: Artifact[] = [];
    
    if (allRequestIds.length > 0) {
      console.error('\nFetching deliveries...');
      const deliveriesResponse = await client.request<{
        deliverys: { items: Delivery[] };
      }>(DELIVERIES_QUERY, { requestIds: allRequestIds });
      deliveries = deliveriesResponse.deliverys.items;
      console.error(`✅ Found ${deliveries.length} delivery/deliveries`);
      
      console.error('\nFetching artifacts...');
      const artifactsResponse = await client.request<{
        artifacts: { items: Artifact[] };
      }>(ARTIFACTS_QUERY, { requestIds: allRequestIds });
      artifacts = artifactsResponse.artifacts.items;
      console.error(`✅ Found ${artifacts.length} artifact(s)`);
    }
    
    // Step 5: Build delivery and artifact maps
    const deliveryMap = new Map<string, Delivery>();
    deliveries.forEach(d => deliveryMap.set(d.requestId, d));
    
    const artifactsByRequest = new Map<string, Artifact[]>();
    artifacts.forEach(a => {
      if (!artifactsByRequest.has(a.requestId)) {
        artifactsByRequest.set(a.requestId, []);
      }
      artifactsByRequest.get(a.requestId)!.push(a);
    });
    
    // Step 6: Map children to their parent runs
    const childrenByParentRequest = new Map<string, Request[]>();
    childJobs.forEach(child => {
      if (child.sourceRequestId) {
        if (!childrenByParentRequest.has(child.sourceRequestId)) {
          childrenByParentRequest.set(child.sourceRequestId, []);
        }
        childrenByParentRequest.get(child.sourceRequestId)!.push(child);
      }
    });
    
    // Step 7: Identify workstreams
    const workstreams = new Set<string>();
    runs.forEach(r => {
      if (r.workstreamId) {
        workstreams.add(r.workstreamId);
      }
    });
    childJobs.forEach(c => {
      if (c.workstreamId) {
        workstreams.add(c.workstreamId);
      }
    });
    
    console.error(`\n✅ Identified ${workstreams.size} workstream(s)`);
    
    // Step 8: Resolve IPFS content for all runs
    console.error('\nResolving IPFS references for runs...\n');
    const resolvedRuns = [];
    
    for (const run of runs) {
      console.error(`Processing run ${run.id}...`);
      const delivery = deliveryMap.get(run.id);
      const runArtifacts = artifactsByRequest.get(run.id) || [];
      const children = childrenByParentRequest.get(run.id) || [];
      
      const resolved = await resolveRunIpfsReferences(run, delivery, runArtifacts);
      
      // Add child job summaries (without full IPFS resolution for children to keep output manageable)
      resolved.children = children.map(child => ({
        id: child.id,
        jobDefinitionId: child.jobDefinitionId,
        jobName: child.jobName,
        workstreamId: child.workstreamId,
        delivered: child.delivered,
        blockTimestamp: child.blockTimestamp,
      }));
      
      resolvedRuns.push(resolved);
    }
    
    // Step 9: Construct final output
    const output = {
      jobDefinition: {
        ...jobDefinition,
        resolvedBlueprint: jobDefinition.blueprint ? tryParseNestedJson(jobDefinition.blueprint) : null
      },
      workstreams: Array.from(workstreams),
      summary: {
        totalRuns: runs.length,
        completedRuns: runs.filter(r => r.delivered).length,
        pendingRuns: runs.filter(r => !r.delivered).length,
        totalChildren: childJobs.length,
        completedChildren: childJobs.filter(c => c.delivered).length,
        totalArtifacts: artifacts.length,
      },
      runs: resolvedRuns,
      allChildJobs: childJobs.map(child => ({
        id: child.id,
        jobDefinitionId: child.jobDefinitionId,
        jobName: child.jobName,
        sourceRequestId: child.sourceRequestId,
        workstreamId: child.workstreamId,
        delivered: child.delivered,
        blockTimestamp: child.blockTimestamp,
      }))
    };
    
    console.error(`\n✅ All data resolved\n`);
    console.error('========== OUTPUT ==========\n');
    
    // Output to stdout for piping
    console.log(JSON.stringify(output, null, 2));
    
  } catch (error) {
    console.error(`\n❌ Error:`, error);
    process.exit(1);
  }
}

main();

