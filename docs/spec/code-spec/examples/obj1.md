# Objective: Orthodoxy - One Obvious Way

## Context

This objective ensures consistency across an AI-generated codebase where different prompts or sessions might produce different solutions to the same problem.

## Test Cases

### Case 1: Multiple approaches to error handling

#### ❌ Violates Objective

```typescript
// File A: Uses .catch() with console.log
fetch(url).catch(err => console.log(err));

// File B: Uses try/catch with console.error
try {
  await fetch(url);
} catch (e) {
  console.error('Failed:', e);
}

// File C: Uses try/catch with logger but unstructured
try {
  await fetch(url);
} catch (e) {
  workerLogger.error(e);
}

// File D: Uses try/catch with logger and structured context
try {
  await fetch(url);
} catch (error) {
  workerLogger.error('Fetch failed', { url, error });
}
```

**Problem:** Four different approaches to handling fetch errors. This violates the orthodoxy objective because there is no single obvious way.

**Impact:**
- New developers (human or AI) must learn all four approaches
- Code review becomes subjective ("which style is acceptable?")
- Debugging is harder (logs have different formats)
- Observability is inconsistent

#### ✅ Follows Objective

```typescript
// All files use the same canonical approach
try {
  await fetch(url);
} catch (error) {
  workerLogger.error('Fetch failed', {
    url,
    error: error instanceof Error ? error.message : String(error)
  });
  throw error;
}
```

**Why this follows the objective:**
- One obvious way consistently applied across the entire codebase
- Predictable: developers know what to expect
- Learnable: AI agents can follow the pattern
- Maintainable: changes to error handling happen in one place (the pattern)

### Case 2: Multiple property access patterns

#### ❌ Violates Objective

```typescript
// Different files accessing tool call data differently
const input1 = call.input;
const input2 = call.arguments;
const input3 = call.args;
const input4 = call.result;
const input5 = call.input || call.arguments || call.args || call.result;
```

**Problem:** Five different ways to access the same conceptual data. No canonical structure.

#### ✅ Follows Objective

```typescript
// Normalize at the boundary
function normalizeToolCall(call: any): { input: any } {
  return {
    input: call.input || call.arguments || call.args || call.result
  };
}

// All code uses the normalized structure
const normalized = normalizeToolCall(call);
const input = normalized.input; // Only one way to access
```

**Why this follows the objective:**
- Inconsistent external data is normalized once at the boundary
- Internal code has one obvious way to access the data
- Future changes to normalization logic happen in one place

## Application

When you encounter code that violates this objective:

1. **Identify the problem domain** - What are these approaches trying to solve?
2. **Choose the canonical approach** - Which one is best for observability, maintainability, consistency?
3. **Document as a default behavior** - Add it to spec.md
4. **Create examples** - Show correct and incorrect usage
5. **Migrate existing code** - Update all instances to follow the canonical approach
6. **Enforce going forward** - Code review catches violations

## References

- PEP 20 (The Zen of Python), Principle #13
- See spec.md "Default Behaviors" for canonical patterns
