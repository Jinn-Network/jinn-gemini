#!/usr/bin/env tsx
/**
 * Distribute venture token rewards to workers
 *
 * Queries Ponder for completed deliveries in a venture's workstream,
 * calculates proportional token rewards, and transfers from treasury.
 *
 * Usage:
 *   yarn tsx scripts/ventures/distribute-rewards.ts \
 *     --venture-id "<uuid>" \
 *     --amount "10000" \
 *     --dry-run
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, erc20Abi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getVenture } from './mint.js';
import dotenv from 'dotenv';

dotenv.config();

const PONDER_URL = 'https://jinn-gemini-production.up.railway.app/graphql';

interface DistributeArgs {
  ventureId: string;
  amount: string; // Total tokens to distribute this round
  dryRun: boolean;
  rpcUrl?: string;
}

interface DeliveryCount {
  workerAddress: string;
  count: number;
}

/**
 * Query Ponder for completed deliveries in a workstream
 */
async function getDeliveriesByWorker(workstreamId: string): Promise<DeliveryCount[]> {
  const query = `
    query GetDeliveries($workstreamId: String!) {
      delivers(
        where: { workstreamId: $workstreamId }
        orderBy: "blockTimestamp"
        orderDirection: "desc"
        limit: 1000
      ) {
        items {
          sender
          requestId
        }
      }
    }
  `;

  const response = await fetch(PONDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { workstreamId } }),
  });

  const result = await response.json();
  const items = result?.data?.delivers?.items || [];

  // Group by sender (worker address)
  const counts = new Map<string, number>();
  for (const item of items) {
    const addr = item.sender.toLowerCase();
    counts.set(addr, (counts.get(addr) || 0) + 1);
  }

  return Array.from(counts.entries()).map(([workerAddress, count]) => ({
    workerAddress,
    count,
  }));
}

async function distributeRewards(args: DistributeArgs) {
  const { ventureId, amount, dryRun } = args;

  // Fetch venture details
  const venture = await getVenture(ventureId);
  if (!venture) {
    throw new Error(`Venture not found: ${ventureId}`);
  }

  if (!venture.token_address) {
    throw new Error(`Venture ${venture.name} has no token address`);
  }

  if (!venture.root_workstream_id) {
    throw new Error(`Venture ${venture.name} has no root workstream ID`);
  }

  console.log(`Distributing ${amount} ${venture.token_symbol || 'tokens'} for venture: ${venture.name}`);
  console.log(`  Token: ${venture.token_address}`);
  console.log(`  Workstream: ${venture.root_workstream_id}`);
  console.log(`  Dry run: ${dryRun}`);

  // Get delivery counts by worker
  const deliveries = await getDeliveriesByWorker(venture.root_workstream_id);

  if (deliveries.length === 0) {
    console.log('No deliveries found. Nothing to distribute.');
    return;
  }

  const totalDeliveries = deliveries.reduce((sum, d) => sum + d.count, 0);
  const totalAmount = parseEther(amount);

  console.log(`\nFound ${totalDeliveries} deliveries across ${deliveries.length} workers:`);

  // Calculate proportional allocation
  const allocations = deliveries.map(({ workerAddress, count }) => {
    const share = (BigInt(count) * totalAmount) / BigInt(totalDeliveries);
    return {
      workerAddress,
      deliveries: count,
      percentage: ((count / totalDeliveries) * 100).toFixed(1),
      amount: share,
      amountFormatted: formatEther(share),
    };
  });

  // Print allocation table
  for (const alloc of allocations) {
    console.log(`  ${alloc.workerAddress}: ${alloc.deliveries} deliveries (${alloc.percentage}%) -> ${alloc.amountFormatted} tokens`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No tokens transferred.');
    return { allocations, totalDeliveries, dryRun: true };
  }

  // Execute transfers
  const rpcUrl = args.rpcUrl || process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const privateKey = process.env.TREASURY_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('TREASURY_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY env var required');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  console.log(`\nSending from: ${account.address}`);

  const results = [];
  for (const alloc of allocations) {
    if (alloc.amount === 0n) continue;

    console.log(`  Transferring ${alloc.amountFormatted} to ${alloc.workerAddress}...`);

    const hash = await walletClient.writeContract({
      address: venture.token_address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [alloc.workerAddress as `0x${string}`, alloc.amount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`    TX: ${hash} (status: ${receipt.status})`);
    results.push({ ...alloc, txHash: hash, status: receipt.status });
  }

  console.log('\nDistribution complete.');
  return { allocations: results, totalDeliveries, dryRun: false };
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(): DistributeArgs {
  const args = process.argv.slice(2);
  const result: Partial<DistributeArgs> = { dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--venture-id':
        result.ventureId = next;
        i++;
        break;
      case '--amount':
        result.amount = next;
        i++;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--rpc-url':
        result.rpcUrl = next;
        i++;
        break;
    }
  }

  if (!result.ventureId) {
    console.error('Error: --venture-id is required');
    printUsage();
    process.exit(1);
  }
  if (!result.amount) {
    console.error('Error: --amount is required');
    printUsage();
    process.exit(1);
  }

  return result as DistributeArgs;
}

function printUsage() {
  console.log(`
Usage: yarn tsx scripts/ventures/distribute-rewards.ts [options]

Required:
  --venture-id <uuid>    Venture ID to distribute rewards for
  --amount <tokens>      Total tokens to distribute this round

Optional:
  --dry-run              Calculate allocations without transferring
  --rpc-url <url>        Base RPC URL (default: BASE_RPC_URL env)

Environment:
  TREASURY_PRIVATE_KEY   Private key for the treasury wallet (or DEPLOYER_PRIVATE_KEY)
  BASE_RPC_URL           Default Base RPC endpoint

How it works:
  1. Queries Ponder for completed deliveries in the venture's workstream
  2. Groups deliveries by worker address
  3. Calculates proportional token allocation
  4. Transfers tokens from treasury to workers via ERC20 transfer

Example:
  # Preview allocation
  yarn tsx scripts/ventures/distribute-rewards.ts \\
    --venture-id "123..." \\
    --amount "10000" \\
    --dry-run

  # Execute distribution
  yarn tsx scripts/ventures/distribute-rewards.ts \\
    --venture-id "123..." \\
    --amount "10000"
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  try {
    const args = parseArgs();
    const result = await distributeRewards(args);
    console.log(JSON.stringify({ ok: true, data: result }, null, 2));
  } catch (err: any) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.endsWith('distribute-rewards.ts') || process.argv[1]?.endsWith('distribute-rewards.js');
if (isDirectRun) {
  main();
}
