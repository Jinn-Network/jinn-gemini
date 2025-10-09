---
argument-hint: [file-path] or [directory] or --diff
description: Review code against the Orthodoxy Principle (Code Spec)
allowed-tools: Read, Glob, Bash(git diff:*)
---

# Code Spec Review

You are reviewing code against the **Orthodoxy Principle** specification.

## Your Task

### Step 1: Read the Specification

Read these files in order to understand the code spec structure:

1. **Read** `code-spec/spec.md` - The complete Code Spec (Objectives → Rules → Default Behaviors)
2. **Read** `code-spec/examples/obj1.md` - Orthodoxy objective example
3. **Read** `code-spec/examples/db01.md` - Correct async error handling
4. **Read** `code-spec/examples/db02.md` through `db06.md` - Common violations to avoid

**Note:** The spec.md file contains everything. Examples demonstrate specific violations and correct usage.

### Step 2: Identify Target Code

Based on `$ARGUMENTS`:

- If `$ARGUMENTS` is `--diff`:
  - Run `git diff --cached` to get staged changes
  - If no staged changes, run `git diff HEAD` for unstaged changes
  - Analyze only the changed lines

- If `$ARGUMENTS` is a file path (e.g., `worker/mech_worker.ts`):
  - Read that specific file
  - Analyze the entire file

- If `$ARGUMENTS` is a directory path (e.g., `worker/`):
  - Use Glob to find all `.ts` files in that directory
  - Read and analyze each file

- If no `$ARGUMENTS`:
  - Default to analyzing all `.ts` files in the `worker/` directory

### Step 3: Analyze for Violations

Look for these specific violations in the code:

#### ❌ Error Handling Violations

1. **Using `.catch()` instead of `try/catch`**
   - Pattern: `.catch(err => ...)`
   - Find: Promise chains with `.catch()`

2. **Silent catch blocks**
   - Pattern: `catch { }` or `catch (e) { }` with no logging
   - Find: Empty catch blocks or catch with no logging

3. **Using `console.*` instead of `workerLogger`**
   - Pattern: `console.log()`, `console.error()`, `console.warn()`
   - Find: Any console.* calls

4. **Unstructured logging**
   - Pattern: `workerLogger.error(stringOnly)` without context object
   - Find: Logger calls with string interpolation or no context object

5. **Multiple property fallbacks**
   - Pattern: `a || b || c || d`
   - Find: Chained fallback property access (indicates no canonical data structure)

6. **No error propagation**
   - Pattern: `catch (e) { log(e); /* no throw */ }`
   - Find: Catch blocks that log but don't re-throw or return fallback

### Step 4: Format Output

For each violation found, output this format:

```markdown
### ❌ `<file-path>:<line-number>`

**Issue:** [Brief description of the violation]

**Current code:**
```typescript
[Show the violating code snippet]
```

**Suggested fix:**
```typescript
[Show the corrected code following canonical pattern]
```

**Pattern reference:** `code-spec/spec.md` (Default Behaviors section)
```

### Step 5: Provide Summary

At the end, provide a summary:

```markdown
## Summary

**Total violations found:** [count]
**Files analyzed:** [count]

### Violations by type:
- Using `.catch()` instead of try/catch: [count]
- Console logging instead of workerLogger: [count]
- Silent failures: [count]
- Unstructured logging: [count]
- Multiple property fallbacks: [count]

### Next steps:
1. Address violations using the suggested fixes
2. If you must deviate from the default behavior, document the exception in your PR
3. See `code-spec/spec.md` "Default Behaviors" section for the full specification

📚 **Full documentation:** `code-spec/README.md`
📖 **Examples:** `code-spec/examples/db01.md` through `db06.md`
```

## Important Notes

- **Be precise:** Include exact line numbers for each violation
- **Be helpful:** Provide the exact fix, not just a description
- **Be thorough:** Check every async function and error handling block
- **Be fair:** If code follows the pattern correctly, acknowledge it

## Example Usage

```bash
# Review a specific file
/review-code-spec worker/mech_worker.ts

# Review all worker files
/review-code-spec worker/

# Review staged changes
/review-code-spec --diff

# Review unstaged changes
git add -A && /review-code-spec --diff
```

---

**Now begin:** Read the spec files, then analyze the target code specified in `$ARGUMENTS`.
