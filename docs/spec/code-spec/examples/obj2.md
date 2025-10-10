# obj2: Code for the Next Agent

This example demonstrates the "Code for the next agent" objective.

## ✅ Correct: Explicit and Discoverable

```typescript
// Configuration access - explicit name and validation
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return url;
}

// Clear intent, AI can grep for "getDatabaseUrl" to find all database config access
const dbUrl = getDatabaseUrl();
```

**Why this works:**
- **Explicit:** Function name clearly states what it does
- **Discoverable:** `grep "getDatabaseUrl"` finds all database URL usage
- **Self-documenting:** Error message explains the requirement
- **Predictable:** Future AI sessions will use the same function

---

## ❌ Violation: Implicit and Hidden

```typescript
// Magic global from initialization file (requires reading another file to understand)
const db = g.db;

// Implicit environment variable access (which var? what happens if missing?)
const url = process.env.DB || process.env.DATABASE_URL || process.env.DB_CONN;

// Clever but unclear
const cfg = (() => {
  const e = process.env;
  return { u: e.U, p: e.P, h: e.H };
})();
```

**Why this violates:**
- **Implicit:** `g.db` requires knowing what `g` is and how it was initialized
- **Hidden:** Multiple env var fallbacks make it unclear which to set
- **Non-discoverable:** Abbreviated names (`u`, `p`, `h`) are not greppable
- **Clever:** IIFE is concise but requires understanding the pattern

---

## Key Insight

AI agents read code through:
1. **Search/grep** - Finding patterns by text matching
2. **Type inference** - Understanding through explicit types
3. **Naming** - Comprehending intent from descriptive names
4. **Locality** - Reading nearby code, not distant files

Write code that succeeds on all four axes.
