---
argument-hint: [file-path] or [directory] or --diff
description: Review code for orthodoxy violations (obj1 - One Obvious Way)
allowed-tools: Read, Glob, Grep, Bash(git diff:*)
---

# Code Spec Review: obj1 - Follow the Principle of Orthodoxy

You are reviewing code specifically for **orthodoxy violations** - multiple approaches to solving the same problem.

> "There should be one—and preferably only one—obvious way to do it."
> — PEP 20 (The Zen of Python), Principle #13

## Your Task

### Step 1: Read the Specification

Read these files to understand orthodoxy requirements:

1. **Read** `docs/spec/code-spec/spec.md` - Focus on obj1: Follow the principle of orthodoxy
2. **Read** `docs/spec/code-spec/examples/obj1.md` - Orthodoxy violation examples
3. **Read** `docs/spec/code-spec/VIOLATIONS.md` - Known pattern inconsistencies in codebase

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

### Step 3: Search for Orthodoxy Violations

**Orthodoxy Principle:** When you find multiple different approaches to the same problem, that's a violation. The codebase should have ONE canonical way.

#### Violation 1: Mixed Error Handling Patterns

**Search for both patterns:**
```bash
# Pattern A: Promise .catch() chains
grep -n "\.catch(" --include="*.ts"

# Pattern B: try/catch blocks
grep -n "try {" --include="*.ts"
```

**Violation occurs when:**
- Some files use `.catch()` for async error handling
- Other files use `try/catch` blocks
- No clear canonical pattern established

**Analysis:**
- Count occurrences of each pattern
- If both patterns exist, this violates orthodoxy
- The canonical pattern should be `try/catch` (more explicit, better for async/await)

---

#### Violation 2: Mixed Logging Approaches

**Search for both patterns:**
```bash
# Pattern A: console.* logging
grep -n "console\.(log|error|warn|info|debug)" --include="*.ts"

# Pattern B: Structured logger (workerLogger, logger)
grep -n "workerLogger\|logger\.(error|info|warn|debug)" --include="*.ts"
```

**Violation occurs when:**
- Some files use `console.log()`, `console.error()`, etc.
- Other files use structured loggers like `workerLogger`
- Mixed usage within same file or across codebase

**Analysis:**
- Count console.* vs logger usage
- Exception: `console.log()` may be acceptable for CLI output, test fixtures
- For application code, there should be ONE logging approach
- The canonical pattern should be structured logging (`workerLogger`)

---

#### Violation 3: Mixed Configuration Access

**Search for patterns:**
```bash
# Direct process.env access
grep -n "process\.env\." --include="*.ts"

# Config helper functions
grep -n "getRequiredString\|getOptionalString" --include="*.ts"

# Zod validation
grep -n "z\.string\(\)\.env\|z\.object.*process\.env" --include="*.ts"
```

**Violation occurs when:**
- Multiple ways to access configuration (inline `process.env`, helpers, Zod schemas)
- Different files use different approaches
- No established pattern for config access

**Known issue (from VIOLATIONS.md):**
- 5 different configuration patterns exist in codebase
- Multiple env var names for same concept (e.g., `RPC_URL || MECHX_CHAIN_RPC || MECH_RPC_HTTP_URL`)

---

#### Violation 4: Mixed Null/Undefined Checking

**Search for patterns:**
```bash
# Truthy/falsy checks
grep -n "if (!.*)" --include="*.ts"

# Explicit null checks
grep -n "=== null\|!== null" --include="*.ts"

# Explicit undefined checks
grep -n "=== undefined\|!== undefined" --include="*.ts"

# Loose equality (checks both null and undefined)
grep -n "== null\|!= null" --include="*.ts"

# Nullish coalescing
grep -n "??" --include="*.ts"
```

**Violation occurs when:**
- Mix of truthy checks (`if (!value)`), explicit null checks, and nullish coalescing
- No clear pattern for when to use which approach
- Potential bugs: truthy checks treat `0`, `""`, `false` as falsy

---

#### Violation 5: Mixed Promise Handling

**Search for patterns:**
```bash
# Legacy .then()/.catch() chains
grep -n "\.then(" --include="*.ts"

# Modern async/await
grep -n "async function\|async (" --include="*.ts"

# Promise.all
grep -n "Promise\.all" --include="*.ts"

# Promise.allSettled
grep -n "Promise\.allSettled" --include="*.ts"
```

**Violation occurs when:**
- Some files use `.then()/.catch()` chains (legacy)
- Most files use `async/await` (modern)
- Inconsistent approach without rationale

**Known issue (from VIOLATIONS.md):**
- `.then()` found in `mech_worker.ts`, `OlasServiceManager.test.ts`
- Rest of codebase uses `async/await`

---

#### Violation 6: Mixed Type Definitions

**Search for patterns:**
```bash
# Interface declarations
grep -n "^interface " --include="*.ts"

# Type aliases
grep -n "^type " --include="*.ts"

# Zod-inferred types
grep -n "z\.infer<typeof" --include="*.ts"
```

**Violation occurs when:**
- No clear guideline on `interface` vs `type`
- Some types defined multiple ways
- Duplicate type definitions across files

---

#### Violation 7: Multiple Property Fallback Chains

**Search for pattern:**
```bash
# Chained fallbacks (3+ levels)
grep -n "||.*||.*||" --include="*.ts"
```

**Violation occurs when:**
- Code accesses same conceptual data via multiple properties
- Example: `call.input || call.arguments || call.args || call.result`
- Indicates no canonical data structure

**Why this violates orthodoxy:**
- If there are 5 possible property names, there's no "one obvious way"
- Future code must check all 5 properties to be safe
- Should normalize at boundary, then use ONE property name internally

---

### Step 4: Analyze Violations

For each pattern found:

1. **Count occurrences** across codebase
2. **Identify if multiple approaches exist** (orthodoxy violation)
3. **Determine which is canonical** (most common, most maintainable)
4. **Read specific files** to get context for violations

### Step 5: Format Output

Output MUST be in this exact format for parsing:

```
File: <path-to-file>
Line: <number>
Issue: <one-line description>
Pattern reference: <pattern-id>
Current code:
<the non-canonical code>
Suggested fix:
<the canonical pattern>
---
```

**Rules:**
- Use EXACT field names: `File:`, `Line:`, `Issue:`, `Pattern reference:`, `Current code:`, `Suggested fix:`
- Each field starts on a new line
- No markdown formatting (no **, no `, no emojis)
- No code fences (no ```)
- Separate each violation with `---` on its own line
- Keep it simple

**Example:**

```
File: worker/mech_worker.ts
Line: 78
Issue: Using .then() instead of async/await (mixed Promise handling)
Pattern reference: obj1
Current code:
return fetchData().then(data => processData(data)).catch(handleError);
Suggested fix:
try {
  const data = await fetchData();
  return processData(data);
} catch (error) {
  handleError(error);
}
---
File: utils/logger.ts
Line: 12
Issue: Using console.log instead of structured logger (mixed logging)
Pattern reference: obj1
Current code:
console.log('Processing request:', requestId);
Suggested fix:
workerLogger.info('Processing request', { requestId });
---
```

That's the entire output. No summaries, no extra markdown, just this format.

## Detection Strategy

### Phase 1: Pattern Discovery
Use Grep to find all occurrences of each pattern:
1. Error handling: `.catch()` vs `try/catch`
2. Logging: `console.*` vs `logger`
3. Config: `process.env` vs helpers vs Zod
4. Null checks: truthy vs explicit vs nullish
5. Promises: `.then()` vs `async/await`
6. Types: `interface` vs `type`

### Phase 2: Frequency Analysis
For each pattern:
1. Count total occurrences
2. Identify dominant pattern (likely canonical)
3. Flag files using minority pattern (violations)

### Phase 3: Context Verification
Read files with violations to:
1. Confirm it's a real inconsistency
2. Check if there's a valid reason for deviation
3. Suggest migration to canonical pattern

## Important Notes

- **Orthodoxy is about consistency, not perfection**
- If no canonical pattern exists, that's a documentation issue (note it, don't flag as violation)
- Test code may have different patterns (lower severity)
- The goal: ONE obvious way for future AI sessions to follow

## Key Insight from Spec

From VIOLATIONS.md, we know these orthodoxy violations exist:
1. Configuration Management: 5 different patterns 🔴
2. Error Handling: Context-dependent patterns 🔴
3. Logging: 4 different patterns 🔴
4. Null/Undefined Checking: 5 different patterns 🟡
5. Promise Handling: Mixed async/await and .then() 🟡
6. Type Definitions: Mixed interface/type usage 🟡

Your job: Detect which of these violations exist in the target code.

## Example Usage

```bash
# Review staged changes for orthodoxy
/review-obj1 --diff

# Review specific file for pattern consistency
/review-obj1 worker/mech_worker.ts

# Review all worker files
/review-obj1 worker/

# Review entire codebase (slow)
/review-obj1 .
```

---

**Now begin:** Read the spec, search for pattern inconsistencies, analyze violations, and report findings.
