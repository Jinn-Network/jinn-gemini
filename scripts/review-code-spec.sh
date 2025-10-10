#!/usr/bin/env bash
set -euo pipefail

# Code Spec Review Script
# Runs the /review-code-spec slash command in headless mode
# Usage:
#   ./scripts/review-code-spec.sh worker/mech_worker.ts    # Review specific file
#   ./scripts/review-code-spec.sh worker/                  # Review directory
#   ./scripts/review-code-spec.sh --diff                   # Review staged changes
#   TIMEOUT=60 ./scripts/review-code-spec.sh <target>      # Custom timeout

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TIMEOUT=${TIMEOUT:-300}  # Default 5 minutes (code spec reviews can take time)
TARGET="${1:---diff}"

echo "🔍 Running Code Spec Review on: $TARGET"
echo "⏳ This may take 1-3 minutes (analyzing spec files + target code)..."
echo ""

# Create temp file for output
TEMP_OUTPUT=$(mktemp)

# Cleanup function
cleanup() {
  local exit_code=$?
  rm -f "$TEMP_OUTPUT"
  # Kill claude process if still running
  if [ -n "${CLAUDE_PID:-}" ]; then
    kill -9 "$CLAUDE_PID" 2>/dev/null || true
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

# Run claude in background
claude -p "/review-code-spec $TARGET" --output-format json > "$TEMP_OUTPUT" 2>&1 &
CLAUDE_PID=$!

# Wait with timeout and progress indicator
ELAPSED=0
echo -n "Progress: "
while kill -0 "$CLAUDE_PID" 2>/dev/null; do
  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo ""
    echo ""
    echo -e "${RED}❌ Timeout after ${TIMEOUT}s${NC}"
    echo ""
    echo "The code spec review is taking longer than expected."
    echo "You can:"
    echo "  1. Increase timeout: TIMEOUT=300 $0 $TARGET"
    echo "  2. Review a smaller target (specific file instead of directory)"
    echo "  3. Check if Claude Code is responsive: claude -p 'test'"
    exit 2
  fi
  sleep 5
  echo -n "."
  ELAPSED=$((ELAPSED + 5))
done
echo " done! (${ELAPSED}s)"
echo ""

# Wait for claude to finish and get exit code
wait "$CLAUDE_PID"
CLAUDE_EXIT_CODE=$?

# Check if claude command failed
if [ $CLAUDE_EXIT_CODE -ne 0 ]; then
  echo -e "${RED}❌ Claude command failed (exit code: $CLAUDE_EXIT_CODE)${NC}"
  echo ""
  echo "Output:"
  cat "$TEMP_OUTPUT"
  exit 1
fi

# Parse the result
if command -v jq >/dev/null 2>&1; then
  RESULT=$(jq -r '.result' < "$TEMP_OUTPUT" 2>/dev/null || cat "$TEMP_OUTPUT")
else
  # jq not available, try to extract result manually
  RESULT=$(cat "$TEMP_OUTPUT")
fi

# Check for violations in the output
if echo "$RESULT" | grep -q "Total violations found:"; then
  # Extract violation count (macOS-compatible grep)
  VIOLATION_COUNT=$(echo "$RESULT" | grep -o 'Total violations found: [0-9]*' | grep -o '[0-9]*$' || echo "")

  if [ -z "$VIOLATION_COUNT" ]; then
    # Couldn't parse count, check if it explicitly says 0
    if echo "$RESULT" | grep -q "Total violations found: 0"; then
      VIOLATION_COUNT=0
    else
      VIOLATION_COUNT="unknown"
    fi
  fi

  if [ "$VIOLATION_COUNT" = "0" ]; then
    echo -e "${GREEN}✅ No violations found!${NC}"
    echo ""
    echo "$RESULT"
    exit 0
  else
    echo -e "${RED}❌ Found $VIOLATION_COUNT violation(s)${NC}"
    echo ""
    echo "$RESULT"
    exit 1
  fi
else
  # No violations section found - assume clean or check for error indicators
  if echo "$RESULT" | grep -qi "error\|failed\|exception"; then
    echo -e "${YELLOW}⚠️  Review completed with warnings${NC}"
  else
    echo -e "${GREEN}✅ Code spec review completed (no violations detected)${NC}"
  fi
  echo ""
  echo "$RESULT"
  exit 0
fi
