# ❌ FAIL: Using .catch() with console.log

## Code

```typescript
fetch(url).catch(err => console.log(err));
```

## Violations

1. ❌ **Uses `.catch()`** instead of `try/catch`
2. ❌ **Uses `console.log`** instead of `workerLogger.error`
3. ❌ **No structured context** - Missing `url` in error context
4. ❌ **Error not propagated** - Silently swallows the error

## Correct Version

```typescript
async function fetchData(url: string): Promise<Response> {
  try {
    const response = await fetch(url);
    return response;
  } catch (error) {
    workerLogger.error('Fetch failed', {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
```

## Why This Matters

- `.catch()` mixes promise chains with async/await (inconsistent)
- `console.log` bypasses structured logging (not observable)
- No context means you can't trace which URL failed
- Swallowing errors makes failures invisible

## Pattern Reference

See [`patterns/error-handling-logging.md`](../patterns/error-handling-logging.md) for the canonical pattern.
