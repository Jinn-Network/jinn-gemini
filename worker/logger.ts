import pino from 'pino';

/**
 * Create the main logger instance with appropriate formatting for the worker.
 * In development, uses pino-pretty for human-readable output.
 * In production, outputs structured JSON logs.
 */
function createLogger() {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  if (isDevelopment) {
    return pino({
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          messageFormat: '[{component}] {msg}',
        }
      }
    });
  }
  
  // Production: structured JSON logging
  return pino({
    level: 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger();

/**
 * Create a child logger for wallet-specific operations.
 * Automatically adds the 'wallet' component tag.
 */
const baseWalletLogger = logger.child({ component: 'WALLET' });
export const walletLogger = {
  debug: baseWalletLogger.debug.bind(baseWalletLogger),
  info: baseWalletLogger.info.bind(baseWalletLogger),
  warn: baseWalletLogger.warn.bind(baseWalletLogger),
  error: baseWalletLogger.error.bind(baseWalletLogger),
  fatal: baseWalletLogger.fatal.bind(baseWalletLogger),
  success: (message: string) => baseWalletLogger.info(message),
};

/**
 * Create a child logger for general worker operations.
 * Automatically adds the 'worker' component tag.
 */
const baseWorkerLogger = logger.child({ component: 'WORKER' });
export const workerLogger = {
  debug: baseWorkerLogger.debug.bind(baseWorkerLogger),
  info: baseWorkerLogger.info.bind(baseWorkerLogger),
  warn: baseWorkerLogger.warn.bind(baseWorkerLogger),
  error: baseWorkerLogger.error.bind(baseWorkerLogger),
  fatal: baseWorkerLogger.fatal.bind(baseWorkerLogger),
  success: (message: string) => baseWorkerLogger.info(message),
};

/**
 * Create a child logger for configuration operations.
 * Automatically adds the 'config' component tag.
 */
export const configLogger = logger.child({ component: 'CONFIG' });

/**
 * Utility function to format addresses consistently in logs.
 */
export function formatAddress(address: string, label?: string): string {
  const formatted = address.startsWith('0x') ? address : `0x${address}`;
  return label ? `${label}: ${formatted}` : formatted;
}

/**
 * Utility function to format wei amounts to ETH for logging.
 */
export function formatWeiToEth(wei: bigint, decimals: number = 5): string {
  const eth = Number(wei) / 1e18;
  return `${eth.toFixed(decimals)} ETH`;
}

/**
 * Utility function to format duration for logging.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  return `${minutes.toFixed(1)}m`;
}

/**
 * Exit the process with appropriate logging and exit code.
 * Maps to the exit code taxonomy defined in the specification.
 */
export function exitWithCode(
  code: 0 | 1 | 2 | 3 | 4 | 5,
  message: string,
  error?: Error
): never {
  switch (code) {
    case 0:
      logger.info({ exitCode: code }, message);
      break;
    case 1:
      logger.fatal({ exitCode: code, error }, message);
      break;
    case 2:
      configLogger.fatal({ exitCode: code, error }, `Configuration Error: ${message}`);
      break;
    case 3:
      walletLogger.warn({ exitCode: code }, `Funding Required: ${message}`);
      break;
    case 4:
      walletLogger.fatal({ exitCode: code, error }, `On-Chain Conflict: ${message}`);
      break;
    case 5:
      logger.fatal({ exitCode: code, error }, `RPC/Network Error: ${message}`);
      break;
  }
  
  process.exit(code);
}