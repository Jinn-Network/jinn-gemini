#!/usr/bin/env bash
set -euo pipefail

# Code Spec Review: Guardrails (r4/db7/db8)
# Ensures automated git workflows enforce secret protections.
# Usage:
#   ./codespec/scripts/review-guardrails.sh worker/mech_worker.ts    # Review specific file
#   ./codespec/scripts/review-guardrails.sh worker/                  # Review directory
#   ./codespec/scripts/review-guardrails.sh --diff                   # Review staged changes
#   TIMEOUT=60 ./codespec/scripts/review-guardrails.sh <target>      # Custom timeout

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TIMEOUT=${TIMEOUT:-240}
TARGET="${1:---diff}"

echo "🛡️  Running Guardrails Review (r4/db7/db8) on: $TARGET"
echo "⏳ Checking automation for secret guard enforcement..."
echo ""

TEMP_OUTPUT=$(mktemp)

cleanup() {
  local exit_code=$?
  rm -f "$TEMP_OUTPUT"
  if [ -n "${CLAUDE_PID:-}" ]; then
    kill -9 "$CLAUDE_PID" 2>/dev/null || true
  }
  exit $exit_code
}
trap cleanup EXIT INT TERM

claude -p "/review-guardrails $TARGET" --output-format json > "$TEMP_OUTPUT" 2>&1 &
CLAUDE_PID=$!

ELAPSED=0
echo -n "Progress: "
while kill -0 "$CLAUDE_PID" 2>/dev/null; do
  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo ""
    echo ""
    echo -e "${RED}❌ Timeout after ${TIMEOUT}s${NC}"
    echo ""
    echo "The guardrails review is taking longer than expected."
    echo "You can:"
    echo "  1. Increase timeout: TIMEOUT=360 $0 $TARGET"
    echo "  2. Review a smaller target (specific file instead of directory)"
    echo "  3. Verify Claude Code responsiveness: claude -p 'test'"
    exit 2
  fi
  sleep 5
  echo -n "."
  ELAPSED=$((ELAPSED + 5))
done
echo " done! (${ELAPSED}s)"
echo ""

if ! wait "$CLAUDE_PID"; then
  CLAUDE_EXIT_CODE=$?
  echo -e "${RED}❌ Claude command failed (exit code: $CLAUDE_EXIT_CODE)${NC}"
  echo ""
  echo "Output:"
  cat "$TEMP_OUTPUT"
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  RESULT=$(jq -r '.result' < "$TEMP_OUTPUT" 2>/dev/null || cat "$TEMP_OUTPUT")
else
  RESULT=$(cat "$TEMP_OUTPUT")
fi

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
    echo -e "${GREEN}✅ Guardrails intact — no violations found${NC}"
    echo -e "${BLUE}   Automation uses the canonical secret protections.${NC}"
    echo ""
    echo "$RESULT"
    exit 0
  else
    echo -e "${YELLOW}⚠️  Found $VIOLATION_COUNT guardrail violation(s)${NC}"
    echo -e "${YELLOW}   Automation is missing secret protection steps.${NC}"
    echo ""
    echo "$RESULT"
    exit 1
  fi
else
  if echo "$RESULT" | grep -qi "error\|failed\|exception"; then
    echo -e "${YELLOW}⚠️  Review completed with warnings${NC}"
    echo ""
    echo "$RESULT"
    exit 0
  else
    echo -e "${GREEN}✅ Guardrails review completed (no violations detected)${NC}"
    echo ""
    echo "$RESULT"
    exit 0
  fi
fi
