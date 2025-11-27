#!/usr/bin/env tsx

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { GraphQLClient, gql } from 'graphql-request';

const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'https://jinn-gemini-production.up.railway.app/graphql';
const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || 'https://gateway.autonolas.tech/ipfs/';

interface Request {
  id: string;
  mech: string;
  sender: string;
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

interface JobRunData {
  request?: Request;
  delivery?: Delivery;
  artifacts: Artifact[];
  recognitionResult?: Artifact;
}

const QUERY = gql`
  query GetJobRun($requestId: String!) {
    request(id: $requestId) {
      id
      mech
      sender
      requestData
      ipfsHash
      deliveryIpfsHash
      blockNumber
      blockTimestamp
      delivered
      jobName
      enabledTools
    }
    delivery(id: $requestId) {
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
    artifacts(where: { requestId: $requestId }) {
      items {
        id
        requestId
        name
        cid
        topic
        contentPreview
      }
    }
    recognitionResult: artifacts(where: { requestId: $requestId, topic: "RECOGNITION_RESULT" }, limit: 1) {
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


async function resolveIpfsReferences(data: JobRunData): Promise<any> {
  const resolved: any = {
    request: data.request,
    delivery: data.delivery,
    artifacts: [],
    recognitionResult: null
  };
  
  // Resolve request IPFS hash
  if (data.request?.ipfsHash) {
    console.error(`Resolving request IPFS hash: ${data.request.ipfsHash}`);
    const content = await fetchIpfsContent(data.request.ipfsHash);
    resolved.request.ipfsContent = tryParseNestedJson(content);
  }
  
  // Resolve delivery IPFS hash (with directory reconstruction)
  if (data.delivery?.ipfsHash) {
    console.error(`Resolving delivery IPFS hash: ${data.delivery.ipfsHash}`);
    const content = await fetchIpfsContent(data.delivery.ipfsHash, data.delivery.requestId);
    resolved.delivery.ipfsContent = tryParseNestedJson(content);
  }
  
  // Resolve delivery IPFS hash from request (alternative location)
  if (data.request?.deliveryIpfsHash && data.request.deliveryIpfsHash !== data.delivery?.ipfsHash) {
    console.error(`Resolving request delivery IPFS hash: ${data.request.deliveryIpfsHash}`);
    const content = await fetchIpfsContent(data.request.deliveryIpfsHash, data.request.id);
    resolved.request.deliveryIpfsContent = tryParseNestedJson(content);
  }
  
  // Resolve recognition result artifact (separate for easier access)
  if (data.recognitionResult) {
    console.error(`Resolving RECOGNITION_RESULT artifact: ${data.recognitionResult.cid}`);
    const content = await fetchIpfsContent(data.recognitionResult.cid);
    const parsedContent = tryParseNestedJson(content);
    resolved.recognitionResult = {
      ...data.recognitionResult,
      resolvedContent: parsedContent
    };
  }
  
  // Resolve all artifact CIDs
  for (const artifact of data.artifacts) {
    console.error(`Resolving artifact ${artifact.name} (${artifact.topic}): ${artifact.cid}`);
    const content = await fetchIpfsContent(artifact.cid);
    const parsedContent = tryParseNestedJson(content);
    
    resolved.artifacts.push({
      ...artifact,
      resolvedContent: parsedContent
    });
  }
  
  return resolved;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 <request-id>')
    .demandCommand(1, 'You must provide a request ID')
    .help()
    .alias('h', 'help')
    .parserConfiguration({
      'parse-numbers': false,
      'parse-positional-numbers': false
    })
    .parse();
  
  const requestId = String(argv._[0]);
  
  console.error(`\n🔍 Inspecting job run: ${requestId}\n`);
  console.error(`Ponder API: ${PONDER_GRAPHQL_URL}`);
  console.error(`IPFS Gateway: ${IPFS_GATEWAY_URL}\n`);
  
  const client = new GraphQLClient(PONDER_GRAPHQL_URL);
  
  try {
    console.error('Fetching data from Ponder...');
    const response = await client.request<{
      request?: Request;
      delivery?: Delivery;
      artifacts: { items: Artifact[] };
      recognitionResult: { items: Artifact[] };
    }>(QUERY, { requestId });
    
    if (!response.request) {
      console.error(`\n❌ Request ${requestId} not found in Ponder\n`);
      process.exit(1);
    }
    
    const jobRunData: JobRunData = {
      request: response.request,
      delivery: response.delivery,
      artifacts: response.artifacts.items,
      recognitionResult: response.recognitionResult.items[0]
    };
    
    console.error(`\n✅ Found request data:`);
    console.error(`   Job Name: ${jobRunData.request?.jobName || 'N/A'}`);
    console.error(`   Delivered: ${jobRunData.request?.delivered ? 'Yes' : 'No'}`);
    console.error(`   Artifacts: ${jobRunData.artifacts.length}`);
    console.error(`   Recognition Result: ${jobRunData.recognitionResult ? 'Yes' : 'No'}`);
    console.error(`\nResolving IPFS references...\n`);
    
    const resolved = await resolveIpfsReferences(jobRunData);
    
    console.error(`\n✅ All IPFS references resolved\n`);
    console.error('========== OUTPUT ==========\n');
    
    // Output to stdout for piping
    console.log(JSON.stringify(resolved, null, 2));
    
  } catch (error) {
    console.error(`\n❌ Error:`, error);
    process.exit(1);
  }
}

main();

