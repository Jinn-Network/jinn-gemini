# Logging in Jinn

This document describes the structured logging system used throughout the Jinn codebase.

## Overview

Jinn uses a centralized Pino-based logging module (`/logging/index.ts`) that provides:

- **Structured JSON logging** for production
- **Pretty-formatted logs** for development
- **Component-specific loggers** with automatic tagging
- **Utility functions** for common formatting needs
- **Consistent error serialization**

## Quick Start

```typescript
import { workerLogger, mcpLogger, scriptLogger } from '../logging/index.js';

// Worker operations
workerLogger.info({ jobId: '123', status: 'processing' }, 'Job started');
workerLogger.error({ error: serializeError(err) }, 'Job failed');

// MCP tool operations
mcpLogger.debug({ toolName: 'create_artifact', params }, 'Tool called');
mcpLogger.error({ toolName: 'dispatch_job', error: err.message }, 'Tool failed');

// Script/library operations
scriptLogger.info({ vnetId, rpcUrl }, 'Created Virtual TestNet');
scriptLogger.warn({ error: err.message }, 'Operation failed');
```

## Available Loggers

### Component Loggers

Each logger automatically adds a `component` tag to distinguish log sources:

- **`workerLogger`** - Worker operations (`WORKER`)
- **`walletLogger`** - Wallet/blockchain operations (`WALLET`)
- **`configLogger`** - Configuration validation (`CONFIG`)
- **`agentLogger`** - Agent/AI operations (`AGENT`)
- **`jobLogger`** - Job lifecycle events (`JOB`)
- **`mcpLogger`** - MCP tool operations (`MCP`)
- **`scriptLogger`** - Script/library operations (`SCRIPT`)

### Logger Methods

All component loggers support:

```typescript
logger.debug({ context }, 'Message');  // Detailed debugging info
logger.info({ context }, 'Message');   // General information
logger.warn({ context }, 'Message');   // Warning conditions
logger.error({ context }, 'Message');  // Error conditions
logger.fatal({ context }, 'Message');  // Fatal errors (terminates process)
```

### Specialized Methods

Some loggers have additional convenience methods:

```typescript
// jobLogger
jobLogger.started(jobId, model);
jobLogger.completed(jobId);
jobLogger.failed(jobId, reason);
jobLogger.retry(jobId, attempt, maxRetries);

// mcpLogger
mcpLogger.toolCall(toolName, params);
mcpLogger.toolError(toolName, error);

// agentLogger
agentLogger.output(message);  // Special colored output for agent responses
agentLogger.thinking(message); // Log agent's internal reasoning
```

## Configuration

Logging behavior is controlled via environment variables:

### `LOG_LEVEL`

Sets the minimum log level. Defaults to `info` in production, `debug` in development.

```bash
LOG_LEVEL=debug   # Show all logs including debug
LOG_LEVEL=info    # Show info, warn, error, fatal
LOG_LEVEL=warn    # Show only warnings and errors
LOG_LEVEL=error   # Show only errors and fatal
```

### `LOG_FORMAT`

Controls output format:

```bash
LOG_FORMAT=pretty  # Human-readable colored output (development)
LOG_FORMAT=json    # Structured JSON (production, CI/CD)
```

**Note**: JSON format is automatically forced in test environments (`VITEST=true`) to avoid pino-pretty worker thread issues.

### `NODE_ENV`

Influences default behavior:

- `development` → pretty format, debug level
- `production` → JSON format, info level

## Best Practices

### 1. Use Structured Context

Always provide context as the first argument:

```typescript
// ✅ Good - structured context
workerLogger.info({ requestId, jobId, duration: 1234 }, 'Job completed');

// ❌ Bad - string interpolation
workerLogger.info(`Job ${jobId} completed for request ${requestId}`);
```

### 2. Serialize Errors Properly

Use `serializeError()` for Error objects:

```typescript
import { serializeError } from '../logging/index.js';

try {
  // ...
} catch (error) {
  workerLogger.error({ error: serializeError(error) }, 'Operation failed');
}
```

### 3. Choose the Right Logger

Use the logger that matches your component:

```typescript
// In worker files
import { workerLogger } from '../logging/index.js';

// In MCP tools
import { mcpLogger } from '../../../logging/index.js';

// In scripts/lib files
import { scriptLogger } from '../../logging/index.js';
```

### 4. Avoid console.*

**Do not use `console.log`, `console.error`, etc.** in operational code. Use structured loggers instead.

**Exceptions** where console.* is acceptable:
- **CLI output** in standalone scripts (intentional user interface)
- **Subprocess streaming** in process managers (formatting child output)
- **MCP protocol compliance** (server.ts overrides for stdio transport)
- **Agent telemetry** (operational visibility during execution)

### 5. Use Utility Functions

The logging module provides helpers for common formatting:

```typescript
import { formatAddress, formatWeiToEth, formatDuration } from '../logging/index.js';

logger.info({
  address: formatAddress(addr, 'Mech'),        // "Mech: 0x1234..."
  amount: formatWeiToEth(wei),                 // "1.5" (ETH)
  duration: formatDuration(ms),                // "1.2s"
}, 'Transaction completed');
```

## Migration from console.*

When migrating existing code:

1. **Import the appropriate logger**:
   ```typescript
   import { workerLogger, serializeError } from '../logging/index.js';
   ```

2. **Replace console calls**:
   ```typescript
   // Before
   console.log('Processing job', jobId);
   console.error('Failed:', error);

   // After
   workerLogger.info({ jobId }, 'Processing job');
   workerLogger.error({ error: serializeError(error) }, 'Failed');
   ```

3. **Extract structured context**:
   ```typescript
   // Before
   console.log(`Job ${jobId} completed in ${duration}ms`);

   // After
   workerLogger.info({ jobId, duration }, 'Job completed');
   ```

## Testing

In test environments, logs are automatically formatted as JSON to avoid pino-pretty worker thread interference with test processes.

To see logs during test runs:
```bash
LOG_LEVEL=debug yarn test:worker
```

## Process Exit Codes

Use `exitWithCode()` for consistent logging on process termination:

```typescript
import { exitWithCode } from '../logging/index.js';

exitWithCode(0, 'Success');                    // Clean exit
exitWithCode(1, 'General error', error);       // Fatal error
exitWithCode(2, 'Invalid configuration', err); // Config error
exitWithCode(3, 'Insufficient funds');         // Funding required
exitWithCode(4, 'On-chain conflict', err);     // State conflict
exitWithCode(5, 'RPC/Network error', err);     // Network issue
```

## Recommendations

### ESLint Rule

While not currently enforced, consider adding an ESLint `no-console` rule to prevent accidental console.* usage:

```json
{
  "rules": {
    "no-console": ["error", {
      "allow": []
    }]
  }
}
```

With exceptions for specific files where console.* is intentional (CLI scripts, process managers, etc.).

### Log Aggregation

In production, consider piping JSON logs to a log aggregation service (Datadog, CloudWatch, etc.) for better observability:

```bash
node dist/worker.js | pino-datadog --apiKey $DD_API_KEY
```

## Implementation Details

- **Location**: `/logging/index.ts`
- **Dependencies**: `pino`, `pino-pretty`, `viem` (for formatEther)
- **Test detection**: Checks `VITEST=true` to force JSON format
- **Default log level**: `info` (production), `debug` (development)
- **Default format**: `json` (production), `pretty` (development)
