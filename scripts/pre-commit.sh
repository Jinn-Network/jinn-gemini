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

echo "✅ Pre-commit checks passed!"
exit 0 