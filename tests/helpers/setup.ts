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
import { findAvailablePort } from './port-utils.js';
import { getTestGitRepo, type TestGitRepo } from './test-git-repo.js';

let vnetResult: VnetResult | null = null;
let ponderProc: ExecaChildProcess | null = null;
let controlApiProc: ExecaChildProcess | null = null;
let tenderlyClient: ReturnType<typeof createTenderlyClient> | null = null;
let testGitRepo: TestGitRepo | null = null;

// Generate unique suite ID for process isolation
const SUITE_ID = `test-${Date.now()}-${process.pid}`;

export async function setup() {
  console.log(`\n[global-setup:${SUITE_ID}] 🚀 Setting up shared E2E test infrastructure...\n`);

  // Load env early and set flag to prevent child processes from reloading
  loadEnvOnce();

  // Set up test git repository (requires TEST_GITHUB_REPO env var)
  // Clones from configured Git remote for full test isolation
  // Each suite gets its own clone to avoid race conditions
  console.log(`[global-setup:${SUITE_ID}] Setting up test git repository...`);
  testGitRepo = getTestGitRepo(SUITE_ID);  // Throws if TEST_GITHUB_REPO not set
  process.env.CODE_METADATA_REPO_ROOT = testGitRepo.repoPath;
  console.log(`[global-setup:${SUITE_ID}] ✓ Test git repo at: ${testGitRepo.repoPath}`);

  // Log which Tenderly account is being used
  const tenderlyAccount = process.env.TENDERLY_ACCOUNT_SLUG || 'NOT SET';
  const tenderlyProject = process.env.TENDERLY_PROJECT_SLUG || 'NOT SET';
  console.log(`[global-setup:${SUITE_ID}] Tenderly Account: ${tenderlyAccount}`);
  console.log(`[global-setup:${SUITE_ID}] Tenderly Project: ${tenderlyProject}`);

  // Create Tenderly Virtual TestNet
  tenderlyClient = createTenderlyClient();
  console.log(`[global-setup:${SUITE_ID}] Creating ephemeral Virtual TestNet...`);
  vnetResult = await tenderlyClient.createVnet(8453); // Base mainnet
  console.log(`[global-setup:${SUITE_ID}] ✓ VNet created: ${vnetResult.id}`);

  // Fund test wallet
  const testWallet = '0x6ad64135eae1a5a78ec74c44d337a596c682f690';
  console.log(`[global-setup:${SUITE_ID}] Funding test wallet: ${testWallet}`);
  await tenderlyClient.fundAddress(testWallet, ethToWei('10'), vnetResult.adminRpcUrl);
  console.log(`[global-setup:${SUITE_ID}] ✓ Wallet funded`);

  // Override RPC URLs for test environment
  process.env.RPC_URL = vnetResult.adminRpcUrl;
  process.env.MECH_RPC_HTTP_URL = vnetResult.adminRpcUrl;
  process.env.MECHX_CHAIN_RPC = vnetResult.adminRpcUrl;
  process.env.BASE_RPC_URL = vnetResult.adminRpcUrl;

  // Find available port for Ponder (with timestamp + PID offset to avoid parallel collisions)
  const basePonderPort = 42070 + ((Date.now() + process.pid) % 50);
  const testPonderPort = await findAvailablePort(basePonderPort);
  console.log(`[global-setup:${SUITE_ID}] Using Ponder port: ${testPonderPort}`);
  const gqlUrl = `http://localhost:${testPonderPort}/graphql`;
  process.env.PONDER_PORT = String(testPonderPort);
  process.env.PONDER_GRAPHQL_URL = gqlUrl;
  process.env.E2E_GQL_URL = gqlUrl; // For tests to read

  // Each suite gets its own Control API port to avoid race conditions
  // Start searching from a unique base port derived from timestamp to reduce collisions
  const baseControlPort = 4001 + (Date.now() % 100);
  const testControlApiPort = await findAvailablePort(baseControlPort);
  const controlUrl = `http://localhost:${testControlApiPort}/graphql`;
  console.log(`[global-setup:${SUITE_ID}] Using Control API port: ${testControlApiPort}`);

  process.env.CONTROL_API_PORT = String(testControlApiPort);
  process.env.CONTROL_API_URL = controlUrl;
  process.env.E2E_CONTROL_URL = controlUrl; // For tests to read

  let controlApiReady = false;

  // Store VNet ID and Suite ID for tests
  process.env.E2E_VNET_ID = vnetResult.id;
  process.env.E2E_SUITE_ID = SUITE_ID;

  // Reset config cache in test process so getters re-read overridden env vars
  const { resetConfigForTests } = await import('../../config/index.js');
  resetConfigForTests();

  // NOW connect MCP client (spawns MCP server with overridden env vars)
  console.log(`[global-setup:${SUITE_ID}] Connecting MCP client...`);
  process.env.JINN_REPO_ROOT = process.cwd();
  const client = getMcpClient();
  await client.connect();
  console.log(`[global-setup:${SUITE_ID}] ✓ MCP client connected`);

  // REMOVED: Global pkill command that killed ALL Ponder instances
  // This allows parallel test suites to run without interfering with each other.
  // Port allocation and process tracking provide isolation instead.

  // Create suite-specific Ponder cache directory
  const ponderCacheDir = `.ponder-${SUITE_ID}`;
  process.env.PONDER_DATABASE_DIR = ponderCacheDir;
  console.log(`[global-setup:${SUITE_ID}] Using Ponder cache dir: ${ponderCacheDir}`);

  // Clean suite-specific Ponder cache
  try {
    await execa('rm', ['-rf', ponderCacheDir]);
    console.log(`[global-setup:${SUITE_ID}] ✓ Cleaned Ponder cache`);
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
    console.log(`[global-setup:${SUITE_ID}] Calculated PONDER_START_BLOCK: ${vnetStartBlock}`);
  } catch (error: any) {
    console.error(`[global-setup:${SUITE_ID}] Warning: Failed to calculate start block:`, error.message);
  }

  const ponderEnv = {
    ...process.env,
    PONDER_REVIEW_MODE: '1',  // Enable review mode to preserve test RPC_URL
    RPC_URL: process.env.RPC_URL,  // Test VNet Admin RPC
    PORT: String(testPonderPort),
    PONDER_START_BLOCK: process.env.PONDER_START_BLOCK,
    MECH_ADDRESS: process.env.MECH_ADDRESS,
    PONDER_MECH_ADDRESS: process.env.MECH_ADDRESS,
    PONDER_DATABASE_DIR: ponderCacheDir,  // Suite-specific cache directory
  };

  // Use stdio: 'inherit' to avoid creating pipe handles that prevent clean teardown
  ponderProc = execa('yarn', ['ponder:dev'], {
    stdio: 'inherit',
    env: ponderEnv,
    cleanup: true,
    forceKillAfterTimeout: 2000, // Force-kill after 2s if SIGTERM doesn't work
  });

  console.log(`[global-setup:${SUITE_ID}] Ponder dev server spawned (PID: ${ponderProc.pid})`);
  await waitForGraphql(gqlUrl, 120_000);
  console.log(`[global-setup:${SUITE_ID}] ✓ Ponder GraphQL ready`);

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
    console.log(`[global-setup:${SUITE_ID}] Starting Control API...`);
    // Use stdio: 'inherit' to avoid creating pipe handles that prevent clean teardown
    controlApiProc = execa('yarn', ['control:dev'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        CONTROL_API_PORT: String(testControlApiPort),
        PONDER_GRAPHQL_URL: gqlUrl,
      },
      cleanup: true,
      forceKillAfterTimeout: 2000, // Force-kill after 2s if SIGTERM doesn't work
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
    console.log(`[global-setup:${SUITE_ID}] ✓ Control API ready (PID: ${controlApiProc.pid})`);
  } else {
    console.log(`[global-setup:${SUITE_ID}] ✓ Control API already running`);
  }

  console.log(`[global-setup:${SUITE_ID}] ✅ All infrastructure ready!\n`);

  // Return teardown function
  return async () => {
    console.log(`\n[global-setup:${SUITE_ID}] 🧹 Tearing down shared infrastructure...\n`);

    // Clean up test git repo branches
    if (testGitRepo) {
      try {
        testGitRepo.cleanup();
      } catch (e: any) {
        console.warn(`[global-setup:${SUITE_ID}] Test repo cleanup warning:`, e.message);
      }
    }

    // Kill Ponder process
    if (ponderProc && ponderProc.pid) {
      try {
        console.log(`[global-setup:${SUITE_ID}] Stopping Ponder (PID: ${ponderProc.pid})...`);
        // Send SIGTERM (forceKillAfterTimeout in execa options will SIGKILL if needed)
        ponderProc.kill('SIGTERM');
        // Wait for process to exit
        await ponderProc.catch((err: any) => {
          // Test cleanup exception: Process rejection on kill is expected
          if (err.isCanceled || err.isTerminated || err.signal === 'SIGTERM') {
            // Normal termination
          } else {
            console.warn(`[global-setup:${SUITE_ID}] Ponder exit error:`, err.message || err);
          }
        });
        console.log(`[global-setup:${SUITE_ID}] ✓ Ponder stopped`);
      } catch (err: any) {
        // Test cleanup exception: Process kill errors during teardown are non-critical
        console.warn(`[global-setup:${SUITE_ID}] Warning stopping Ponder:`, err.message || err);
      }
    }

    // Disconnect MCP client
    const client = getMcpClient();
    try {
      await client.disconnect();
      console.log(`[global-setup:${SUITE_ID}] ✓ MCP client disconnected`);
    } catch (err: any) {
      // Test cleanup exception: MCP disconnect errors are non-critical during teardown
      console.warn(`[global-setup:${SUITE_ID}] Warning disconnecting MCP client:`, err.message || err);
    }

    // Kill Control API process
    if (controlApiProc && controlApiProc.pid) {
      try {
        console.log(`[global-setup:${SUITE_ID}] Stopping Control API (PID: ${controlApiProc.pid})...`);
        // Send SIGTERM (forceKillAfterTimeout in execa options will SIGKILL if needed)
        controlApiProc.kill('SIGTERM');
        // Wait for process to exit
        await controlApiProc.catch((err: any) => {
          // Test cleanup exception: Process rejection on kill is expected
          if (err.isCanceled || err.isTerminated || err.signal === 'SIGTERM') {
            // Normal termination
          } else {
            console.warn(`[global-setup:${SUITE_ID}] Control API exit error:`, err.message || err);
          }
        });
        console.log(`[global-setup:${SUITE_ID}] ✓ Control API stopped`);
      } catch (err: any) {
        // Test cleanup exception: Process kill errors during teardown are non-critical
        console.warn(`[global-setup:${SUITE_ID}] Warning stopping Control API:`, err.message || err);
      }
    }

    // Delete Virtual TestNet
    if (vnetResult && tenderlyClient) {
      console.log(`[global-setup:${SUITE_ID}] Deleting Virtual TestNet: ${vnetResult.id}`);
      await tenderlyClient.deleteVnet(vnetResult.id);
      console.log(`[global-setup:${SUITE_ID}] ✓ VNet deleted`);
    }

    // Clean up suite-specific Ponder cache directory
    try {
      await execa('rm', ['-rf', ponderCacheDir]);
      console.log(`[global-setup:${SUITE_ID}] ✓ Cleaned suite-specific Ponder cache`);
    } catch (error: any) {
      console.warn(`[global-setup:${SUITE_ID}] Warning: Failed to clean Ponder cache:`, error.message);
    }

    console.log(`[global-setup:${SUITE_ID}] ✅ Teardown complete\n`);
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
