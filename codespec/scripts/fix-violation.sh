#!/usr/bin/env bash
set -euo pipefail

# Code Spec Violation Fix Script with Git Worktree Isolation
# Applies automated fixes to violations tracked in the ledger in isolated worktrees
# Usage:
#   ./codespec/scripts/fix-violation.sh V-d68bbf
#   ./codespec/scripts/fix-violation.sh --help

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
VIOLATION_ID="${1:-}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_BASE="$REPO_ROOT/.worktrees"
SKIP_PR_CREATION=false

# Display help
if [ "$VIOLATION_ID" = "--help" ] || [ "$VIOLATION_ID" = "-h" ] || [ -z "$VIOLATION_ID" ]; then
  echo "Usage: fix-violation.sh <violation-id>"
  echo ""
  echo "Fixes a code spec violation in an isolated git worktree."
  echo ""
  echo "Arguments:"
  echo "  <violation-id>    The violation ID to fix (e.g., V-d68bbf)"
  echo ""
  echo "Examples:"
  echo "  ./codespec/scripts/fix-violation.sh V-d68bbf"
  echo ""
  echo "Options:"
  echo "  --help, -h        Show this help message"
  echo ""
  echo "How it works:"
  echo "  1. Creates isolated git worktree at .worktrees/fix-<violation-id>/"
  echo "  2. Branches from your current branch"
  echo "  3. Sets up environment with conductor-setup.sh"
  echo "  4. Runs Claude Code /fix-violation in the worktree"
  echo "  5. Verifies fix with tests and reviews"
  echo "  6. Pushes branch and creates PR targeting your current branch"
  echo "  7. Cleans up worktree on success"
  echo ""
  echo "Safety:"
  echo "  • Your current branch is never touched"
  echo "  • Failed fixes leave worktree for manual inspection"
  echo "  • PR targets your current branch, not main"
  exit 0
fi

echo -e "${BOLD}🔧 Fixing Code Spec Violation${NC}"
echo "   Violation ID: $VIOLATION_ID"
echo ""

# ============================================================================
# Pre-flight checks
# ============================================================================

# Check if violation exists
echo "📋 Looking up violation..."
if ! yarn --silent tsx codespec/lib/ledger-cli.ts get "$VIOLATION_ID" > /dev/null 2>&1; then
  echo -e "${RED}❌ Violation not found: $VIOLATION_ID${NC}"
  echo ""
  echo "Make sure the violation ID is correct and exists in .codespec/ledger.jsonl"
  echo ""
  echo "To list all violations:"
  echo "  yarn tsx codespec/lib/ledger-cli.ts list"
  exit 1
fi

echo -e "${GREEN}✓${NC} Found violation $VIOLATION_ID"
echo ""

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
  echo -e "${RED}❌ Not on a branch (detached HEAD)${NC}"
  echo "   Please checkout a branch first:"
  echo "   git checkout <branch-name>"
  exit 1
fi

echo "📍 Current branch: ${BOLD}$CURRENT_BRANCH${NC}"
echo "   → PR will target: $CURRENT_BRANCH"
echo ""

# Warn about uncommitted changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes in the main repo${NC}"
  echo "   This won't affect the worktree, but you may want to commit or stash them."
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
  echo ""
fi

# Check GitHub CLI authentication (for PR creation)
if ! gh auth status >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠️  GitHub CLI not authenticated${NC}"
  echo "   Run: gh auth login"
  echo "   Branch will be pushed but PR creation will be skipped."
  echo ""
  SKIP_PR_CREATION=true
fi

# ============================================================================
# Worktree setup
# ============================================================================

WORKTREE_PATH="$WORKTREE_BASE/fix-${VIOLATION_ID}"
BRANCH_NAME="codespec/fix-${VIOLATION_ID}"

# Check if worktree already exists
if [ -d "$WORKTREE_PATH" ]; then
  echo -e "${YELLOW}⚠️  Worktree already exists: $WORKTREE_PATH${NC}"
  echo ""
  echo "Options:"
  echo "  1. Remove it: git worktree remove $WORKTREE_PATH"
  echo "  2. Continue working in it: cd $WORKTREE_PATH"
  echo "  3. Delete branch and worktree:"
  echo "     git worktree remove $WORKTREE_PATH --force"
  echo "     git branch -D $BRANCH_NAME"
  exit 1
fi

# Check if branch already exists
if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠️  Branch $BRANCH_NAME already exists${NC}"
  echo ""
  echo "Options:"
  echo "  1. Delete it: git branch -D $BRANCH_NAME"
  echo "  2. Use existing: git worktree add $WORKTREE_PATH $BRANCH_NAME"
  exit 1
fi

# Create worktree directory if needed
mkdir -p "$WORKTREE_BASE"

# Create worktree branching from current branch
echo "🌳 Creating worktree..."
if git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "$CURRENT_BRANCH" 2>&1 | grep -v "Preparing worktree"; then
  :
fi
echo -e "${GREEN}✅ Worktree created${NC}"
echo "   Path: $WORKTREE_PATH"
echo "   Branch: $BRANCH_NAME (based on $CURRENT_BRANCH)"
echo ""

# ============================================================================
# Environment setup
# ============================================================================

# Navigate to worktree
cd "$WORKTREE_PATH"

echo "⚙️  Setting up worktree environment..."
echo "   This may take 1-2 minutes on first run..."
echo ""

# Run conductor setup (quietly, only show errors)
if ../../conductor-setup.sh > /tmp/conductor-setup-${VIOLATION_ID}.log 2>&1; then
  echo -e "${GREEN}✅ Environment setup complete${NC}"
  echo ""
else
  echo -e "${RED}❌ Environment setup failed${NC}"
  echo "   Check log: /tmp/conductor-setup-${VIOLATION_ID}.log"
  echo ""
  echo "Cleaning up worktree..."
  cd ../..
  git worktree remove "$WORKTREE_PATH" --force
  exit 1
fi

# ============================================================================
# Update ledger status
# ============================================================================

# Update ledger from main repo (not worktree)
cd ../..
echo "📝 Updating ledger status to 'in_progress'..."
if yarn --silent tsx codespec/lib/ledger-cli.ts update "$VIOLATION_ID" in_progress \
  --worktree-branch="$BRANCH_NAME" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Ledger updated${NC}"
else
  echo -e "${YELLOW}⚠️  Warning: Failed to update ledger status${NC}"
  echo "   Continuing anyway..."
fi
echo ""

# Return to worktree
cd "$WORKTREE_PATH"

# ============================================================================
# Run fix in worktree
# ============================================================================

# Show violation details
echo "📄 Violation details:"
yarn --silent tsx ../../codespec/lib/ledger-cli.ts get "$VIOLATION_ID" 2>/dev/null || true
echo ""

echo "🤖 Running automated fix with Claude Code..."
echo "   This may take 1-5 minutes depending on complexity..."
echo ""

# Create log file
mkdir -p ../../tmp
LOG_FILE="../../tmp/fix-violation-${VIOLATION_ID}.log"
echo "📝 Logging to: $LOG_FILE"
echo ""
echo "─────────────────────────────────────────────────────────────"
echo ""

# Run Claude Code with /fix-violation command
# Use --dangerously-skip-permissions for full headless automation
# Use --output-format stream-json with --verbose to see real-time progress
# Use tee to both stream to stdout and write to log file
# IMPORTANT: cd into worktree first, then run claude from there
(cd "$WORKTREE_PATH" && claude -p "/fix-violation $VIOLATION_ID" \
  --dangerously-skip-permissions \
  --output-format stream-json \
  --verbose) 2>&1 | tee "$LOG_FILE"
if [ "${PIPESTATUS[0]}" -eq 0 ]; then
  FIX_EXIT_CODE=0
else
  FIX_EXIT_CODE=1
fi

echo ""
echo "─────────────────────────────────────────────────────────────"
echo ""

# ============================================================================
# Push branch and create PR on success
# ============================================================================

if [ $FIX_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✅ Fix completed successfully${NC}"
  echo ""

  # Push branch to remote
  echo "📤 Pushing branch to remote..."
  if git push -u origin "$BRANCH_NAME" 2>&1 | grep -v "^remote:"; then
    echo -e "${GREEN}✅ Branch pushed${NC}"
    echo ""

    # Create PR (if gh is authenticated)
    if [ "$SKIP_PR_CREATION" = false ]; then
      echo "📬 Creating pull request..."

      # Get violation details for PR body
      VIOLATION_DETAILS=$(yarn --silent tsx ../../codespec/lib/ledger-cli.ts get "$VIOLATION_ID" 2>/dev/null || echo "Unable to fetch violation details")

      # Create PR from main repo (not worktree) so gh can see both branches properly
      cd "$REPO_ROOT"

      # Create PR
      PR_OUTPUT=$(gh pr create \
        --base "$CURRENT_BRANCH" \
        --head "$BRANCH_NAME" \
        --title "fix(codespec): resolve violation $VIOLATION_ID" \
        --body "## Code Spec Violation Fix

**Violation ID:** \`$VIOLATION_ID\`

This PR fixes a code spec violation detected by automated review.

### Violation Details
\`\`\`
$VIOLATION_DETAILS
\`\`\`

### Verification
- ✅ Code review passed (no violations detected)
- ✅ Tests passed

### How to Review
1. Check the violation was actually fixed
2. Run tests: \`yarn test:worker\`
3. Review code changes for correctness

---
🤖 Generated by [\`fix-violation.sh\`](../../codespec/scripts/fix-violation.sh)" 2>&1)

      # Extract PR URL (macOS-compatible grep)
      PR_URL=$(echo "$PR_OUTPUT" | grep -o 'https://github.com/.*/pull/[0-9]*' | head -1)

      if [ -n "$PR_URL" ]; then
        echo -e "${GREEN}✅ PR created${NC}"
        echo "   $PR_URL"
        echo ""

        # Update ledger with PR URL (already in main repo)
        if yarn --silent tsx codespec/lib/ledger-cli.ts update "$VIOLATION_ID" pr_open \
          --pr-url="$PR_URL" > /dev/null 2>&1; then
          echo -e "${GREEN}✅ Ledger updated with PR URL${NC}"
        else
          echo -e "${YELLOW}⚠️  Warning: Failed to update ledger with PR URL${NC}"
        fi
      else
        echo -e "${YELLOW}⚠️  PR creation succeeded but couldn't extract URL${NC}"
        echo "   Check GitHub for the PR manually"
      fi
    else
      echo -e "${YELLOW}⚠️  Skipping PR creation (gh not authenticated)${NC}"
      echo "   You can create the PR manually:"
      echo "   gh pr create --base $CURRENT_BRANCH --head $BRANCH_NAME"
    fi
    echo ""
  else
    echo -e "${RED}❌ Failed to push branch${NC}"
    FIX_EXIT_CODE=1
  fi
fi

# ============================================================================
# Cleanup
# ============================================================================

cd ../..  # Back to main repo

if [ $FIX_EXIT_CODE -eq 0 ]; then
  # Success: remove worktree (branch is pushed, PR created)
  echo "🧹 Cleaning up worktree..."
  git worktree remove "$WORKTREE_PATH" 2>/dev/null || {
    echo -e "${YELLOW}⚠️  Couldn't auto-remove worktree${NC}"
    echo "   Remove manually: git worktree remove $WORKTREE_PATH"
  }
  echo -e "${GREEN}✅ Worktree cleaned up${NC}"
  echo ""
  echo "🎉 Fix completed successfully!"
  if [ -n "${PR_URL:-}" ]; then
    echo "   PR: $PR_URL"
  fi
  echo "   Review and merge when ready"
  echo ""
  echo "Next steps:"
  echo "  • Review the PR"
  echo "  • Merge if tests pass"
  echo "  • Branch will be deleted automatically after merge"
  exit 0
else
  # Failure: leave worktree for inspection
  echo -e "${RED}❌ Fix failed or verification failed${NC}"
  echo ""
  echo -e "${YELLOW}⚠️  Worktree left for manual inspection:${NC}"
  echo "   Path: $WORKTREE_PATH"
  echo "   Branch: $BRANCH_NAME"
  echo ""
  echo "To inspect:"
  echo "  cd $WORKTREE_PATH"
  echo "  git status"
  echo "  git diff"
  echo ""
  echo "To clean up:"
  echo "  git worktree remove $WORKTREE_PATH"
  echo "  git branch -D $BRANCH_NAME"
  echo ""
  echo "Log saved to: $LOG_FILE"
  exit 1
fi
