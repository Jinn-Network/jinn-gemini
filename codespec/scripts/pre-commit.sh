#!/bin/bash

# Pre-commit hook to prevent committing sensitive files
# This script should be placed in .git/hooks/pre-commit and made executable

echo "🔍 Running pre-commit security checks..."

# Check for environment files (but allow template files)
if git diff --cached --name-only | grep -E "\.env$|\.env\." | grep -v -E "\.template$|template\."; then
    echo "❌ ERROR: Attempting to commit environment file(s)."
    echo "   Environment files contain sensitive information and should not be committed."
    echo "   Please remove them from your commit:"
    echo "   git reset HEAD <filename>"
    exit 1
fi

# Check for Gemini configuration files
if git diff --cached --name-only | grep -E "\.gemini/settings\.json|\.gemini/config\.json|\.gemini/credentials\.json"; then
    echo "❌ ERROR: Attempting to commit Gemini configuration file(s)."
    echo "   These files may contain sensitive authentication information."
    echo "   Please remove them from your commit:"
    echo "   git reset HEAD <filename>"
    exit 1
fi

# Check for potential secrets in staged files (but ignore template examples and legitimate code patterns)
# Look for actual secret patterns: api_key=, password=, secret=, etc.
SECRETS_FOUND=$(git diff --cached | grep -i -E "(api_key\s*=|password\s*=|secret\s*=|token\s*=|key\s*=)" | grep -v -E "(template|example|test|your-|placeholder|SUPABASE_SERVICE_ROLE_KEY)" || true)

if [ -n "$SECRETS_FOUND" ]; then
    echo "⚠️  WARNING: Potential secrets found in staged files:"
    echo "$SECRETS_FOUND"
    echo ""
    echo "Please review these changes to ensure no actual secrets are being committed."
    echo "If these are legitimate changes, you can proceed with the commit."
    echo ""
    read -p "Continue with commit? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Commit aborted."
        exit 1
    fi
fi

# Check for large files
LARGE_FILES=$(git diff --cached --name-only | xargs -I {} sh -c 'if [ -f "{}" ]; then echo "{}: $(du -h "{}" | cut -f1)"; fi' | grep -E "([0-9]+M|[0-9]+\.[0-9]+G)" || true)

if [ -n "$LARGE_FILES" ]; then
    echo "⚠️  WARNING: Large files detected:"
    echo "$LARGE_FILES"
    echo ""
    echo "Consider if these files should be in version control."
    echo ""
    read -p "Continue with commit? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Commit aborted."
        exit 1
    fi
fi

# Check for required dependencies (warning only, don't block commits)
echo "🔍 Checking development environment setup..."

# Check if git submodules are initialized
if [ -f .gitmodules ] && [ ! -f "olas-operate-middleware/operate/cli.py" ] && [ ! -f "olas-operate-middleware/pyproject.toml" ]; then
    echo "⚠️  WARNING: Git submodules may not be initialized."
    echo "   Run: git submodule update --init --recursive"
    echo "   Or: yarn setup:dev"
fi

# Check if Python environment exists for olas-operate-middleware
if [ -d "olas-operate-middleware" ]; then
    if [ ! -d "olas-operate-middleware/venv" ] && ! command -v poetry >/dev/null 2>&1; then
        echo "⚠️  WARNING: Python environment for olas-operate-middleware may not be set up."
        echo "   Run: yarn setup:python"
        echo "   Or: yarn setup:dev"
    fi
fi

# Check if .env file exists
if [ ! -f .env ] && [ -f .env.template ]; then
    echo "⚠️  WARNING: .env file not found."
    echo "   Run: cp .env.template .env"
    echo "   Then edit .env with your configuration values"
fi

# Check if node_modules exists
if [ ! -d node_modules ] && [ -f package.json ]; then
    echo "⚠️  WARNING: Node.js dependencies may not be installed."
    echo "   Run: yarn install"
    echo "   Or: yarn setup:dev"
fi

echo "💡 For comprehensive setup validation, run: yarn qa:jinn-179"
echo "✅ Pre-commit checks passed!"
exit 0 