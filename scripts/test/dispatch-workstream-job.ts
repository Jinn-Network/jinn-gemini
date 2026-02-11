#!/usr/bin/env npx tsx
/**
 * Dispatch a test job within a specific workstream on a Tenderly VNet.
 *
 * Uses the SAME production code path as redispatch-job.ts:
 *   buildIpfsPayload() → marketplaceInteract() → pushJsonToIpfs()
 *
 * This ensures the IPFS metadata structure matches production exactly,
 * so the worker's BlueprintBuilder correctly extracts the task from
 * blueprint invariants.
 *
 * Usage:
 *   yarn test:e2e:dispatch --workstream <id> --cwd <jinn-node-clone>
 *   yarn test:e2e:dispatch --workstream <id> --cwd <path> --blueprint '{"invariants":[...]}'
 *   yarn test:e2e:dispatch --workstream <id> --cwd <path> --job-def-id <uuid>
 *
 * Flags:
 *   --workstream <id>       Required. Workstream hash.
 *   --cwd <path>            Required. Path to jinn-node clone.
 *   --job-name <name>       Job name (default: e2e-test-job).
 *   --job-def-id <uuid>     Job definition ID (default: random UUID).
 *   --blueprint <json>      Blueprint JSON (default: OLAS price research with tool-use invariants).
 *   --enabled-tools <csv>   Comma-separated tool names (default: google_web_search,web_fetch,create_artifact).
 *
 * Requires:
 *   - OPERATE_PASSWORD env var (for agent key decryption)
 *   - RPC_URL env var or .env.e2e file
 */

import crypto from 'crypto';
import dotenv from 'dotenv';
import { join, resolve } from 'path';
import { buildIpfsPayload } from 'jinn-node/agent/shared/ipfs-payload-builder.js';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from 'jinn-node/env/operate-profile.js';

const MONOREPO_ROOT = resolve(import.meta.dirname, '..', '..');
const E2E_ENV_FILE = resolve(MONOREPO_ROOT, '.env.e2e');

// Load env files in priority order (later overrides earlier):
// 1. .env — base monorepo creds
// 2. .env.test — Tenderly creds
// 3. .env.e2e — VNet RPC_URL (highest priority)
dotenv.config({ path: resolve(MONOREPO_ROOT, '.env'), quiet: true });
dotenv.config({ path: resolve(MONOREPO_ROOT, '.env.test'), override: true, quiet: true });
dotenv.config({ path: E2E_ENV_FILE, override: true, quiet: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const [key, val] = args[i].split('=');
      if (val !== undefined) {
        flags[key.slice(2)] = val;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key.slice(2)] = args[++i];
      }
    }
  }
  return flags;
}

// ─── Default Blueprint ───────────────────────────────────────────────────────

/**
 * Default blueprint for E2E testing. GOAL-001 describes the actual task,
 * TOOL-001/002 validate tool invocation. The worker's BlueprintBuilder
 * reads ONLY metadata.blueprint — there is no separate "prompt" field.
 */
const DEFAULT_BLUEPRINT = JSON.stringify({
  invariants: [
    {
      id: 'GOAL-001',
      type: 'BOOLEAN',
      condition: 'Research the current price of OLAS token using web search. Create an artifact summarizing findings including current price, 24h change, and market cap.',
      assessment: 'Artifact exists with OLAS price data sourced from web search results',
    },
    {
      id: 'TOOL-001',
      type: 'BOOLEAN',
      condition: 'You must use the google_web_search tool to find OLAS token price data',
      assessment: 'Check telemetry for google_web_search tool calls',
    },
    {
      id: 'TOOL-002',
      type: 'BOOLEAN',
      condition: 'You must use the create_artifact tool to store your research findings',
      assessment: 'Check telemetry for create_artifact tool calls',
    },
  ],
});

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const workstreamId = flags.workstream;
  if (!workstreamId) throw new Error('--workstream <id> is required');

  const clonePath = flags.cwd;
  if (!clonePath) throw new Error('--cwd <jinn-node-clone-path> is required');

  const jobName = flags['job-name'] || 'e2e-test-job';
  const blueprint = flags.blueprint || DEFAULT_BLUEPRINT;
  const jobDefinitionId = flags['job-def-id'] || crypto.randomUUID();

  // Tools the agent should have available
  const enabledTools = flags['enabled-tools']
    ? flags['enabled-tools'].split(',')
    : ['google_web_search', 'web_fetch', 'create_artifact'];

  // Point operate-profile at the jinn-node clone so getMechAddress(),
  // getServicePrivateKey(), getMechChainConfig() read from the right .operate dir
  const operateDir = join(resolve(clonePath), '.operate');
  process.env.OPERATE_PROFILE_DIR = operateDir;
  console.log('Using operate profile:', operateDir);

  // 1. Build IPFS payload via production helper (same as redispatch-job.ts)
  console.log('\nBuilding IPFS payload...');
  console.log('  jobName:', jobName);
  console.log('  jobDefinitionId:', jobDefinitionId);
  console.log('  workstreamId:', workstreamId);
  console.log('  enabledTools:', enabledTools.join(', '));

  const { ipfsJsonContents } = await buildIpfsPayload({
    blueprint,
    jobName,
    jobDefinitionId,
    enabledTools,
    skipBranch: true, // E2E: no git branch creation
    workstreamId,
  });

  // 2. Dispatch via production marketplaceInteract (same as redispatch-job.ts)
  const mechAddress = getMechAddress();
  const chainConfig = getMechChainConfig();
  const privateKey = getServicePrivateKey();

  if (!mechAddress) {
    throw new Error('Mech address not found. Check .operate service config (MECH_TO_CONFIG).');
  }
  if (!privateKey) {
    throw new Error('Service private key not found. Check .operate/keys directory and OPERATE_PASSWORD env.');
  }

  console.log('\nDispatching via marketplaceInteract...');
  console.log('  mechAddress:', mechAddress);

  const result = await marketplaceInteract({
    prompts: [blueprint],
    priorityMech: mechAddress,
    tools: enabledTools,
    ipfsJsonContents,
    chainConfig,
    keyConfig: { source: 'value', value: privateKey },
    postOnly: true,
    responseTimeout: 300,
  });

  if (!result || !Array.isArray(result.request_ids) || result.request_ids.length === 0) {
    throw new Error('Dispatch failed: no request IDs returned. Check RPC quota, funding, or mech config.');
  }

  console.log('\nDispatched successfully!');
  console.log('  Request IDs:', result.request_ids.join(', '));
  if (result.transaction_hash) {
    console.log('  Transaction:', result.transaction_hash);
  }
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
