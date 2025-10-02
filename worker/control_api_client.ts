import 'dotenv/config';

type Json = Record<string, any> | any[] | string | number | boolean | null;

export type JobReportInput = {
  status: string;
  duration_ms: number;
  total_tokens?: number;
  tools_called?: Json;
  final_output?: string | null;
  error_message?: string | null;
  error_type?: string | null;
  raw_telemetry?: Json;
};

export type ArtifactInput = {
  cid: string;
  topic: string;
  content?: string | null;
};

export type MessageInput = {
  content: string;
  status?: string;
};

const CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';

function getWorkerAddress(): string {
  const addr = (process.env.MECH_ADDRESS || process.env.MECH_WORKER_ADDRESS || '').trim();
  if (!addr) throw new Error('MECH_ADDRESS is required for Control API calls');
  return addr;
}

function buildHeaders(requestId: string, phase: string): Record<string, string> {
  const worker = getWorkerAddress();
  const idem = `${requestId}:${phase}`;
  return {
    'Content-Type': 'application/json',
    'X-Worker-Address': worker,
    'Idempotency-Key': idem,
  };
}

async function fetchWithRetry(body: any, headers: Record<string, string>, attempt = 0): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(CONTROL_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    } as any);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok || !json || json.errors) {
      const msg = json?.errors?.map((e: any) => e?.message).join('; ') || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  } catch (err) {
    if (attempt < 3) {
      const backoffMs = Math.pow(2, attempt) * 500;
      await new Promise(r => setTimeout(r, backoffMs));
      return fetchWithRetry(body, headers, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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

export async function claimTransactionRequest(): Promise<any | null> {
  const headers = {
    'Content-Type': 'application/json',
    'X-Worker-Address': getWorkerAddress(),
    'Idempotency-Key': `tx-claim:${Date.now()}`,
  };
  const query = `mutation { claimTransactionRequest { id request_id worker_address chain_id execution_strategy status payload tx_hash safe_tx_hash error_code error_message created_at updated_at } }`;
  const json = await fetchWithRetry({ query, variables: {} }, headers);
  return json.data?.claimTransactionRequest ?? null;
}

export async function updateTransactionStatus(args: { id: string; status: string; safe_tx_hash?: string; tx_hash?: string; error_code?: string; error_message?: string }): Promise<any> {
  const headers = {
    'Content-Type': 'application/json',
    'X-Worker-Address': getWorkerAddress(),
    'Idempotency-Key': `tx-update:${args.id}:${args.status}`,
  };
  const query = `mutation UpdateTx($id: String!, $status: String!, $safe_tx_hash: String, $tx_hash: String, $error_code: String, $error_message: String) { updateTransactionStatus(id: $id, status: $status, safe_tx_hash: $safe_tx_hash, tx_hash: $tx_hash, error_code: $error_code, error_message: $error_message) { id status tx_hash safe_tx_hash error_code error_message updated_at } }`;
  const variables = { ...args } as any;
  const json = await fetchWithRetry({ query, variables }, headers);
  return json.data.updateTransactionStatus;
}


