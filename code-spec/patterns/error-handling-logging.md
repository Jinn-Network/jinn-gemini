# Error Handling + Logging Pattern

**Pattern ID:** `error-handling-logging-v1`
**Established:** 2025-01-09
**Status:** Active

## The Canonical Pattern

All async operations must use `try/catch` blocks with `workerLogger.*` and structured context objects.

### ✅ Correct Implementation

```typescript
async function fetchData(url: string): Promise<Data> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    workerLogger.error('Failed to fetch data', {
      url,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error; // Re-throw for caller to handle
  }
}
```

**Key elements:**
1. `try/catch` block (not `.catch()`)
2. `workerLogger.error()` (not `console.*`)
3. Structured context object with relevant debugging info
4. Error serialization (`error instanceof Error ? ...`)
5. Re-throw or explicit handling (never silent)

### ✅ With Graceful Fallback

```typescript
async function fetchWithFallback(url: string): Promise<Data | null> {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    workerLogger.error('Fetch failed, returning null', {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    return null; // Explicit fallback
  }
}
```

**Note:** If you handle the error gracefully (don't re-throw), still log it with context.

### ✅ With Context Enrichment

```typescript
async function processJob(jobId: string): Promise<void> {
  try {
    const job = await fetchJob(jobId);
    const result = await executeJob(job);
    await saveResult(jobId, result);
  } catch (error) {
    workerLogger.error('Job processing failed', {
      jobId,
      step: 'unknown', // Add more specific step tracking as needed
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}
```

## ❌ Non-Canonical Patterns (Violations)

### Using `.catch()` instead of `try/catch`

```typescript
// ❌ WRONG
fetch(url).catch(err => console.log(err));

// ❌ WRONG
someAsyncFunc().catch(e => workerLogger.error('Failed', { e }));
```

**Why this violates:**
- Mixes promise chains with async/await
- Less explicit than try/catch
- Harder to add multi-step error handling

### Using `console.*` instead of `workerLogger`

```typescript
// ❌ WRONG
try {
  await fetch(url);
} catch (e) {
  console.error('Failed:', e);
}

// ❌ WRONG
console.log('Error happened:', error);
```

**Why this violates:**
- Not structured logging
- Not observable in telemetry/logs
- No consistent format

### Silent Failures

```typescript
// ❌ WRONG
try {
  await riskyOperation();
} catch {
  // Silently ignoring error
}

// ❌ WRONG
try {
  await riskyOperation();
} catch (e) {
  // Empty catch with no logging
}
```

**Why this violates:**
- Error disappears without trace
- Impossible to debug
- Violates observability principle

### Unstructured Logging

```typescript
// ❌ WRONG
catch (error) {
  workerLogger.error(error); // No context object
}

// ❌ WRONG
catch (error) {
  workerLogger.error('Failed'); // No error details
}

// ❌ WRONG
catch (error) {
  workerLogger.error(`Failed: ${error}`); // String interpolation, not structured
}
```

**Why this violates:**
- Can't query/filter logs effectively
- Missing debugging context
- Not machine-parseable

### Multiple Property Fallbacks

```typescript
// ❌ WRONG - Indicates no canonical data structure
const input = signalCall.input || signalCall.arguments || signalCall.args || signalCall.result;
```

**Why this violates:**
- Indicates the data structure is not standardized
- Different code paths produce different shapes
- Should establish one property name

**Fix:** Normalize at the boundary:
```typescript
// ✅ CORRECT
function normalizeToolCall(call: any): { input: any } {
  return {
    input: call.input || call.arguments || call.args || call.result
  };
}

// Then use consistently
const normalized = normalizeToolCall(signalCall);
const input = normalized.input; // Only one way to access
```

## Pattern Rationale

### Why `try/catch`?
- **Explicit:** Clear boundaries for error handling
- **Aligns with async/await:** Standard modern JavaScript pattern
- **Composable:** Easy to add cleanup logic, multi-step handling

### Why `workerLogger`?
- **Structured:** Machine-parseable logs
- **Observable:** Integrates with telemetry (OpenTelemetry)
- **Consistent:** Same format across all logs
- **Traceable:** Can correlate logs with spans/traces

### Why Context Objects?
- **Debugging:** Includes all relevant info at error site
- **Querying:** Can filter logs by specific fields
- **Telemetry:** Enriches traces with error context

### Why Re-throw?
- **Caller's choice:** Let caller decide if it's recoverable
- **Context propagation:** Error bubbles up with full stack
- **Explicit handling:** If you don't re-throw, you're explicitly handling

## Exceptions

Rare cases may require deviation:

### Third-party Callback APIs

```typescript
// Legacy callback-based API
legacyLib.doSomething((err, result) => {
  if (err) {
    workerLogger.error('Legacy operation failed', { error: err });
    // Can't use try/catch here, but still log structured
  }
});
```

**Document in PR:**
```markdown
## ⚠️ Code Spec Exception: Error Handling
**Reason:** Third-party library uses callbacks, not async/await
**Alternative:** Callback with structured logging
**File:** `worker/legacy-adapter.ts:42`
```

### Fire-and-Forget Operations

```typescript
// Intentionally don't await (fire-and-forget)
void someAsyncOperation().catch(err => {
  workerLogger.error('Background operation failed', { error: err });
  // Can't re-throw, this is fire-and-forget
});
```

**Document in PR:**
```markdown
## ⚠️ Code Spec Exception: Error Handling
**Reason:** Fire-and-forget background operation
**Alternative:** `.catch()` with logging, no re-throw
**File:** `worker/background-task.ts:89`
```

## Migration Notes

### Current State (Pre-Spec)

Codebase analysis shows:
- **29 files** use `try/catch`
- **2 files** use `.catch()`
- **26 files** mix `console.*` and `workerLogger.*`
- **Multiple files** have property fallback chains

### Migration Strategy

1. **Phase 1:** Document pattern (this file) ✅
2. **Phase 2:** Test spec on existing code
3. **Phase 3:** AI-assisted migration of violations
4. **Phase 4:** Enforce on new code via `/review-code-spec`

## Changelog

### 2025-01-09: Initial Pattern
**Created:** Error handling + logging canonical pattern
**Rationale:** High frequency domain (29+ files), tightly coupled concerns
**Status:** Active
