#!/usr/bin/env npx tsx
/**
 * E2E Test Harness — VNet Lifecycle CLI
 *
 * Manages Tenderly Virtual TestNets for end-to-end testing of jinn-node.
 *
 * Commands:
 *   create              Create a new VNet, output admin RPC URL
 *   fund <addr>         Fund address with ETH + OLAS
 *   mine [n]            Mine n blocks (default 1)
 *   time-warp <seconds> Advance time + mine a block
 *   cleanup             Delete all stale e2e-test-* VNets
 *   status              Check VNet health + quota status
 *
 * Usage:
 *   yarn test:e2e:vnet create
 *   yarn test:e2e:vnet fund 0x1234... --eth 0.1 --olas 20
 *   yarn test:e2e:vnet time-warp 259200    # 72 hours
 *   yarn test:e2e:vnet status
 */

import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { createTenderlyClient, ethToWei } from '../lib/tenderly.js';

const MONOREPO_ROOT = resolve(import.meta.dirname, '..', '..');
const E2E_ENV_FILE = resolve(MONOREPO_ROOT, '.env.e2e');

// Load env files in priority order (later overrides earlier):
// 1. .env — base monorepo creds (Supabase, etc.)
// 2. .env.test — Tenderly creds
// 3. .env.e2e — VNet RPC_URL from "vnet create" (highest priority)
dotenv.config({ path: resolve(MONOREPO_ROOT, '.env'), quiet: true });
dotenv.config({ path: resolve(MONOREPO_ROOT, '.env.test'), override: true, quiet: true });
dotenv.config({ path: E2E_ENV_FILE, override: true, quiet: true });
const OLAS_TOKEN_ADDRESS = '0x54330d28ca3357F294334BDC454a032e7f353416';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const [key, val] = args[i].split('=');
      if (val !== undefined) {
        flags[key.slice(2)] = val;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key.slice(2)] = args[++i];
      } else {
        flags[key.slice(2)] = 'true';
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

async function getRpcUrl(flags: Record<string, string>): Promise<string> {
  if (flags['rpc-url']) return flags['rpc-url'];
  if (process.env.RPC_URL) return process.env.RPC_URL;

  try {
    const envContent = await fs.readFile(E2E_ENV_FILE, 'utf-8');
    const match = envContent.match(/^RPC_URL=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* .env.e2e doesn't exist yet */ }

  throw new Error('No RPC URL found. Pass --rpc-url, set RPC_URL env, or run "create" first.');
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[] = []): Promise<any> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`RPC ${method} failed: HTTP ${resp.status} — ${text}`);
  }
  const json = await resp.json();
  if (json.error) throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

/**
 * Write .env.e2e from scratch (not append). Each `create` starts a clean session.
 */
async function writeEnvE2e(vars: Record<string, string>): Promise<void> {
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  await fs.writeFile(E2E_ENV_FILE, lines.join('\n') + '\n');
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdCreate(flags: Record<string, string>) {
  const client = createTenderlyClient();

  // Cleanup old VNets first
  console.log('Cleaning up stale VNets...');
  const deleted = await client.cleanupOldVnets({ maxAgeMs: 3600000 });
  if (deleted > 0) console.log(`  Deleted ${deleted} stale VNets`);

  // Create new VNet
  console.log('Creating new VNet (Base fork)...');
  const vnet = await client.createVnet(8453);

  // Get current block
  const blockHex = await rpcCall(vnet.adminRpcUrl, 'eth_blockNumber');
  const blockNumber = parseInt(blockHex, 16);

  // Write to .env.e2e
  await writeEnvE2e({
    RPC_URL: vnet.adminRpcUrl,
    VNET_ID: vnet.id,
    CHAIN_ID: '8453',
  });

  const result = {
    vnetId: vnet.id,
    adminRpcUrl: vnet.adminRpcUrl,
    blockNumber,
    envFile: E2E_ENV_FILE,
  };

  console.log('\nVNet created:');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nConfig written to ${E2E_ENV_FILE}`);
}

async function cmdFund(positional: string[], flags: Record<string, string>) {
  const address = positional[0];
  if (!address) throw new Error('Usage: fund <address> [--eth <amount>] [--olas <amount>]');

  const rpcUrl = await getRpcUrl(flags);
  const ethAmount = flags.eth || '0';
  const olasAmount = flags.olas || '0';
  if (parseFloat(ethAmount) === 0 && parseFloat(olasAmount) === 0) {
    throw new Error('Specify at least one of --eth <amount> or --olas <amount>');
  }

  // Fund ETH (skip if 0)
  // tenderly_setBalance sets ABSOLUTE balance, so we read current + add requested
  if (parseFloat(ethAmount) > 0) {
    const currentHex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
    const currentWei = BigInt(currentHex);
    const addWei = BigInt(ethToWei(ethAmount));
    const totalWei = currentWei + addWei;
    console.log(`Funding ${address} with ${ethAmount} ETH (current: ${Number(currentWei) / 1e18} ETH)...`);
    await rpcCall(rpcUrl, 'tenderly_setBalance', [[address], `0x${totalWei.toString(16)}`]);
    console.log('  ETH funded');
  }

  // Fund OLAS (skip if 0)
  // tenderly_setErc20Balance sets ABSOLUTE balance, so we read current + add requested
  if (parseFloat(olasAmount) > 0) {
    // Read current OLAS balance via ERC20 balanceOf
    const balanceOfData = `0x70a08231000000000000000000000000${address.slice(2).toLowerCase()}`;
    const currentHex = await rpcCall(rpcUrl, 'eth_call', [
      { to: OLAS_TOKEN_ADDRESS, data: balanceOfData },
      'latest',
    ]);
    const currentWei = BigInt(currentHex);
    const addWei = BigInt(ethToWei(olasAmount)); // OLAS has 18 decimals like ETH
    const totalWei = currentWei + addWei;
    console.log(`Funding ${address} with ${olasAmount} OLAS (current: ${Number(currentWei / BigInt(1e14)) / 1e4} OLAS)...`);
    await rpcCall(rpcUrl, 'tenderly_setErc20Balance', [
      OLAS_TOKEN_ADDRESS,
      [address],
      `0x${totalWei.toString(16)}`,
    ]);
    console.log('  OLAS funded');
  }

  console.log('\nDone.');
}

async function cmdMine(positional: string[], flags: Record<string, string>) {
  const count = parseInt(positional[0] || '1', 10);
  const rpcUrl = await getRpcUrl(flags);

  console.log(`Mining ${count} block(s)...`);
  for (let i = 0; i < count; i++) {
    await rpcCall(rpcUrl, 'evm_mine');
  }

  const blockHex = await rpcCall(rpcUrl, 'eth_blockNumber');
  console.log(`Done. Current block: ${parseInt(blockHex, 16)}`);
}

async function cmdTimeWarp(positional: string[], flags: Record<string, string>) {
  const seconds = parseInt(positional[0], 10);
  if (!seconds || seconds <= 0) throw new Error('Usage: time-warp <seconds>');

  const rpcUrl = await getRpcUrl(flags);

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  console.log(`Warping time forward by ${seconds}s (${hours}h ${minutes}m)...`);

  await rpcCall(rpcUrl, 'evm_increaseTime', [`0x${seconds.toString(16)}`]);
  await rpcCall(rpcUrl, 'evm_mine');

  const blockHex = await rpcCall(rpcUrl, 'eth_blockNumber');
  console.log(`Done. Current block: ${parseInt(blockHex, 16)}`);
}

async function cmdCleanup(flags: Record<string, string>) {
  const dryRun = flags['dry-run'] === 'true';
  const maxAgeHours = parseInt(flags['max-age-hours'] || '1', 10);

  const client = createTenderlyClient();

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Cleaning up VNets older than ${maxAgeHours}h...`);
  const deleted = await client.cleanupOldVnets({
    maxAgeMs: maxAgeHours * 3600000,
    dryRun,
  });

  console.log(`${dryRun ? 'Would delete' : 'Deleted'} ${deleted} VNets.`);

  // Clean up clone directory if saved in .env.e2e
  const cloneDir = process.env.CLONE_DIR;
  if (cloneDir) {
    try {
      await fs.access(cloneDir);
      if (dryRun) {
        console.log(`[DRY RUN] Would remove clone: ${cloneDir}`);
      } else {
        console.log(`Removing clone: ${cloneDir}...`);
        await fs.rm(cloneDir, { recursive: true, force: true });
        console.log('  Clone removed.');
      }
    } catch {
      // Directory doesn't exist, nothing to clean
    }
  }

  // Clean .env.e2e last (since it contains CLONE_DIR we just used)
  if (!dryRun) {
    try {
      await fs.access(E2E_ENV_FILE);
      await fs.unlink(E2E_ENV_FILE);
      console.log(`Removed ${E2E_ENV_FILE}`);
    } catch {
      // File doesn't exist
    }
  }
}

async function cmdStatus(flags: Record<string, string>) {
  let rpcUrl: string;
  try {
    rpcUrl = await getRpcUrl(flags);
  } catch {
    console.log('No VNet configured. Run "create" first.');
    return;
  }

  // Read VNet ID from .env.e2e
  let vnetId = 'unknown';
  try {
    const envContent = await fs.readFile(E2E_ENV_FILE, 'utf-8');
    const match = envContent.match(/^VNET_ID=(.+)$/m);
    if (match) vnetId = match[1].trim();
  } catch { /* no file */ }

  console.log(`VNet ID: ${vnetId}`);
  console.log(`RPC URL: ${rpcUrl}`);

  // Test read
  try {
    const blockHex = await rpcCall(rpcUrl, 'eth_blockNumber');
    console.log(`Current block: ${parseInt(blockHex, 16)}`);
    console.log('Reads: OK');
  } catch (e: any) {
    console.log(`Reads: FAILED — ${e.message}`);
    return;
  }

  // Test write (mine a block)
  try {
    await rpcCall(rpcUrl, 'evm_mine');
    console.log('Writes: OK');
  } catch (e: any) {
    if (e.message.includes('403') || e.message.includes('quota')) {
      console.log('Writes: QUOTA EXHAUSTED — create a new VNet');
    } else {
      console.log(`Writes: FAILED — ${e.message}`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional.shift();

  switch (command) {
    case 'create':
      return cmdCreate(flags);
    case 'fund':
      return cmdFund(positional, flags);
    case 'mine':
      return cmdMine(positional, flags);
    case 'time-warp':
      return cmdTimeWarp(positional, flags);
    case 'cleanup':
      return cmdCleanup(flags);
    case 'status':
      return cmdStatus(flags);
    default:
      console.error(`Unknown command: ${command || '(none)'}`);
      console.error('\nUsage: e2e-harness.ts <command> [options]');
      console.error('Commands: create, fund, mine, time-warp, cleanup, status');
      process.exit(1);
  }
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
