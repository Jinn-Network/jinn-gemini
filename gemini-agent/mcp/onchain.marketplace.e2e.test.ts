import { describe, it, expect } from 'vitest';
import fetch from 'cross-fetch';
import { randomUUID } from 'node:crypto';
import { execa } from 'execa';

// Import tools via the MCP tools index (NodeNext resolution allows .js for TS modules)
import { dispatchNewJob, getDetails } from './tools/index.js';
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

// E2E guard: only run when explicitly enabled and environment is configured
const E2E_ENABLED = process.env.E2E_ONCHAIN === '1';

describe.skipIf(!E2E_ENABLED)('On-chain: dispatch_new_job → subgraph → get_details', () => {
  let ponderProc: any = null;

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
  }, 120_000);

  afterAll(async () => {
    if (ponderProc) {
      try { ponderProc.kill('SIGTERM', { forceKillAfterTimeout: 5000 }); } catch {}
      ponderProc = null;
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
    const prompt = 'E2E prompt: verify on-chain dispatch, IPFS upload, and subgraph indexing.';
    const enabledTools = ['google_web_search'];

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
    expect(typeof ipfsJson?.prompt).toBe('string');

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
});
