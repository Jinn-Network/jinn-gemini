#!/usr/bin/env tsx
/**
 * Launch a venture token via Doppler on Base
 *
 * Deploys a multicurve auction token paired against OLAS on Base.
 * Updates the venture record in Supabase with token details.
 *
 * Usage:
 *   yarn tsx scripts/ventures/launch-token.ts \
 *     --venture-id "<uuid>" \
 *     --name "Growth Agency Token" \
 *     --symbol "GROWTH" \
 *     --safe-address "0x..."
 */

import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { DopplerSDK } from '@whetstone-research/doppler-sdk';
import { updateVenture } from './update.js';
import dotenv from 'dotenv';

dotenv.config();

// OLAS on Base
const OLAS_BASE_ADDRESS = '0x54330d28ca3357F294334BDC454a032e7f353416' as const;

// Default token supply: 1 billion
const TOTAL_SUPPLY = parseEther('1000000000');
const TOKENS_TO_SELL = parseEther('900000000'); // 90% for auction
const VESTING_AMOUNT = parseEther('100000000'); // 10% to Safe

interface LaunchTokenArgs {
  ventureId: string;
  name: string;
  symbol: string;
  safeAddress: string;
  tokenUri?: string;
  rpcUrl?: string;
}

async function launchToken(args: LaunchTokenArgs) {
  const { ventureId, name, symbol, safeAddress, tokenUri } = args;
  const rpcUrl = args.rpcUrl || process.env.BASE_RPC_URL || 'https://mainnet.base.org';

  // Wallet setup — requires DEPLOYER_PRIVATE_KEY in env
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY env var required');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });

  console.log(`Launching token ${symbol} for venture ${ventureId}...`);
  console.log(`  Name: ${name}`);
  console.log(`  Symbol: ${symbol}`);
  console.log(`  Safe: ${safeAddress}`);
  console.log(`  Numeraire: OLAS (${OLAS_BASE_ADDRESS})`);
  console.log(`  Total supply: 1B`);
  console.log(`  Auction: 900M (90%)`);
  console.log(`  Vesting: 100M (10%) -> Safe`);

  // Initialize Doppler SDK
  const sdk = new DopplerSDK({
    publicClient,
    walletClient,
  });

  // Build multicurve params
  const params = {
    token: {
      name,
      symbol,
      tokenURI: tokenUri || '',
    },
    sale: {
      initialSupply: TOTAL_SUPPLY,
      numTokensToSell: TOKENS_TO_SELL,
      numeraire: OLAS_BASE_ADDRESS,
    },
    vesting: {
      recipient: safeAddress as `0x${string}`,
      amount: VESTING_AMOUNT,
    },
    governance: {
      type: 'default' as const,
    },
    migration: {
      type: 'uniswapV4' as const,
    },
  };

  console.log('\nSubmitting multicurve creation...');

  // Deploy via Doppler factory
  const result = await sdk.factory.createMulticurve(params);

  console.log('\nToken launched successfully!');
  console.log(`  Token address: ${result.tokenAddress}`);
  console.log(`  Pool ID: ${result.poolId}`);
  console.log(`  Governance: ${result.governanceAddress}`);

  // Update venture record with token details
  console.log('\nUpdating venture record in Supabase...');

  await updateVenture({
    id: ventureId,
    tokenAddress: result.tokenAddress,
    tokenSymbol: symbol,
    tokenName: name,
    tokenLaunchPlatform: 'doppler',
    governanceAddress: result.governanceAddress,
    poolAddress: result.poolAddress,
    tokenMetadata: {
      poolId: result.poolId,
      safeAddress,
      totalSupply: '1000000000',
      tokensToSell: '900000000',
      vestingAmount: '100000000',
      numeraire: OLAS_BASE_ADDRESS,
      launchedAt: new Date().toISOString(),
    },
  });

  console.log('Venture record updated.');

  return {
    tokenAddress: result.tokenAddress,
    poolId: result.poolId,
    governanceAddress: result.governanceAddress,
    poolAddress: result.poolAddress,
  };
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(): LaunchTokenArgs {
  const args = process.argv.slice(2);
  const result: Partial<LaunchTokenArgs> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--venture-id':
        result.ventureId = next;
        i++;
        break;
      case '--name':
        result.name = next;
        i++;
        break;
      case '--symbol':
        result.symbol = next;
        i++;
        break;
      case '--safe-address':
        result.safeAddress = next;
        i++;
        break;
      case '--token-uri':
        result.tokenUri = next;
        i++;
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
  if (!result.name) {
    console.error('Error: --name is required');
    printUsage();
    process.exit(1);
  }
  if (!result.symbol) {
    console.error('Error: --symbol is required');
    printUsage();
    process.exit(1);
  }
  if (!result.safeAddress) {
    console.error('Error: --safe-address is required');
    printUsage();
    process.exit(1);
  }

  return result as LaunchTokenArgs;
}

function printUsage() {
  console.log(`
Usage: yarn tsx scripts/ventures/launch-token.ts [options]

Required:
  --venture-id <uuid>        Venture ID to associate the token with
  --name <name>              Token display name (e.g., "Growth Agency Token")
  --symbol <symbol>          Token symbol (e.g., "GROWTH")
  --safe-address <addr>      Gnosis Safe address for 10% vesting allocation

Optional:
  --token-uri <uri>          IPFS metadata URI for the token
  --rpc-url <url>            Base RPC URL (default: BASE_RPC_URL env or https://mainnet.base.org)

Environment:
  DEPLOYER_PRIVATE_KEY       Private key for the deployer wallet (required)
  BASE_RPC_URL               Default Base RPC endpoint

Token allocation:
  - 90% (900M) -> Doppler auction for price discovery
  - 10% (100M) -> Gnosis Safe (team treasury, via vesting)

Numeraire: OLAS on Base (${OLAS_BASE_ADDRESS})
Migration: Uniswap V4 (creates TOKEN/OLAS pool)

Example:
  yarn tsx scripts/ventures/launch-token.ts \\
    --venture-id "123e4567-e89b-12d3-a456-426614174000" \\
    --name "Growth Agency Token" \\
    --symbol "GROWTH" \\
    --safe-address "0x..."
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  try {
    const args = parseArgs();
    const result = await launchToken(args);
    console.log(JSON.stringify({ ok: true, data: result }, null, 2));
  } catch (err: any) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.endsWith('launch-token.ts') || process.argv[1]?.endsWith('launch-token.js');
if (isDirectRun) {
  main();
}
