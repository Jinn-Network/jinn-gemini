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
 *   checkpoint          Call checkpoint() on staking contract (fund OLAS if needed)
 *   seed-activity       Set Safe nonce + marketplace request count for activity check
 *   seed-acl <dir>      Seed credential bridge ACL with all agent addresses from .operate/keys/
 *   cleanup             Delete all stale e2e-test-* VNets
 *   status              Check VNet health + quota status
 *
 * Usage:
 *   yarn test:e2e:vnet create
 *   yarn test:e2e:vnet fund 0x1234... --eth 0.1 --olas 20
 *   yarn test:e2e:vnet time-warp 259200    # 72 hours
 *   yarn test:e2e:vnet checkpoint --staking 0x0dfa... --key 0xabc...
 *   yarn test:e2e:vnet seed-activity 0xSafe... --staking 0x0dfa... --value 1000
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

// Minimal staking contract ABI for checkpoint
const STAKING_ABI = [
  'function checkpoint() returns (uint256[], uint256[], uint256[], uint256[])',
  'function availableRewards() view returns (uint256)',
  'function tsCheckpoint() view returns (uint256)',
  'function getNextRewardCheckpointTimestamp() view returns (uint256)',
  'function calculateStakingReward(uint256 serviceId) view returns (uint256)',
  'function getServiceIds() view returns (uint256[])',
];

async function cmdCheckpoint(flags: Record<string, string>) {
  const stakingAddr = flags['staking'];
  const privateKey = flags['key'];
  if (!stakingAddr || !privateKey) {
    throw new Error('Usage: checkpoint --staking <address> --key <private-key>');
  }

  const rpcUrl = await getRpcUrl(flags);

  // Dynamic import — ethers is only needed for this command
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const staking = new ethers.Contract(stakingAddr, STAKING_ABI, wallet);

  // 1. Read pre-checkpoint state
  console.log('Staking contract state (pre-checkpoint):');
  const availableRewards = await staking.availableRewards();
  const tsCheckpoint = await staking.tsCheckpoint();
  const nextCheckpoint = await staking.getNextRewardCheckpointTimestamp();
  const serviceIds: bigint[] = await staking.getServiceIds();

  console.log(`  Available rewards: ${ethers.formatEther(availableRewards)} OLAS`);
  console.log(`  Last checkpoint:   ${new Date(Number(tsCheckpoint) * 1000).toISOString()}`);
  console.log(`  Next eligible:     ${new Date(Number(nextCheckpoint) * 1000).toISOString()}`);
  console.log(`  Staked services:   [${serviceIds.map(id => id.toString()).join(', ')}]`);

  // 2. Fund staking contract with OLAS if rewards are empty
  if (availableRewards === 0n) {
    const fundAmount = ethers.parseEther('10000'); // 10,000 OLAS
    console.log(`\nNo rewards available — funding staking contract with 10,000 OLAS...`);
    await rpcCall(rpcUrl, 'tenderly_setErc20Balance', [
      OLAS_TOKEN_ADDRESS,
      [stakingAddr],
      `0x${fundAmount.toString(16)}`,
    ]);
    const newRewards = await staking.availableRewards();
    console.log(`  Available rewards now: ${ethers.formatEther(newRewards)} OLAS`);
  }

  // 3. Pre-checkpoint reward estimates per service
  console.log('\nPre-checkpoint reward estimates:');
  for (const serviceId of serviceIds) {
    const reward = await staking.calculateStakingReward(serviceId);
    console.log(`  Service ${serviceId}: ${ethers.formatEther(reward)} OLAS`);
  }

  // 4. Call checkpoint
  console.log('\nCalling checkpoint()...');
  const tx = await staking.checkpoint();
  const receipt = await tx.wait();
  console.log(`  TX: ${receipt.hash}`);
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

  // 5. Parse return values from checkpoint event logs
  // checkpoint() returns (serviceIds, eligibleServiceIds, eligibleServiceRewards, evictServiceIds)
  // We read them from post-state since return values aren't in receipt
  console.log('\nPost-checkpoint state:');
  const postRewards = await staking.availableRewards();
  console.log(`  Available rewards: ${ethers.formatEther(postRewards)} OLAS`);

  let anyRewards = false;
  for (const serviceId of serviceIds) {
    const reward = await staking.calculateStakingReward(serviceId);
    const status = reward > 0n ? 'REWARDED' : 'no reward';
    console.log(`  Service ${serviceId}: ${ethers.formatEther(reward)} OLAS (${status})`);
    if (reward > 0n) anyRewards = true;
  }

  if (anyRewards) {
    console.log('\nCheckpoint successful — at least one service has rewards.');
  } else {
    console.log('\nWARNING: No services received rewards. Check activity checker requirements.');
  }
}

// Minimal activity checker ABI
const ACTIVITY_CHECKER_ABI = [
  'function mechMarketplace() view returns (address)',
  'function getMultisigNonces(address multisig) view returns (uint256[])',
];

async function cmdSeedActivity(positional: string[], flags: Record<string, string>) {
  const multisig = positional[0];
  const stakingAddr = flags['staking'];
  const value = parseInt(flags['value'] || '1000', 10);
  if (!multisig || !stakingAddr) {
    throw new Error('Usage: seed-activity <multisig> --staking <staking-address> [--value <n>]');
  }

  const rpcUrl = await getRpcUrl(flags);
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // 1. Query activity checker address from staking contract
  const staking = new ethers.Contract(stakingAddr, [
    'function activityChecker() view returns (address)',
  ], provider);
  const checkerAddr = await staking.activityChecker();
  console.log(`Activity checker: ${checkerAddr}`);

  // 2. Query marketplace address from activity checker
  const checker = new ethers.Contract(checkerAddr, ACTIVITY_CHECKER_ABI, provider);
  const marketplaceAddr = await checker.mechMarketplace();
  console.log(`Mech marketplace:  ${marketplaceAddr}`);

  // 3. Read current nonces
  const nonces: bigint[] = await checker.getMultisigNonces(multisig);
  console.log(`Current nonces:    [${nonces.map(n => n.toString()).join(', ')}]`);

  const valueHex = ethers.zeroPadValue(ethers.toBeHex(value), 32);

  // 4. Set Safe nonce (slot 5 in GnosisSafe)
  const safeSlot = ethers.zeroPadValue(ethers.toBeHex(5), 32);
  console.log(`\nSetting Safe nonce to ${value}...`);
  await rpcCall(rpcUrl, 'tenderly_setStorageAt', [multisig, safeSlot, valueHex]);

  // 5. Set marketplace request count (mapping slot 9, keyed by multisig)
  const mappingSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [multisig, 9]
    )
  );
  console.log(`Setting request count to ${value}...`);
  await rpcCall(rpcUrl, 'tenderly_setStorageAt', [marketplaceAddr, mappingSlot, valueHex]);

  // 6. Verify
  const newNonces: bigint[] = await checker.getMultisigNonces(multisig);
  console.log(`\nVerified nonces:   [${newNonces.map(n => n.toString()).join(', ')}]`);

  if (newNonces[0] === BigInt(value) && newNonces[1] === BigInt(value)) {
    console.log('Activity seeded successfully.');
  } else {
    console.error('WARNING: Nonces do not match expected values!');
    process.exit(1);
  }
}

async function cmdSeedAcl(positional: string[], flags: Record<string, string>) {
  const cloneDir = positional[0] || flags['cwd'];
  if (!cloneDir) {
    throw new Error('Usage: seed-acl <clone-dir>  OR  seed-acl --cwd <clone-dir>');
  }

  const operateKeysDir = resolve(cloneDir, '.operate', 'keys');
  const aclPath = resolve(MONOREPO_ROOT, '.env.e2e.acl.json');

  // Discover agent addresses from .operate/keys/
  let keyEntries: string[];
  try {
    const entries = await fs.readdir(operateKeysDir);
    keyEntries = entries.filter(
      name => /^(0x)?[a-fA-F0-9]{40}$/.test(name)
    );
  } catch {
    throw new Error(`Cannot read ${operateKeysDir} — run "yarn setup" first.`);
  }

  if (keyEntries.length === 0) {
    throw new Error(`No agent keys found in ${operateKeysDir}`);
  }

  // Normalize to lowercase 0x-prefixed
  const addresses = keyEntries.map(k =>
    (k.startsWith('0x') ? k : '0x' + k).toLowerCase()
  );

  // Load existing ACL or start fresh
  let acl: { grants: Record<string, any>; connections: Record<string, any> };
  try {
    acl = JSON.parse(await fs.readFile(aclPath, 'utf-8'));
  } catch {
    acl = { grants: {}, connections: {} };
  }

  // Seed each agent with umami grant (idempotent)
  for (const addr of addresses) {
    if (!acl.grants[addr]) {
      acl.grants[addr] = {};
    }
    if (!acl.grants[addr].umami) {
      acl.grants[addr].umami = {
        nangoConnectionId: 'e2e-umami',
        pricePerAccess: '0',
        expiresAt: null,
        active: true,
      };
    }
  }

  // Ensure connection entry exists
  if (!acl.connections['e2e-umami']) {
    acl.connections['e2e-umami'] = {
      provider: 'umami',
      metadata: { scope: 'e2e-test' },
    };
  }

  await fs.writeFile(aclPath, JSON.stringify(acl, null, 2) + '\n');

  console.log(`ACL seeded for ${addresses.length} agent(s):`);
  for (const addr of addresses) {
    console.log(`  ${addr}`);
  }
  console.log(`File: ${aclPath}`);
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
    case 'checkpoint':
      return cmdCheckpoint(flags);
    case 'seed-activity':
      return cmdSeedActivity(positional, flags);
    case 'seed-acl':
      return cmdSeedAcl(positional, flags);
    case 'cleanup':
      return cmdCleanup(flags);
    case 'status':
      return cmdStatus(flags);
    default:
      console.error(`Unknown command: ${command || '(none)'}`);
      console.error('\nUsage: e2e-harness.ts <command> [options]');
      console.error('Commands: create, fund, mine, time-warp, checkpoint, seed-activity, seed-acl, cleanup, status');
      process.exit(1);
  }
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
