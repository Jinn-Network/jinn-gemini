/**
 * Global E2E Test Setup
 * Initializes shared infrastructure once for all e2e tests
 * - Creates Tenderly VNet
 * - Starts Ponder indexer
 * - Starts Control API
 * - Connects MCP client
 */

import { execa, type ExecaChildProcess } from 'execa';
import fetch from 'cross-fetch';
import path from 'node:path';
import { loadEnvOnce } from '../../gemini-agent/mcp/tools/shared/env.js';
import { createTenderlyClient, ethToWei, type VnetResult } from '../../scripts/lib/tenderly.js';
import { getMcpClient } from './shared.js';

let vnetResult: VnetResult | null = null;
let ponderProc: ExecaChildProcess | null = null;
let controlApiProc: ExecaChildProcess | null = null;
let tenderlyClient: ReturnType<typeof createTenderlyClient> | null = null;

export async function setup() {
  console.log('\n[global-setup] 🚀 Setting up shared E2E test infrastructure...\n');

  // Set test-specific Ponder port
  const testPonderPort = 42070;
  process.env.PONDER_PORT = String(testPonderPort);
  process.env.PONDER_GRAPHQL_URL = `http://localhost:${testPonderPort}/graphql`;

  // Load env early and set flag to prevent child processes from reloading
  loadEnvOnce();

  // Log which Tenderly account is being used
  const tenderlyAccount = process.env.TENDERLY_ACCOUNT_SLUG || 'NOT SET';
  const tenderlyProject = process.env.TENDERLY_PROJECT_SLUG || 'NOT SET';
  console.log(`[global-setup] Tenderly Account: ${tenderlyAccount}`);
  console.log(`[global-setup] Tenderly Project: ${tenderlyProject}`);

  // Create Tenderly Virtual TestNet
  tenderlyClient = createTenderlyClient();
  console.log('[global-setup] Creating ephemeral Virtual TestNet...');
  vnetResult = await tenderlyClient.createVnet(8453); // Base mainnet
  console.log(`[global-setup] ✓ VNet created: ${vnetResult.id}`);

  // Fund test wallet
  const testWallet = '0x6ad64135eae1a5a78ec74c44d337a596c682f690';
  console.log(`[global-setup] Funding test wallet: ${testWallet}`);
  await tenderlyClient.fundAddress(testWallet, ethToWei('10'), vnetResult.adminRpcUrl);
  console.log('[global-setup] ✓ Wallet funded');

  // IMPORTANT: Set all test env vars BEFORE spawning MCP server
  // The MCP server will inherit these and cache them in its config module

  // Override RPC URLs for test environment
  process.env.RPC_URL = vnetResult.adminRpcUrl;
  process.env.MECH_RPC_HTTP_URL = vnetResult.adminRpcUrl;
  process.env.MECHX_CHAIN_RPC = vnetResult.adminRpcUrl;
  process.env.BASE_RPC_URL = vnetResult.adminRpcUrl;

  // Set E2E_GQL_URL for tests to read (PONDER_PORT already set at top of setup())
  process.env.E2E_GQL_URL = process.env.PONDER_GRAPHQL_URL;

  // Set Control API URL
  const controlUrl = 'http://localhost:4001/graphql';
  process.env.CONTROL_API_URL = controlUrl;
  process.env.E2E_CONTROL_URL = controlUrl; // For tests to read

  // Store VNet ID for tests
  process.env.E2E_VNET_ID = vnetResult.id;

  // Reset config cache in test process so getters re-read overridden env vars
  const { resetConfigForTests } = await import('../../config/index.js');
  resetConfigForTests();

  // NOW connect MCP client (spawns MCP server with overridden env vars)
  console.log('[global-setup] Connecting MCP client...');
  const client = getMcpClient();
  await client.connect();
  console.log('[global-setup] ✓ MCP client connected');

  // Kill existing Ponder instances
  try {
    await execa('pkill', ['-f', 'ponder.*dev'], { reject: false });
    console.log('[global-setup] Killed existing Ponder instances');
    await new Promise(r => setTimeout(r, 2000));
  } catch {}

  // Clean Ponder cache
  try {
    await execa('rm', ['-rf', 'ponder/.ponder/sqlite']);
    console.log('[global-setup] ✓ Cleaned Ponder cache');
  } catch {}

  // Start Ponder
  const ponderDir = path.join(process.cwd(), 'ponder');

  // Calculate start block
  try {
    const response = await fetch(process.env.RPC_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 })
    });
    const data = await response.json();
    const currentBlock = parseInt(data.result, 16);
    const vnetStartBlock = Math.max(0, currentBlock - 100);
    process.env.PONDER_START_BLOCK = String(vnetStartBlock);
    console.log(`[global-setup] Calculated PONDER_START_BLOCK: ${vnetStartBlock}`);
  } catch (error: any) {
    console.error('[global-setup] Warning: Failed to calculate start block:', error.message);
  }

  const ponderEnv = {
    ...process.env,
    PONDER_REVIEW_MODE: '1',  // Enable review mode to preserve test RPC_URL
    RPC_URL: process.env.RPC_URL,  // Test VNet Admin RPC
    PORT: String(testPonderPort),
    PONDER_START_BLOCK: process.env.PONDER_START_BLOCK,
    MECH_ADDRESS: process.env.MECH_ADDRESS,
    PONDER_MECH_ADDRESS: process.env.MECH_ADDRESS,
  };

  ponderProc = execa('yarn', ['ponder:dev'], { stdio: 'pipe', env: ponderEnv });
  const ponderLogs: string[] = [];
  if (ponderProc.stdout) ponderProc.stdout.on('data', (d: any) => { ponderLogs.push(d.toString()); });
  if (ponderProc.stderr) ponderProc.stderr.on('data', (d: any) => {
    const msg = d.toString();
    ponderLogs.push(msg);
    process.stderr.write(`[ponder stderr] ${msg}`);
  });

  ponderProc.on('exit', (code: number | null) => {
    if (code !== 0 && code !== null) {
      console.error(`[global-setup] Ponder process exited with code ${code}`);
      console.error(`[global-setup] Last 50 lines:\n${ponderLogs.slice(-50).join('')}`);
    }
  });

  console.log('[global-setup] Ponder dev server spawned');
  await waitForGraphql(process.env.PONDER_GRAPHQL_URL!, 120_000);
  console.log('[global-setup] ✓ Ponder GraphQL ready');

  // Start Control API if needed
  let controlReady = false;

  try {
    const resp = await fetch(controlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ _health }' })
    });
    const j = await resp.json();
    if (j?.data?._health === 'ok') controlReady = true;
  } catch {}

  if (!controlReady) {
    console.log('[global-setup] Starting Control API...');
    controlApiProc = execa('yarn', ['control:dev'], { cwd: process.cwd(), stdio: 'pipe', env: { ...process.env } });
    if (controlApiProc.stdout) controlApiProc.stdout.on('data', (d: any) => {
      try { process.stderr.write(`[control] ${d}`); } catch {}
    });
    if (controlApiProc.stderr) controlApiProc.stderr.on('data', (d: any) => {
      try { process.stderr.write(`[control] ${d}`); } catch {}
    });

    const start = Date.now();
    let lastErr: any = null;
    while (Date.now() - start < 60_000) {
      try {
        const resp = await fetch(controlUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: '{ _health }' })
        });
        const j = await resp.json();
        if (j?.data?._health === 'ok') { controlReady = true; break; }
      } catch (e: any) { lastErr = e; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!controlReady) throw lastErr || new Error('Control API failed to start');
    console.log('[global-setup] ✓ Control API ready');
  } else {
    console.log('[global-setup] ✓ Control API already running');
  }

  console.log('[global-setup] ✅ All infrastructure ready!\n');

  // Return teardown function
  return async () => {
    console.log('\n[global-setup] 🧹 Tearing down shared infrastructure...\n');

    if (ponderProc) {
      try {
        ponderProc.kill('SIGTERM', { forceKillAfterTimeout: 5000 });
        console.log('[global-setup] ✓ Ponder stopped');
      } catch {}
    }

    const client = getMcpClient();
    try {
      await client.disconnect();
      console.log('[global-setup] ✓ MCP client disconnected');
    } catch {}

    if (controlApiProc) {
      try {
        controlApiProc.kill('SIGTERM', { forceKillAfterTimeout: 5000 });
        console.log('[global-setup] ✓ Control API stopped');
      } catch {}
    }

    if (vnetResult && tenderlyClient) {
      console.log(`[global-setup] Deleting Virtual TestNet: ${vnetResult.id}`);
      await tenderlyClient.deleteVnet(vnetResult.id);
      console.log('[global-setup] ✓ VNet deleted');
    }

    console.log('[global-setup] ✅ Teardown complete\n');
  };
}

/**
 * Wait for GraphQL endpoint to become available
 */
async function waitForGraphql(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  const q = '{ requests(limit: 1) { items { id } } }';
  let lastErr: any = null;
  while (true) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
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
