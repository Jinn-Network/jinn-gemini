#!/usr/bin/env tsx
/**
 * Interactive Service Setup CLI - JINN-202 Simplified Version
 * 
 * User-friendly command-line wizard for setting up an OLAS service.
 * Uses middleware's native attended mode with interactive prompts.
 * 
 * Usage:
 *   yarn setup:service              # Interactive wizard (default)
 *   yarn setup:service --chain=base # Specify chain
 *   yarn setup:service --with-mech  # Deploy with mech contract
 */

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { SimplifiedServiceBootstrap, SimplifiedBootstrapConfig } from '../worker/SimplifiedServiceBootstrap.js';
import { logger } from '../worker/logger.js';

// Load mainnet env if TENDERLY_ENABLED is false
if (process.env.TENDERLY_ENABLED !== 'true') {
  const mainnetEnvPath = resolve(process.cwd(), '.env.mainnet');
  if (existsSync(mainnetEnvPath)) {
    dotenvConfig({ path: mainnetEnvPath, override: true });
    logger.info('Loaded .env.mainnet for mainnet deployment');
  }
}

const setupLogger = logger.child({ component: "SETUP-CLI" });

interface CLIArgs {
  chain?: 'base' | 'gnosis' | 'mode' | 'optimism';
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
  --chain=NETWORK     Network to deploy on (base, gnosis, mode, optimism)
                      Default: base

  --no-mech           Disable mech deployment (mech enabled by default, JINN-186)
  --no-staking        Disable staking (staking enabled by default, JINN-204)
  --staking-contract  Custom staking contract address (default: AgentsFun1)
  --help, -h          Show this help message

ENVIRONMENT VARIABLES:
  OPERATE_PASSWORD    Password for wallet encryption (required)
  BASE_LEDGER_RPC     RPC URL for Base network (required if using Base)
  GNOSIS_LEDGER_RPC   RPC URL for Gnosis network (required if using Gnosis)
  MODE_LEDGER_RPC     RPC URL for Mode network (required if using Mode)
  OPTIMISM_LEDGER_RPC RPC URL for Optimism network (required if using Optimism)

TENDERLY VIRTUAL TESTNET (Optional):
  TENDERLY_ENABLED=true     Switches from mainnet to Tenderly Virtual TestNet
  TENDERLY_RPC_URL          RPC URL for your Virtual TestNet
  
  See: yarn tsx scripts/setup-tenderly-vnet.ts

EXAMPLES:
  # Deploy service on Base mainnet (with staking + mech by default)
  yarn setup:service --chain=base

  # Deploy service without mech
  yarn setup:service --chain=base --no-mech

  # Deploy on Gnosis network
  yarn setup:service --chain=gnosis
  
  # Deploy on Tenderly Virtual TestNet (cost-free testing)
  TENDERLY_ENABLED=true yarn setup:service --chain=base

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

  // Check if Tenderly mode is enabled
  const isTenderly = process.env.TENDERLY_ENABLED === 'true';

  // Validate environment
  const operatePassword = process.env.OPERATE_PASSWORD;
  if (!operatePassword) {
    console.error(`\n❌ Error: OPERATE_PASSWORD environment variable is required\n`);
    console.error(`Set it in your .env file or export it:\n`);
    console.error(`  export OPERATE_PASSWORD="your-password"\n`);
    process.exit(1);
  }

  // Determine chain and RPC URL
  const chain = args.chain || 'base';
  let rpcUrl: string;

  if (isTenderly) {
    // Tenderly mode: use TENDERLY_RPC_URL
    rpcUrl = process.env.TENDERLY_RPC_URL || '';
    if (!rpcUrl) {
      console.error(`\n❌ Error: TENDERLY_RPC_URL required when TENDERLY_ENABLED=true\n`);
      console.error(`Run: yarn tsx scripts/setup-tenderly-vnet.ts\n`);
      process.exit(1);
    }
  } else {
    // Mainnet mode: use chain-specific RPC
    const rpcEnvVar = `${chain.toUpperCase()}_LEDGER_RPC`;
    rpcUrl = process.env[rpcEnvVar] || process.env.BASE_LEDGER_RPC || process.env.RPC_URL || '';

    if (!rpcUrl) {
      console.error(`\n❌ Error: ${rpcEnvVar} environment variable is required\n`);
      console.error(`Set it in your .env file or export it:\n`);
      console.error(`  export ${rpcEnvVar}="https://your-rpc-url"\n`);
      process.exit(1);
    }
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
  if (isTenderly) {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         🧪 TENDERLY VIRTUAL TESTNET MODE ENABLED          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('⚡ Using simulated Base mainnet fork');
    console.log('💰 Unlimited ETH (no real funds needed)');
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
    mode: isTenderly ? 'tenderly' : 'mainnet',
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

