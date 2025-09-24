import '../env/index.js';
import { Agent } from '../gemini-agent/agent.js';
import { deliverViaSafe } from 'mech-client-ts/dist/deliver.js';
import { Web3 } from 'web3';
// Import JSON artifact without import assertions for TS compatibility
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import agentMechArtifact from 'mech-client-ts/dist/abis/AgentMech.json';
import { workerLogger } from './logger.js';
import { claimRequest as apiClaimRequest, createJobReport as apiCreateJobReport, createArtifact as apiCreateArtifact } from './control_api_client.js';
import { extractArtifactsFromOutput, extractArtifactsFromTelemetry } from './artifacts.js';

type UnclaimedRequest = {
  id: string;           // on-chain requestId (decimal string or 0x)
  mech: string;         // mech address (0x...)
  requester: string;    // requester address (0x...)
  blockTimestamp?: number;
  ipfsHash?: string;
  delivered?: boolean;
};

const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
const SINGLE_SHOT = process.argv.includes('--single') || process.argv.includes('--single-job');
const USE_CONTROL_API = (process.env.USE_CONTROL_API ?? 'true') !== 'false';
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

// Preflight: verify requestId is currently undelivered on-chain for the target mech
async function isUndeliveredOnChain(params: { mechAddress: string; requestIdHex: string; rpcHttpUrl?: string }): Promise<boolean> {
  const { mechAddress, requestIdHex, rpcHttpUrl } = params;
  try {
    if (!rpcHttpUrl) return true; // best-effort: if no RPC provided, don't block delivery
    const abi: any = (agentMechArtifact as any)?.abi || (agentMechArtifact as any);
    const web3 = new Web3(rpcHttpUrl);
    const contract = new (web3 as any).eth.Contract(abi, mechAddress);
    const ids: string[] = await contract.methods.getUndeliveredRequestIds(100, 0).call();
    const set = new Set((ids || []).map((x: string) => String(x).toLowerCase()));
    return set.has(String(requestIdHex).toLowerCase());
  } catch {
    return true; // don't fail hard on preflight errors
  }
}

async function fetchRecentRequests(limit: number = 10): Promise<UnclaimedRequest[]> {
  try {
    // Query our local Ponder GraphQL (custom schema)
    const query = `query RecentRequests($limit: Int!) {\n  requests(orderBy: \"blockTimestamp\", orderDirection: \"desc\", limit: $limit) {\n    items {\n      id\n      mech\n      sender\n      ipfsHash\n      blockTimestamp\n      delivered\n    }\n  }\n}`;
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
    const rpcHttpUrl = process.env.MECHX_CHAIN_RPC || process.env.MECH_RPC_HTTP_URL;
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
    workerLogger.warn({ requestId: request.id, error: e?.message || String(e) }, 'Claim error');
    return false;
  }
}

async function fetchIpfsMetadata(ipfsHash?: string): Promise<{ prompt?: string; enabledTools?: string[]; sourceRequestId?: string } | null> {
  if (!ipfsHash) return null;
  try {
    const hash = String(ipfsHash).replace(/^0x/, '');
    // The marketplace stores truncated hash in some contexts; attempt direct fetch
    const url = `https://gateway.autonolas.tech/ipfs/${hash}`;
    // Add a timeout so we don't hang here
    const controller = new AbortController();
    const timeoutMs = parseInt(process.env.IPFS_FETCH_TIMEOUT_MS || '7000', 10);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const prompt = json?.prompt || json?.input || undefined;
    const enabledTools = Array.isArray(json?.enabledTools) ? json.enabledTools : undefined;
    const sourceRequestId = json?.sourceRequestId ? String(json.sourceRequestId) : undefined;
    return { prompt, enabledTools, sourceRequestId };
  } catch (e: any) {
    workerLogger.warn({ error: e?.message || String(e) }, 'Failed to fetch IPFS metadata; proceeding without it');
    return null;
  }
}

async function runAgentForRequest(request: UnclaimedRequest, metadata: any): Promise<{ output: string; telemetry: any }> {
  const model = process.env.MECH_MODEL || 'gemini-2.5-flash-lite';
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
    const payload = {
      status: error ? 'FAILED' : 'COMPLETED',
      duration_ms: result?.telemetry?.duration || 0,
      total_tokens: result?.telemetry?.totalTokens || 0,
      tools_called: JSON.stringify(result?.telemetry?.toolCalls ?? []),
      final_output: result?.output || null,
      error_message: error ? (error.message || String(error)) : null,
      error_type: error ? 'AGENT_ERROR' : null,
      raw_telemetry: JSON.stringify(result?.telemetry ?? {})
    };
    await apiCreateJobReport(request.id, payload);
  } catch {}
}

async function storeOnchainArtifact(request: UnclaimedRequest, workerAddress: string, cid: string, topic: string, content?: string): Promise<void> {
  try {
    const data = { cid, topic, content: content || null };
    await apiCreateArtifact(request.id, data);
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

  // Optional: target a specific request id if provided (for deterministic tests)
  const targetIdEnv = (process.env.MECH_TARGET_REQUEST_ID || '').trim();
  let filtered = candidates;
  if (targetIdEnv) {
    const targetHex = targetIdEnv.startsWith('0x') ? targetIdEnv.toLowerCase() : ('0x' + BigInt(targetIdEnv).toString(16)).toLowerCase();
    filtered = candidates.filter(c => {
      const idHex = String(c.id).startsWith('0x') ? String(c.id).toLowerCase() : ('0x' + BigInt(String(c.id)).toString(16)).toLowerCase();
      return idHex === targetHex;
    });
    if (filtered.length === 0) {
      workerLogger.info({ target: targetHex }, 'Target request not found among candidates');
      return;
    }
  }

  // Iterate candidates until we claim one successfully
  let target: UnclaimedRequest | null = null;
  for (const c of filtered) {
    const ok = await tryClaim(c, workerAddress);
    if (ok) { target = c; break; }
  }
  if (!target) return;
  let result: any = { output: '', telemetry: {} };
  let error: any = null;
  try {
    const metadata = await fetchIpfsMetadata(target.ipfsHash);
    result = await runAgentForRequest(target, metadata);
    // Extract artifacts produced during the run (from tool outputs)
    const artifacts = [
      ...extractArtifactsFromOutput(result?.output || ''),
      ...extractArtifactsFromTelemetry(result?.telemetry || {})
    ];
    if (artifacts.length > 0) {
      (result as any).artifacts = artifacts;
      // Persist via Control API for queryability immediately (optional)
      for (const a of artifacts) {
        try { await apiCreateArtifact(target.id, { cid: a.cid, topic: a.topic, content: null }); } catch {}
      }
    }
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
  // Marking claim completed is handled by Control API upon report creation

  // Attempt on-chain delivery via Safe when configured
  try {
    const chainConfig = process.env.MECH_CHAIN_CONFIG || 'base';
    const safeAddress = process.env.MECH_SAFE_ADDRESS || '';
    const targetMechAddress = target.mech;
    const privateKeyEnv = (process.env.MECH_PRIVATE_KEY || '').trim();
    const privateKeyPath = process.env.MECH_PRIVATE_KEY_PATH || 'mech_private_key.txt';
    const rpcHttpUrl = process.env.MECHX_CHAIN_RPC || process.env.MECH_RPC_HTTP_URL;
    if (safeAddress && targetMechAddress) {
      // Preflight: ensure request is still undelivered on-chain before constructing Safe tx
      const requestIdHex = String(target.id).startsWith('0x') ? String(target.id) : '0x' + BigInt(String(target.id)).toString(16);
      const ok = await isUndeliveredOnChain({ mechAddress: targetMechAddress, requestIdHex, rpcHttpUrl });
      if (!ok) {
        workerLogger.info({ requestId: target.id }, 'Preflight: request already delivered or not eligible; skipping Safe delivery');
        return;
      }

      const payload = {
        chainConfig,
        requestId: String(target.id),
        resultContent: {
          requestId: String(target.id),
          output: result?.output || '',
          telemetry: result?.telemetry || {},
          artifacts: Array.isArray((result as any)?.artifacts) ? (result as any).artifacts : []
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
    // Record a FAILED status so the claim does not remain IN_PROGRESS
    try {
      await apiCreateJobReport(target.id, {
        status: 'FAILED',
        duration_ms: result?.telemetry?.duration || 0,
        total_tokens: result?.telemetry?.totalTokens || 0,
        tools_called: JSON.stringify(result?.telemetry?.toolCalls ?? []),
        final_output: typeof result?.output === 'string' ? result.output : JSON.stringify(result?.output ?? ''),
        error_message: e?.message || String(e),
        error_type: 'DELIVERY_ERROR',
        raw_telemetry: JSON.stringify(result?.telemetry ?? {}),
      } as any);
    } catch (reportErr: any) {
      workerLogger.warn({ requestId: target.id, error: reportErr?.message || String(reportErr) }, 'Failed to record FAILED status');
    }
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
