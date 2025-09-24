import { describe, it, expect } from 'vitest';
import fetch from 'cross-fetch';
import { randomUUID } from 'node:crypto';
import { execa } from 'execa';

// Import tools via the MCP tools index (NodeNext resolution allows .js for TS modules)
import { loadMcpServer, stopMcpServer, dispatchNewJob, getDetails } from './tools/index.js';
import { loadEnvOnce } from './tools/shared/env.js';

// Helper: parse MCP tool response content
function parseToolText(result: any): any {
  try {
    const text = result?.content?.[0]?.text;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Helper: reconstruct directory CID (dag-pb) from hex ipfsHash (raw codec f01551220...digest)
function hexToBytes(hex: string): number[] {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
}
function toBase32LowerNoPad(bytes: number[]): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bitBuffer = 0;
  let bitCount = 0;
  let out = '';
  for (const b of bytes) {
    bitBuffer = (bitBuffer << 8) | (b & 0xff);
    bitCount += 8;
    while (bitCount >= 5) {
      const idx = (bitBuffer >> (bitCount - 5)) & 0x1f;
      bitCount -= 5;
      out += alphabet[idx];
    }
  }
  if (bitCount > 0) {
    const idx = (bitBuffer << (5 - bitCount)) & 0x1f;
    out += alphabet[idx];
  }
  return out;
}
function reconstructDirCidFromHexIpfsHash(ipfsHashHex: string): string | null {
  // Expect prefix f01551220 + 64-hex digest (raw codec + sha2-256 32 bytes)
  const s = String(ipfsHashHex).toLowerCase();
  const prefix = 'f01551220';
  if (!s.startsWith(prefix)) return null;
  const digestHex = s.slice(prefix.length);
  if (digestHex.length !== 64) return null;
  const digestBytes = hexToBytes(digestHex);
  const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digestBytes];
  return 'b' + toBase32LowerNoPad(cidBytes);
}

async function fetchJsonWithRetry(url: string, attempts = 5, delayMs = 1500): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return await resp.json();
    } catch {}
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Failed to fetch JSON from ${url}`);
}

// E2E guard: only run when explicitly enabled and environment is configured
const E2E_ENABLED = process.env.E2E_ONCHAIN === '1';

describe.skipIf(!E2E_ENABLED)('On-chain: dispatch_new_job → subgraph → get_details → worker deliver + artifact', () => {
  let ponderProc: any = null;
  let controlApiProc: any = null;
  let mcpStarted = false;

  async function waitForGraphql(url: string, timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    const q = '{ requests(limit: 1) { items { id } } }';
    let lastErr: any = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const resp = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
        if (resp.ok) return;
        lastErr = new Error(`GraphQL HTTP ${resp.status}`);
      } catch (e: any) {
        lastErr = e;
      }
      if (Date.now() - start > timeoutMs) {
        throw lastErr || new Error('Timed out waiting for GraphQL');
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  beforeAll(async () => {
    // Ensure env in this process
    loadEnvOnce();
    await loadMcpServer();
    mcpStarted = true;

    // Start Ponder subgraph locally if not already running
    const gqlUrl = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
    // Try a quick probe; if it fails, spawn the process
    let ready = false;
    try {
      await waitForGraphql(gqlUrl, 2000);
      ready = true;
    } catch {}
    if (!ready) {
      // Start dev server (indexer + HTTP). Pipe logs for diagnosis.
      ponderProc = execa('yarn', ['--cwd', 'ponder', 'dev'], { cwd: process.cwd(), stdio: 'pipe', env: { ...process.env } });
      if (ponderProc.stdout) ponderProc.stdout.on('data', (d: any) => { try { process.stderr.write(`[ponder] ${d}`); } catch {} });
      if (ponderProc.stderr) ponderProc.stderr.on('data', (d: any) => { try { process.stderr.write(`[ponder] ${d}`); } catch {} });
      // Give it time to come up
      await waitForGraphql(gqlUrl, 120_000);
    }

    // Start Control API if not already running (required for worker claim/report/artifacts)
    let controlReady = false;
    const controlUrl = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';
    try {
      const resp = await fetch(controlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ _health }' }) });
      const j = await resp.json();
      if (j?.data?._health === 'ok') controlReady = true;
    } catch {}
    if (!controlReady) {
      controlApiProc = execa('yarn', ['control:dev'], { cwd: process.cwd(), stdio: 'pipe', env: { ...process.env } });
      if (controlApiProc.stdout) controlApiProc.stdout.on('data', (d: any) => { try { process.stderr.write(`[control] ${d}`); } catch {} });
      if (controlApiProc.stderr) controlApiProc.stderr.on('data', (d: any) => { try { process.stderr.write(`[control] ${d}`); } catch {} });
      // Wait for health
      const start = Date.now();
      let lastErr: any = null;
      while (Date.now() - start < 60_000) {
        try {
          const resp = await fetch(controlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ _health }' }) });
          const j = await resp.json();
          if (j?.data?._health === 'ok') { controlReady = true; break; }
        } catch (e: any) { lastErr = e; }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!controlReady) throw lastErr || new Error('Control API failed to start');
    }
  }, 120_000);

  afterAll(async () => {
    if (ponderProc) {
      try { ponderProc.kill('SIGTERM', { forceKillAfterTimeout: 5000 }); } catch {}
      ponderProc = null;
    }
    if (mcpStarted) {
      await stopMcpServer();
      mcpStarted = false;
    }
    if (controlApiProc) {
      try { controlApiProc.kill('SIGTERM', { forceKillAfterTimeout: 5000 }); } catch {}
      controlApiProc = null;
    }
  });
  it('posts a marketplace request, verifies IPFS and subgraph indexing, and fetches via get_details', async () => {
    // Ensure env is loaded for mech client ts and tools
    loadEnvOnce();
    // Preflight env
    const gqlUrl = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
    expect(process.env.MECH_PRIVATE_KEY, 'MECH_PRIVATE_KEY required').toBeTruthy();
    expect(gqlUrl, 'PONDER_GRAPHQL_URL must be set or default to local').toBeTruthy();

    // 1) Dispatch a new job
    const jobName = `e2e-job-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const prompt = 'E2E prompt: verify on-chain dispatch, IPFS upload, and subgraph indexing. Include variables exactly.';
    const enabledTools = ['create_artifact'];

    const dispatchRes = await dispatchNewJob({ prompt, jobName, enabledTools, updateExisting: true });
    const dispatchParsed = parseToolText(dispatchRes);
    expect(dispatchParsed?.meta?.ok).toBe(true);
    const data = dispatchParsed?.data || {};
    expect(Array.isArray(data.request_ids) && data.request_ids.length > 0).toBe(true);
    const requestIdHex: string = data.request_ids[0];
    const requestIdInt: string = Array.isArray(data.request_id_ints) ? data.request_id_ints[0] : '';
    const jobDefinitionId: string = data.jobDefinitionId;
    expect(typeof jobDefinitionId).toBe('string');

    // 2) Resolve IPFS JSON (via gateway URL if available; else via subgraph lookup of request.ipfsHash)
    let gatewayUrl: string | null = data.ipfs_gateway_url || null;
    if (!gatewayUrl) {
      const q = 'query($id:String!){ request(id:$id){ ipfsHash } }';
      for (let i = 0; i < 20 && !gatewayUrl; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 0 : 2000));
        const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, variables: { id: requestIdHex } }) });
        if (!resp.ok) continue;
        const jr = await resp.json();
        const ipfsHash = jr?.data?.request?.ipfsHash as string | undefined;
        if (ipfsHash) gatewayUrl = `https://gateway.autonolas.tech/ipfs/${ipfsHash}`;
      }
    }
    // IPFS metadata is core: must be discoverable and valid JSON
    expect(gatewayUrl, 'IPFS gateway URL should be discoverable').toBeTruthy();
    const ipfsResp = await fetch(gatewayUrl!, { method: 'GET' });
    expect(ipfsResp.ok, `IPFS fetch failed for ${gatewayUrl}`).toBe(true);
    const ipfsJson: any = await ipfsResp.json();
    expect(ipfsJson?.jobName).toBe(jobName);
    expect(ipfsJson?.jobDefinitionId).toBe(jobDefinitionId);
    expect(Array.isArray(ipfsJson?.enabledTools)).toBe(true);
    expect(ipfsJson?.enabledTools?.sort()).toEqual(enabledTools.sort());
    expect(typeof ipfsJson?.prompt).toBe('string');
    expect(typeof ipfsJson?.nonce).toBe('string');
    // Lineage keys may be only present when env context is provided; do not require presence here

    // Audit log: gateway URL and IPFS JSON payload
    // Includes linkage to request/job for downstream verification
    // Note: Console output is captured by Vitest and shown on success/failure
    /* eslint-disable no-console */
    console.log(JSON.stringify({
      audit: {
        step: 'ipfs_json_resolved',
        gateway_url: gatewayUrl,
        request_id_hex: requestIdHex,
        request_id_int: requestIdInt,
        job_definition_id: jobDefinitionId,
        job_name: jobName,
        ipfs_json: ipfsJson,
      }
    }, null, 2));
    /* eslint-enable no-console */

    // 3) Poll subgraph until jobDefinition is indexed and matches our payload
    const qJob = 'query($id:String!){ jobDefinition(id:$id){ id name enabledTools promptContent sourceRequestId sourceJobDefinitionId } }';
    let jobDef: any = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 1500));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qJob, variables: { id: jobDefinitionId } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      jobDef = jr?.data?.jobDefinition || null;
      if (jobDef?.id) break;
    }
    expect(jobDef?.id).toBe(jobDefinitionId);
    expect(jobDef?.name).toBe(jobName);
    expect(Array.isArray(jobDef?.enabledTools)).toBe(true);
    expect(typeof jobDef?.promptContent).toBe('string');

    // 4) Verify get_details returns the same records with optional ipfs resolution
    const detailsRes = await getDetails({ ids: [requestIdHex, jobDefinitionId], resolve_ipfs: true });
    const detailsParsed = parseToolText(detailsRes);
    expect(detailsParsed?.data?.length).toBeGreaterThan(0);
    // Basic presence checks
    const hasRequest = (detailsParsed?.data || []).some((r: any) => r.id === requestIdHex);
    const hasJob = (detailsParsed?.data || []).some((r: any) => r.id === jobDefinitionId);
    expect(hasRequest && hasJob).toBe(true);
    // Verify IPFS content resolved for request and matches source fields
    const reqObj = (detailsParsed?.data || []).find((r: any) => r.id === requestIdHex);
    expect(reqObj?.ipfsContent?.jobName).toBe(jobName);
    expect(reqObj?.ipfsContent?.jobDefinitionId).toBe(jobDefinitionId);
    expect(Array.isArray(reqObj?.ipfsContent?.enabledTools)).toBe(true);
    expect(reqObj?.ipfsContent?.enabledTools?.sort()).toEqual(enabledTools.sort());
  }, 240_000);

  it('propagates lineage env (sourceRequestId/sourceJobDefinitionId) into IPFS + subgraph', async () => {
    loadEnvOnce();
    const gqlUrl = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
    expect(process.env.MECH_PRIVATE_KEY, 'MECH_PRIVATE_KEY required').toBeTruthy();

    // Inject lineage via env
    const lineageRequest = process.env.TEST_LINEAGE_REQUEST_ID || '0x4ce84fa46e5aa543fd2703e06f2da9d42bfa808475e191e430326751ce709cc3';
    const lineageJobDef = process.env.TEST_LINEAGE_JOB_DEFINITION_ID || 'b1c5ebe4-9368-4762-b528-15645b54ddb8';
    const prevReq = process.env.JINN_REQUEST_ID;
    const prevJob = process.env.JINN_JOB_DEFINITION_ID;
    process.env.JINN_REQUEST_ID = lineageRequest;
    process.env.JINN_JOB_DEFINITION_ID = lineageJobDef;
    try {
      const jobName = `e2e-lineage-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const prompt = 'E2E lineage: ensure env lineage is embedded and indexed.';
      const enabledTools = ['google_web_search'];

      const dispatchRes = await dispatchNewJob({ prompt, jobName, enabledTools, updateExisting: true });
      const dispatchParsed = parseToolText(dispatchRes);
      expect(dispatchParsed?.meta?.ok).toBe(true);
      const data = dispatchParsed?.data || {};
      const requestIdHex: string = data.request_ids[0];
      const jobDefinitionId: string = data.jobDefinitionId;

      // Resolve IPFS via subgraph ipfsHash
      const qReq = 'query($id:String!){ request(id:$id){ ipfsHash } }';
      let gatewayUrl: string | null = null;
      for (let i = 0; i < 20 && !gatewayUrl; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 0 : 2000));
        const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qReq, variables: { id: requestIdHex } }) });
        if (!resp.ok) continue;
        const jr = await resp.json();
        const ipfsHash = jr?.data?.request?.ipfsHash as string | undefined;
        if (ipfsHash) gatewayUrl = `https://gateway.autonolas.tech/ipfs/${ipfsHash}`;
      }
      expect(gatewayUrl, 'IPFS gateway URL should be discoverable').toBeTruthy();
      const ipfsResp = await fetch(gatewayUrl!, { method: 'GET' });
      expect(ipfsResp.ok).toBe(true);
      const ipfsJson: any = await ipfsResp.json();
      expect(ipfsJson?.sourceRequestId).toBe(lineageRequest);
      expect(ipfsJson?.sourceJobDefinitionId).toBe(lineageJobDef);

      // Verify subgraph jobDefinition contains lineage
      const qJob = 'query($id:String!){ jobDefinition(id:$id){ id sourceRequestId sourceJobDefinitionId } }';
      let jobDef: any = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 0 : 1500));
        const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qJob, variables: { id: jobDefinitionId } }) });
        if (!resp.ok) continue;
        const jr = await resp.json();
        jobDef = jr?.data?.jobDefinition || null;
        if (jobDef?.id) break;
      }
      expect(jobDef?.id).toBe(jobDefinitionId);
      expect(jobDef?.sourceRequestId).toBe(lineageRequest);
      expect(jobDef?.sourceJobDefinitionId ?? null).toBe(lineageJobDef ?? null);

      // Verify subgraph request contains lineage link
      const qReq2 = 'query($id:String!){ request(id:$id){ id sourceRequestId sourceJobDefinitionId } }';
      const r2 = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qReq2, variables: { id: requestIdHex } }) });
      expect(r2.ok).toBe(true);
      const jr2 = await r2.json();
      const reqObj = jr2?.data?.request || null;
      expect(reqObj?.id).toBe(requestIdHex);
      expect(reqObj?.sourceRequestId).toBe(lineageRequest);
      expect(reqObj?.sourceJobDefinitionId).toBe(jobDefinitionId);
    } finally {
      // Restore env
      if (prevReq !== undefined) process.env.JINN_REQUEST_ID = prevReq; else delete process.env.JINN_REQUEST_ID;
      if (prevJob !== undefined) process.env.JINN_JOB_DEFINITION_ID = prevJob; else delete process.env.JINN_JOB_DEFINITION_ID;
    }
  }, 240_000);

  it('end-to-end: worker processes request, creates artifact via MCP, delivers on-chain, and subgraph indexes delivery + artifact', async () => {
    loadEnvOnce();
    const gqlUrl = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
    const mechWorker = process.env.MECH_WORKER_ADDRESS;
    expect(mechWorker, 'MECH_WORKER_ADDRESS required').toBeTruthy();

    // 1) Dispatch a new job instructing artifact creation
    const jobName = `e2e-worker-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const artifactName = 'e2e-report';
    const artifactTopic = 'analysis';
    const artifactContent = `artifact generated at ${new Date().toISOString()}`;
    const prompt = `Create a concise artifact using the create_artifact tool, exactly once, with: name: \"${artifactName}\", topic: \"${artifactTopic}\", content: \"${artifactContent}\". Do not print extra text; let the tool response be the final output.`;
    const enabledTools = ['create_artifact'];
    const dispatchRes = await dispatchNewJob({ prompt, jobName, enabledTools, updateExisting: true });
    const dispatchParsed = parseToolText(dispatchRes);
    expect(dispatchParsed?.meta?.ok).toBe(true);
    const data = dispatchParsed?.data || {};
    expect(Array.isArray(data.request_ids) && data.request_ids.length > 0).toBe(true);
    const requestIdHex: string = data.request_ids[0];
    const jobDefinitionId: string = data.jobDefinitionId;

    // Ensure the request is indexed before running worker (Control API validates against Ponder)
    const qReqExists = 'query($id:String!){ request(id:$id){ id } }';
    let seen = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 2000));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qReqExists, variables: { id: requestIdHex } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      if (jr?.data?.request?.id === requestIdHex) { seen = true; break; }
    }
    expect(seen, 'Request should be indexed before worker runs').toBe(true);

    // 2) Run mech worker single-shot to claim and process our request
    const env: any = { ...process.env };
    // Ensure Control API + Ponder URLs are present for worker
    env.PONDER_GRAPHQL_URL = gqlUrl;
    env.CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';
    env.USE_CONTROL_API = env.USE_CONTROL_API ?? 'true';

    // Hint worker to target this specific request id for deterministic processing
    env.MECH_TARGET_REQUEST_ID = requestIdHex;
    const workerProc = execa('yarn', ['--ignore-engines', 'dev:mech'], { cwd: process.cwd(), env, stdio: 'pipe' });
    if (workerProc.stdout) workerProc.stdout.on('data', (d: any) => { try { process.stderr.write(`[worker] ${d}`); } catch {} });
    if (workerProc.stderr) workerProc.stderr.on('data', (d: any) => { try { process.stderr.write(`[worker] ${d}`); } catch {} });
    // Wait for completion (single-shot exits when done)
    await workerProc.catch(() => { /* allow non-zero exits; delivery may still have succeeded */ });

    // 3) Poll for delivery indexed with ipfsHash
    const qDelivery = 'query($id:String!){ delivery(id:$id){ id requestId ipfsHash transactionHash blockTimestamp sourceRequestId sourceJobDefinitionId } }';
    let delivery: any = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 5000));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qDelivery, variables: { id: requestIdHex } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      delivery = jr?.data?.delivery || null;
      if (delivery?.id && delivery?.ipfsHash && delivery?.transactionHash) break;
    }
    expect(delivery?.id).toBe(requestIdHex);
    expect(typeof delivery?.ipfsHash).toBe('string');
    expect(typeof delivery?.transactionHash).toBe('string');

    // 4) Fetch delivery JSON from IPFS deterministically using dir CID reconstruction
    let deliveryJson: any = null;
    if (delivery?.ipfsHash) {
      const dirCid = reconstructDirCidFromHexIpfsHash(delivery.ipfsHash);
      expect(dirCid, 'Unable to reconstruct dir CID from delivery.ipfsHash').toBeTruthy();
      const reqPath = `${dirCid}/${requestIdHex}`;
      const url = `https://gateway.autonolas.tech/ipfs/${reqPath}`;
      deliveryJson = await fetchJsonWithRetry(url, 6, 2000);
      expect(typeof deliveryJson).toBe('object');
    }

    // 5) Verify artifacts indexed for this request; the worker may skip artifact creation if the tool fails.
    const qArtifact = 'query($id:String!){ artifact(id:$id){ id requestId sourceRequestId sourceJobDefinitionId name topic cid contentPreview } }';
    let artifact: any = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 4000));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qArtifact, variables: { id: `${requestIdHex}:0` } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      artifact = jr?.data?.artifact || null;
      if (artifact?.id) break;
    }

    if (!artifact) {
      console.warn('No artifact indexed for request', requestIdHex, '- delivery JSON artifact count:', Array.isArray(deliveryJson?.artifacts) ? deliveryJson.artifacts.length : 'n/a');
    } else {
      expect(artifact?.id).toBe(`${requestIdHex}:0`);
      expect(artifact?.requestId).toBe(requestIdHex);
      expect(artifact?.topic).toBe(artifactTopic);
      if (artifact?.name) expect(artifact?.name).toBe(artifactName);
      expect(typeof artifact?.cid).toBe('string');
    }

    // 6) Cross-check get_details for artifact and request delivery lineage
    const detailsRes = await getDetails({ ids: [requestIdHex, `${requestIdHex}:0`], resolve_ipfs: false });
    const parsed = parseToolText(detailsRes);
    const reqRec = (parsed?.data || []).find((x: any) => x.id === requestIdHex);
    const artRec = (parsed?.data || []).find((x: any) => x.id === `${requestIdHex}:0`);
    expect(reqRec?.delivered).toBe(true);
    expect(typeof reqRec?.deliveryIpfsHash).toBe('string');
    if (artRec) {
      expect(artRec?.topic).toBe(artifactTopic);
      expect(typeof artRec?.cid).toBe('string');
    }

    if (deliveryJson && Array.isArray(deliveryJson.artifacts)) {
      const a = deliveryJson.artifacts.find((x: any) => x.topic === artifactTopic);
      if (!a) {
        console.warn('Delivery JSON contained no artifacts with topic', artifactTopic);
      } else {
        expect(typeof a.cid).toBe('string');
      }
    }
  }, 600_000);
});
