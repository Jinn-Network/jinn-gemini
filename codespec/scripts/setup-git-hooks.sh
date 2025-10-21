#!/usr/bin/env bash
set -euo pipefail

# Git Hooks Setup Script
# Installs pre-commit hook for code spec review
# Usage: ./scripts/setup-git-hooks.sh

HOOKS_DIR=".git/hooks"
PRE_COMMIT_HOOK="$HOOKS_DIR/pre-commit"

echo "🔧 Setting up git hooks for code spec review..."

# Check if .git directory exists
if [ ! -d ".git" ]; then
  echo "❌ Error: .git directory not found. Are you in the repository root?"
  exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

# Check if pre-commit hook already exists
if [ -f "$PRE_COMMIT_HOOK" ]; then
  echo "⚠️  Pre-commit hook already exists at $PRE_COMMIT_HOOK"
  echo "Creating backup at $PRE_COMMIT_HOOK.backup"
  cp "$PRE_COMMIT_HOOK" "$PRE_COMMIT_HOOK.backup"
fi

# Create pre-commit hook
cat > "$PRE_COMMIT_HOOK" << 'EOF'
#!/usr/bin/env bash
# Pre-commit hook: Code Spec Review
# Automatically reviews staged TypeScript files against the Orthodoxy Principle

# Skip review for WIP commits
if git log -1 --pretty=%B 2>/dev/null | grep -q "^wip:" || \
   git log -1 --pretty=%B 2>/dev/null | grep -q "^WIP:"; then
  echo "🚧 WIP commit detected, skipping code spec review"
  exit 0
fi

# Check if there are any staged .ts files
STAGED_TS_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep '\.ts$' || true)

if [ -z "$STAGED_TS_FILES" ]; then
  # No TypeScript files staged, skip review
  exit 0
fi

echo "📋 Running code spec review on staged changes..."
echo ""

# Run the review script
if ./codespec/scripts/detect-violations.sh --diff; then
  echo ""
  echo "✅ Code spec review passed!"
  exit 0
else
  echo ""
  echo "❌ Code spec violations found!"
  echo ""
  echo "To fix: Address the violations listed above"
  echo "To skip this check: git commit --no-verify"
  echo "For WIP commits: git commit -m 'wip: your message'"
  echo ""
  exit 1
fi
EOF

# Make hook executable
chmod +x "$PRE_COMMIT_HOOK"

echo ""
echo "✅ Pre-commit hook installed successfully (STRICT MODE)!"
echo ""
echo "📋 What this means:"
echo "  - The hook will BLOCK commits with code spec violations"
echo "  - Reviews take 30-120 seconds per commit (analyzing spec + your code)"
echo "  - Only runs on staged .ts files"
echo ""
echo "🚀 Usage:"
echo "  Normal commit:  git commit -m 'your message'"
echo "  WIP commit:     git commit -m 'wip: your message'  (skips review)"
echo "  Skip review:    git commit --no-verify -m 'your message'"
echo ""
echo "💡 Tip: Use 'wip:' prefix for work-in-progress commits to skip review"
echo ""
