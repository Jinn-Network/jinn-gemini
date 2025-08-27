import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { WalletManager } from '@jinn/wallet-manager';
import type { WalletManagerConfig, BootstrapResult } from '@jinn/wallet-manager';
import { config } from './config.js';
import { logger, walletLogger, workerLogger, exitWithCode, formatAddress, formatWeiToEth } from './logger.js';

interface WorkerArgs {
  dryRun: boolean;
  nonInteractive: boolean;
  debug: boolean;
  singleJob: boolean;
  jobId?: string;
}

/**
 * Parse command line arguments using yargs.
 */
async function parseArguments(): Promise<WorkerArgs> {
  const argv = await yargs(hideBin(process.argv))
    .option('dry-run', {
      alias: 'd',
      type: 'boolean',
      description: 'Run all pre-flight checks without executing transactions.',
      default: false,
    })
    .option('non-interactive', {
      type: 'boolean',
      description: 'Exit if funding is required instead of polling.',
      default: false,
    })
    .option('debug', {
      type: 'boolean',
      description: 'Run in debug mode with verbose output.',
      default: false,
    })
    .option('single-job', {
      type: 'boolean',
      description: 'Process only one job then exit.',
      default: false,
    })
    .option('job-id', {
      alias: 'j',
      type: 'string',
      description: 'Target a specific job ID for processing.',
    })
    .help()
    .parse();

  return {
    dryRun: argv.dryRun,
    nonInteractive: argv.nonInteractive,
    debug: argv.debug,
    singleJob: argv.singleJob || Boolean(argv.jobId),
    jobId: argv.jobId,
  };
}

/**
 * Initialize and bootstrap the wallet manager.
 * Handles all possible bootstrap outcomes according to the specification.
 */
async function initializeWallet(args: WorkerArgs): Promise<void> {
  // Use TEST_RPC_URL in test environments if provided, otherwise use RPC_URL
  const rpcUrl = process.env.NODE_ENV === 'test' && config.TEST_RPC_URL 
    ? config.TEST_RPC_URL 
    : config.RPC_URL;

  const walletManagerConfig: WalletManagerConfig = {
    workerPrivateKey: config.WORKER_PRIVATE_KEY as `0x${string}`,
    chainId: config.CHAIN_ID,
    rpcUrl: rpcUrl,
    options: {
      storageBasePath: config.JINN_WALLET_STORAGE_PATH,
      // Disable STS checks if explicitly configured or in test environments
      disableTxServiceChecks: config.DISABLE_STS_CHECKS || process.env.NODE_ENV === 'test',
    },
  };

  const walletManager = new WalletManager(walletManagerConfig);

  // First, check if we already have a valid local identity
  const existingIdentity = await walletManager.getExistingIdentity();
  if (existingIdentity) {
    walletLogger.info('Local identity found. Verifying on-chain state...');
    walletLogger.info(`    - Safe Address: ${existingIdentity.safeAddress}`);
    walletLogger.info(`    - Chain ID:     ${existingIdentity.chainId}`);
    
    // Verify the existing identity is still valid on-chain
    const verificationResult = await walletManager.verifyExistingIdentity(existingIdentity);
    if (verificationResult.isValid) {
      walletLogger.info('Identity verified.');
      logger.info('Wallet bootstrap complete. Worker is now polling for jobs...');
      
      // In test environments, exit after successful bootstrap
      if (process.env.NODE_ENV === 'test') {
        logger.info('Test environment detected - exiting after bootstrap completion');
        exitWithCode(0, 'Bootstrap complete in test mode');
      }
      return;
    } else {
      walletLogger.warn('Local identity file points to an invalid on-chain Safe. Re-evaluating state to determine next steps.');
    }
  } else {
    walletLogger.info('No local identity found. Beginning bootstrap process...');
  }

  // If dry run, just run the dry run and exit
  if (args.dryRun) {
    const result = await walletManager.bootstrap({ dryRun: true });
    handleDryRunResult(result);
    return;
  }

  // Attempt wallet bootstrap
  let result = await walletManager.bootstrap();

  // Handle needs_funding with polling loop
  if (result.status === 'needs_funding') {
    if (args.nonInteractive) {
      walletLogger.warn('EOA requires funding but --non-interactive flag is set');
      exitWithCode(3, 'Funding required but running in non-interactive mode');
    }

    result = await handleFundingRequirements(result, walletManager);
  }

  // Handle final result
  switch (result.status) {
    case 'exists':
      walletLogger.success('Identity verified.');
      walletLogger.info(`    - ${formatAddress(result.identity.safeAddress, 'Safe Address')}`);
      walletLogger.info(`    - Chain ID:     ${result.identity.chainId}`);
      break;

    case 'created':
      walletLogger.success('Safe deployed successfully!');
      walletLogger.info(`    - ${formatAddress(result.identity.ownerAddress, 'Owner Address')}`);
      walletLogger.info(`    - ${formatAddress(result.identity.safeAddress, 'Safe Address')}`);
      walletLogger.info(`    - Chain ID:      ${result.identity.chainId}`);
      if (result.metrics.txHash) {
        walletLogger.info(`    - Transaction Hash: ${result.metrics.txHash}`);
      }
      walletLogger.info(`Identity saved to ~/.jinn/wallets/${result.identity.chainId}/${result.identity.ownerAddress}.json`);
      break;

    case 'failed':
      handleBootstrapFailure(result);
      break;

    default:
      walletLogger.error(`Unexpected bootstrap result status: ${(result as any).status}`);
      exitWithCode(1, 'Unexpected bootstrap result');
  }

  logger.info('Wallet bootstrap complete. Worker is now polling for jobs...');
  
  // In test environments, exit after successful bootstrap
  if (process.env.NODE_ENV === 'test') {
    logger.info('Test environment detected - exiting after bootstrap completion');
    exitWithCode(0, 'Bootstrap complete in test mode');
  }
}

/**
 * Handle dry run results and exit.
 */
function handleDryRunResult(result: BootstrapResult): never {
  if (result.status !== 'dry_run') {
    logger.error('Expected dry_run result but got: ' + result.status);
    exitWithCode(1, 'Invalid dry run result');
  }

  logger.info('Jinn Worker starting in DRY RUN mode...');
  walletLogger.info('Configuration valid.');
  walletLogger.info(`EOA Owner: ${result.report.ownerAddress}`);
  walletLogger.info(`Predicted Safe Address: ${result.report.predictedSafeAddress}`);
  walletLogger.info(`On-chain status: ${result.report.onChainState}`);
  logger.info('');

  result.report.actions.forEach(action => {
    logger.info(`[DRY RUN] ACTION: ${action.details}`);
  });

  logger.info('');
  exitWithCode(0, 'Dry run complete. No on-chain or filesystem changes were made.');
}

/**
 * Handle funding requirements with polling loop.
 */
async function handleFundingRequirements(
  result: BootstrapResult,
  walletManager: WalletManager
): Promise<BootstrapResult> {
  if (result.status !== 'needs_funding') {
    return result;
  }

  walletLogger.warn('The owner EOA is not sufficiently funded to deploy a Safe.');
  logger.info('');
  logger.info('    Action Required: Please fund the following address.');
  logger.info('');
  logger.info(`    - ${formatAddress(result.address, 'Address')}`);
  logger.info(`    - Chain ID:   ${walletManager.getChainId()}`);
  logger.info(`    - Required:   ${formatWeiToEth(result.required.minRecommendedWei)} (${result.required.minRecommendedWei} wei)`);
  logger.info('');
  walletLogger.info('Waiting for funds. Checking balance every 10 seconds... (Press Ctrl+C to exit)');

  // Polling loop
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
    
    const checkResult = await walletManager.bootstrap();
    
    if (checkResult.status === 'needs_funding') {
      const currentBalance = await walletManager.getOwnerBalance();
      walletLogger.info(`Balance: ${formatWeiToEth(currentBalance)}. Still waiting...`);
      continue;
    }
    
    if (checkResult.status === 'created' || checkResult.status === 'exists') {
      walletLogger.success('Funds detected! Resuming bootstrap process...');
      return checkResult;
    }
    
    // If we get a failed status, exit the polling loop
    if (checkResult.status === 'failed') {
      return checkResult;
    }
  }
}

/**
 * Handle bootstrap failures with appropriate exit codes.
 */
function handleBootstrapFailure(result: BootstrapResult): never {
  if (result.status !== 'failed') {
    exitWithCode(1, 'Invalid failed result');
  }

  switch (result.code) {
    case 'invalid_config':
      exitWithCode(2, result.error);
      break;
    case 'chain_id_mismatch':
      exitWithCode(2, result.error);
      break;
    case 'safe_config_mismatch':
      exitWithCode(4, result.error);
      break;
    case 'rpc_error':
      exitWithCode(5, result.error);
      break;
    case 'unfunded':
      // This should have been caught in the needs_funding case
      exitWithCode(3, result.error);
      break;
    default:
      exitWithCode(1, result.error);
  }
}

/**
 * Legacy job processing stub (to be implemented later).
 */
async function processJobs(args: WorkerArgs): Promise<void> {
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  workerLogger.info(`Worker ${workerId} starting up...`);
  
  if (args.singleJob) {
    workerLogger.info('Single job mode - would process one job then exit');
    exitWithCode(0, 'Single job processing not yet implemented');
  } else {
    workerLogger.info('Continuous mode - would poll for jobs indefinitely');
    // For now, just keep the process alive for testing
    setInterval(() => {
      workerLogger.debug('Would poll for jobs...');
    }, 30000);
  }
}

/**
 * Main entry point for the Jinn worker.
 */
async function main() {
  try {
    const args = await parseArguments();
    
    // Set log level based on debug flag
    if (args.debug) {
      logger.level = 'debug';
      workerLogger.debug('Debug mode enabled');
    }

    logger.info(`Jinn Worker starting...${args.dryRun ? ' in DRY RUN mode' : ''}`);

    // Pre-flight checks are handled by config loading (will exit if invalid)
    
    // Initialize wallet (includes bootstrap)
    await initializeWallet(args);
    
    // If we get here and it's not a dry run, start job processing
    if (!args.dryRun) {
      await processJobs(args);
    }

  } catch (error) {
    logger.fatal({ error }, 'Worker encountered a fatal error');
    exitWithCode(1, 'Fatal error in worker main');
  }
}

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled promise rejection');
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  exitWithCode(0, 'Worker shutdown by user request');
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  exitWithCode(0, 'Worker shutdown by system request');
});

main();
