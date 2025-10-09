# ❌ FAIL: Silent catch block

## Code

```typescript
try {
  await riskyOperation();
} catch {
  // Silent failure - no logging
}
```

## Violations

1. ❌ **Silent failure** - Error completely ignored
2. ❌ **No logging** - Failure invisible to observability
3. ❌ **No propagation** - Caller thinks operation succeeded

## Correct Version

```typescript
try {
  await riskyOperation();
} catch (error) {
  workerLogger.error('Risky operation failed', {
    operation: 'riskyOperation',
    error: error instanceof Error ? error.message : String(error)
  });
  throw error; // Or handle with explicit fallback
}
```

## Why This Matters

Silent failures are **debugging nightmares**:
- Operation fails but caller thinks it succeeded
- No trace in logs or telemetry
- Impossible to diagnose in production
- Violates "fail explicitly, never silently" principle

## When Would You NOT Log?

Almost never. Even if you handle the error gracefully, you should log it:

```typescript
try {
  await nonCriticalOperation();
} catch (error) {
  workerLogger.warn('Non-critical operation failed, continuing', {
    error: error instanceof Error ? error.message : String(error)
  });
  // Continue without re-throwing, but logged
}
```

## Pattern Reference

See [`patterns/error-handling-logging.md`](../patterns/error-handling-logging.md) for the canonical pattern.
