import fetch from 'cross-fetch';
import { getCurrentJobContext } from './context.js';

type RequestClaim = {
  request_id: string;
  worker_address: string;
  status: string;
  claimed_at: string;
  completed_at?: string | null;
};

type JobReportInput = {
  status: string;
  duration_ms: number;
  total_tokens?: number | null;
  tools_called?: string | null; // JSON string
  final_output?: string | null;
  error_message?: string | null;
  error_type?: string | null;
  raw_telemetry?: string | null; // JSON string
};

type ArtifactInput = {
  cid: string;
  topic: string;
  content?: string | null;
};

type MessageInput = {
  content: string;
  status?: string;
};

const CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000; // 1 second

function getWorkerAddress(): string {
  const context = getCurrentJobContext();
  if (context.mechAddress) {
    return context.mechAddress;
  }
  
  const addr = (process.env.MECH_WORKER_ADDRESS || '').trim();
  if (!addr) {
    throw new Error('MECH_WORKER_ADDRESS is required for Control API calls');
  }
  return addr;
}

function buildHeaders(requestId: string, operationType: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Worker-Address': getWorkerAddress(),
    'Idempotency-Key': `${requestId}-${operationType}-${Date.now()}`, // Simple idempotency key
  };
}

async function fetchWithRetry(
  body: { query: string; variables?: Record<string, any> },
  headers: Record<string, string>,
  attempts = RETRY_ATTEMPTS
): Promise<any> {
  let lastError: any;
  const startTime = Date.now();
  
  for (let i = 0; i < attempts; i++) {
    try {
      console.log(`[Control API] Attempt ${i + 1}/${attempts} - ${body.query.split('(')[0].split(' ')[1] || 'unknown'}`);
      
      const response = await fetch(CONTROL_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Control API HTTP error: ${response.status} - ${errorText}`);
      }

      const json = await response.json();
      if (json.errors) {
        throw new Error(`Control API GraphQL error: ${JSON.stringify(json.errors)}`);
      }
      
      const duration = Date.now() - startTime;
      console.log(`[Control API] Success in ${duration}ms - ${body.query.split('(')[0].split(' ')[1] || 'unknown'}`);
      return json;
    } catch (e: any) {
      lastError = e;
      const duration = Date.now() - startTime;
      console.warn(`[Control API] Attempt ${i + 1}/${attempts} failed after ${duration}ms: ${e?.message || String(e)}`);
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (i + 1))); // Exponential backoff
      }
    }
  }
  
  const totalDuration = Date.now() - startTime;
  throw new Error(`Failed to call Control API after ${attempts} attempts (${totalDuration}ms): ${lastError?.message || String(lastError)}`);
}

export async function claimRequest(requestId: string): Promise<{ request_id: string; status: string }> {
  const headers = buildHeaders(requestId, 'claim');
  const query = `mutation Claim($requestId: String!) { claimRequest(requestId: $requestId) { request_id status } }`;
  try {
    const json = await fetchWithRetry({ query, variables: { requestId } }, headers);
    return json.data.claimRequest;
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes('already claimed')) {
      return { request_id: requestId, status: 'IN_PROGRESS' };
    }
    throw e;
  }
}

export async function createJobReport(requestId: string, report: JobReportInput): Promise<string> {
  const headers = buildHeaders(requestId, 'report');
  const query = `mutation Report($requestId: String!, $data: JobReportInput!) { createJobReport(requestId: $requestId, reportData: $data) { id } }`;
  const json = await fetchWithRetry({ query, variables: { requestId, data: report } }, headers);
  return json.data.createJobReport.id as string;
}

export async function createArtifact(requestId: string, artifact: ArtifactInput): Promise<string> {
  const headers = buildHeaders(requestId, `artifact:${artifact.topic || 'default'}`);
  const query = `mutation Artifact($requestId: String!, $data: ArtifactInput!) { createArtifact(requestId: $requestId, artifactData: $data) { id } }`;
  const json = await fetchWithRetry({ query, variables: { requestId, data: artifact } }, headers);
  return json.data.createArtifact.id as string;
}

export async function createMessage(requestId: string, message: MessageInput): Promise<string> {
  const headers = buildHeaders(requestId, `message:${message.status || 'PENDING'}`);
  const query = `mutation Message($requestId: String!, $data: MessageInput!) { createMessage(requestId: $requestId, messageData: $data) { id } }`;
  const json = await fetchWithRetry({ query, variables: { requestId, data: message } }, headers);
  return json.data.createMessage.id as string;
}

export function isControlApiEnabled(): boolean {
  return (process.env.USE_CONTROL_API ?? 'true') !== 'false';
}

export function shouldUseControlApi(tableName: string): boolean {
  if (!isControlApiEnabled()) return false;
  
  const onchainTables = ['onchain_request_claims', 'onchain_job_reports', 'onchain_artifacts', 'onchain_messages'];
  return onchainTables.includes(tableName);
}
