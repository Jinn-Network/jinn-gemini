---
argument-hint: [file-path] or [directory] or --diff
description: Review code for discoverability violations (obj2 - Code for the Next Agent)
allowed-tools: Read, Glob, Grep, Bash(git diff:*)
---

# Code Spec Review: obj2 - Code for the Next Agent

You are reviewing code specifically for **discoverability violations** - code that is implicit, non-discoverable, or requires human intuition.

> "Explicit is better than implicit."
> — PEP 20 (The Zen of Python), Principle #2

**Core Principle:** AI agents are the primary developers. Every line of code should be optimized for machine discoverability, readability, and comprehension.

## Your Task

### Step 1: Read the Specification

Read these files to understand discoverability requirements:

1. **Read** `docs/spec/code-spec/spec.md` - Focus on obj2: Code for the next agent
2. **Read** `docs/spec/code-spec/examples/obj2.md` - Discoverability violation examples

### Step 2: Identify Target Code

Based on `$ARGUMENTS`:

- If `$ARGUMENTS` is `--diff`:
  - Run `git diff --cached` to get staged changes
  - If no staged changes, run `git diff HEAD` for unstaged changes
  - Analyze only the changed lines

- If `$ARGUMENTS` is a file path (e.g., `worker/config.ts`):
  - Read that specific file
  - Analyze the entire file

- If `$ARGUMENTS` is a directory path (e.g., `worker/`):
  - Use Glob to find all `.ts` files in that directory
  - Read and analyze each file

- If no `$ARGUMENTS`:
  - Default to analyzing all `.ts` files in the `worker/` directory

### Step 3: Search for Discoverability Violations

**AI agents navigate code through:**
1. **Search/grep** - Finding patterns by text matching
2. **Type inference** - Understanding through explicit types
3. **Naming** - Comprehending intent from descriptive names
4. **Locality** - Reading nearby code, not distant files

Code should succeed on all four axes.

---

#### Violation 1: Inline Environment Variable Access

**Search pattern:**
```bash
# Find direct process.env access outside of config files
grep -n "process\.env\.[A-Z_]" --include="*.ts" --exclude="*config*.ts"
```

**Violation occurs when:**
- Code directly accesses `process.env.VARIABLE_NAME` instead of using config helpers
- No validation or error handling
- Variable names not centralized

**Why this violates obj2:**
- **Non-discoverable:** Hard to find all places where env var is used
- **Implicit:** No explicit validation or required vs optional
- **Hidden errors:** Missing env var causes runtime failure, not startup failure

**Example violation:**
```typescript
// ❌ Inline, no validation, hard to grep for "API key access"
const apiKey = process.env.API_KEY;
fetch(url, { headers: { Authorization: apiKey } });
```

**Correct pattern:**
```typescript
// ✅ Explicit, validated, discoverable
function getApiKey(): string {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY environment variable is required');
  }
  return apiKey;
}

// Usage is explicit and greppable
const apiKey = getApiKey();
```

---

#### Violation 2: Magic Globals and Implicit Dependencies

**Search pattern:**
```bash
# Look for single-letter globals, unexplained references
grep -n "^const [a-z] = \|global\.\|window\." --include="*.ts"
```

**Violation occurs when:**
- Code references variables not imported or defined locally
- Global state accessed implicitly
- Dependencies not explicit

**Why this violates obj2:**
- **Non-discoverable:** AI can't find where `g.db` is defined
- **Implicit:** Requires reading initialization file
- **Context-dependent:** Fails if initialization order changes

**Example violation:**
```typescript
// ❌ Where is 'g' defined? What is 'db'?
const result = await g.db.query(sql);

// ❌ What does 'e' contain?
const e = process.env;
const config = { url: e.U, pass: e.P };
```

**Correct pattern:**
```typescript
// ✅ Explicit import, clear dependency
import { database } from './database';
const result = await database.query(sql);

// ✅ Descriptive names, explicit access
const databaseUrl = process.env.DATABASE_URL;
const password = process.env.DATABASE_PASSWORD;
```

---

#### Violation 3: Multiple Fallback Chains (3+ levels)

**Search pattern:**
```bash
# Find chained fallbacks (indicates unclear data structure)
grep -n "||.*||.*||" --include="*.ts"
```

**Violation occurs when:**
- Code checks 3+ different properties for same data
- Example: `call.input || call.arguments || call.args || call.result`
- Indicates no canonical data structure

**Why this violates obj2:**
- **Non-discoverable:** Future code must know all 4 property names
- **Hidden logic:** Which property is actually canonical?
- **Implicit:** Why are there 4 different names?

**Example violation:**
```typescript
// ❌ Which property should I use? All 4?
const input = call.input || call.arguments || call.args || call.result;

// ❌ What's the difference between these?
const rpcUrl = process.env.RPC_URL ||
               process.env.MECHX_CHAIN_RPC ||
               process.env.MECH_RPC_HTTP_URL ||
               'http://localhost:8545';
```

**Correct pattern:**
```typescript
// ✅ Normalize at boundary
function normalizeToolCall(call: any): { input: any } {
  return {
    input: call.input || call.arguments || call.args || call.result
  };
}

// All code uses normalized structure - ONE way
const normalized = normalizeToolCall(call);
const input = normalized.input; // Only one property to remember

// ✅ One canonical env var name
const rpcUrl = getRpcUrl(); // Function handles env var internally
```

---

#### Violation 4: Missing or Non-Descriptive Error Messages

**Search pattern:**
```bash
# Find throw statements with no message or generic messages
grep -n "throw new Error()\|throw new Error('')\|throw new Error(\"error\")" --include="*.ts"

# Find validation without clear error messages
grep -B2 "throw new Error" --include="*.ts"
```

**Violation occurs when:**
- `throw new Error()` with no message
- Generic messages like "Invalid input" or "Error"
- No explanation of what's wrong or how to fix it

**Why this violates obj2:**
- **Non-discoverable:** AI can't understand what failed
- **Not self-documenting:** Requires reading context
- **Hidden requirements:** What was expected?

**Example violation:**
```typescript
// ❌ What failed? What was expected?
if (!config) {
  throw new Error('Invalid config');
}

// ❌ No message at all
if (!value) throw new Error();
```

**Correct pattern:**
```typescript
// ✅ Explicit about what's missing and why
if (!config) {
  throw new Error('Configuration object is required but was null or undefined');
}

// ✅ Explains requirement and actual value
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required for database connection');
}
```

---

#### Violation 5: Abbreviated or Non-Descriptive Variable Names

**Search pattern:**
```bash
# Look for single-letter variables (exclude loop counters i, j, k)
grep -n "const [a-hm-z] =\|let [a-hm-z] =\|var [a-hm-z] =" --include="*.ts"

# Look for common abbreviations that obscure meaning
grep -n "const \(cfg\|temp\|tmp\|res\|val\|obj\|arr\|str\|num\) =" --include="*.ts"
```

**Violation occurs when:**
- Single-letter variables in non-loop contexts
- Overly abbreviated names
- Non-greppable identifiers

**Why this violates obj2:**
- **Non-discoverable:** Can't grep for "e" or "cfg"
- **Context-dependent:** Requires reading nearby code
- **Implicit:** Meaning not clear from name

**Example violation:**
```typescript
// ❌ What is 'e'? Error? Environment? Event?
const e = process.env;

// ❌ What is 'cfg'? What does it configure?
const cfg = loadConfig();

// ❌ What is 'res'? Response? Result? Resource?
const res = await fetch(url);
```

**Correct pattern:**
```typescript
// ✅ Explicit, greppable, self-documenting
const environment = process.env;

// ✅ Clear what it configures
const workerConfig = loadWorkerConfig();

// ✅ Clear it's a fetch response
const response = await fetch(url);
const responseData = await response.json();
```

---

#### Violation 6: Clever Code and One-Liners

**Search pattern:**
```bash
# Find IIFEs (Immediately Invoked Function Expressions)
grep -n "(() =>\|function().*())" --include="*.ts"

# Find deeply nested optional chaining
grep -n "\?\.\w\+\?\.\w\+\?\.\w\+\?\.\w\+\?\." --include="*.ts"

# Find complex ternaries
grep -n "? .* : .* ? .* :" --include="*.ts"
```

**Violation occurs when:**
- IIFE used for side effects or clever initialization
- Deep optional chaining (5+ levels)
- Nested ternary operators
- Code that requires human intuition to understand

**Why this violates obj2:**
- **Requires cleverness:** AI must infer intent
- **Not self-documenting:** Needs explanation
- **Implicit:** Side effects or control flow hidden

**Example violation:**
```typescript
// ❌ IIFE - why the wrapper? Side effects?
const config = (() => {
  const e = process.env;
  return { u: e.U, p: e.P, h: e.H };
})();

// ❌ Deep optional chaining - what if any step is undefined?
const value = obj?.a?.b?.c?.d?.e?.f?.g;

// ❌ Nested ternary - hard to follow
const result = x ? y : z ? a : b ? c : d;
```

**Correct pattern:**
```typescript
// ✅ Explicit function with clear purpose
function loadConfigFromEnvironment() {
  return {
    url: process.env.DATABASE_URL,
    password: process.env.DATABASE_PASSWORD,
    host: process.env.DATABASE_HOST,
  };
}
const config = loadConfigFromEnvironment();

// ✅ Check intermediate values explicitly
const value = obj?.a?.b?.c;
if (!value) {
  throw new Error('Expected obj.a.b.c to be defined');
}
const finalValue = value.d?.e?.f;

// ✅ Use if/else for clarity
let result;
if (x) {
  result = y;
} else if (z) {
  result = a;
} else if (b) {
  result = c;
} else {
  result = d;
}
```

---

### Step 4: Analyze Violations

For each pattern found:

1. **Read the file** to get full context
2. **Determine if it's a real violation:**
   - Is it explicit and discoverable?
   - Can an AI agent understand it through search/types/naming?
   - Or does it require human intuition or hidden context?
3. **Suggest explicit alternative**

### Step 5: Format Output

For each violation:

```markdown
### ⚠️ [obj2] `<file-path>:<line-number>`

**Violation:** [What makes this code implicit/non-discoverable]
**Category:** [Inline env access | Magic globals | Fallback chains | Missing errors | Abbreviations | Clever code]

**Current code:**
```typescript
[Show the implicit/non-discoverable code]
```

**Why this violates obj2:**
- [Explain discoverability issue]
- [Explain how it confuses AI agents]

**Suggested fix:**
```typescript
[Show explicit, discoverable alternative]
```

**Reference:** `docs/spec/code-spec/spec.md` (obj2: Code for the Next Agent)
```

### Step 6: Provide Summary

```markdown
## [obj2] Discoverability Review Summary

**Files analyzed:** [count]
**Total violations found:** [count]

### Violation Categories:

| Category | Count | Severity |
|----------|-------|----------|
| Inline env var access | [count] | 🟡 |
| Magic globals | [count] | 🟡 |
| Multiple fallback chains | [count] | 🟡 |
| Missing error messages | [count] | 🟢 |
| Abbreviated names | [count] | 🟢 |
| Clever one-liners | [count] | 🟢 |

### Discoverability Principle:

> AI agents read code through search, types, names, and locality.
> Implicit behavior, clever tricks, and hidden context confuse AI.
> Write code the next agent can understand.

### Action Required:

1. Make implicit code explicit
2. Add descriptive variable names
3. Provide clear error messages
4. Centralize configuration access
5. Avoid clever code - prefer clarity

📚 **Full documentation:** `docs/spec/code-spec/USAGE.md`
📖 **Discoverability examples:** `docs/spec/code-spec/examples/obj2.md`
```

## Detection Strategy

### Phase 1: Pattern Search
Use Grep to find common violations:
1. Inline `process.env` access
2. Fallback chains (3+ levels)
3. Single-letter variables
4. Empty error messages
5. IIFEs and complex expressions

### Phase 2: Context Analysis
Read files to verify:
1. Is this code discoverable?
2. Can AI find it through grep?
3. Is intent clear from naming?
4. Are dependencies explicit?

### Phase 3: Recommendation
For each violation:
1. Explain why it's implicit
2. Show explicit alternative
3. Highlight discoverability benefits

## Important Notes

- **Test code may have lower standards** (abbreviations acceptable in tests)
- **Loop variables (i, j, k) are acceptable** (convention)
- **Focus on code that AI will read and modify**
- **Clever code might be correct, but hard for AI to understand**

## Key Questions for Each Code Pattern

Ask yourself:
1. Can an AI agent find this through search?
2. Is the intent explicit from names and types?
3. Are dependencies clear without reading other files?
4. Would a future AI session understand this code?

If any answer is "no", it violates obj2.

## Example Usage

```bash
# Review staged changes for discoverability
/review-obj2 --diff

# Review specific file
/review-obj2 worker/mech_worker.ts

# Review all worker files
/review-obj2 worker/

# Review entire codebase
/review-obj2 .
```

---

**Now begin:** Read the spec, search for implicit patterns, analyze violations, and report findings.
