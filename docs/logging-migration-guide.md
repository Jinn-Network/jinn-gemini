# Logging Migration Guide

This guide explains how to migrate code from `console.*` to structured logging using the shared `logging/index.ts` module.

## Quick Reference

| Old Pattern | New Pattern |
|-------------|-------------|
| `console.log('msg')` | `logger.info('msg')` |
| `console.error('msg', error)` | `logger.error({ error: serializeError(error) }, 'msg')` |
| `console.warn('msg')` | `logger.warn('msg')` |
| `console.log(\`User ${id}\`)` | `logger.info({ userId: id }, 'User action')` |

## Step-by-Step Migration

### 1. Add Import

At the top of your file, after existing imports:

```typescript
import { createChildLogger, serializeError } from './logging/index.js';

// Create a component-specific logger
const logger = createChildLogger('MY_COMPONENT_NAME');
```

**Component naming convention:**
- Use UPPER_SNAKE_CASE
- Be descriptive but concise
- Examples: `HTTP_CLIENT`, `DATABASE`, `AUTH_SERVICE`

### 2. Replace Console Calls

#### Basic Logging

```typescript
// ❌ Before
console.log('Starting process');

// ✅ After
logger.info('Starting process');
```

#### With Variables

```typescript
// ❌ Before
console.log(`Processing user ${userId}`);

// ✅ After (structured metadata)
logger.info({ userId }, 'Processing user');
```

#### Error Logging

Always use `serializeError` when logging error objects:

```typescript
// ❌ Before
catch (error) {
  console.error('Failed to process:', error);
}

// ✅ After
catch (error) {
  logger.error({ error: serializeError(error) }, 'Failed to process');
}
```

## Common Patterns

### Pattern 1: Script Logging

```typescript
import { createChildLogger, serializeError } from '../logging/index.js';

const logger = createChildLogger('SCRIPT_NAME', {
  script: 'path/to/script.ts'
});

async function main() {
  logger.info('Script starting');

  try {
    // ... script logic
    logger.info({ result }, 'Script completed');
  } catch (error) {
    logger.error({ error: serializeError(error) }, 'Script failed');
    process.exit(1);
  }
}

main();
```

### Pattern 2: MCP Tool Logging

```typescript
import { createChildLogger, serializeError } from '../../../../logging/index.js';

const toolLogger = createChildLogger('MCP_TOOL', {
  tool: 'my_tool_name'
});

export async function myTool(params: MyParams) {
  toolLogger.info({ params }, 'Tool invoked');

  try {
    const result = await execute(params);
    toolLogger.info({ result }, 'Tool completed');
    return { success: true, data: result };
  } catch (error) {
    toolLogger.error({
      params,
      error: serializeError(error)
    }, 'Tool failed');
    return { success: false, error: String(error) };
  }
}
```

## Using Pre-configured Loggers

For common components, use the pre-configured loggers:

```typescript
import {
  workerLogger,   // For worker operations
  agentLogger,    // For AI/agent operations
  jobLogger,      // For job lifecycle
  mcpLogger,      // For MCP tools
  configLogger,   // For configuration
  walletLogger    // For wallet operations
} from './logging/index.js';

// Use directly
workerLogger.info({ requestId }, 'Processing request');

// Agent output (includes emoji)
agentLogger.output('AI response: The answer is 42');

// Job lifecycle helpers
jobLogger.started(jobId, 'gpt-4');
jobLogger.completed(jobId);
jobLogger.failed(jobId, 'Timeout');
```

## Security Best Practices

### Never Log These Fields

```typescript
// ❌ NEVER
logger.info({
  privateKey: '0x...',     // NEVER LOG PRIVATE KEYS
  apiKey: 'sk-...',        // NEVER LOG API KEYS
  password: 'secret',      // NEVER LOG PASSWORDS
  mnemonic: 'word1 word2', // NEVER LOG MNEMONICS
  token: 'Bearer ...'      // NEVER LOG AUTH TOKENS
});

// ✅ Instead, log non-sensitive identifiers
logger.info({
  walletAddress: '0x...',  // OK - public address
  userId: '123',           // OK - identifier
  hasValidToken: true      // OK - boolean status
});
```

## Migration Status

### ✅ Completed
- Phase 1: Shared logging module created
- Phase 2: Worker code migrated (18 files)
- Phase 3: Core utilities migrated (env/operate-profile.ts)
- Phase 5: ESLint guardrails added

### 🚧 In Progress
- Phase 4: Scripts & MCP tools migration (93 files, 2600+ console calls)

### Helper Script

To analyze a file for migration:

```bash
# Count console usage
grep -c "console\." path/to/file.ts

# List all console calls with line numbers
grep -n "console\." path/to/file.ts
```

## References

- Code Spec: `docs/spec/code-spec/spec.md` (Structured logging only)
- Example File: `docs/spec/code-spec/examples/db3.md`
- Logging Module: `logging/index.ts`
- Issue: JINN-236
