/**
 * @fileoverview Shared logging utility using Pino for structured logging.
 *
 * This module provides a centralized logging configuration for the entire codebase.
 * It supports both development (pretty-printed) and production (JSON) output formats,
 * and includes specialized child loggers for different components.
 *
 * @module logging
 */

import pino from 'pino';
import { formatEther } from 'viem';

/**
 * Check if we're in development mode based on NODE_ENV.
 * @returns {boolean} True if NODE_ENV is not 'production'
 */
function isDevelopmentMode(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Get the log level from environment or default to 'info'.
 * Supports: trace, debug, info, warn, error, fatal
 */
function getLogLevel(): pino.Level {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels: pino.Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

  if (level && validLevels.includes(level as pino.Level)) {
    return level as pino.Level;
  }

  return 'info';
}

/**
 * Get the log format preference from environment.
 * Can override automatic development/production detection.
 *
 * - 'pretty': Human-readable colored output (uses pino-pretty)
 * - 'json': Structured JSON output (production default)
 *
 * If not set, defaults to 'pretty' in development, 'json' in production.
 */
function getLogFormat(): 'pretty' | 'json' {
  const format = process.env.LOG_FORMAT?.toLowerCase();

  if (format === 'pretty' || format === 'json') {
    return format;
  }

  // Default based on environment
  return isDevelopmentMode() ? 'pretty' : 'json';
}

/**
 * Create the main logger instance with appropriate formatting.
 *
 * Configuration via environment variables:
 * - NODE_ENV: 'production' for JSON logs, anything else for pretty logs
 * - LOG_LEVEL: trace, debug, info, warn, error, fatal (default: info)
 * - LOG_FORMAT: 'pretty' or 'json' (overrides NODE_ENV detection)
 */
function createLogger(): pino.Logger {
  const level = getLogLevel();
  const format = getLogFormat();

  if (format === 'pretty') {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          // Custom colors for specific log types
          customColors: 'info:blue,warn:yellow,error:red',
        }
      }
    });
  }

  // Production: structured JSON logging
  return pino({
    level,
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // In production, only include stack traces at debug level
    serializers: {
      error: (err: Error) => {
        if (level === 'debug' || level === 'trace') {
          return pino.stdSerializers.err(err);
        }
        // In production, exclude stack traces unless debug is enabled
        return {
          type: err.name,
          message: err.message,
        };
      },
    },
  });
}

/**
 * Base logger instance.
 * Use this directly or create child loggers with component metadata.
 */
export const logger = createLogger();

/**
 * Create a child logger with component metadata.
 *
 * Child loggers inherit the configuration from the base logger
 * and automatically add component tags to all log entries.
 *
 * @param component - Component identifier (e.g., 'WORKER', 'MCP_TOOL', 'HTTP_CLIENT')
 * @returns Pino child logger instance
 *
 * @example
 * ```typescript
 * const httpLogger = logger.child({ component: 'HTTP_CLIENT' });
 * httpLogger.info({ url, status }, 'HTTP request completed');
 * ```
 */
export function createChildLogger(component: string): pino.Logger {
  return logger.child({ component });
}

/**
 * Utility to serialize Error objects for structured logging.
 * Ensures consistent error representation across all loggers.
 *
 * @param err - Error object to serialize
 * @returns Serialized error object
 */
export function serializeError(err: Error | unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      type: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { message: String(err) };
}

// ============================================================================
// Pre-configured component loggers
// ============================================================================

/**
 * Create a child logger for wallet-specific operations.
 * Automatically adds the 'WALLET' component tag.
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
 * Automatically adds the 'WORKER' component tag.
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
 * Automatically adds the 'CONFIG' component tag.
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

// ============================================================================
// Logging utility functions
// ============================================================================

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
