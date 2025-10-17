#!/usr/bin/env bash
set -euo pipefail

# Code Spec Review: obj1 - Follow the Principle of Orthodoxy
# Reviews code for pattern inconsistencies (multiple approaches to same problem)
# Usage:
#   ./codespec/scripts/review-obj1.sh worker/config.ts    # Review specific file
#   ./codespec/scripts/review-obj1.sh worker/             # Review directory
#   ./codespec/scripts/review-obj1.sh --diff              # Review staged changes
#   TIMEOUT=60 ./codespec/scripts/review-obj1.sh <target> # Custom timeout

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TIMEOUT=${TIMEOUT:-240}  # Default 4 minutes (orthodoxy analysis can be comprehensive)
TARGET="${1:---diff}"

echo "📏 Running Orthodoxy Review (obj1: One Obvious Way) on: $TARGET"
echo "⏳ Analyzing for pattern inconsistencies..."
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
claude -p "/review-obj1 $TARGET" --output-format json > "$TEMP_OUTPUT" 2>&1 &
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
    echo "The orthodoxy review is taking longer than expected."
    echo "You can:"
    echo "  1. Increase timeout: TIMEOUT=360 $0 $TARGET"
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

# Check for violations
if echo "$RESULT" | grep -q "Total violations found:"; then
  VIOLATION_COUNT=$(echo "$RESULT" | grep -o 'Total violations found: [0-9]*' | grep -o '[0-9]*$' || echo "")

  if [ -z "$VIOLATION_COUNT" ]; then
    if echo "$RESULT" | grep -q "Total violations found: 0"; then
      VIOLATION_COUNT=0
    else
      VIOLATION_COUNT="unknown"
    fi
  fi

  if [ "$VIOLATION_COUNT" = "0" ]; then
    echo -e "${GREEN}✅ No orthodoxy violations found!${NC}"
    echo -e "${BLUE}   Code follows consistent patterns.${NC}"
    echo ""
    echo "$RESULT"
    exit 0
  else
    echo -e "${YELLOW}⚠️  Found $VIOLATION_COUNT orthodoxy violation(s)${NC}"
    echo -e "${YELLOW}   Multiple approaches to the same problem detected.${NC}"
    echo ""
    echo "$RESULT"
    exit 1
  fi
else
  # No violations section found - assume clean or check for error indicators
  if echo "$RESULT" | grep -qi "error\|failed\|exception"; then
    echo -e "${YELLOW}⚠️  Review completed with warnings${NC}"
    echo ""
    echo "$RESULT"
    exit 0
  else
    echo -e "${GREEN}✅ Orthodoxy review completed (no violations detected)${NC}"
    echo ""
    echo "$RESULT"
    exit 0
  fi
fi
