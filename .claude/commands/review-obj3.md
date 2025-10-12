---
argument-hint: [file-path] or [directory] or --diff
description: Review code for security violations (obj3 - Minimize Harm)
allowed-tools: Read, Glob, Grep, Bash(git diff:*)
---

# Code Spec Review: obj3 - Minimize Harm (Security)

You are reviewing code specifically for **security violations** against the "Minimize Harm" objective.

## Your Task

### Step 1: Read the Specification

Read these files to understand security requirements:

1. **Read** `docs/spec/code-spec/spec.md` - Focus on obj3: Minimize Harm
2. **Read** `docs/spec/code-spec/examples/obj3.md` - Security violation examples

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

### Step 3: Search for Security Violations

Use Grep and Read tools to find these patterns:

#### 🔴 Priority 1: Critical Security Vulnerabilities

**1. Hardcoded Secrets**
- **Pattern:** `API_KEY\s*=\s*['"]`, `SECRET\s*=\s*['"]`, `PASSWORD\s*=\s*['"]`, `TOKEN\s*=\s*['"]`
- **Pattern:** String literals starting with `sk-`, `Bearer `, `ghp_`, `gho_`
- **Violation:** Credentials committed to repository
- **Search:**
  ```bash
  # Use Grep to find potential secrets
  grep -E "(API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)\s*=\s*['\"]" --include="*.ts"
  grep -E "(sk-|Bearer |ghp_|gho_)[a-zA-Z0-9]+" --include="*.ts"
  ```

**2. SQL Injection Risk**
- **Pattern:** Template literals or string concatenation in database queries
- **Pattern:** `` `INSERT|UPDATE|DELETE|SELECT.*\${.*}` ``
- **Violation:** User input in SQL without parameterization
- **Search:**
  ```bash
  # Look for template literals in query contexts
  grep -E "(query|execute|sql).*\`.*\$\{" --include="*.ts"
  grep -E "INSERT|UPDATE|DELETE.*\+.*\+" --include="*.ts"
  ```

**3. Unsafe Code Execution**
- **Pattern:** `eval(`, `Function(`, `new Function(`
- **Pattern:** `require(.*process.env|require(.*userInput`
- **Violation:** Code injection vulnerability
- **Search:**
  ```bash
  grep -E "\beval\(|new Function\(" --include="*.ts"
  grep -E "require\(.*(process\.env|input|req\.)" --include="*.ts"
  ```

#### 🟡 Priority 2: Security Anti-patterns

**4. Fail-Open Patterns**
- **Pattern:** Catch blocks that `return true` in auth/permission functions
- **Pattern:** Error handling that grants access on failure
- **Violation:** Errors should fail securely (deny access)
- **Analysis Required:** Read catch blocks in functions with names like `check`, `verify`, `auth`, `permission`
- **Search:**
  ```bash
  # Find catch blocks that might fail open
  grep -B5 "return true" --include="*.ts" | grep -E "catch|permission|auth|check"
  ```

**5. Missing Input Validation**
- **Pattern:** Functions accepting external input without Zod validation
- **Pattern:** Direct access to `req.body`, `req.params`, `req.query` without `.safeParse()`
- **Violation:** Untrusted input not validated
- **Search:**
  ```bash
  # Look for request handlers without validation
  grep -E "(req\.body|req\.params|req\.query)" --include="*.ts"
  # Check if Zod validation exists nearby
  ```

**6. Logging Sensitive Data**
- **Pattern:** Logger calls with sensitive field names
- **Pattern:** `logger.*(password|apiKey|secret|token|ssn|creditCard|private)`
- **Violation:** PII or credentials in logs
- **Search:**
  ```bash
  grep -iE "logger\.(info|error|warn|debug).*\b(password|api_?key|secret|token|ssn|credit)" --include="*.ts"
  ```

### Step 4: Analyze Each Violation

For each potential violation found:

1. **Read the file** to get full context
2. **Determine severity:**
   - 🔴 **Critical:** Hardcoded secrets, SQL injection, code injection
   - 🟡 **High:** Fail-open, missing validation
   - 🟢 **Medium:** Sensitive logging, minor security issues

3. **Verify it's a real violation** (not a false positive):
   - Is it in test code? (Lower severity)
   - Is it in a comment/string literal? (Not executable)
   - Is there compensating security control?

### Step 5: Format Output

For each violation, use this format:

```markdown
### 🔴 [obj3] `<file-path>:<line-number>`

**Violation:** [Brief description]
**Severity:** 🔴 Critical | 🟡 High | 🟢 Medium
**Pattern:** [Which security pattern was violated]

**Current code:**
```typescript
[Show the violating code snippet]
```

**Security Risk:**
[Explain the specific security risk - SQL injection, credential leak, etc.]

**Suggested fix:**
```typescript
[Show the secure version with proper validation/parameterization]
```

**Reference:** `docs/spec/code-spec/spec.md` (obj3: Minimize Harm)
```

### Step 6: Provide Summary

At the end:

```markdown
## [obj3] Security Review Summary

**Files analyzed:** [count]
**Total violations found:** [count]

### By Severity:
- 🔴 Critical: [count] (immediate action required)
- 🟡 High: [count] (fix before merge)
- 🟢 Medium: [count] (address in refactoring)

### By Type:
- Hardcoded secrets: [count]
- SQL injection risks: [count]
- Fail-open patterns: [count]
- Missing input validation: [count]
- Sensitive data logging: [count]
- Unsafe code execution: [count]

### Action Required:
1. 🔴 **Critical violations MUST be fixed before commit**
2. 🟡 High severity violations should be fixed before merge
3. 🟢 Medium severity violations should be addressed in next refactor

### Next Steps:
- Review each violation above
- Apply suggested fixes
- Re-run `/review-obj3 --diff` to verify fixes
- Never commit secrets (use environment variables)
- Always validate external input (use Zod schemas)
- Always fail securely (deny on error, not grant)

📚 **Full documentation:** `docs/spec/code-spec/USAGE.md`
📖 **Security examples:** `docs/spec/code-spec/examples/obj3.md`
```

## Detection Strategy

### Phase 1: High-Confidence Pattern Search
Use Grep to find obvious security issues:
1. Hardcoded credentials (regex patterns)
2. SQL injection patterns (template literals in queries)
3. Unsafe eval/Function usage

### Phase 2: Contextual Analysis
Read files to understand context:
1. Fail-open patterns (requires understanding function purpose)
2. Missing validation (check if Zod is used)
3. Sensitive logging (requires knowing what's sensitive)

### Phase 3: Verification
For each finding:
1. Read surrounding code for context
2. Verify it's not a test fixture or mock data
3. Confirm the security impact
4. Suggest specific remediation

## Important Notes

- **Be precise:** Include exact file:line for each violation
- **Be security-focused:** Explain the risk, not just the pattern
- **Prioritize by severity:** Critical issues first
- **Provide fixes:** Show secure alternative, not just description
- **Reduce false positives:** Verify context before flagging

## Security Principles (from obj3)

1. **Validate All External Input** - Never trust user data
2. **Never Commit Secrets** - Use environment variables
3. **Fail Closed, Not Open** - Deny access on error
4. **Principle of Least Privilege** - Minimum necessary permissions
5. **Defense in Depth** - Multiple layers of security

## Example Usage

```bash
# Review staged changes for security issues (pre-commit)
/review-obj3 --diff

# Review specific file
/review-obj3 worker/mech_worker.ts

# Review all worker files for security
/review-obj3 worker/

# Review all TypeScript files in project
/review-obj3 .
```

---

**Now begin:** Read the obj3 spec, search for security patterns, analyze violations, and report findings.
