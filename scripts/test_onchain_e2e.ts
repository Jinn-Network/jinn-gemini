/*
 End-to-end on-chain test:
 1) Post marketplace job via mech-client-ts
 2) Verify Ponder indexed Request
 3) (Optional) Exercise Control API claim/report/artifact for lineage & idempotency
 4) Verify worker delivers on-chain (Deliver event appears in Ponder)
*/

import axios from 'axios';
import { setTimeout as delay } from 'timers/promises';
import { marketplaceInteract } from 'mech-client-ts/dist/marketplace_interact.js';

const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
const CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';
const CONTROL_API_SERVICE_KEY = process.env.CONTROL_API_SERVICE_KEY || '';
const TEST_WORKER_ADDRESS = process.env.TEST_WORKER_ADDRESS || process.env.MECH_WORKER_ADDRESS || '';

async function gql(url: string, query: string, variables?: any) {
  const res = await axios.post(url, { query, variables }, { headers: { 'Content-Type': 'application/json' } });
  if (res.data?.errors) throw new Error(JSON.stringify(res.data.errors));
  return res.data.data;
}

async function postJob(): Promise<{ requestHex: string; txHash: string }> {
  const priorityMech = process.env.PRIORITY_MECH || '0xab15f8d064b59447bd8e9e89dd3fa770abf5eeb7';
  const prompt = 'E2E test: please echo this string.';
  const res: any = await marketplaceInteract({
    prompts: [prompt],
    priorityMech,
    tools: ['manage_artifact'],
    postOnly: true,
    chainConfig: 'base',
  });
  if (!res?.request_ids?.length) throw new Error('Failed to post marketplace request');
  const requestHex = String(res.request_ids[0]);
  const txHash = String(res.transaction_hash || res.transactionHash);
  return { requestHex, txHash };
}

async function waitForRequestIndexed(requestHex: string, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await gql(
      PONDER_GRAPHQL_URL,
      'query { requests { items { id } } }'
    );
    const items: any[] = data?.requests?.items || [];
    if (items.find((i) => i.id === requestHex)) return true;
    await delay(3000);
  }
  throw new Error('Request was not indexed by Ponder within timeout');
}

async function controlApiClaim(requestHex: string) {
  if (!CONTROL_API_SERVICE_KEY || !TEST_WORKER_ADDRESS) return; // skip if not configured
  const query = `mutation($id: ID!) { claimRequest(requestId: $id) { request_id worker_address status } }`;
  const headers = { 'x-service-key': CONTROL_API_SERVICE_KEY, 'x-worker-address': TEST_WORKER_ADDRESS } as any;
  const res = await axios.post(CONTROL_API_URL, { query, variables: { id: requestHex } }, { headers });
  if (res.data?.errors) throw new Error('Control API claim error: ' + JSON.stringify(res.data.errors));
  return res.data.data.claimRequest;
}

async function controlApiClaimIdempotent(requestHex: string) {
  if (!CONTROL_API_SERVICE_KEY || !TEST_WORKER_ADDRESS) return; // skip if not configured
  const q = `mutation($id: ID!) { claimRequest(requestId: $id) { request_id worker_address status } }`;
  const headers = { 'x-service-key': CONTROL_API_SERVICE_KEY, 'x-worker-address': TEST_WORKER_ADDRESS } as any;
  const p1 = axios.post(CONTROL_API_URL, { query: q, variables: { id: requestHex } }, { headers });
  const p2 = axios.post(CONTROL_API_URL, { query: q, variables: { id: requestHex } }, { headers });
  const [r1, r2] = await Promise.all([p1, p2]);
  if (r1.data?.errors) throw new Error(JSON.stringify(r1.data.errors));
  if (r2.data?.errors) throw new Error(JSON.stringify(r2.data.errors));
  const a = r1.data.data.claimRequest;
  const b = r2.data.data.claimRequest;
  if (!(a.request_id === b.request_id && a.worker_address === b.worker_address)) {
    throw new Error('Idempotency failed: claims differ');
  }
}

async function waitForDeliver(requestHex: string, timeoutMs = 240000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await gql(
      PONDER_GRAPHQL_URL,
      'query { deliverys { items { id requestId transactionHash } } }'
    );
    const items: any[] = data?.deliverys?.items || [];
    if (items.find((i) => i.requestId === requestHex)) return true;
    await delay(5000);
  }
  throw new Error('Deliver event not observed within timeout');
}

async function main() {
  try {
    console.log('Posting marketplace job...');
    const { requestHex, txHash } = await postJob();
    console.log('Request:', requestHex, 'Tx:', txHash);

    console.log('Waiting for Ponder to index Request...');
    await waitForRequestIndexed(requestHex);
    console.log('Request indexed.');

    if (CONTROL_API_SERVICE_KEY && TEST_WORKER_ADDRESS) {
      console.log('Claiming via Control API (idempotent)...');
      await controlApiClaim(requestHex);
      await controlApiClaimIdempotent(requestHex);
      console.log('Control API claim OK.');
    } else {
      console.log('Skipping Control API tests (missing CONTROL_API_SERVICE_KEY or TEST_WORKER_ADDRESS).');
    }

    console.log('Waiting for Deliver event (ensure mech worker is running)...');
    await waitForDeliver(requestHex);
    console.log('Deliver observed. E2E test PASSED.');
    process.exit(0);
  } catch (e: any) {
    console.error('E2E test FAILED:', e?.message || e);
    process.exit(1);
  }
}

main();


