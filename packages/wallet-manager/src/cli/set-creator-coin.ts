#!/usr/bin/env node

/**
 * CLI tool for securely setting the creator coin address in a wallet identity.
 * 
 * This tool allows operators to associate a Zora creator coin address with an
 * existing wallet identity. The creator coin address is used by the Zora
 * integration to identify which coin the agent should manage.
 * 
 * ## Usage
 * 
 * ```bash
 * # From the root directory
 * yarn wallet:set-creator-coin --address 0x1234567890123456789012345678901234567890
 * 
 * # Or with explicit chain and owner
 * yarn wallet:set-creator-coin --address 0x1234... --chain-id 8453 --owner 0xabcd...
 * ```
 * 
 * ## Security
 * 
 * - Validates address format and checksum
 * - Requires confirmation before modifying wallet identity
 * - Creates backup of existing identity file
 * - Uses atomic file operations to prevent corruption
 * 
 * @since 3.0.0
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync, renameSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { isAddress, getAddress } from 'viem';
import { createInterface } from 'readline';
import type { WalletIdentity } from '../types.js';

interface CliArgs {
  address: string;
  chainId?: number;
  owner?: string;
  storageBasePath?: string;
  help?: boolean;
  dryRun?: boolean;
}

function printUsage(): void {
  console.log(`
Usage: yarn wallet:set-creator-coin --address <CREATOR_COIN_ADDRESS> [options]

Options:
  --address <address>       The creator coin address to set (required)
  --chain-id <number>       Chain ID (default: auto-detect from existing wallets)
  --owner <address>         Owner address (default: auto-detect from existing wallets)
  --storage-base-path <path> Custom storage path (default: ~/.jinn/wallets)
  --dry-run                 Show what would be changed without modifying files
  --help                    Show this help message

Examples:
  yarn wallet:set-creator-coin --address 0x1234567890123456789012345678901234567890
  yarn wallet:set-creator-coin --address 0x1234... --chain-id 8453 --owner 0xabcd...
  yarn wallet:set-creator-coin --address 0x1234... --dry-run
`);
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const parsed: CliArgs = { address: '' };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--address':
        if (!nextArg) throw new Error('--address requires a value');
        parsed.address = nextArg;
        i++;
        break;
      case '--chain-id':
        if (!nextArg) throw new Error('--chain-id requires a value');
        parsed.chainId = parseInt(nextArg, 10);
        if (isNaN(parsed.chainId)) throw new Error('--chain-id must be a number');
        i++;
        break;
      case '--owner':
        if (!nextArg) throw new Error('--owner requires a value');
        parsed.owner = nextArg;
        i++;
        break;
      case '--storage-base-path':
        if (!nextArg) throw new Error('--storage-base-path requires a value');
        parsed.storageBasePath = nextArg;
        i++;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--help':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function getStorageBasePath(customPath?: string): string {
  if (customPath) {
    return customPath.startsWith('~') 
      ? resolve(homedir(), customPath.slice(1))
      : resolve(customPath);
  }
  return resolve(homedir(), '.jinn', 'wallets');
}

function findWalletIdentities(basePath: string): Array<{ path: string; identity: WalletIdentity }> {
  const identities: Array<{ path: string; identity: WalletIdentity }> = [];
  
  if (!existsSync(basePath)) {
    return identities;
  }

  // Look for chain directories
  const chainDirs = readdirSync(basePath).filter((name: string) => {
    const chainPath = resolve(basePath, name);
    return statSync(chainPath).isDirectory() && /^\d+$/.test(name);
  });

  for (const chainDir of chainDirs) {
    const chainPath = resolve(basePath, chainDir);
    const identityFiles = readdirSync(chainPath).filter((name: string) => name.endsWith('.json'));
    
    for (const identityFile of identityFiles) {
      const identityPath = resolve(chainPath, identityFile);
      try {
        const identityData = JSON.parse(readFileSync(identityPath, 'utf8'));
        identities.push({ path: identityPath, identity: identityData });
      } catch (error) {
        console.warn(`Warning: Could not parse identity file ${identityPath}: ${error}`);
      }
    }
  }

  return identities;
}

function getIdentityFilePath(basePath: string, chainId: number, ownerAddress: string): string {
  return resolve(basePath, chainId.toString(), `${ownerAddress}.json`);
}

function validateAddress(address: string): string {
  if (!isAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
  return getAddress(address); // Returns checksummed address
}

function confirmAction(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(message + ' (y/N): ', (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function main(): Promise<void> {
  try {
    const args = parseArgs();

    if (args.help) {
      printUsage();
      process.exit(0);
    }

    if (!args.address) {
      console.error('Error: --address is required');
      printUsage();
      process.exit(1);
    }

    // Validate and normalize the creator coin address
    const creatorCoinAddress = validateAddress(args.address) as `0x${string}`;
    
    const basePath = getStorageBasePath(args.storageBasePath);
    const identities = findWalletIdentities(basePath);

    if (identities.length === 0) {
      console.error('Error: No wallet identities found. Please bootstrap a wallet first.');
      process.exit(1);
    }

    // Auto-detect or validate chain ID and owner
    let targetIdentity: { path: string; identity: WalletIdentity } | undefined;

    if (args.chainId && args.owner) {
      const ownerAddress = validateAddress(args.owner) as `0x${string}`;
      const identityPath = getIdentityFilePath(basePath, args.chainId, ownerAddress);
      
      if (!existsSync(identityPath)) {
        console.error(`Error: No wallet identity found for chain ${args.chainId} and owner ${ownerAddress}`);
        process.exit(1);
      }
      
      const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
      targetIdentity = { path: identityPath, identity };
    } else if (identities.length === 1) {
      targetIdentity = identities[0];
    } else {
      console.log('Multiple wallet identities found:');
      identities.forEach((item, index) => {
        console.log(`${index + 1}. Chain ${item.identity.chainId}, Owner ${item.identity.ownerAddress}, Safe ${item.identity.safeAddress}`);
      });
      
      if (!args.chainId || !args.owner) {
        console.error('Error: Multiple identities found. Please specify --chain-id and --owner');
        process.exit(1);
      }
    }

    if (!targetIdentity) {
      console.error('Error: Could not determine target wallet identity');
      process.exit(1);
    }

    // Show what will be changed
    console.log('\nTarget wallet identity:');
    console.log(`  Chain ID: ${targetIdentity.identity.chainId}`);
    console.log(`  Owner: ${targetIdentity.identity.ownerAddress}`);
    console.log(`  Safe Address: ${targetIdentity.identity.safeAddress}`);
    console.log(`  Current Creator Coin: ${targetIdentity.identity.creator_coin_address || 'Not set'}`);
    console.log(`  New Creator Coin: ${creatorCoinAddress}`);
    console.log(`  File Path: ${targetIdentity.path}`);

    if (args.dryRun) {
      console.log('\n✓ Dry run complete. No changes were made.');
      process.exit(0);
    }

    // Confirm the change
    const confirmed = await confirmAction('\nProceed with updating the creator coin address?');
    if (!confirmed) {
      console.log('Operation cancelled.');
      process.exit(0);
    }

    // Create backup
    const backupPath = targetIdentity.path + '.backup.' + Date.now();
    copyFileSync(targetIdentity.path, backupPath);
    console.log(`Backup created: ${backupPath}`);

    // Update the identity
    const updatedIdentity: WalletIdentity = {
      ...targetIdentity.identity,
      creator_coin_address: creatorCoinAddress
    };

    // Write atomically
    const tempPath = targetIdentity.path + '.tmp.' + Date.now();
    writeFileSync(tempPath, JSON.stringify(updatedIdentity, null, 2));
    
    // Atomic rename
    renameSync(tempPath, targetIdentity.path);

    console.log(`✓ Creator coin address updated successfully!`);
    console.log(`  New creator coin address: ${creatorCoinAddress}`);
    
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}
