#!/usr/bin/env tsx
/**
 * Tenderly VNet Development Environment
 *
 * Creates an isolated blockchain environment for testing and debugging.
 * Preserves VNet after exit for post-session review.
 *
 * Usage:
 *   yarn dev:vnet
 *
 * Cleanup:
 *   yarn cleanup:vnet <vnet-id>
 */

import { join } from 'path';
import { execa } from 'execa';
import { createTenderlyClient, ethToWei, type VnetResult } from './lib/tenderly.js';
import { SessionManager } from './lib/session.js';
import { ProcessManager } from './lib/process-manager.js';
import { loadEnvOnce } from '../gemini-agent/mcp/tools/shared/env.js';

// Test wallet to fund (from E2E test)
const TEST_WALLET = '0x6ad64135eae1a5a78ec74c44d337a596c682f690';

// State
let vnetResult: VnetResult | null = null;
let tenderlyClient: ReturnType<typeof createTenderlyClient> | null = null;
let sessionManager: SessionManager | null = null;
let processManager: ProcessManager | null = null;
let quotaExhausted = false;
let isShuttingDown = false;

/**
 * Main execution flow
 */
async function main() {
  // Load environment variables (same as E2E tests)
  loadEnvOnce();

  console.log('='.repeat(60));
  console.log('Tenderly VNet Development Environment');
  console.log('='.repeat(60));
  console.log('');

  // Initialize session manager
  sessionManager = new SessionManager();

  // Initialize process manager with crash/quota handlers
  processManager = new ProcessManager({
    onCrash: (serviceName, code) => {
      if (isShuttingDown) return;
      console.error(`\n❌ Service crashed: ${serviceName} (code ${code})`);
      console.error('Shutting down all services...');
      shutdown('service_crash', `${serviceName} crashed with code ${code}`);
    },
    onQuotaError: () => {
      if (isShuttingDown) return;
      console.error('\n⚠️  Tenderly RPC quota exhausted!');
      quotaExhausted = true;
      shutdown('quota_exhausted', 'RPC quota limit reached');
    },
  });

  // Step 1: Create Tenderly VNet
  console.log('[tenderly] Creating ephemeral Virtual TestNet...');
  tenderlyClient = createTenderlyClient();
  vnetResult = await tenderlyClient.createVnet(8453); // Base mainnet fork

  console.log(`[tenderly] ✓ VNet created: ${vnetResult.id}`);
  console.log(`[tenderly]   Dashboard: ${vnetResult.blockExplorerUrl}`);
  console.log(`[tenderly]   Admin RPC: ${vnetResult.adminRpcUrl}`);
  console.log('');

  // Step 2: Fund test wallet
  console.log(`[tenderly] Funding test wallet: ${TEST_WALLET}`);
  await tenderlyClient.fundAddress(TEST_WALLET, ethToWei('10'), vnetResult.adminRpcUrl);
  console.log('[tenderly] ✓ Test wallet funded with 10 ETH');
  console.log('');

  // Step 3: Initialize session
  await sessionManager.initSession(vnetResult, [TEST_WALLET]);
  console.log(`[session] ✓ Session saved to: ${sessionManager.getSessionFile()}`);
  console.log('');

  // Step 4: Override RPC URL in environment and set recent start block
  process.env.RPC_URL = vnetResult.adminRpcUrl;
  process.env.MECHX_CHAIN_RPC = vnetResult.adminRpcUrl;

  // Convert HTTPS RPC to WSS for WebSocket connection (mech-client-ts needs this)
  const wssUrl = vnetResult.adminRpcUrl.replace('https://', 'wss://');
  process.env.MECHX_WSS_ENDPOINT = wssUrl;

  // Get current block number and set Ponder to start from recent block
  const currentBlockHex = await fetch(vnetResult.adminRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    }),
  }).then(r => r.json()).then(j => j.result);
  const currentBlock = parseInt(currentBlockHex, 16);
  const startBlock = Math.max(currentBlock - 100, 0); // Start from 100 blocks ago
  process.env.PONDER_START_BLOCK = startBlock.toString();

  console.log('[env] ✓ RPC_URL overridden to use VNet');
  console.log(`[env] ✓ PONDER_START_BLOCK set to ${startBlock} (current: ${currentBlock})`);
  console.log('');

  // Step 5: Kill any existing dev services and clean Ponder cache
  console.log('[cleanup] Killing any existing dev services...');
  try {
    // Kill all potentially running services
    await execa('pkill', ['-f', 'ponder.*dev'], { reject: false });
    await execa('pkill', ['-f', 'control:dev'], { reject: false });
    await execa('pkill', ['-f', 'mech_worker'], { reject: false });
    await execa('pkill', ['-f', 'frontend.*dev'], { reject: false });

    // Also kill by port to ensure nothing is blocking
    try {
      const { stdout } = await execa('lsof', ['-ti:4001,42069,3020'], { reject: false });
      if (stdout.trim()) {
        const pids = stdout.trim().split('\n');
        for (const pid of pids) {
          await execa('kill', ['-9', pid], { reject: false });
        }
      }
    } catch {}

    // Wait for processes to fully terminate
    await new Promise(r => setTimeout(r, 3000));

    // Clean Ponder cache
    await execa('rm', ['-rf', 'ponder/.ponder/sqlite'], { reject: false });
    console.log('[cleanup] ✓ All services killed and cache cleaned');
  } catch (e) {
    console.warn('[cleanup] Warning: Could not complete cleanup:', e);
  }
  console.log('');

  // Step 6: Start Ponder
  console.log('[ponder] Starting indexer...');
  const ponderProc = processManager.startService({
    name: 'ponder',
    command: 'yarn',
    args: ['dev'],
    cwd: join(process.cwd(), 'ponder'),
    env: {
      PONDER_RPC_URL: vnetResult.adminRpcUrl,
      PONDER_GRAPHQL_URL: process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql',
      PONDER_START_BLOCK: process.env.PONDER_START_BLOCK!,
      RPC_URL: vnetResult.adminRpcUrl,
    },
  });

  if (ponderProc.pid) {
    await sessionManager.updateService('ponder', { pid: ponderProc.pid, status: 'running' });
  }

  // Wait for Ponder GraphQL
  const ponderUrl = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
  await processManager.waitForGraphql({
    url: ponderUrl,
    query: '{ requests(limit: 1) { items { id } } }',
    expectedResponse: (data) => data?.data !== undefined,
    timeoutMs: 120_000,
    intervalMs: 1000,
  });
  console.log('[ponder] ✓ GraphQL ready');
  console.log('');

  // Step 7: Start Control API
  console.log('[control] Starting Control API...');
  const controlProc = processManager.startService({
    name: 'control',
    command: 'yarn',
    args: ['control:dev'],
    cwd: process.cwd(),
    env: {},
  });

  if (controlProc.pid) {
    await sessionManager.updateService('controlApi', { pid: controlProc.pid, status: 'running' });
  }

  // Wait for Control API health
  const controlUrl = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';
  await processManager.waitForGraphql({
    url: controlUrl,
    query: '{ _health }',
    expectedResponse: (data) => data?.data?._health === 'ok',
    timeoutMs: 60_000,
    intervalMs: 1000,
  });
  console.log('[control] ✓ GraphQL ready');
  console.log('');

  // Step 8: Start Mech Worker (continuous mode)
  console.log('[worker] Starting mech worker (continuous mode)...');
  const workerProc = processManager.startService({
    name: 'worker',
    command: 'tsx',
    args: ['worker/mech_worker.ts'],
    cwd: process.cwd(),
    env: {
      USE_TSX_MCP: '1',
    },
  });

  if (workerProc.pid) {
    await sessionManager.updateService('worker', { pid: workerProc.pid, status: 'running' });
  }
  console.log('[worker] ✓ Worker started');
  console.log('');

  // Step 9: Start Frontend
  console.log('[frontend] Starting Next.js dev server on port 3020...');
  const frontendProc = processManager.startService({
    name: 'frontend',
    command: 'yarn',
    args: ['next', 'dev', '--turbopack', '--port', '3020'],
    cwd: join(process.cwd(), 'frontend/explorer'),
    env: {
      NEXT_PUBLIC_SUBGRAPH_URL: ponderUrl,
    },
  });

  if (frontendProc.pid) {
    await sessionManager.updateService('frontend', { pid: frontendProc.pid, status: 'running' });
  }
  console.log('[frontend] ✓ Dev server started');
  console.log('');

  // Step 10: Dispatch Chief Orchestrator job to start the chain
  console.log('[orchestrator] Dispatching Chief Orchestrator job...');

  // Wait for all services to stabilize and connections to be ready
  await new Promise(r => setTimeout(r, 5000));

  try {
    const { marketplaceInteract } = await import('mech-client-ts/dist/marketplace_interact.js');
    const { randomUUID } = await import('crypto');

    const jobName = 'Chief Orchestrator - Crypto Alpha Hunter';
    const prompt = `# Role: Chief Orchestrator – Crypto Alpha Hunter

## Mission
As the Chief Orchestrator, my purpose is to lead the discovery of profitable crypto opportunities ("alpha"). I achieve this by defining strategic direction, delegating high-level goals to specialized agents, and ensuring coordinated execution across all workstreams. I do not perform groundwork; I am a strategist who directs the system.

## Core Mandate: Find Expectation vs. Reality Gaps
My primary function is to generate alpha by directing my agents to find market divergences. I seek situations where consensus prices in one outcome, while fundamentals, adoption, or on-chain signals point to another. My mission is to consistently direct the system to surface these disconnects before the market corrects.

## Operational Workstreams (Delegated)
To achieve my core mandate, I will launch and oversee agents to perform the following functions:

1. **Surface Emerging Narratives:** I will delegate the task of spotting new narratives early. I will use the resulting intelligence to assess where hype may be over- or under-shooting reality.

2. **Track Capital Allocation:** I will delegate the tracking of venture and institutional capital flows. I will use these reports to test whether on-the-ground reality can sustain current market expectations.

3. **Monitor Market Infrastructure:** I will assign agents to monitor changes in market infrastructure, such as listings, liquidity, and onramps. I will use their findings on actual liquidity and user adoption to challenge market expectations.

4. **Spot Incentives & Catalysts:** I will task agents with identifying airdrops, grants, and staking rewards. I will use their analysis to determine if the resulting activity will persist after the catalyst fades.

5. **Analyze Macro & Policy Shifts:** I will delegate the monitoring of regulation and macro trends. I will use these inputs to identify where reality diverges from narrative-driven expectations.

## My Strategic Process
- **My strategic lens is always "expectation vs. reality."** I will use all intelligence from my delegated agents to detect market misalignments.
- **I will empower my agents to delegate and specialize.** Each workstream must be able to break down its high-level goal as needed to succeed.
- **My role is to integrate signals and identify alpha.** I will synthesize reports from all workstreams to surface the strongest divergences.
- **I will adapt the strategy based on results.** I will allocate more resources to workstreams that consistently uncover mispricings and pivot away from those generating noise.

My entire operation ladders up to one guiding mandate: **Find mispricings born of narrative-reality divergence by orchestrating a system of specialized agents.**`;

    const jobDefinitionId = randomUUID();
    const enabledTools = ['dispatch_new_job', 'dispatch_existing_job', 'get_job_context', 'search_jobs', 'search_artifacts', 'create_artifact'];

    const ipfsJsonContents = [{
      prompt,
      jobName,
      enabledTools,
      jobDefinitionId,
      nonce: randomUUID(),
      additionalContext: {},
    }];

    const result = await (marketplaceInteract as any)({
      prompts: [prompt],
      priorityMech: '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
      tools: enabledTools,
      ipfsJsonContents,
      chainConfig: 'base',
      postOnly: true,
    });

    if (result?.request_ids?.[0]) {
      console.log(`[orchestrator] ✓ Chief Orchestrator dispatched`);
      console.log(`[orchestrator]   Request ID: ${result.request_ids[0]}`);
      console.log(`[orchestrator]   Job Definition: ${jobDefinitionId}`);
    } else {
      console.warn('[orchestrator] ⚠️  Dispatch may have failed - no request ID returned');
    }
  } catch (error: any) {
    console.error('[orchestrator] ⚠️  Failed to dispatch Chief Orchestrator:', error.message);
    console.error('[orchestrator]   Chain will need to be started manually');
  }
  console.log('');

  // All services running
  console.log('='.repeat(60));
  console.log('✓ All services running!');
  console.log('='.repeat(60));
  console.log('');
  console.log('Frontend:         http://localhost:3020');
  console.log('Ponder GraphQL:   http://localhost:42069/graphql');
  console.log('Control API:      http://localhost:4001/graphql');
  console.log(`VNet Dashboard:   ${vnetResult.blockExplorerUrl}`);
  console.log('');
  console.log('Press Ctrl+C to stop (VNet will be preserved for review)');
  console.log('');

  // Keep running until interrupted
  await new Promise(() => {}); // Never resolves
}

/**
 * Graceful shutdown handler
 */
async function shutdown(
  reason: 'user_interrupt' | 'quota_exhausted' | 'service_crash' | 'error',
  notes?: string
) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('');
  console.log('='.repeat(60));
  console.log('Shutting down...');
  console.log('='.repeat(60));
  console.log('');

  // Kill all services
  if (processManager) {
    await processManager.killAll();
  }

  // Update session
  if (sessionManager) {
    await sessionManager.endSession(reason, quotaExhausted, notes);
  }

  // DO NOT DELETE VNET - preserve for review
  if (vnetResult) {
    console.log('');
    console.log('✓ VNet preserved for review:');
    console.log(`  VNet ID: ${vnetResult.id}`);
    console.log(`  Dashboard: ${vnetResult.blockExplorerUrl}`);
    console.log(`  Admin RPC: ${vnetResult.adminRpcUrl}`);

    if (quotaExhausted) {
      console.log('');
      console.log('⚠️  RPC quota exhausted - VNet is read-only via Tenderly Dashboard');
      console.log('');
      console.log('Review options:');
      console.log('  1. Tenderly Dashboard (full blockchain state):');
      console.log(`     ${vnetResult.blockExplorerUrl}`);
      console.log('  2. Frontend (cached data up to quota exhaustion):');
      console.log('     Keep Ponder and Frontend running to query cached data');
    }

    console.log('');
    console.log('To delete this VNet later, run:');
    console.log(`  yarn cleanup:vnet ${vnetResult.id}`);
  }

  if (sessionManager) {
    console.log('');
    console.log(`Session details saved to: ${sessionManager.getSessionFile()}`);
  }

  console.log('');
  process.exit(0);
}

// Signal handlers
process.on('SIGINT', () => shutdown('user_interrupt'));
process.on('SIGTERM', () => shutdown('user_interrupt'));
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  shutdown('error', String(err));
});

// Run
main().catch((err) => {
  console.error('Fatal error:', err);
  shutdown('error', String(err));
});
