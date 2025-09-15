import '../env/index.js';
import { readRecords } from '../gemini-agent/mcp/tools/read-records.js';
import { createRecord } from '../gemini-agent/mcp/tools/create-record.js';
import { updateRecords } from '../gemini-agent/mcp/tools/update-records.js';
import { Agent } from '../gemini-agent/agent.js';
import { deliverViaSafe } from '../../mech-client-ts/dist/deliver.js';
import { workerLogger } from './logger.js';

type UnclaimedRequest = {
  id: string;           // on-chain requestId (decimal string or 0x)
  mech: string;         // mech address (0x...)
  requester: string;    // requester address (0x...)
  blockTimestamp?: number;
  ipfsHash?: string;
};

const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
const SINGLE_SHOT = process.argv.includes('--single');
const STALE_MINUTES = parseInt(process.env.MECH_RECLAIM_AFTER_MINUTES || '10', 10);

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

async function fetchRecentRequests(limit: number = 10): Promise<UnclaimedRequest[]> {
  try {
    // Query our local Ponder GraphQL (custom schema)
    const query = `query RecentRequests($limit: Int!) {\n  requests(orderBy: \"blockTimestamp\", orderDirection: \"desc\", limit: $limit) {\n    items {\n      id\n      mech\n      sender\n      ipfsHash\n      blockTimestamp\n    }\n  }\n}`;
    const res = await fetch(PONDER_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { limit } })
    });
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
    const json = await res.json();
    const items: any[] = json?.data?.requests?.items || [];
    return items.map((r: any) => ({
      id: String(r.id),
      mech: String(r.mech),
      requester: String(r.sender || ''),
      ipfsHash: r?.ipfsHash ? String(r.ipfsHash) : undefined,
      blockTimestamp: Number(r.blockTimestamp)
    })) as UnclaimedRequest[];
  } catch (e) {
    workerLogger.warn({ error: e instanceof Error ? e.message : String(e) }, 'Ponder GraphQL not reachable; returning empty set');
    return [];
  }
}

async function filterUnclaimed(requests: UnclaimedRequest[]): Promise<UnclaimedRequest[]> {
  if (requests.length === 0) return [];
  const ids = requests.map(r => r.id);
  try {
    const res = await readRecords({ table_name: 'onchain_request_claims', filter: { request_id: ids } });
    const parsed = safeParseToolResponse(res);
    if (!parsed.ok) return requests;
    const claimed: any[] = Array.isArray(parsed.data) ? parsed.data : (parsed.data?.data ?? []);
    const claimedSet = new Set((claimed || []).map((r: any) => String(r.request_id)));
    return requests.filter(r => !claimedSet.has(r.id));
  } catch {
    return requests;
  }
}

async function getExistingClaim(requestId: string): Promise<any | null> {
  try {
    const res = await readRecords({ table_name: 'onchain_request_claims', filter: { request_id: requestId }, limit: 1 });
    const parsed = safeParseToolResponse(res);
    if (!parsed.ok) return null;
    const rows: any[] = Array.isArray(parsed.data) ? parsed.data : (parsed.data?.data ?? []);
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

async function tryClaim(request: UnclaimedRequest, workerAddress: string): Promise<boolean> {
  try {
    // Check if already claimed and possibly stale
    const existing = await getExistingClaim(request.id);
    if (existing) {
      const status = String(existing.status || '');
      const claimedAt = existing.claimed_at ? new Date(existing.claimed_at) : null;
      const ageMinutes = claimedAt ? (Date.now() - claimedAt.getTime()) / 60000 : 0;
      const isStale = status === 'IN_PROGRESS' && ageMinutes > STALE_MINUTES;
      if (!isStale) {
        workerLogger.info({ requestId: request.id, status }, 'Request already claimed');
        return false;
      }
      // Reclaim stale entry by updating owner and timestamp
      const up = await updateRecords({
        table_name: 'onchain_request_claims',
        filter: { request_id: request.id, status: 'IN_PROGRESS' },
        updates: { worker_address: workerAddress, claimed_at: new Date().toISOString() }
      });
      const upd = safeParseToolResponse(up);
      if (!upd.ok) {
        workerLogger.info({ requestId: request.id, reason: upd.message }, 'Stale reclaim failed');
        return false;
      }
      workerLogger.info({ requestId: request.id }, 'Reclaimed stale request');
      return true;
    }

    // Fresh claim
    const res = await createRecord({
      table_name: 'onchain_request_claims',
      data: {
        request_id: request.id,
        worker_address: workerAddress,
        status: 'IN_PROGRESS'
      }
    });
    const parsed = safeParseToolResponse(res);
    if (!parsed.ok) {
      workerLogger.info({ requestId: request.id, reason: parsed.message }, 'Claim failed (likely already claimed)');
      return false;
    }
    workerLogger.info({ requestId: request.id, mech: request.mech }, 'Claimed request');
    return true;
  } catch (e: any) {
    workerLogger.warn({ requestId: request.id, error: e?.message || String(e) }, 'Claim error');
    return false;
  }
}

async function fetchIpfsMetadata(ipfsHash?: string): Promise<{ prompt?: string; enabledTools?: string[]; parentRequestId?: string } | null> {
  if (!ipfsHash) return null;
  try {
    const hash = String(ipfsHash).replace(/^0x/, '');
    // The marketplace stores truncated hash in some contexts; attempt direct fetch
    const url = `https://gateway.autonolas.tech/ipfs/${hash}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const json = await res.json();
    const prompt = json?.prompt || json?.input || undefined;
    const enabledTools = Array.isArray(json?.enabledTools) ? json.enabledTools : undefined;
    const parentRequestId = json?.parentRequestId ? String(json.parentRequestId) : undefined;
    return { prompt, enabledTools, parentRequestId };
  } catch {
    return null;
  }
}

async function runAgentForRequest(request: UnclaimedRequest, metadata: any): Promise<{ output: string; telemetry: any }> {
  const model = process.env.MECH_MODEL || 'gemini-2.5-pro';
  const enabledTools = Array.isArray(metadata?.enabledTools) ? metadata.enabledTools : [];
  const agent = new Agent(model, enabledTools, {
    jobId: request.id,
    jobDefinitionId: null,
    jobName: 'Onchain Task',
    projectRunId: null,
    sourceEventId: null,
    projectDefinitionId: null
  });
  const prompt = String(metadata?.prompt || '').trim() || `Process request ${request.id} for mech ${request.mech}`;
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

async function storeOnchainReport(request: UnclaimedRequest, workerAddress: string, result: { output: string; telemetry: any }, error?: any): Promise<void> {
  try {
    await createRecord({
      table_name: 'onchain_job_reports',
      data: {
        request_id: request.id,
        worker_address: workerAddress,
        status: error ? 'FAILED' : 'COMPLETED',
        duration_ms: result?.telemetry?.duration || 0,
        total_tokens: result?.telemetry?.totalTokens || 0,
        tools_called: result?.telemetry?.toolCalls || [],
        final_output: result?.output || null,
        error_message: error ? (error.message || String(error)) : null,
        error_type: error ? 'AGENT_ERROR' : null,
        raw_telemetry: result?.telemetry || {}
      }
    });
  } catch {}
}

async function storeOnchainArtifact(request: UnclaimedRequest, workerAddress: string, cid: string, topic: string, content?: string): Promise<void> {
  try {
    await createRecord({
      table_name: 'onchain_artifacts',
      data: {
        request_id: request.id,
        worker_address: workerAddress,
        cid,
        topic,
        content: content || null
      }
    });
  } catch {}
}

async function processOnce(): Promise<void> {
  const workerAddress = process.env.MECH_WORKER_ADDRESS || '';
  if (!workerAddress) {
    workerLogger.error('Missing MECH_WORKER_ADDRESS environment variable');
    return;
  }

  const recent = await fetchRecentRequests(10);
  const candidates = await filterUnclaimed(recent);
  if (candidates.length === 0) {
    workerLogger.info('No unclaimed on-chain requests found');
    return;
  }

  const target = candidates[0];
  const claimed = await tryClaim(target, workerAddress);
  if (!claimed) return;
  let result: any = { output: '', telemetry: {} };
  let error: any = null;
  try {
    const metadata = await fetchIpfsMetadata(target.ipfsHash);
    result = await runAgentForRequest(target, metadata);
    workerLogger.info({ requestId: target.id }, 'Execution completed');
  } catch (e: any) {
    error = e;
    workerLogger.error({ requestId: target.id, error: e?.message || String(e) }, 'Execution failed');
  }
  await storeOnchainReport(target, workerAddress, result, error);
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
  // Mark claim as completed
  try {
    await updateRecords({
      table_name: 'onchain_request_claims',
      filter: { request_id: target.id },
      updates: { status: 'COMPLETED', completed_at: new Date().toISOString() }
    });
  } catch {}

  // Attempt on-chain delivery via Safe when configured
  try {
    const chainConfig = process.env.MECH_CHAIN_CONFIG || 'base';
    const safeAddress = process.env.MECH_SAFE_ADDRESS || '';
    const targetMechAddress = target.mech;
    const privateKeyEnv = (process.env.MECH_PRIVATE_KEY || '').trim();
    const privateKeyPath = process.env.MECH_PRIVATE_KEY_PATH || 'mech_private_key.txt';
    const rpcHttpUrl = process.env.MECHX_CHAIN_RPC || process.env.MECH_RPC_HTTP_URL;
    if (safeAddress && targetMechAddress) {
      const payload = {
        chainConfig,
        requestId: String(target.id),
        resultContent: {
          requestId: String(target.id),
          output: result?.output || '',
          telemetry: result?.telemetry || {}
        },
        targetMechAddress,
        safeAddress,
        // Prefer inline env private key when provided; otherwise fall back to path
        ...(privateKeyEnv ? { privateKey: privateKeyEnv } : { privateKeyPath }),
        ...(rpcHttpUrl ? { rpcHttpUrl } : {}),
        wait: true
      } as const;
      const delivery = await (deliverViaSafe as any)(payload);
      workerLogger.info({ requestId: target.id, tx: delivery?.tx_hash, status: delivery?.status }, 'Delivered via Safe');
    }
  } catch (e: any) {
    workerLogger.warn({ requestId: target.id, error: e?.message || String(e) }, 'Safe delivery failed');
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
      await processOnce();
    } catch (e: any) {
      workerLogger.error({ error: e?.message || String(e) }, 'Error in mech loop');
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(() => process.exit(1));


