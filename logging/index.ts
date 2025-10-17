/**
 * Shared logging module for the entire codebase.
 *
 * This module provides a centralized Pino logger with structured logging.
 * All runtime code should import from this module instead of using console.*.
 *
 * @module logging
 *
 * @example Basic usage
 * import { logger } from './logging/index.js';
 * logger.info({ requestId: '123' }, 'Processing request');
 *
 * @example Component logger
 * import { createChildLogger } from './logging/index.js';
 * const myLogger = createChildLogger('MY_COMPONENT');
 * myLogger.info({ userId: '456' }, 'User action');
 *
 * @example Error logging
 * import { serializeError } from './logging/index.js';
 * logger.error({ error: serializeError(err) }, 'Operation failed');
 */

import pino from 'pino';
import { formatEther } from 'viem';

/**
 * SECURITY: Never log these field names
 *
 * The following field names should NEVER be included in log metadata:
 * - privateKey, private_key, PRIVATE_KEY
 * - apiKey, api_key, API_KEY, API_SECRET
 * - password, PASSWORD, pwd
 * - mnemonic, seed, SEED
 * - token, TOKEN (auth tokens)
 * - secret, SECRET
 *
 * Always use serializeError() when logging Error objects to avoid
 * accidentally exposing secrets in error messages or stack traces.
 *
 * Stack traces are only logged at 'debug' level or below in production.
 */

/**
 * Determine if we're in development mode based on environment.
 * Development mode enables pretty-printing for human readability.
 */
function isDevelopmentMode(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Get the configured log level from environment.
 * Falls back to 'info' if not specified or invalid.
 *
 * Valid levels: trace, debug, info, warn, error, fatal
 */
function getLogLevel(): pino.Level {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

  if (level && validLevels.includes(level)) {
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
 * Configuration:
 * - Development: pino-pretty with colors and timestamps
 * - Production: Structured JSON logs
 *
 * Environment variables:
 * - LOG_LEVEL: trace | debug | info | warn | error | fatal (default: info)
 * - LOG_FORMAT: pretty | json (default: auto-detect)
 * - NODE_ENV: production disables pretty printing
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
 * @param metadata - Optional additional metadata to include in all logs
 *
 * @example
 * const httpLogger = createChildLogger('HTTP_CLIENT', { version: '1.0' });
 * httpLogger.info({ url, method: 'GET' }, 'HTTP request sent');
 * // Output: { component: 'HTTP_CLIENT', version: '1.0', url: '...', msg: 'HTTP request sent' }
 */
export function createChildLogger(
  component: string,
  metadata?: Record<string, unknown>
): pino.Logger {
  return logger.child({ component, ...metadata });
}

/**
 * Serialize an error object for safe logging.
 *
 * Handles various error types and formats:
 * - Standard Error objects
 * - String errors
 * - Objects with message property
 * - Unknown error types
 *
 * This helper ensures errors are safely converted to strings
 * without exposing sensitive information or causing serialization failures.
 *
 * @param e - Error to serialize (can be Error, string, or unknown type)
 * @returns Safe string representation of the error
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logger.error({ error: serializeError(error) }, 'Operation failed');
 * }
 */
export function serializeError(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    return String(e.message);
  }
  if (e instanceof Error) return e.toString();

  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Format an Ethereum address for consistent display in logs.
 *
 * @param address - Ethereum address (with or without 0x prefix)
 * @param label - Optional label to prefix the address
 * @returns Formatted address string
 *
 * @example
 * formatAddress('1234567890abcdef', 'Wallet')
 * // Returns: "Wallet: 0x1234567890abcdef"
 */
export function formatAddress(address: string, label?: string): string {
  const formatted = address.startsWith('0x') ? address : `0x${address}`;
  return label ? `${label}: ${formatted}` : formatted;
}

/**
 * Format wei amount to ETH for human-readable logs.
 * Removes unnecessary trailing zeros.
 *
 * @param wei - Amount in wei (bigint)
 * @returns Formatted ETH string
 *
 * @example
 * formatWeiToEth(1000000000000000000n)
 * // Returns: "1"
 *
 * formatWeiToEth(1230000000000000000n)
 * // Returns: "1.23"
 */
export function formatWeiToEth(wei: bigint): string {
  const eth = formatEther(wei);

  // Remove unnecessary trailing zeros
  if (eth.includes('.')) {
    return eth.replace(/\.?0+$/, '');
  }

  return eth;
}

/**
 * Format duration in milliseconds to human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * formatDuration(500)      // "500ms"
 * formatDuration(5000)     // "5.0s"
 * formatDuration(125000)   // "2.1m"
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
 *
 * Maps to the exit code taxonomy defined in the specification:
 * - 0: Success
 * - 1: General error
 * - 2: Configuration error
 * - 3: Funding required (informational)
 * - 4: On-chain conflict
 * - 5: RPC/Network error
 *
 * @param code - Exit code (0-5)
 * @param message - Exit message
 * @param error - Optional error object
 *
 * @example
 * exitWithCode(2, 'Missing required environment variable: RPC_URL');
 * // Logs fatal message and exits with code 2
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
      logger.fatal({ exitCode: code, error: error ? serializeError(error) : undefined }, message);
      break;
    case 2:
      logger.fatal({ exitCode: code, error: error ? serializeError(error) : undefined }, `Configuration Error: ${message}`);
      break;
    case 3:
      logger.warn({ exitCode: code }, `Funding Required: ${message}`);
      break;
    case 4:
      logger.fatal({ exitCode: code, error: error ? serializeError(error) : undefined }, `On-Chain Conflict: ${message}`);
      break;
    case 5:
      logger.fatal({ exitCode: code, error: error ? serializeError(error) : undefined }, `RPC/Network Error: ${message}`);
      break;
  }

  process.exit(code);
}

//
// Pre-configured component loggers for backward compatibility
// These maintain the existing API from worker/logger.ts
//

/**
 * Logger for wallet operations.
 * Automatically adds component: 'WALLET' to all log entries.
 */
const baseWalletLogger = logger.child({ component: 'WALLET' });
export const walletLogger = {
  debug: baseWalletLogger.debug.bind(baseWalletLogger),
  info: baseWalletLogger.info.bind(baseWalletLogger),
  warn: baseWalletLogger.warn.bind(baseWalletLogger),
  error: baseWalletLogger.error.bind(baseWalletLogger),
  fatal: baseWalletLogger.fatal.bind(baseWalletLogger),
  /** Alias for info - logs success message */
  success: (message: string) => baseWalletLogger.info(message),
};

/**
 * Logger for general worker operations.
 * Automatically adds component: 'WORKER' to all log entries.
 */
const baseWorkerLogger = logger.child({ component: 'WORKER' });
export const workerLogger = {
  debug: baseWorkerLogger.debug.bind(baseWorkerLogger),
  info: baseWorkerLogger.info.bind(baseWorkerLogger),
  warn: baseWorkerLogger.warn.bind(baseWorkerLogger),
  error: baseWorkerLogger.error.bind(baseWorkerLogger),
  fatal: baseWorkerLogger.fatal.bind(baseWorkerLogger),
  /** Alias for info - logs success message */
  success: (message: string) => baseWorkerLogger.info(message),
};

/**
 * Logger for configuration operations.
 * Automatically adds component: 'CONFIG' to all log entries.
 */
export const configLogger = logger.child({ component: 'CONFIG' });

/**
 * Logger for agent operations and AI output.
 * Automatically adds component: 'AGENT' to all log entries.
 *
 * Special methods:
 * - output(): For AI response output (formatted with 🤖 in dev mode)
 * - thinking(): For AI reasoning/thinking logs
 */
const baseAgentLogger = logger.child({ component: 'AGENT' });
export const agentLogger = {
  debug: baseAgentLogger.debug.bind(baseAgentLogger),
  info: baseAgentLogger.info.bind(baseAgentLogger),
  warn: baseAgentLogger.warn.bind(baseAgentLogger),
  error: baseAgentLogger.error.bind(baseAgentLogger),
  fatal: baseAgentLogger.fatal.bind(baseAgentLogger),

  /**
   * Log AI agent output/responses.
   * In development mode, displays with 🤖 emoji.
   * In production, logs as structured JSON with agentOutput: true.
   *
   * @param message - Agent output message
   */
  output: (message: string) => {
    baseAgentLogger.info({ agentOutput: true }, `🤖 ${message}`);
  },

  /**
   * Log AI agent thinking/reasoning.
   * In development mode, displays with 💭 emoji.
   * In production, logs as structured JSON with agentThinking: true.
   *
   * @param message - Agent thinking message
   */
  thinking: (message: string) => {
    baseAgentLogger.debug({ agentThinking: true }, `💭 ${message}`);
  },
};

/**
 * Logger for job lifecycle events.
 * Automatically adds component: 'JOB' to all log entries.
 *
 * Convenience methods for common job events.
 */
const baseJobLogger = logger.child({ component: 'JOB' });
export const jobLogger = {
  debug: baseJobLogger.debug.bind(baseJobLogger),
  info: baseJobLogger.info.bind(baseJobLogger),
  warn: baseJobLogger.warn.bind(baseJobLogger),
  error: baseJobLogger.error.bind(baseJobLogger),
  fatal: baseJobLogger.fatal.bind(baseJobLogger),

  /** Log job started event */
  started: (jobId: string, model: string) =>
    baseJobLogger.info({ jobId, model }, 'Job execution started'),

  /** Log job completed event */
  completed: (jobId: string) =>
    baseJobLogger.info({ jobId }, 'Job completed successfully'),

  /** Log job failed event */
  failed: (jobId: string, reason: string) =>
    baseJobLogger.error({ jobId, reason }, 'Job failed'),

  /** Log job retry event */
  retry: (jobId: string, attempt: number, maxRetries: number) =>
    baseJobLogger.warn({ jobId, attempt, maxRetries }, `Job retry attempt ${attempt}/${maxRetries}`),
};

/**
 * Logger for MCP/tool operations.
 * Automatically adds component: 'MCP' to all log entries.
 *
 * Convenience methods for common MCP events.
 */
const baseMcpLogger = logger.child({ component: 'MCP' });
export const mcpLogger = {
  debug: baseMcpLogger.debug.bind(baseMcpLogger),
  info: baseMcpLogger.info.bind(baseMcpLogger),
  warn: baseMcpLogger.warn.bind(baseMcpLogger),
  error: baseMcpLogger.error.bind(baseMcpLogger),
  fatal: baseMcpLogger.fatal.bind(baseMcpLogger),

  /** Log MCP tool call */
  toolCall: (toolName: string, params?: any) =>
    baseMcpLogger.debug({ toolName, params }, 'Tool call executed'),

  /** Log MCP tool error */
  toolError: (toolName: string, error: string) =>
    baseMcpLogger.error({ toolName, error }, 'Tool call failed'),
};
