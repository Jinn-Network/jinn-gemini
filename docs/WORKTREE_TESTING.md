# Worktree Testing Guide

This guide explains how to use git worktrees with the Jinn worker for isolated testing of code changes.

## Overview

Git worktrees allow you to check out multiple branches simultaneously in separate directories. This is useful for testing worker changes without affecting your main development environment.

## Worktree Setup Scripts

There are two setup scripts available:

### 1. `setup-worktree.sh` (Recommended for worker testing)

**Use this when:** You want to quickly test worker functionality in an isolated worktree.

**What it does:**
- ✓ Validates prerequisites (Node 22+, yarn, git)
- ✓ Copies environment files (`.env`, `.env.test`)
- ✓ **Copies `.operate` directory** (mech credentials - REQUIRED for worker)
- ✓ Checks infrastructure (Ponder, Control API)
- ✓ Auto-starts Control API if not running
- ✓ Installs dependencies and builds project
- ✓ Fast setup (~30-60 seconds)

**What it skips:**
- ✗ Test fixtures (`tests-next/fixtures/*`)
- ✗ Integration smoke tests
- ✗ Python/Poetry validation (auto-installs on first use)

### 2. `conductor-setup.sh` (Full development setup)

**Use this when:** You need to run the complete test suite or need test fixtures.

**What it does:**
- Everything in minimal setup, PLUS:
- ✓ Copies git template test fixture
- ✓ Populates operate profile test fixture
- ✓ Runs full integration smoke test (Ponder + Control API)
- ✓ Validates Python/Poetry setup
- Slower setup (~2-5 minutes)

## Quick Start

### 1. Create a Worktree

```bash
# From main repo root
git worktree add .conductor/my-feature-test feature-branch

# Or create a new branch
git worktree add .conductor/new-feature-test -b new-feature
```

### 2. Run Setup Script

```bash
cd .conductor/my-feature-test

# For worker testing (fast)
./setup-worktree.sh

# For full test suite
./conductor-setup.sh
```

### 3. Run the Worker

```bash
# Start worker (polls for requests continuously)
yarn mech

# Or single-job mode for testing
yarn mech --single
```

## Prerequisites

Before running the setup script, ensure your **main repository** has:

1. **`.operate` directory** at `olas-operate-middleware/.operate`
   - Contains service configuration and private keys
   - Required for worker to identify mech and sign transactions
   - Set up once in main repo, then copied to worktrees

2. **`.env` and `.env.test` files** at repo root
   - Contain environment variables for services
   - Copied from main repo to worktrees

3. **Infrastructure running** (or setup script will start it):
   - Ponder indexer: `yarn dev:ponder`
   - Control API: auto-started by setup script if needed

## How It Works

### Worktree Detection

The setup scripts automatically detect if you're in a worktree by checking if `.git` is a file (containing `gitdir:` reference) instead of a directory.

```bash
# In worktree, .git is a file:
$ cat .git
gitdir: /path/to/main/repo/.git/worktrees/my-feature-test

# Script parses this to find main repo and copy files
```

### Operate Profile Copying

The `.operate` directory is critical because it contains:

- **Service config** (`services/{hash}/config.json`):
  - Mech address the worker serves
  - Safe multisig address
  - Chain configuration

- **Private keys** (`keys/{agent-address}`):
  - Agent EOA private key for signing transactions

Without this, the worker cannot:
- Identify which mech to listen to
- Sign delivery transactions
- Know which Safe to use

### Environment Variables

The script sets `CODE_METADATA_REPO_ROOT` by detecting the worktree, allowing git operations to work correctly.

## Common Workflows

### Testing a Bug Fix

```bash
# 1. Create worktree for bug fix
git worktree add .conductor/bug-fix-123 -b fix/issue-123

# 2. Setup and test
cd .conductor/bug-fix-123
./setup-worktree.sh
yarn mech --single

# 3. Verify fix works, then merge
cd ../../  # back to main repo
git merge fix/issue-123

# 4. Clean up worktree
git worktree remove .conductor/bug-fix-123
```

### Testing Multiple Versions

```bash
# Create worktrees for different branches
git worktree add .conductor/version-a feature-a
git worktree add .conductor/version-b feature-b

# Setup both
cd .conductor/version-a && ./setup-worktree.sh
cd ../version-b && ./setup-worktree.sh

# Test each independently
cd version-a && yarn mech --single
cd ../version-b && yarn mech --single
```

### Testing with Different Configs

```bash
# Create worktree
git worktree add .conductor/config-test

# Setup
cd .conductor/config-test
./setup-worktree.sh

# Modify .env for testing
echo "SOME_TEST_VAR=value" >> .env

# Test with modified config
yarn mech --single
```

## Troubleshooting

### "Operate profile not found"

```
❌ ERROR: .operate directory not found at /path/to/main/repo/olas-operate-middleware/.operate
```

**Solution:** Run the setup in your main repository first to create the `.operate` directory with service credentials.

### "Control API not running"

The setup script will attempt to auto-start Control API. If it fails:

```bash
# Start manually
yarn dev:control-api

# Then re-run setup
./setup-worktree.sh
```

### "Ponder not detected"

The worker needs Ponder to query for requests:

```bash
# Start Ponder
yarn dev:ponder

# Worker will connect automatically
yarn mech
```

### Node modules or build issues

```bash
# Clean and rebuild
rm -rf node_modules dist
yarn install
yarn build
```

## Cleanup

Remove worktrees when done:

```bash
# From main repo
git worktree remove .conductor/my-feature-test

# Or force remove if there are changes
git worktree remove --force .conductor/my-feature-test
```

## Performance Comparison

| Script | Time | Test Fixtures | Integration Test | Best For |
|--------|------|---------------|------------------|----------|
| `setup-worktree.sh` | ~30-60s | No | No | Worker testing |
| `conductor-setup.sh` | ~2-5min | Yes | Yes | Full test suite |

## Related Documentation

- [Worker Documentation](../AGENT_README_TEST.md)
- [Testing Guide](../tests-next/README.md)
- [Git Worktrees](https://git-scm.com/docs/git-worktree)
