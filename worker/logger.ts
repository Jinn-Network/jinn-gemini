import pino from 'pino';
import { formatEther } from 'viem';

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
 * Create a child logger for agent operations and AI output.
 * Uses a distinct color (magenta) to differentiate AI responses from system logs.
 */
const baseAgentLogger = logger.child({ component: 'AGENT' });
export const agentLogger = {
  debug: baseAgentLogger.debug.bind(baseAgentLogger),
  info: baseAgentLogger.info.bind(baseAgentLogger),
  warn: baseAgentLogger.warn.bind(baseAgentLogger),
  error: baseAgentLogger.error.bind(baseAgentLogger),
  fatal: baseAgentLogger.fatal.bind(baseAgentLogger),
  // Special method for agent output/responses - use direct console with color
  output: (message: string) => {
    // Use bright magenta for agent output with robot emoji
    console.log(`\x1b[95m${message}\x1b[0m`);
  },
  thinking: (message: string) => baseAgentLogger.debug({ agentThinking: true }, message),
};

/**
 * Create a child logger for job lifecycle events.
 * Automatically adds the 'JOB' component tag.
 */
const baseJobLogger = logger.child({ component: 'JOB' });
export const jobLogger = {
  debug: baseJobLogger.debug.bind(baseJobLogger),
  info: baseJobLogger.info.bind(baseJobLogger),
  warn: baseJobLogger.warn.bind(baseJobLogger),
  error: baseJobLogger.error.bind(baseJobLogger),
  fatal: baseJobLogger.fatal.bind(baseJobLogger),
  started: (jobId: string, model: string) => baseJobLogger.info({ jobId, model }, 'Job execution started'),
  completed: (jobId: string) => baseJobLogger.info({ jobId }, 'Job completed successfully'),
  failed: (jobId: string, reason: string) => baseJobLogger.error({ jobId, reason }, 'Job failed'),
  retry: (jobId: string, attempt: number, maxRetries: number) => 
    baseJobLogger.warn({ jobId, attempt, maxRetries }, `Job retry attempt ${attempt}/${maxRetries}`),
};

/**
 * Create a child logger for MCP/tool operations.
 * Automatically adds the 'MCP' component tag.
 */
const baseMcpLogger = logger.child({ component: 'MCP' });
export const mcpLogger = {
  debug: baseMcpLogger.debug.bind(baseMcpLogger),
  info: baseMcpLogger.info.bind(baseMcpLogger),
  warn: baseMcpLogger.warn.bind(baseMcpLogger),
  error: baseMcpLogger.error.bind(baseMcpLogger),
  fatal: baseMcpLogger.fatal.bind(baseMcpLogger),
  toolCall: (toolName: string, params?: any) => baseMcpLogger.debug({ toolName, params }, 'Tool call executed'),
  toolError: (toolName: string, error: string) => baseMcpLogger.error({ toolName, error }, 'Tool call failed'),
};

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
export function formatWeiToEth(wei: bigint): string {
  const eth = formatEther(wei);
  // Basic trim to remove unnecessary trailing zeros, but keep it simple.
  // E.g. 1.230000... -> 1.23
  if (eth.includes('.')) {
    return eth.replace(/\.?0+$/, '');
  }
  return eth;
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