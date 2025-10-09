# ❌ FAIL: Using console.error instead of workerLogger

## Code

```typescript
try {
  await fetch(url);
} catch (err) {
  console.error('Fetch failed:', err);
}
```

## Violations

1. ❌ **Uses `console.error`** instead of `workerLogger.error`
2. ❌ **No structured context** - String concatenation instead of object
3. ❌ **No URL in context** - Can't tell which fetch failed
4. ❌ **Error not propagated** - Silently swallows after logging

## Correct Version

```typescript
try {
  const response = await fetch(url);
  return response;
} catch (error) {
  workerLogger.error('Fetch failed', {
    url,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  throw error;
}
```

## Why This Matters

### console.* vs workerLogger

| `console.error` | `workerLogger.error` |
|-----------------|---------------------|
| Unstructured text | Structured JSON |
| Not queryable | Queryable by fields |
| No telemetry integration | OpenTelemetry compatible |
| No trace correlation | Correlates with spans |
| Inconsistent format | Consistent format |

### String Concatenation vs Context Object

```typescript
// ❌ BAD: String interpolation
console.error(`Failed to fetch ${url}:`, err);

// ✅ GOOD: Structured object
workerLogger.error('Failed to fetch', { url, error: err });
```

The structured version allows you to:
- Query logs: `logs.where('url', '=', 'https://api.example.com')`
- Aggregate errors by URL
- Correlate with traces via `url` field

## Pattern Reference

See [`patterns/error-handling-logging.md`](../patterns/error-handling-logging.md) for the canonical pattern.
