# Manual Test: CodeSpec Autofix Workflow

## Purpose
This document provides step-by-step instructions for manually testing the complete CodeSpec autofix workflow, from violation detection through PR creation.

## Prerequisites

- [ ] Claude Code CLI installed (`claude --version` works)
- [ ] Git repository with remote configured
- [ ] GitHub CLI installed (`gh --version` works)
- [ ] Repository has tests that can be run (`yarn test`)
- [ ] Clean working directory (`git status` shows no uncommitted changes)

## Test Environment Setup

### 1. Create a Test Violation

```bash
# Create a test file with a deliberate security violation (obj3)
cat > test-violation-sample.ts << 'EOF'
// This file contains deliberate violations for testing the autofix workflow

// VIOLATION: Hardcoded API key (obj3 - Minimize Harm, r1 - Never Commit Secrets)
const API_KEY = "sk_test_4eC39HqLyjWDarjtT1zdp7dc";

export async function fetchData() {
  const response = await fetch("https://api.example.com/data", {
    headers: {
      Authorization: `Bearer ${API_KEY}`
    }
  });
  return response.json();
}

// VIOLATION: Inconsistent error handling (obj1 - Orthodoxy)
export function processData(data: any) {
  try {
    return data.map((item: any) => item.value);
  } catch (e) {
    return null; // Silent failure, not following established error patterns
  }
}
EOF

git add test-violation-sample.ts
git commit -m "test: add sample file with violations for testing autofix"
```

## Workflow Test Steps

### Phase 1: Detection

**Step 1.1: Run Full Detection**
```bash
# Run detection on the test file
./codespec/scripts/detect-violations.sh test-violation-sample.ts
```

**Expected Output:**
- Script runs all three objective reviews in parallel (obj1, obj2, obj3)
- Finds 2+ violations (hardcoded secret, inconsistent error handling)
- Outputs violation details with severity and clauses
- Updates `.codespec/ledger.jsonl`

**Verification:**
```bash
# Check ledger was created/updated
cat .codespec/ledger.jsonl | jq .

# Count violations
cat .codespec/ledger.jsonl | wc -l
```

**Expected:**
- At least 2 violations logged
- Each has: `id`, `clauses[]`, `severity`, `path`, `line`, `fingerprint`, `status: "open"`

---

**Step 1.2: Run Individual Objective Review**
```bash
# Test security review only
./codespec/scripts/review-obj3.sh test-violation-sample.ts
```

**Expected Output:**
- Faster execution (only one review)
- Finds security violation (hardcoded API key)
- JSON output includes violation details

---

### Phase 2: Ledger Inspection

**Step 2.1: List All Violations**
```bash
# View all violations in a readable format
cat .codespec/ledger.jsonl | jq -r '.id + " | " + .severity + " | " + .title + " | " + (.clauses | join(","))'
```

**Expected:**
- Formatted list of violations with IDs (e.g., `V-9c2f1a`)
- Each shows severity and associated clauses

**Step 2.2: Identify Target Violation**
```bash
# Pick the first open violation for autofix testing
VIOLATION_ID=$(cat .codespec/ledger.jsonl | jq -r 'select(.status == "open") | .id' | head -1)
echo "Testing autofix with: $VIOLATION_ID"
```

---

### Phase 3: Autofix - Dry Run

**Step 3.1: Run Dry Run Autofix**
```bash
# Run autofix in dry-run mode (generates prompt but doesn't execute)
yarn tsx codespec/scripts/autofix-violation.ts $VIOLATION_ID --dry-run
```

**Expected Output:**
```
🔧 Starting autofix workflow for V-xxxxxx...

📋 Violation: Hardcoded API key in authentication
📁 File: test-violation-sample.ts:4
🏷️  Clauses: r1, obj3

🌳 Creating worktree...
✅ Worktree created: .worktrees/fix-V-xxxxxx
   Branch: fix/codespec/r1+obj3/hardcoded-api-key

📝 Generating fix prompt...
✅ Prompt saved to: .worktrees/fix-V-xxxxxx/.codespec-autofix-prompt.md

🔍 Dry run mode - stopping here.
   Review the prompt at: .worktrees/fix-V-xxxxxx/.codespec-autofix-prompt.md
   To continue, run Claude Code in the worktree:
   cd .worktrees/fix-V-xxxxxx
   claude -p "$(cat .codespec-autofix-prompt.md)"
```

**Verification:**
```bash
# Check worktree was created
ls -la .worktrees/

# Check prompt was generated
cat .worktrees/fix-${VIOLATION_ID}/.codespec-autofix-prompt.md
```

**Expected in Prompt:**
- Clear description of the violation
- Reference to relevant spec sections (obj3, r1 examples)
- Context about the code location
- Instructions to fix without breaking tests
- List of files that can be edited

---

**Step 3.2: Review Ledger Status Update**
```bash
# Check violation status changed to in_progress
cat .codespec/ledger.jsonl | jq "select(.id == \"$VIOLATION_ID\")"
```

**Expected:**
- `status: "in_progress"`
- `worktree_branch` set to the branch name

---

### Phase 4: Autofix - Full Run

**Step 4.1: Clean Up Dry Run**
```bash
# Remove the dry-run worktree to test full flow
git worktree remove .worktrees/fix-${VIOLATION_ID}
git branch -D fix/codespec/r1+obj3/hardcoded-api-key  # or whatever branch name was created

# Reset violation status in ledger to "open" (edit the JSONL file manually or use a script)
```

**Step 4.2: Run Full Autofix**
```bash
# Run autofix without --dry-run
yarn tsx codespec/scripts/autofix-violation.ts $VIOLATION_ID
```

**Expected Output:**
```
🔧 Starting autofix workflow for V-xxxxxx...

📋 Violation: [details]
📁 File: test-violation-sample.ts:4
🏷️  Clauses: r1, obj3

🌳 Creating worktree...
✅ Worktree created: .worktrees/fix-V-xxxxxx
   Branch: fix/codespec/r1+obj3/hardcoded-api-key

📝 Generating fix prompt...
✅ Prompt saved to: .worktrees/fix-V-xxxxxx/.codespec-autofix-prompt.md

🤖 Invoking Claude Code for autofix...
   This may take 1-3 minutes depending on the complexity...

[Claude Code output showing file edits]

✅ Autofix completed

🔍 Verifying fix...
   Running review on test-violation-sample.ts...
   ✅ Review passed
   Running tests...
   ✅ Tests passed
✅ Verification passed!

💾 Committing changes...
✅ Changes committed

📤 Pushing to remote...
✅ Pushed to remote

📬 Creating pull request...
✅ PR created: https://github.com/owner/repo/pull/123

🎉 Autofix workflow complete!
   PR: https://github.com/owner/repo/pull/123
   Next: Review and merge the PR
```

**If Verification Fails:**
```
🔍 Verifying fix...
   Running review on test-violation-sample.ts...
   ❌ Review still finds violations
   Worktree left open for manual fix: .worktrees/fix-V-xxxxxx
```

---

### Phase 5: Manual Inspection

**Step 5.1: Inspect Worktree Changes**
```bash
# Navigate to worktree
cd .worktrees/fix-${VIOLATION_ID}

# Check git status
git status

# View the diff
git diff main

# View the specific file
cat test-violation-sample.ts
```

**Expected:**
- Hardcoded API key replaced with environment variable
- Proper validation added for environment variable
- Error handling follows established patterns
- Comments added explaining the fix

---

**Step 5.2: Review Commit**
```bash
# View commit in worktree
git log -1 --stat
```

**Expected Commit Message:**
```
fix(codespec): Hardcoded API key in authentication

Fixes V-xxxxxx
Clauses: r1, obj3

🤖 Generated with CodeSpec Autofix
```

---

**Step 5.3: Inspect Pull Request**
```bash
# View PR in browser
gh pr view --web

# Or view PR details in terminal
gh pr view
```

**Expected PR Details:**
- **Title:** `fix(codespec): Hardcoded API key in authentication`
- **Body includes:**
  - Violation ID and clauses
  - Before/after code snippets
  - Verification results (review passed, tests passed)
  - Link to CodeSpec documentation
- **Labels:** `codespec-r1`, `codespec-obj3`

---

### Phase 6: Verification After Merge

**Step 6.1: Re-run Detection on Main**
```bash
# After merging PR, checkout main and pull
git checkout main
git pull

# Run detection again
./codespec/scripts/detect-violations.sh test-violation-sample.ts
```

**Expected:**
- No violations found (exit code 0)
- Or significantly fewer violations

---

**Step 6.2: Check Ledger Status**
```bash
# View the fixed violation in ledger
cat .codespec/ledger.jsonl | jq "select(.id == \"$VIOLATION_ID\")"
```

**Expected:**
- `status: "merged"` (updated after PR merge)
- `pr_url` present

---

## Edge Cases to Test

### Test Case 1: Violation Already Has Worktree
```bash
# Try to run autofix on same violation twice
yarn tsx codespec/scripts/autofix-violation.ts $VIOLATION_ID
```

**Expected:**
```
⚠️  Worktree already exists for V-xxxxxx
   Path: .worktrees/fix-V-xxxxxx
   Remove it first or continue working in the existing worktree.
```

---

### Test Case 2: Violation Not Found
```bash
# Try with fake violation ID
yarn tsx codespec/scripts/autofix-violation.ts V-999999
```

**Expected:**
```
❌ Violation V-999999 not found in ledger
```

---

### Test Case 3: Tests Fail After Fix
```bash
# Manually break a test before running autofix
# Then observe that autofix leaves worktree open when tests fail
```

**Expected:**
```
🔍 Verifying fix...
   Running review on test-violation-sample.ts...
   ✅ Review passed
   Running tests...
   ❌ Tests failed
   Worktree left open for manual fix: .worktrees/fix-V-xxxxxx
```

---

### Test Case 4: Multiple Violations in Same File
```bash
# Run detection to get multiple violations
./codespec/scripts/detect-violations.sh test-violation-sample.ts

# Autofix them one at a time
VIOLATION_1=$(cat .codespec/ledger.jsonl | jq -r 'select(.status == "open") | .id' | head -1)
VIOLATION_2=$(cat .codespec/ledger.jsonl | jq -r 'select(.status == "open") | .id' | tail -1)

yarn tsx codespec/scripts/autofix-violation.ts $VIOLATION_1
# Wait for completion, merge PR

yarn tsx codespec/scripts/autofix-violation.ts $VIOLATION_2
# Second fix should account for changes from first fix
```

---

## Cleanup

```bash
# Remove test file
git checkout main
rm test-violation-sample.ts
git add test-violation-sample.ts
git commit -m "test: remove autofix test file"
git push

# Clean up worktrees (if any left over)
git worktree list
git worktree prune

# Optional: Clear ledger for clean slate
rm .codespec/ledger.jsonl
```

---

## Success Criteria

✅ **Detection Phase:**
- [ ] Violations detected and logged to ledger
- [ ] Fingerprints are stable across multiple runs
- [ ] Clauses correctly identified

✅ **Autofix Phase:**
- [ ] Worktree created in isolated location
- [ ] Branch name follows convention
- [ ] Prompt generated with complete context
- [ ] Claude Code successfully applies fix
- [ ] Changes committed with proper message

✅ **Verification Phase:**
- [ ] CodeSpec review passes after fix
- [ ] Tests pass after fix
- [ ] Worktree left open if verification fails

✅ **PR Phase:**
- [ ] PR created with correct title and body
- [ ] PR includes violation context
- [ ] PR can be reviewed and merged

✅ **Ledger Phase:**
- [ ] Status transitions tracked correctly (open → in_progress → pr_open → merged)
- [ ] Worktree branch and PR URL recorded
- [ ] Fingerprints remain stable

---

## Troubleshooting

**Problem:** Claude CLI not found
```bash
# Install Claude Code
# See: https://docs.claude.com/en/docs/claude-code/setup
```

**Problem:** Detection script hangs
```bash
# Set shorter timeout
TIMEOUT=60 ./codespec/scripts/detect-violations.sh test-violation-sample.ts
```

**Problem:** PR creation fails
```bash
# Ensure gh CLI is authenticated
gh auth status
gh auth login
```

**Problem:** Worktree conflicts
```bash
# List and remove stale worktrees
git worktree list
git worktree remove .worktrees/fix-V-xxxxxx --force
git worktree prune
```

---

## Notes

- This workflow assumes the CodeSpec infrastructure is fully set up
- Each autofix takes 1-5 minutes depending on complexity
- Multiple autofixes can run in parallel (separate worktrees)
- The ledger is append-only; old violations remain for audit trail
- Suppressions can be added to `.codespec/suppressions.yml` for known false positives
