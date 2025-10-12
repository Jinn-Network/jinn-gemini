---
argument-hint: [file-path] or [directory] or --diff
description: Review code against all Code Spec objectives (orchestrator)
allowed-tools: Bash(/review-obj1:*, /review-obj2:*, /review-obj3:*, SlashCommand), Read
---

# Code Spec Review (Orchestrator)

You are orchestrating a comprehensive code review across all three Code Spec objectives.

This command runs three specialized reviews in sequence and aggregates the results:
- **obj1:** Orthodoxy (pattern consistency)
- **obj2:** Code for the Next Agent (discoverability)
- **obj3:** Minimize Harm (security)

## Your Task

### Step 1: Read the Specification Overview

**Read** `docs/spec/code-spec/spec.md` to understand the three objectives at a high level.

### Step 2: Identify Target

Parse `$ARGUMENTS` to determine what to review:
- `--diff` → staged changes (or unstaged if none staged)
- File path → specific file
- Directory → all `.ts` files in directory
- Empty → default to `worker/` directory

### Step 3: Run All Three Objective Reviews

Execute the three specialized reviews **in sequence** (not parallel, to preserve output order):

1. **Security Review (obj3) - Highest Priority**
   ```bash
   /review-obj3 $ARGUMENTS
   ```
   Reviews for: hardcoded secrets, SQL injection, fail-open patterns, missing validation

2. **Orthodoxy Review (obj1)**
   ```bash
   /review-obj1 $ARGUMENTS
   ```
   Reviews for: multiple approaches to same problem, pattern inconsistencies

3. **Discoverability Review (obj2)**
   ```bash
   /review-obj2 $ARGUMENTS
   ```
   Reviews for: implicit code, magic globals, poor naming, clever one-liners

### Step 4: Aggregate Results

Collect the output from all three reviews and combine into a unified report.

### Step 5: Format Unified Output

```markdown
# Code Spec Review: Complete Analysis

**Target:** [file/directory/diff]
**Objectives analyzed:** obj1 (Orthodoxy), obj2 (Discoverability), obj3 (Security)

---

## Executive Summary

| Objective | Violations | Severity | Status |
|-----------|-----------|----------|--------|
| **obj3: Security** | [count] | 🔴 Critical | [Pass/Fail] |
| **obj1: Orthodoxy** | [count] | 🟡 Warning | [Pass/Fail] |
| **obj2: Discoverability** | [count] | 🟢 Info | [Pass/Fail] |
| **Total** | [count] | - | [Pass/Fail] |

---

## 🔴 [obj3] Security Violations (Highest Priority)

[Include all obj3 violations from /review-obj3 output]

**If no violations:**
✅ No security violations detected.

---

## 🟡 [obj1] Orthodoxy Violations

[Include all obj1 violations from /review-obj1 output]

**If no violations:**
✅ No orthodoxy violations detected. Code follows consistent patterns.

---

## 🟢 [obj2] Discoverability Violations

[Include all obj2 violations from /review-obj2 output]

**If no violations:**
✅ No discoverability violations detected. Code is explicit and AI-friendly.

---

## Action Items

### Immediate (Required for Commit):
- [ ] Fix all 🔴 Critical security violations (obj3)
- [ ] Verify no hardcoded secrets
- [ ] Ensure input validation exists

### Before Merge (Recommended):
- [ ] Address 🟡 orthodoxy violations (obj1)
- [ ] Migrate to canonical patterns
- [ ] Update documentation if new patterns needed

### Refactoring (Optional):
- [ ] Improve 🟢 discoverability (obj2)
- [ ] Make implicit code explicit
- [ ] Add descriptive names and error messages

---

## Resources

📚 **Documentation:**
- Full specification: `docs/spec/code-spec/spec.md`
- Usage guide: `docs/spec/code-spec/USAGE.md`
- Known violations: `docs/spec/code-spec/VIOLATIONS.md`

📖 **Examples:**
- obj1 examples: `docs/spec/code-spec/examples/obj1.md`
- obj2 examples: `docs/spec/code-spec/examples/obj2.md`
- obj3 examples: `docs/spec/code-spec/examples/obj3.md`

🔧 **Individual Reviews:**
- Run security only: `/review-obj3 $ARGUMENTS`
- Run orthodoxy only: `/review-obj1 $ARGUMENTS`
- Run discoverability only: `/review-obj2 $ARGUMENTS`

---

**Review completed.** Use individual objective commands for focused analysis.
```

## Important Notes

- **Run reviews in sequence** (obj3 → obj1 → obj2) to prioritize security
- **Preserve all violation details** from individual reviews
- **Aggregate counts** for summary table
- **Clear severity indicators**: 🔴 Critical (obj3), 🟡 Warning (obj1), 🟢 Info (obj2)
- **Actionable next steps** organized by urgency

## Example Usage

```bash
# Review staged changes (pre-commit)
/review-code-spec --diff

# Review specific file
/review-code-spec worker/config.ts

# Review all worker files
/review-code-spec worker/

# Review entire codebase (slow)
/review-code-spec .
```

## Performance Notes

- Each objective review takes 30-120 seconds
- Total time: 2-6 minutes for --diff
- For faster feedback, run individual objectives:
  - `/review-obj3 --diff` for pre-commit security check (fastest)
  - `/review-obj1 file.ts` for pattern consistency
  - `/review-obj2 file.ts` for code clarity

---

**Now begin:** Run the three specialized reviews and aggregate results into unified report.
