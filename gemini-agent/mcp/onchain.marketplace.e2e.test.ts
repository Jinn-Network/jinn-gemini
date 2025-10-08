import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fetch from 'cross-fetch';
import { randomUUID } from 'node:crypto';
import { execa } from 'execa';
import path from 'node:path';

// Import tools via the MCP tools index (NodeNext resolution allows .js for TS modules)
import { getDetails, loadMcpServer, stopMcpServer, dispatchNewJob, dispatchExistingJob, searchJobs, searchArtifacts } from './tools/index.js';
import { loadEnvOnce } from './tools/shared/env.js';
import { createTenderlyClient, ethToWei, type VnetResult } from '../../scripts/lib/tenderly.js';

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
  let jobDefForRepost: string | null = null;
  let controlUrl: string;
  let gqlUrl: string;
  let vnetResult: VnetResult | null = null;
  let tenderlyClient: ReturnType<typeof createTenderlyClient> | null = null;

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

    // Create Tenderly Virtual TestNet for isolated testing
    tenderlyClient = createTenderlyClient();
    console.log('[tenderly] Creating ephemeral Virtual TestNet for E2E test...');
    vnetResult = await tenderlyClient.createVnet(8453); // Base mainnet
    console.log(`[tenderly] VNet created: ${vnetResult.id}`);
    console.log(`[tenderly] Admin RPC: ${vnetResult.adminRpcUrl}`);

    // Fund the test wallet
    const testWallet = '0x6ad64135eae1a5a78ec74c44d337a596c682f690';
    console.log(`[tenderly] Funding test wallet: ${testWallet}`);
    await tenderlyClient.fundAddress(testWallet, ethToWei('10'), vnetResult.adminRpcUrl);
    console.log('[tenderly] Test wallet funded with 10 ETH');

    // Override RPC URLs to use Tenderly VNet
    process.env.RPC_URL = vnetResult.adminRpcUrl;
    process.env.PONDER_RPC_URL = vnetResult.adminRpcUrl;
    process.env.MECH_RPC_HTTP_URL = vnetResult.adminRpcUrl;
    process.env.MECHX_CHAIN_RPC = vnetResult.adminRpcUrl;
    process.env.BASE_RPC_URL = vnetResult.adminRpcUrl;

    await loadMcpServer();
    mcpStarted = true;

    // Kill any existing Ponder instances to ensure clean state
    try {
      await execa('pkill', ['-f', 'ponder.*dev'], { reject: false });
      console.log('[ponder] killed existing instances');
      // Wait a moment for processes to terminate
      await new Promise(r => setTimeout(r, 2000));
    } catch {
      // Ignore errors if no processes to kill
    }

    // Clean Ponder cache to force fresh start with current .env
    try {
      await execa('rm', ['-rf', 'ponder/.ponder/sqlite']);
      console.log('[ponder] cleaned cache');
    } catch {
      // Ignore if directory doesn't exist
    }

    // Start fresh Ponder instance on test-specific port to avoid conflicts
    const testPonderPort = 42070;
    gqlUrl = `http://localhost:${testPonderPort}/graphql`;
    const ponderDir = path.join(process.cwd(), 'ponder');

    // Update the environment variable so MCP tools use the correct Ponder URL
    process.env.PONDER_GRAPHQL_URL = gqlUrl;

    // Ensure Ponder uses the correct environment - explicitly pass critical vars
    const ponderEnv = {
      ...process.env,
      PONDER_RPC_URL: process.env.PONDER_RPC_URL,
      PORT: String(testPonderPort),
      PONDER_START_BLOCK: process.env.PONDER_START_BLOCK,
      PONDER_MECH_ADDRESS: process.env.MECH_ADDRESS, // Ensure Ponder indexes the correct mech
    };

    console.log('[test] Starting Ponder with PONDER_RPC_URL:', process.env.PONDER_RPC_URL);
    ponderProc = execa('yarn', ['dev'], { cwd: ponderDir, stdio: 'pipe', env: ponderEnv });
    // Attach handlers to prevent pipe buffer blocking and capture errors
    const ponderLogs: string[] = [];
    if (ponderProc.stdout) ponderProc.stdout.on('data', (d: any) => { ponderLogs.push(d.toString()); });
    if (ponderProc.stderr) ponderProc.stderr.on('data', (d: any) => {
      const msg = d.toString();
      ponderLogs.push(msg);
      process.stderr.write(`[ponder stderr] ${msg}`);
    });

    // Monitor process exit
    ponderProc.on('exit', (code: number | null) => {
      if (code !== 0 && code !== null) {
        console.error(`[ponder] Process exited with code ${code}`);
        console.error(`[ponder] Last 50 lines of output:\n${ponderLogs.slice(-50).join('')}`);
      }
    });

    console.log('[ponder] dev server spawned');
    // Give it time to come up
    await waitForGraphql(gqlUrl, 120_000);

    // Start Control API if not already running (required for worker claim/report/artifacts)
    let controlReady = false;
    controlUrl = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';
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

    // Clean up Tenderly Virtual TestNet
    if (vnetResult && tenderlyClient) {
      console.log(`[tenderly] Deleting Virtual TestNet: ${vnetResult.id}`);
      await tenderlyClient.deleteVnet(vnetResult.id);
      console.log('[tenderly] VNet cleanup complete');
    }
  });
  it('posts a marketplace request, verifies IPFS and subgraph indexing, and fetches via get_details', async () => {
    // Ensure env is loaded for mech client ts and tools
    loadEnvOnce();
    // Preflight env
    expect(process.env.MECH_PRIVATE_KEY, 'MECH_PRIVATE_KEY required').toBeTruthy();
    expect(gqlUrl, 'gqlUrl must be initialized').toBeTruthy();

    // 1) Dispatch a new job
    const jobName = `e2e-job-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const enabledTools = ['create_artifact'];

    const dispatchRes = await dispatchNewJob({
      objective: 'Verify on-chain dispatch and IPFS upload',
      context: 'E2E test to validate marketplace integration and subgraph indexing with exact variable matching',
      acceptanceCriteria: 'Request is indexed, IPFS content is valid, variables match exactly',
      jobName,
      enabledTools,
      updateExisting: true
    });
    const dispatchParsed = parseToolText(dispatchRes);
    if (!dispatchParsed?.meta?.ok) {
      console.error('[TEST DEBUG] dispatchNewJob failed:', JSON.stringify(dispatchParsed, null, 2));
    }
    expect(dispatchParsed?.meta?.ok).toBe(true);
    const data = dispatchParsed?.data || {};
    expect(Array.isArray(data.request_ids) && data.request_ids.length > 0).toBe(true);
    const requestIdHex: string = data.request_ids[0];
    const requestIdInt: string = Array.isArray(data.request_id_ints) ? data.request_id_ints[0] : '';
    const jobDefinitionId: string = data.jobDefinitionId;
    expect(typeof jobDefinitionId).toBe('string');
    jobDefForRepost = jobDefinitionId;

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

    // 4) Test search-jobs tool can find the posted job by name
    const searchJobsByNameRes = await searchJobs({ query: jobName, include_requests: false });
    const searchJobsByNameParsed = parseToolText(searchJobsByNameRes);
    expect(searchJobsByNameParsed?.data?.length).toBeGreaterThan(0);
    const foundJobByName = searchJobsByNameParsed?.data?.find((j: any) => j.id === jobDefinitionId);
    expect(foundJobByName).toBeTruthy();
    expect(foundJobByName?.name).toBe(jobName);
    
    // Test search-jobs tool can find the posted job by prompt content
    const searchJobsByPromptRes = await searchJobs({ query: 'Verify on-chain dispatch', include_requests: false });
    const searchJobsByPromptParsed = parseToolText(searchJobsByPromptRes);
    expect(searchJobsByPromptParsed?.data?.length).toBeGreaterThan(0);
    const foundJobByPrompt = searchJobsByPromptParsed?.data?.find((j: any) => j.id === jobDefinitionId);
    expect(foundJobByPrompt).toBeTruthy();
    // Prompt content now uses structured format with markdown headers, case-insensitive check
    expect(foundJobByPrompt?.promptContent?.toLowerCase()).toContain('verify on-chain dispatch');

    // 5) Verify get_details returns the same records with optional ipfs resolution
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
      const enabledTools = ['google_web_search'];

      const dispatchRes = await dispatchNewJob({
        objective: 'Validate lineage propagation in IPFS and subgraph',
        context: 'E2E test to verify sourceRequestId and sourceJobDefinitionId flow through the system correctly',
        acceptanceCriteria: 'IPFS contains lineage fields, subgraph indexes them correctly, env vars propagate',
        jobName,
        enabledTools,
        updateExisting: true
      });
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
      expect(reqObj?.sourceJobDefinitionId).toBe(lineageJobDef);
    } finally {
      // Restore env
      if (prevReq !== undefined) process.env.JINN_REQUEST_ID = prevReq; else delete process.env.JINN_REQUEST_ID;
      if (prevJob !== undefined) process.env.JINN_JOB_DEFINITION_ID = prevJob; else delete process.env.JINN_JOB_DEFINITION_ID;
    }
  }, 240_000);

  it('reposts existing job: request lineage uses poster context while job definition lineage remains unchanged', async () => {
    loadEnvOnce();
    expect(jobDefForRepost, 'Need a jobDefinitionId from earlier test').toBeTruthy();

    const lineageRequest = process.env.TEST_LINEAGE_REQUEST_ID || '0x4ce84fa46e5aa543fd2703e06f2da9d42bfa808475e191e430326751ce709cc3';
    const lineageJobDef = process.env.TEST_LINEAGE_JOB_DEFINITION_ID || 'b1c5ebe4-9368-4762-b528-15645b54ddb8';
    const prevReq = process.env.JINN_REQUEST_ID;
    const prevJob = process.env.JINN_JOB_DEFINITION_ID;
    process.env.JINN_REQUEST_ID = lineageRequest;
    process.env.JINN_JOB_DEFINITION_ID = lineageJobDef;

    try {
      const repostRes = await dispatchExistingJob({ jobId: jobDefForRepost! });
      const parsed = parseToolText(repostRes);
      if (!parsed?.meta?.ok) {
        console.log('[DEBUG] dispatchExistingJob failed:', JSON.stringify(parsed, null, 2));
      }
      expect(parsed?.meta?.ok).toBe(true);
      const reqId: string | undefined = parsed?.data?.request_ids?.[0];
      expect(typeof reqId).toBe('string');

      const qReq = 'query($id:String!){ request(id:$id){ id sourceRequestId sourceJobDefinitionId ipfsHash delivered } }';
      let reqObj: any = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 0 : 1500));
        const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qReq, variables: { id: reqId } }) });
        if (!resp.ok) continue;
        const jr = await resp.json();
        reqObj = jr?.data?.request || null;
        if (reqObj?.id) break;
      }
      expect(reqObj?.id).toBe(reqId);
      expect(reqObj?.sourceRequestId).toBe(lineageRequest);
      expect(reqObj?.sourceJobDefinitionId).toBe(lineageJobDef);

      const qJob = 'query($id:String!){ jobDefinition(id:$id){ id sourceRequestId sourceJobDefinitionId } }';
      const respJob = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qJob, variables: { id: jobDefForRepost } }) });
      expect(respJob.ok).toBe(true);
      const jobJson = await respJob.json();
      const job = jobJson?.data?.jobDefinition;
      expect(job?.id).toBe(jobDefForRepost);
      expect(job?.sourceRequestId ?? null).toBe(null);
      expect(job?.sourceJobDefinitionId ?? null).toBe(null);

      // Optional: ensure get_details surfaces the reposted request
      const detailsRes = await getDetails({ ids: [reqId!], resolve_ipfs: false });
      const detailsParsed = parseToolText(detailsRes);
      const hasReq = (detailsParsed?.data || []).some((r: any) => r.id === reqId);
      expect(hasReq).toBe(true);
    } finally {
      if (prevReq !== undefined) process.env.JINN_REQUEST_ID = prevReq; else delete process.env.JINN_REQUEST_ID;
      if (prevJob !== undefined) process.env.JINN_JOB_DEFINITION_ID = prevJob; else delete process.env.JINN_JOB_DEFINITION_ID;
    }
  }, 180_000);

  it('end-to-end: worker processes request, creates artifact via MCP, delivers on-chain, and subgraph indexes delivery + artifact', async () => {
    loadEnvOnce();
    const mechWorker = process.env.MECH_WORKER_ADDRESS || process.env.MECH_ADDRESS;
    expect(mechWorker, 'MECH_WORKER_ADDRESS or MECH_ADDRESS required').toBeTruthy();

    // 1) Create parent job first (for Work Protocol testing)
    const parentJobName = `e2e-parent-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const parentDispatch = await dispatchNewJob({
      objective: 'Coordinate child job execution and review results',
      context: 'Parent job for Work Protocol testing - orchestrates child tasks and aggregates outputs',
      acceptanceCriteria: 'Child jobs are dispatched, results aggregated, next steps determined',
      jobName: parentJobName,
      enabledTools: ['create_artifact'],
      updateExisting: true
    });
    const parentParsed = parseToolText(parentDispatch);
    expect(parentParsed?.meta?.ok).toBe(true);
    const parentJobDefinitionId: string = parentParsed?.data?.jobDefinitionId;
    const parentRequestId: string = parentParsed?.data?.request_ids?.[0];

    // Wait for parent job to be indexed
    const qParentExists = 'query($id:String!){ jobDefinition(id:$id){ id name } }';
    let parentIndexed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 1500));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qParentExists, variables: { id: parentJobDefinitionId } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      if (jr?.data?.jobDefinition?.id === parentJobDefinitionId) { parentIndexed = true; break; }
    }
    expect(parentIndexed, 'Parent job should be indexed').toBe(true);

    // 2) Set lineage context and dispatch child job with Work Protocol signal
    const prevReq = process.env.JINN_REQUEST_ID;
    const prevJob = process.env.JINN_JOB_DEFINITION_ID;
    process.env.JINN_REQUEST_ID = parentRequestId;
    process.env.JINN_JOB_DEFINITION_ID = parentJobDefinitionId;

    let requestIdHex: string;
    let jobDefinitionId: string;
    // Move these outside the try block so they're accessible throughout the test
    const artifactName = 'e2e-report';
    const artifactTopic = 'analysis';
    const artifactContent = `artifact generated at ${new Date().toISOString()}`;
    
    try {
      const jobName = `e2e-worker-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const enabledTools = ['create_artifact', 'finalize_job'];
      const dispatchRes = await dispatchNewJob({
        objective: 'Create test artifact via MCP tool',
        context: 'Worker execution test - validates artifact creation and finalize_job flow for Work Protocol',
        acceptanceCriteria: `Artifact created with name "${artifactName}", topic "${artifactTopic}", content "${artifactContent}", finalize_job called with COMPLETED status`,
        deliverables: 'Single artifact with specified metadata and content',
        constraints: 'Call create_artifact exactly once, then finalize_job with status COMPLETED',
        jobName,
        enabledTools,
        updateExisting: true
      });
      const dispatchParsed = parseToolText(dispatchRes);
      expect(dispatchParsed?.meta?.ok).toBe(true);
      const data = dispatchParsed?.data || {};
      expect(Array.isArray(data.request_ids) && data.request_ids.length > 0).toBe(true);
      requestIdHex = data.request_ids[0];
      jobDefinitionId = data.jobDefinitionId;
    } finally {
      // Restore context for worker execution
      if (prevReq !== undefined) process.env.JINN_REQUEST_ID = prevReq; else delete process.env.JINN_REQUEST_ID;
      if (prevJob !== undefined) process.env.JINN_JOB_DEFINITION_ID = prevJob; else delete process.env.JINN_JOB_DEFINITION_ID;
    }

    // Ensure the request is indexed before running worker (Control API validates against Ponder)
    const qReqExists = 'query($id:String!){ request(id:$id){ id jobDefinitionId } }';
    let seen = false;
    let requestRecord: any = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 2000));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qReqExists, variables: { id: requestIdHex } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      if (jr?.data?.request?.id === requestIdHex) {
        seen = true;
        requestRecord = jr.data.request;
        break;
      }
    }
    expect(seen, 'Request should be indexed before worker runs').toBe(true);

    // Verify worker can load correct job definition: request has jobDefinitionId field
    expect(requestRecord.jobDefinitionId, 'Request should have jobDefinitionId field populated').toBeTruthy();
    expect(requestRecord.jobDefinitionId, 'Request jobDefinitionId should match created job').toBe(jobDefinitionId);

    // Verify job definition can be queried from Ponder using jobDefinitionId
    const qJobDef = 'query($id:String!){ jobDefinition(id:$id){ id name enabledTools promptContent } }';
    const jobDefResp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qJobDef, variables: { id: requestRecord.jobDefinitionId } }) });
    expect(jobDefResp.ok).toBe(true);
    const jobDefJson = await jobDefResp.json();
    const jobDef = jobDefJson?.data?.jobDefinition;
    expect(jobDef, 'Worker should be able to query job definition from Ponder using jobDefinitionId').toBeTruthy();
    expect(jobDef.id).toBe(jobDefinitionId);
    expect(Array.isArray(jobDef.enabledTools) && jobDef.enabledTools.includes('create_artifact')).toBe(true);

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

    expect(artifact, `Artifact should be indexed for request ${requestIdHex}`).toBeTruthy();
    const artifactRecord = artifact!;
    expect(artifactRecord.id).toBe(`${requestIdHex}:0`);
    expect(artifactRecord.requestId).toBe(requestIdHex);
    expect(artifactRecord.topic).toBe(artifactTopic);
    if (artifactRecord.name) expect(artifactRecord.name).toBe(artifactName);
    expect(typeof artifactRecord.cid).toBe('string');

    // 6) Test search-artifacts tool can find the created artifact
    // Search by name
    const searchArtifactsByNameRes = await searchArtifacts({ query: artifactName, include_request_context: false });
    const searchArtifactsByNameParsed = parseToolText(searchArtifactsByNameRes);
    expect(searchArtifactsByNameParsed?.data?.length).toBeGreaterThan(0);
    const foundArtifactByName = searchArtifactsByNameParsed?.data?.find((a: any) => a.id === `${requestIdHex}:0`);
    expect(foundArtifactByName).toBeTruthy();
    expect(foundArtifactByName?.name).toBe(artifactName);
    expect(foundArtifactByName?.topic).toBe(artifactTopic);
    
    // Search by topic
    const searchArtifactsByTopicRes = await searchArtifacts({ query: artifactTopic, include_request_context: false });
    const searchArtifactsByTopicParsed = parseToolText(searchArtifactsByTopicRes);
    expect(searchArtifactsByTopicParsed?.data?.length).toBeGreaterThan(0);
    const foundArtifactByTopic = searchArtifactsByTopicParsed?.data?.find((a: any) => a.id === `${requestIdHex}:0`);
    expect(foundArtifactByTopic).toBeTruthy();
    expect(foundArtifactByTopic?.topic).toBe(artifactTopic);
    
    // Search by content preview (if available)
    const searchArtifactsByContentRes = await searchArtifacts({ query: 'artifact generated', include_request_context: false });
    const searchArtifactsByContentParsed = parseToolText(searchArtifactsByContentRes);
    // Content preview may or may not match depending on how it's stored, so we just verify the search runs
    expect(searchArtifactsByContentParsed?.meta?.ok ?? searchArtifactsByContentParsed?.data).toBeTruthy();

    // 7) Cross-check get_details for artifact and request delivery lineage
    const detailsRes = await getDetails({ ids: [requestIdHex, `${requestIdHex}:0`], resolve_ipfs: false });
    const parsed = parseToolText(detailsRes);
    const reqRec = (parsed?.data || []).find((x: any) => x.id === requestIdHex);
    const artRec = (parsed?.data || []).find((x: any) => x.id === `${requestIdHex}:0`);
    expect(reqRec?.delivered).toBe(true);
    expect(typeof reqRec?.deliveryIpfsHash).toBe('string');
    expect(artRec, `get_details should return artifact record ${requestIdHex}:0`).toBeTruthy();
    expect(artRec?.topic).toBe(artifactTopic);
    expect(typeof artRec?.cid).toBe('string');

    expect(Array.isArray(deliveryJson?.artifacts), 'Delivery JSON should include an artifacts array').toBe(true);
    const deliveryArtifact = (deliveryJson as any)?.artifacts?.find((x: any) => x.topic === artifactTopic);
    expect(deliveryArtifact, `Delivery JSON should include artifact with topic ${artifactTopic}`).toBeTruthy();
    expect(typeof deliveryArtifact?.cid).toBe('string');

    // 8) Work Protocol: Verify parent job was automatically dispatched
    // The child job calls finalize_job tool with status "COMPLETED", which triggers the worker
    // to automatically dispatch the parent job. This is the core of Work Protocol.
    // Query for NEW requests that target the parent job definition (jobDefinitionId = parent) created after the child completed
    // These auto-dispatched requests will have additionalContext with message from the child
    // Filter out the original parent request by excluding the initial parent request ID
    const qParentRequests = 'query($jobId:String!){ requests(where:{jobDefinitionId:$jobId}, orderBy:"blockTimestamp", orderDirection:"desc"){ items { id blockTimestamp additionalContext jobDefinitionId } } }';
    let parentRequests: any[] = [];
    let latestParentRequest: any = null;

    // Poll for parent request with additionalContext populated
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 3000));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qParentRequests, variables: { jobId: parentJobDefinitionId } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      // Query returns ALL requests for the parent job, filter for auto-dispatched ones (those created after initial parent request AND have message)
      const allRequests = jr?.data?.requests?.items || [];
      parentRequests = allRequests.filter((r: any) => r.id !== parentRequestId && r.additionalContext && r.additionalContext.message);

      // Check if we have a parent request with additionalContext populated
      if (parentRequests.length > 0) {
        latestParentRequest = parentRequests[0];
        // Ponder fetches IPFS content asynchronously, so additionalContext may be null/empty initially
        // Keep polling until it's populated with the message field
        // Note: Empty object {} is truthy, so we need to check for actual content
        if (latestParentRequest.additionalContext && latestParentRequest.additionalContext.message) {
          break;
        }
      }
    }
    expect(parentRequests.length, 'Work Protocol: Parent job should have been auto-dispatched after child COMPLETED').toBeGreaterThan(0);
    expect(latestParentRequest.additionalContext, 'Auto-dispatched parent should have additionalContext').toBeTruthy();

    // Extract message from additionalContext
    // Ponder's GraphQL returns additionalContext as an object (already parsed)
    let workProtocolMessage: any = null;
    const additionalContext = latestParentRequest.additionalContext;

    if (typeof additionalContext === 'object' && additionalContext.message) {
      // Already an object with message field
      workProtocolMessage = additionalContext.message;
    } else if (typeof additionalContext === 'string') {
      // Fallback: if it's a string, parse it
      try {
        const parsed = JSON.parse(additionalContext);
        workProtocolMessage = typeof parsed.message === 'string' ?
          JSON.parse(parsed.message) : parsed.message;
      } catch {
        // Message extraction failed
      }
    }
    
    expect(workProtocolMessage, 'Work Protocol message should be present').toBeTruthy();
    expect(workProtocolMessage.content, 'Message should have content about child completion').toContain('Child job COMPLETED');
    expect(workProtocolMessage.to, 'Message should be addressed to parent job').toBe(parentJobDefinitionId);
    expect(workProtocolMessage.from, 'Message should be from child request').toBe(requestIdHex);

    /* eslint-disable no-console */
    console.log('Work Protocol verification:', {
      parentAutoDispatched: parentRequests.length > 0,
      messageFormat: 'standardized',
      protocolWorking: true
    });
    /* eslint-enable no-console */

  }, 600_000);

  it('context envelope: dispatch existing job with hierarchical context from child jobs and artifacts', async () => {
    loadEnvOnce();
    expect(process.env.MECH_PRIVATE_KEY, 'MECH_PRIVATE_KEY required').toBeTruthy();

    // Test scenario: Create parent job → Dispatch 2 child jobs → Create artifacts → Redispatch parent with context
    
    // 1) Create a parent job that will coordinate child tasks
    const parentJobName = `context-parent-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const parentTools = ['dispatch_new_job', 'dispatch_existing_job', 'create_artifact'];

    const parentDispatch = await dispatchNewJob({
      objective: 'Coordinate data analysis and report generation workflow',
      context: 'Context envelope test - job will be reposted with child job hierarchy and artifact context',
      acceptanceCriteria: 'Child jobs complete, context envelope includes hierarchy and artifacts when reposted',
      jobName: parentJobName,
      enabledTools: parentTools,
      updateExisting: true
    });
    const parentParsed = parseToolText(parentDispatch);
    expect(parentParsed?.meta?.ok).toBe(true);
    const parentJobDefinitionId: string = parentParsed?.data?.jobDefinitionId;
    const parentRequestId: string = parentParsed?.data?.request_ids?.[0];
    expect(typeof parentJobDefinitionId).toBe('string');
    expect(typeof parentRequestId).toBe('string');

    // Wait for parent job to be indexed
    const qParentExists = 'query($id:String!){ jobDefinition(id:$id){ id name } }';
    let parentIndexed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 1500));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qParentExists, variables: { id: parentJobDefinitionId } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      if (jr?.data?.jobDefinition?.id === parentJobDefinitionId) { parentIndexed = true; break; }
    }
    expect(parentIndexed, 'Parent job should be indexed').toBe(true);

    // 2) Set lineage context to simulate parent job dispatching children
    const prevReq = process.env.JINN_REQUEST_ID;
    const prevJob = process.env.JINN_JOB_DEFINITION_ID;
    process.env.JINN_REQUEST_ID = parentRequestId;
    process.env.JINN_JOB_DEFINITION_ID = parentJobDefinitionId;

    try {
      // 3) Dispatch child job 1: Data Analysis
      // Note: This child does NOT call finalize_job, so it won't trigger Work Protocol auto-dispatch
      const child1Name = `context-child1-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const child1Tools = ['create_artifact'];

      const child1Dispatch = await dispatchNewJob({
        objective: 'Analyze sample data and generate insights',
        context: 'First child job in decomposition hierarchy - intermediate analysis step for parent workflow',
        acceptanceCriteria: 'Analysis artifact created with insights and metrics',
        constraints: 'Do not finalize - this is intermediate work',
        deliverables: 'Analysis results artifact with insights and metrics',
        jobName: child1Name,
        enabledTools: child1Tools,
        updateExisting: true
      });
      const child1Parsed = parseToolText(child1Dispatch);
      expect(child1Parsed?.meta?.ok).toBe(true);
      const child1JobDefinitionId: string = child1Parsed?.data?.jobDefinitionId;
      const child1RequestId: string = child1Parsed?.data?.request_ids?.[0];

      // 4) Dispatch child job 2: Report Generation
      // Note: This child also does NOT call finalize_job, so it won't trigger Work Protocol auto-dispatch
      const child2Name = `context-child2-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const child2Tools = ['create_artifact'];

      const child2Dispatch = await dispatchNewJob({
        objective: 'Generate summary report from analysis',
        context: 'Second child job in decomposition hierarchy - report generation step for parent workflow',
        acceptanceCriteria: 'Summary report artifact created with recommendations',
        constraints: 'Do not finalize - waiting for additional data',
        deliverables: 'Formatted summary report with analysis and recommendations',
        jobName: child2Name,
        enabledTools: child2Tools,
        updateExisting: true
      });
      const child2Parsed = parseToolText(child2Dispatch);
      expect(child2Parsed?.meta?.ok).toBe(true);
      const child2JobDefinitionId: string = child2Parsed?.data?.jobDefinitionId;
      const child2RequestId: string = child2Parsed?.data?.request_ids?.[0];

      // 5) Create some artifacts to simulate child job outputs
      const testArtifact1 = await import('./tools/index.js').then(m => m.createArtifact({
        name: 'analysis-results',
        topic: 'data-analysis', 
        content: JSON.stringify({
          insights: ['Pattern A detected', 'Trend B identified'],
          metrics: { accuracy: 0.95, completeness: 0.87 },
          timestamp: new Date().toISOString()
        })
      }));
      const artifact1Parsed = parseToolText(testArtifact1);
      expect(artifact1Parsed?.data?.cid).toBeTruthy();

      const testArtifact2 = await import('./tools/index.js').then(m => m.createArtifact({
        name: 'summary-report',
        topic: 'reporting',
        content: JSON.stringify({
          summary: 'Analysis completed successfully with high confidence.',
          recommendations: ['Continue monitoring Pattern A', 'Investigate Trend B further'],
          status: 'completed',
          timestamp: new Date().toISOString()
        })
      }));
      const artifact2Parsed = parseToolText(testArtifact2);
      expect(artifact2Parsed?.data?.cid).toBeTruthy();

      // 6) Wait for child jobs to be indexed
      const qChildExists = 'query($id:String!){ jobDefinition(id:$id){ id name sourceJobDefinitionId sourceRequestId } }';
      
      // Check child 1 indexing
      let child1Indexed = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 0 : 1500));
        const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qChildExists, variables: { id: child1JobDefinitionId } }) });
        if (!resp.ok) continue;
        const jr = await resp.json();
        const child1Job = jr?.data?.jobDefinition;
        if (child1Job?.id === child1JobDefinitionId) { 
          // Verify lineage
          expect(child1Job.sourceJobDefinitionId).toBe(parentJobDefinitionId);
          expect(child1Job.sourceRequestId).toBe(parentRequestId);
          child1Indexed = true; 
          break; 
        }
      }
      expect(child1Indexed, 'Child job 1 should be indexed with proper lineage').toBe(true);

      // Check child 2 indexing  
      let child2Indexed = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 0 : 1500));
        const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qChildExists, variables: { id: child2JobDefinitionId } }) });
        if (!resp.ok) continue;
        const jr = await resp.json();
        const child2Job = jr?.data?.jobDefinition;
        if (child2Job?.id === child2JobDefinitionId) {
          // Verify lineage
          expect(child2Job.sourceJobDefinitionId).toBe(parentJobDefinitionId);
          expect(child2Job.sourceRequestId).toBe(parentRequestId);
          child2Indexed = true; 
          break; 
        }
      }
      expect(child2Indexed, 'Child job 2 should be indexed with proper lineage').toBe(true);

    } finally {
      // Restore original context
      if (prevReq !== undefined) process.env.JINN_REQUEST_ID = prevReq; else delete process.env.JINN_REQUEST_ID;
      if (prevJob !== undefined) process.env.JINN_JOB_DEFINITION_ID = prevJob; else delete process.env.JINN_JOB_DEFINITION_ID;
    }

    // 7) Now redispatch the parent job - this should include context envelope with child job hierarchy
    const repostRes = await dispatchExistingJob({ jobId: parentJobDefinitionId });
    const repostParsed = parseToolText(repostRes);
    expect(repostParsed?.meta?.ok).toBe(true);
    const repostRequestId: string = repostParsed?.data?.request_ids?.[0];
    expect(typeof repostRequestId).toBe('string');

    // 8) Verify the reposted request contains additionalContext in IPFS
    const qRepostReq = 'query($id:String!){ request(id:$id){ id ipfsHash additionalContext } }';
    let repostRequest: any = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 2000));
      const resp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qRepostReq, variables: { id: repostRequestId } }) });
      if (!resp.ok) continue;
      const jr = await resp.json();
      repostRequest = jr?.data?.request || null;
      if (repostRequest?.id && repostRequest?.ipfsHash) break;
    }
    expect(repostRequest?.id).toBe(repostRequestId);
    expect(typeof repostRequest?.ipfsHash).toBe('string');

    // 9) Fetch and verify IPFS content contains additionalContext
    let ipfsJsonWithContext: any = null;
    if (repostRequest?.ipfsHash) {
      const gatewayUrl = `https://gateway.autonolas.tech/ipfs/${repostRequest.ipfsHash}`;
      for (let i = 0; i < 5; i++) {
        try {
          const ipfsResp = await fetch(gatewayUrl, { method: 'GET' });
          if (ipfsResp.ok) {
            ipfsJsonWithContext = await ipfsResp.json();
            break;
          }
        } catch {}
        if (i < 4) await new Promise(r => setTimeout(r, 2000));
      }
    }
    expect(ipfsJsonWithContext, 'IPFS content should be accessible').toBeTruthy();
    console.log('IPFS content for debugging:', JSON.stringify(ipfsJsonWithContext, null, 2));
    expect(ipfsJsonWithContext?.jobDefinitionId).toBe(parentJobDefinitionId);
    expect(ipfsJsonWithContext?.additionalContext, 'IPFS should contain additionalContext').toBeTruthy();
    
    // 10) Verify context envelope structure
    const context = ipfsJsonWithContext.additionalContext;
    expect(context?.hierarchy, 'Context should contain hierarchy').toBeTruthy();
    expect(context?.summary, 'Context should contain summary').toBeTruthy();
    expect(Array.isArray(context.hierarchy)).toBe(true);
    expect(context.hierarchy.length).toBeGreaterThan(0);
    
    // 11) Verify hierarchy contains parent and child jobs
    const hierarchyIds = context.hierarchy.map((job: any) => job.jobId);
    expect(hierarchyIds).toContain(parentJobDefinitionId); // Parent should be in hierarchy
    
    // Check if child jobs appear in hierarchy (they should if the context gathering worked)
    const hasChildJob = context.hierarchy.some((job: any) => job.level > 0);
    expect(hasChildJob, 'Hierarchy should contain child jobs at level > 0').toBe(true);
    
    // 12) Verify summary statistics
    expect(typeof context.summary.totalJobs).toBe('number');
    expect(typeof context.summary.completedJobs).toBe('number');
    expect(typeof context.summary.activeJobs).toBe('number');
    expect(typeof context.summary.totalArtifacts).toBe('number');
    expect(context.summary.totalJobs).toBeGreaterThan(0);

    // 13) Verify the reposted request has additionalContext indexed in Ponder
    expect(repostRequest?.additionalContext, 'Ponder should index additionalContext').toBeTruthy();
    const indexedContext = repostRequest.additionalContext;
    expect(indexedContext?.hierarchy).toBeTruthy();
    expect(indexedContext?.summary).toBeTruthy();
    expect(Array.isArray(indexedContext.hierarchy)).toBe(true);

    // Work Protocol: Verify that child jobs without finalize_job do NOT trigger parent dispatch
    // In this test, child jobs do not call finalize_job, so parent should NOT be auto-dispatched
    // (Only the manual repost above should exist, not auto-dispatches from Work Protocol)

    const qAutoDispatchCheck = 'query($jobId:String!){ requests(where:{jobDefinitionId:$jobId}, orderBy:"blockTimestamp", orderDirection:"desc"){ items { id blockTimestamp } } }';
    const autoDispatchResp = await fetch(gqlUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: qAutoDispatchCheck, variables: { jobId: parentJobDefinitionId } }) });
    expect(autoDispatchResp.ok).toBe(true);
    const autoDispatchData = await autoDispatchResp.json();
    const allParentRequests = autoDispatchData?.data?.requests?.items || [];
    
    // Debug: Log all requests to understand what's happening
    console.log('DEBUG: All parent requests:', allParentRequests.map(r => ({ id: r.id, timestamp: r.blockTimestamp })));
    console.log('DEBUG: Original parent request ID:', parentRequestId);
    console.log('DEBUG: Manual repost request ID:', repostRequestId);
    
    // Should have: 1) Original parent request, 2) Manual repost from dispatchExistingJob
    // Should NOT have: Additional auto-dispatches from Work Protocol (since children didn't call finalize_job)
    const nonOriginalRequests = allParentRequests.filter((r: any) => r.id !== parentRequestId);
    expect(nonOriginalRequests.length, 'Should only have manual repost, no Work Protocol auto-dispatch without finalize_job').toBe(1);
    expect(nonOriginalRequests[0]?.id, 'Manual repost should match expected ID').toBe(repostRequestId);

    // Audit log for verification
    /* eslint-disable no-console */
    console.log(JSON.stringify({
      audit: {
        step: 'context_envelope_verification',
        parent_job_id: parentJobDefinitionId,
        repost_request_id: repostRequestId,
        context_summary: context.summary,
        hierarchy_job_count: context.hierarchy.length,
        hierarchy_levels: [...new Set(context.hierarchy.map((j: any) => j.level))].sort(),
        ipfs_gateway_url: `https://gateway.autonolas.tech/ipfs/${repostRequest.ipfsHash}`,
        context_envelope_present: !!context,
        indexed_context_present: !!indexedContext,
        work_protocol_verification: {
          total_parent_requests: allParentRequests.length,
          auto_dispatch_prevented: true,
          reason: 'Children did not call finalize_job'
        }
      }
    }, null, 2));
    /* eslint-enable no-console */

  }, 300_000);

  it('message system: dispatch job with message and verify indexing', async () => {
    loadEnvOnce();
    expect(process.env.MECH_PRIVATE_KEY, 'MECH_PRIVATE_KEY required').toBeTruthy();

    // Test scenario: Create job with message and verify it gets indexed

    // 1) Dispatch job with message
    const jobName = `msg-test-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const testMessage = 'Test message: verify this gets indexed correctly';

    const dispatch = await dispatchNewJob({
      objective: 'Verify message system indexing',
      context: 'Message system test - validates message creation and subgraph indexing for Work Protocol',
      acceptanceCriteria: 'Message is indexed in messages table with correct content and recipient',
      jobName: jobName,
      enabledTools: ['create_artifact'],
      updateExisting: true,
      message: testMessage
    });
    const parsed = parseToolText(dispatch);
    expect(parsed?.meta?.ok).toBe(true);
    const jobDefinitionId: string = parsed?.data?.jobDefinitionId;
    const requestId: string = parsed?.data?.request_ids?.[0];
    
    // 2) Verify message was indexed in the messages table
    const qMessage = 'query($to:String!){ messages(where:{to:$to}){ items { id content sourceJobDefinitionId to blockTimestamp } } }';
    let messageIndexed = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 2000));
      const resp = await fetch(gqlUrl, { 
        method: 'POST', 
        headers: { 'content-type': 'application/json' }, 
        body: JSON.stringify({ query: qMessage, variables: { to: jobDefinitionId } }) 
      });
      if (!resp.ok) continue;
      const jr = await resp.json();
      const messages = jr?.data?.messages?.items || [];
      const foundMsg = messages.find((m: any) => m.content === testMessage);
      if (foundMsg) {
        expect(foundMsg.to).toBe(jobDefinitionId);
        expect(foundMsg.content).toBe(testMessage);
        messageIndexed = true;
        break;
      }
    }
    expect(messageIndexed, 'Message should be indexed in messages table').toBe(true);
    
    // 3) Test dispatch existing job with different message
    const repostMessage = 'Repost message: different context for retry';
    const repostRes = await dispatchExistingJob({ 
      jobId: jobDefinitionId,
      message: repostMessage 
    });
    const repostParsed = parseToolText(repostRes);
    expect(repostParsed?.meta?.ok).toBe(true);
    const repostRequestId: string = repostParsed?.data?.request_ids?.[0];
    
    // 4) Verify second message was also indexed
    let repostMessageIndexed = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 2000));
      const resp = await fetch(gqlUrl, { 
        method: 'POST', 
        headers: { 'content-type': 'application/json' }, 
        body: JSON.stringify({ query: qMessage, variables: { to: jobDefinitionId } }) 
      });
      if (!resp.ok) continue;
      const jr = await resp.json();
      const messages = jr?.data?.messages?.items || [];
      const foundRepostMsg = messages.find((m: any) => m.content === repostMessage);
      if (foundRepostMsg) {
        expect(foundRepostMsg.to).toBe(jobDefinitionId);
        expect(foundRepostMsg.content).toBe(repostMessage);
        repostMessageIndexed = true;
        break;
      }
    }
    expect(repostMessageIndexed, 'Repost message should be indexed').toBe(true);
    
    /* eslint-disable no-console */
    console.log(JSON.stringify({
      audit: {
        step: 'message_system_verification',
        job_id: jobDefinitionId,
        original_request_id: requestId,
        repost_request_id: repostRequestId,
        messages_verified: [testMessage, repostMessage],
        message_indexing_working: true
      }
    }, null, 2));
    /* eslint-enable no-console */
  }, 300_000);

});
