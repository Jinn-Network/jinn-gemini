# ✅ PASS: Graceful error handling with explicit fallback

## Code

```typescript
async function fetchJobWithRetry(jobId: string): Promise<Job | null> {
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    workerLogger.error('Failed to fetch job, returning null', {
      jobId,
      error: error instanceof Error ? error.message : String(error)
    });
    return null; // Explicit fallback
  }
}
```

## Why This Passes

✅ **Uses `try/catch` block** - Explicit error boundary
✅ **Uses `workerLogger.error()`** - Structured logging
✅ **Structured context object** - Includes `jobId` for correlation
✅ **Error serialization** - Handles Error objects properly
✅ **Explicit fallback** - Returns `null` instead of re-throwing (intentional)
✅ **Logs the fallback strategy** - "returning null" makes intent clear

## Pattern Elements

- **Try/catch:** Standard async error handling
- **Logger:** Observable structured logging
- **Context:** Debugging info (`jobId`, `error`)
- **Graceful handling:** Doesn't re-throw, but logs explicitly

## Note

This example shows that **not re-throwing is acceptable** when:
1. The error is handled gracefully (explicit fallback)
2. The fallback strategy is logged clearly
3. The return type reflects the possibility of failure (`Job | null`)
