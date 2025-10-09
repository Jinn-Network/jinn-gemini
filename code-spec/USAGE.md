# Code Spec Review - Quick Start Guide

## Setup (One Time)

Install the pre-commit hook to automatically check your code:

```bash
yarn setup:hooks
```

This creates a git hook that runs before every commit to check your staged TypeScript files against the code spec.

**⏱️ Important:** Each review takes 30-120 seconds. The pre-commit hook will pause your commit while the review runs. If you need to commit quickly, you can use `git commit --no-verify` (but please review your code manually later).

## Daily Usage

### Automatic (Recommended)

Once hooks are installed, violations are caught automatically:

```bash
# Your normal workflow
git add worker/mech_worker.ts
git commit -m "fix: update error handling"

# If violations are found:
# ❌ Code spec violations found!
# [violations listed here]
#
# To fix: Address the violations listed above
# To skip this check: git commit --no-verify
```

**⚡ Quick tip:** Use `wip:` prefix for work-in-progress commits to skip review:

```bash
# WIP commits skip the review automatically (fast)
git commit -m "wip: trying new approach"

# When ready, create a proper commit (with review)
git commit -m "feat: implement new error handling pattern"
```

### Manual Check Before Commit

Check your staged changes manually:

```bash
yarn lint:spec
```

### Check Specific Files

```bash
# Single file
./scripts/review-code-spec.sh worker/mech_worker.ts

# Directory
./scripts/review-code-spec.sh worker/

# All worker files
yarn lint:spec:all
```

## Understanding Violations

When violations are found, you'll see:

1. **File and line number** - Where the violation occurs
2. **Issue description** - What's wrong
3. **Current code** - The problematic code
4. **Suggested fix** - How to fix it
5. **Pattern reference** - Link to the canonical pattern

## Bypassing the Check

There are two ways to skip code spec review:

### 1. WIP Commits (Recommended for work-in-progress)

```bash
# Use 'wip:' prefix - fast, no review
git commit -m "wip: trying new approach"
git commit -m "WIP: debugging issue"
```

**When to use:**
- Experimenting with code
- Saving progress before switching tasks
- Want to commit quickly without waiting for review

**Note:** Clean up WIP commits before pushing or squash them into proper commits.

### 2. No-Verify Flag (Use sparingly)

```bash
# Example: Third-party library requires non-canonical pattern
git commit --no-verify -m "fix: legacy adapter (see PR for exception)"
```

**When to use:**
- Code has legitimate exceptions to the pattern
- Third-party library constraints
- Emergency hotfix situations

**Always document exceptions in your PR!**

## Authentication

The scripts use your local Claude Code authentication:
- ✅ No extra API costs
- ✅ Uses your Claude subscription
- ✅ Runs entirely on your machine

## Troubleshooting

### "command not found: claude"

Make sure Claude Code is installed and in your PATH:

```bash
claude --version
```

If not installed, see: https://docs.claude.com/en/docs/claude-code/setup

### Hook not running

Verify the hook is installed:

```bash
ls -la .git/hooks/pre-commit
```

If missing, run `yarn setup:hooks` again.

### Script times out

Code spec reviews typically take **30-120 seconds** depending on:
- Number of spec files to read (currently 5 files, ~700 lines)
- Size of target file(s)
- Complexity of analysis required

**Normal timing:**
- Small file (< 200 lines): 30-60 seconds
- Medium file (200-500 lines): 60-120 seconds
- Large file or directory: 120-180 seconds (3 minutes)

**If it times out:**
```bash
# Increase timeout (default is 300 seconds / 5 minutes)
TIMEOUT=600 ./scripts/review-code-spec.sh worker/large_file.ts

# Or use yarn with timeout
TIMEOUT=600 yarn lint:spec
```

**Why does it take this long?**
Claude must:
1. Read and understand 5 spec/example files (~700 lines)
2. Analyze your target code
3. Find violations with exact line numbers
4. Generate detailed fixes for each violation

This thoroughness is what makes the review valuable!

## Pattern Reference

See [patterns/error-handling-logging.md](./patterns/error-handling-logging.md) for the full canonical error handling pattern.
