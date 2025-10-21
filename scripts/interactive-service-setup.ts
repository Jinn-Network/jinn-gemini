#!/usr/bin/env tsx
/**
 * Interactive Service Setup CLI - JINN-202 Simplified Version
 *
 * User-friendly command-line wizard for setting up an OLAS service.
 * Uses middleware's native attended mode with interactive prompts.
 *
 * Usage:
 *   yarn setup:service                    # Mainnet deployment (uses .env)
 *   yarn setup:service --testnet          # Testnet deployment (uses .env.test)
 *   yarn setup:service --chain=base       # Specify chain
 *   yarn setup:service --no-mech          # Deploy without mech contract
 */

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { SimplifiedServiceBootstrap, SimplifiedBootstrapConfig } from '../worker/SimplifiedServiceBootstrap.js';
import { logger } from '../logging/index.js';

const setupLogger = logger.child({ component: "SETUP-CLI" });

// Parse args early to determine environment
const earlyArgs = process.argv.slice(2);
const isTestnet = earlyArgs.includes('--testnet');

// Load appropriate env file based on --testnet flag
if (isTestnet) {
  const testEnvPath = resolve(process.cwd(), '.env.test');
  if (existsSync(testEnvPath)) {
    dotenvConfig({ path: testEnvPath, override: true });
    setupLogger.info('Loaded .env.test for testnet deployment');
  } else {
    console.error('\n❌ Error: .env.test not found');
    console.error('Create .env.test with testnet/Tenderly VNet configuration\n');
    process.exit(1);
  }
}
// Otherwise, .env is already loaded by 'dotenv/config' at line 14

interface CLIArgs {
  chain?: 'base' | 'gnosis' | 'mode' | 'optimism';
  testnet?: boolean;
  noMech?: boolean;
  noStaking?: boolean;
  stakingContract?: string;
  help?: boolean;
}

function parseArgs(): CLIArgs {
  const args: CLIArgs = {};

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--chain=')) {
      args.chain = arg.split('=')[1] as any;
    } else if (arg === '--testnet') {
      args.testnet = true;
    } else if (arg === '--no-mech') {
      args.noMech = true;
    } else if (arg === '--no-staking') {
      args.noStaking = true;
    } else if (arg.startsWith('--staking-contract=')) {
      args.stakingContract = arg.split('=')[1];
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│           OLAS Service Interactive Setup Wizard (JINN-202)                  │
└─────────────────────────────────────────────────────────────────────────────┘

This wizard uses the middleware's native attended mode to guide you through
setting up an OLAS service with interactive funding prompts.

USAGE:
  yarn setup:service [OPTIONS]

OPTIONS:
  --testnet           Use .env.test for testnet/Tenderly VNet deployment
                      Default: use .env for mainnet deployment

  --chain=NETWORK     Network to deploy on (base, gnosis, mode, optimism)
                      Default: base

  --no-mech           Disable mech deployment (mech enabled by default, JINN-186)
  --no-staking        Disable staking (staking enabled by default, JINN-204)
  --staking-contract  Custom staking contract address (default: AgentsFun1)
  --help, -h          Show this help message

ENVIRONMENT FILES:
  .env                Production/mainnet configuration (default)
  .env.test           Testnet/Tenderly VNet configuration (use with --testnet)

REQUIRED ENVIRONMENT VARIABLES:
  OPERATE_PASSWORD    Password for wallet encryption
  RPC_URL             RPC URL for the target network

EXAMPLES:
  # Deploy on mainnet using .env
  yarn setup:service --chain=base

  # Deploy on testnet using .env.test (Tenderly VNet)
  yarn setup:service --testnet --chain=base

  # Deploy without mech
  yarn setup:service --chain=base --no-mech

  # Deploy on Gnosis network
  yarn setup:service --chain=gnosis

WHAT HAPPENS:
  The middleware will:
  1. Detect or create Master EOA (wallet)
  2. Detect or create Master Safe
  3. Create Agent Key and prompt you to fund it (~0.001 ETH)
  4. Deploy Service Safe and prompt you to fund it (~0.001 ETH + 100 OLAS)
  5. Stake the service in the staking contract (50 OLAS bond + 50 OLAS stake)
  6. Deploy mech contract (by default)

FUNDING PROMPTS:
  • The middleware shows exact addresses and amounts needed
  • Displays real-time waiting indicator while polling for funds
  • Auto-continues when funding is detected (no manual "continue" needed)
  • Total time: 5-10 minutes depending on transfer confirmation speed

INTERRUPTION:
  • You can Ctrl+C at any time
  • Partial state is automatically cleaned on next run
  • Safe to retry from the beginning

`);
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate environment
  const operatePassword = process.env.OPERATE_PASSWORD;
  if (!operatePassword) {
    console.error(`\n❌ Error: OPERATE_PASSWORD environment variable is required\n`);
    console.error(`Set it in your .env or .env.test file or export it:\n`);
    console.error(`  export OPERATE_PASSWORD="your-password"\n`);
    process.exit(1);
  }

  // Determine chain and RPC URL
  const chain = args.chain || 'base';
  const rpcUrl = process.env.RPC_URL || '';

  if (!rpcUrl) {
    console.error(`\n❌ Error: RPC_URL environment variable is required\n`);
    console.error(`Set it in your ${args.testnet ? '.env.test' : '.env'} file or export it:\n`);
    console.error(`  export RPC_URL="https://your-rpc-url"\n`);
    process.exit(1);
  }

  // Mech marketplace addresses (Base mainnet is the primary target)
  const mechMarketplaceAddresses: Record<string, string> = {
    base: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020',
    gnosis: '0x0000000000000000000000000000000000000000', // TODO: Add when available
    mode: '0x0000000000000000000000000000000000000000',   // TODO: Add when available
    optimism: '0x0000000000000000000000000000000000000000', // TODO: Add when available
  };

  // JINN-204: Support staking configuration (enabled by default)
  const disableStaking = args.noStaking === true;
  const stakingContract = args.stakingContract as string | undefined;

  // JINN-207: Set mech request price to 0.000005 ETH (5000000000000 wei) for cost-effective marketplace requests
  const mechRequestPrice = '5000000000000'; // 0.000005 ETH in wei
  
  const config: SimplifiedBootstrapConfig = {
    chain: chain as any,
    operatePassword,
    rpcUrl,
    // JINN-186: Mech deployment enabled by default for full integration (use --no-mech to disable)
    deployMech: !args.noMech,
    mechMarketplaceAddress: mechMarketplaceAddresses[chain],
    mechRequestPrice: mechRequestPrice,
    // JINN-204: Staking enabled by default (use --no-staking to disable)
    stakingProgram: disableStaking ? 'no_staking' : 'custom_staking',
    customStakingAddress: stakingContract || '0x2585e63df7BD9De8e058884D496658a030b5c6ce' // AgentsFun1
  };

  // Show mode banner
  if (args.testnet) {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              🧪 TESTNET DEPLOYMENT MODE                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('⚡ Using Tenderly Virtual TestNet');
    console.log('💰 Simulated funds (no real funds needed)');
    console.log('🔍 Instant transactions');
    console.log('📊 Full visibility in Tenderly Dashboard');
    console.log('');
  } else {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              🌐 MAINNET DEPLOYMENT MODE                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`🌍 Network: ${chain.toUpperCase()}`);
    console.log(`💰 Real funds will be used`);
    console.log(`🔒 Staking: ${disableStaking ? 'DISABLED' : 'ENABLED (AgentsFun1)'}`);
    if (!disableStaking) {
      console.log(`   Contract: ${stakingContract || '0x2585e63df7BD9De8e058884D496658a030b5c6ce'}`);
      console.log(`   Required: ~100 OLAS (50 OLAS bond + 50 OLAS stake)`);
    }
    console.log(`🤖 Mech deployment: ${config.deployMech ? 'ENABLED' : 'DISABLED'}`);
    if (config.deployMech) {
      console.log(`   Request Price: ${mechRequestPrice} wei (0.000005 ETH)`);
      console.log(`   Marketplace: ${config.mechMarketplaceAddress}`);
    }
    console.log('');
  }

  setupLogger.info({
    chain,
    withMech: config.deployMech,
    mode: args.testnet ? 'testnet' : 'mainnet',
    rpcUrl: rpcUrl.substring(0, 30) + '...',
  }, 'Starting simplified interactive service setup (JINN-202)');

  const bootstrap = new SimplifiedServiceBootstrap(config);
  
  try {
    const result = await bootstrap.bootstrap();

    if (result.success) {
      console.log('\n' + '='.repeat(80));
      console.log('  ✅ SETUP COMPLETED SUCCESSFULLY');
      console.log('='.repeat(80));
      console.log('');
      
      if (result.serviceConfigId) {
        console.log(`📋 Service Config ID: ${result.serviceConfigId}`);
      }
      if (result.serviceSafeAddress) {
        console.log(`🔐 Service Safe: ${result.serviceSafeAddress}`);
      }
      console.log('');
      
      // Save result to file for reference
      const resultPath = `/tmp/jinn-service-setup-${Date.now()}.json`;
      const fs = await import('fs/promises');
      await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
      console.log(`📝 Setup details saved to: ${resultPath}`);
      console.log('');
      
      process.exit(0);
    } else {
      console.error(`\n❌ Setup failed: ${result.error}\n`);
      process.exit(1);
    }
  } finally {
    // Cleanup resources
    await bootstrap.cleanup();
  }
}

main().catch((error) => {
  console.error(`\n❌ Fatal error:`, error);
  setupLogger.error({ error }, 'Fatal error in setup CLI');
  process.exit(1);
});

