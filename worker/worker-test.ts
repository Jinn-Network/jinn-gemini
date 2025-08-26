import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
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
 * Simulate wallet initialization for testing.
 */
async function initializeWallet(args: WorkerArgs): Promise<void> {
  if (args.dryRun) {
    logger.info('Jinn Worker starting in DRY RUN mode...');
    walletLogger.info('Configuration valid.');
    walletLogger.info(`EOA Owner: 0x742C65e68d8d2700ba29399dC13968F7bE4EeB6B`);
    walletLogger.info(`Predicted Safe Address: 0x9327aE88A8a45363E2E06b55279cD432Ff58fE65`);
    walletLogger.info(`On-chain status: not_deployed`);
    logger.info('');
    logger.info('[DRY RUN] ACTION: Deploy new 1-of-1 Gnosis Safe.');
    logger.info('[DRY RUN] ACTION: Persist identity to ~/.jinn/wallets/8453/0x8E0A63Ffa538EeF4D5e5b0FbE3EFC0CB92A66b4b.json');
    logger.info('');
    exitWithCode(0, 'Dry run complete. No on-chain or filesystem changes were made.');
  }

  // Simulate existing wallet
  walletLogger.info('Existing identity found. Verifying on-chain...');
  await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate async operation
  walletLogger.success('Identity verified.');
  walletLogger.info(`    - ${formatAddress('0x9327aE88A8a45363E2E06b55279cD432Ff58fE65', 'Safe Address')}`);
  walletLogger.info(`    - Chain ID:     ${config.CHAIN_ID}`);
  logger.info('Wallet bootstrap complete. Worker is now polling for jobs...');
}

/**
 * Simulate job processing.
 */
async function processJobs(args: WorkerArgs): Promise<void> {
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  workerLogger.info(`Worker ${workerId} starting up...`);
  
  if (args.singleJob) {
    workerLogger.info('Single job mode - would process one job then exit');
    exitWithCode(0, 'Single job processing not yet implemented');
  } else {
    workerLogger.info('Continuous mode - would poll for jobs indefinitely');
    // For testing, just run for a few seconds then exit
    await new Promise(resolve => setTimeout(resolve, 3000));
    exitWithCode(0, 'Test completed successfully');
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
    console.error('Error details:', error);
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
