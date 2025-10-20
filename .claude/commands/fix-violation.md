---
argument-hint: <violation-id>
description: Fix a code spec violation from the ledger
---

# Fix Violation Command

You are fixing a specific code spec violation tracked in the violations ledger.

## Context Notes

**When run via fix-violation.sh:**
This command executes in an isolated git worktree at `.worktrees/fix-<violation-id>/`.
Your commits will be on branch `codespec/fix-<violation-id>`, not on the current branch.
After successful completion, a PR will be created automatically targeting the original branch.

**When run directly (not in worktree):**
This command runs in your current working directory and commits directly to your current branch.
Use this mode for manual fixes or when testing the command interactively.

## Your Task

### Step 1: Look Up the Violation

Run this command to get the violation details:

```bash
yarn tsx codespec/lib/ledger-cli.ts get $ARGUMENTS --json
```

Parse the JSON output to extract:
- `id` - Violation ID
- `clauses` - Which spec objectives/rules are violated (e.g., ["obj3"])
- `severity` - How critical is this (critical, high, medium, low, info)
- `path` - File containing the violation
- `line` - Line number where violation occurs
- `title` - Short description
- `description` - Full description of the violation
- `suggested_fix` - Suggested code fix
- `status` - Current status (should be 'open' or 'in_progress')

**If the violation is not found:**
- Inform the user that the violation doesn't exist
- Suggest they run `yarn tsx codespec/lib/ledger-cli.ts get --help` for usage
- **DO NOT proceed with fixing or committing** - exit immediately

### Step 2: Update Status to In Progress

Before starting the fix, mark the violation as 'in_progress':

```bash
yarn tsx codespec/lib/ledger-cli.ts update $ARGUMENTS in_progress
```

### Step 3: Gather Context

Read these files to understand what you're fixing:

1. **Read the Code Spec** - `docs/spec/code-spec/spec.md`
   - Focus on the section for the violated clause(s)
   - Example: If `clauses` contains "obj3", read the "obj3: Minimize Harm" section

2. **Read Example Files** - For each clause in `clauses`:
   - `docs/spec/code-spec/examples/obj1.md` (if obj1 violated)
   - `docs/spec/code-spec/examples/obj2.md` (if obj2 violated)
   - `docs/spec/code-spec/examples/obj3.md` (if obj3 violated)
   - `docs/spec/code-spec/examples/r1.md` (if r1 violated)
   - `docs/spec/code-spec/examples/r2.md` (if r2 violated)
   - `docs/spec/code-spec/examples/r3.md` (if r3 violated)

3. **Read the Violating File** - Read `violation.path` to see full context
   - Don't just focus on the single line - understand the function/context
   - Identify imports, dependencies, and surrounding code

### Step 4: Apply the Fix

Use the `suggested_fix` as guidance, but apply your understanding from the spec:

**Approach A: Direct Replacement** (when suggested_fix is literal code)
- Use the Edit tool to replace the violating code with `suggested_fix`
- Match the exact indentation and formatting

**Approach B: Conceptual Fix** (when suggested_fix is a description)
- Reason about the correct fix based on:
  - The violated clause (obj1/obj2/obj3/r1/r2/r3)
  - The canonical pattern from examples
  - The context in the file
- Apply the fix that best satisfies the spec

**Important:**
- Preserve existing functionality - don't break working code
- Match the coding style of the file
- Consider side effects and dependencies
- Add imports if needed (e.g., importing logger for structured logging)

### Step 5: Verify the Fix

After applying the fix:

1. **Run the relevant review** to confirm violation is gone:
   ```bash
   # If obj1 was violated
   ./codespec/scripts/review-obj1.sh <file-path>

   # If obj2 was violated
   ./codespec/scripts/review-obj2.sh <file-path>

   # If obj3 was violated
   ./codespec/scripts/review-obj3.sh <file-path>
   ```

2. **Run tests (MANDATORY - do not skip):**
   ```bash
   yarn test:worker
   ```

   **Important:** This step is mandatory. Do not proceed to Step 6 until tests pass.

3. **If tests fail:**
   - Review the error output
   - Consider if the fix introduced a bug
   - May need to adjust the fix or revert
   - If tests cannot be made to pass, update status back to 'open' and do not commit

### Step 6: Update Status Based on Results

**If the fix is successful (tests pass, review shows no violations):**

```bash
yarn tsx codespec/lib/ledger-cli.ts update $ARGUMENTS verified
```

**If the fix failed (tests failed or review still shows violations):**

```bash
yarn tsx codespec/lib/ledger-cli.ts update $ARGUMENTS open
```

### Step 7: Create a Commit (Only if Fix Succeeded)

**ONLY create a commit if:**
- ✅ The violation was found
- ✅ The fix was applied successfully
- ✅ The review shows no violations
- ✅ Tests passed (yarn test:worker)
- ✅ Status was updated to 'verified'

Create a git commit documenting the fix:

```bash
git add <modified-files>
git commit -m "fix(codespec): resolve violation $ARGUMENTS

<clause>: <description-of-violation>

Fixed by: <description-of-fix>

Violation ID: $ARGUMENTS
"
```

Example commit message:
```
fix(codespec): resolve violation V-d68bbf

obj3: Hardcoded API key in source code

Fixed by: Moving API key to environment variable with validation

Violation ID: V-d68bbf
```

**DO NOT commit if:**
- ❌ Violation was not found
- ❌ Fix failed to apply
- ❌ Tests failed after fix
- ❌ Review still shows violations

### Step 8: Report Results

**If successful, provide this summary:**

```
✅ Fixed violation V-d68bbf

File: <path>:<line>
Issue: <title>
Clause: <clauses>

Changes made:
- <description of fix>

Verification:
✅ Review passed (no violations detected)
✅ Tests passed (yarn test:worker)

Status: verified
Commit: <commit-hash>
```

**If the fix failed, explain why:**

```
❌ Failed to fix violation V-d68bbf

File: <path>:<line>
Issue: <title>

Reason: <why it failed>

The violation status has been reverted to 'open'.
Manual intervention may be required.
```

## Important Notes

### Deliberative Alignment
This command embodies "deliberative alignment" - you must:
1. **Read the spec before fixing** - Don't just apply suggested_fix blindly
2. **Understand the principle** - Know WHY the code violates the spec
3. **Apply the canonical pattern** - Follow established conventions from examples

### Multiple Violations at Same Location
If fixing one violation reveals or creates others:
- Fix the primary violation first
- Run full review to detect new violations
- Update the ledger with new findings
- Consider whether a broader refactor is needed

### Cannot Auto-Fix
Some violations may require human judgment:
- Architectural changes
- Security decisions (e.g., which secrets to keep)
- Breaking changes to APIs

If you cannot safely auto-fix:
1. Explain why in detail
2. Provide guidance for manual fix
3. Keep status as 'open'
4. Optionally add `owner` field for assignment

## Example Usage

```bash
# Fix a specific violation
/fix-violation V-d68bbf

# View violation details first
yarn tsx codespec/lib/ledger-cli.ts get V-d68bbf

# Fix all critical violations (batch)
cat .codespec/ledger.jsonl | grep '"severity":"critical"' | jq -r '.id' | while read id; do
  /fix-violation $id
done
```

---

**Now begin:** Look up the violation, read the spec, apply the fix, verify it works, and update the ledger.
