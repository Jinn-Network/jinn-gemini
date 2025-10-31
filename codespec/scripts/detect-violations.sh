#!/usr/bin/env bash
set -euo pipefail

# Code Spec Violations Detection Script (Orchestrator)
# Runs all three objective-specific reviews in parallel and aggregates results
# Usage:
#   ./codespec/scripts/detect-violations.sh worker/mech_worker.ts    # Review specific file
#   ./codespec/scripts/detect-violations.sh worker/                  # Review directory
#   ./codespec/scripts/detect-violations.sh --diff                   # Review staged changes
#   TIMEOUT=60 ./codespec/scripts/detect-violations.sh <target>      # Custom timeout
#   ./codespec/scripts/detect-violations.sh --obj3-only --diff       # Security only (fast)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
TIMEOUT=${TIMEOUT:-600}  # Default 10 minutes (3 reviews in parallel)
TARGET="${1:---diff}"

# Get script directory (needed before handling --obj3-only branch)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check for obj3-only mode (fast security check for pre-commit)
if [ "$TARGET" = "--obj3-only" ]; then
  shift
  TARGET="${1:---diff}"
  echo "🔒 Running Security Review Only (guardrails + obj3)"
  "$SCRIPT_DIR/review-guardrails.sh" "$TARGET"
  GUARD_EXIT=$?
  "$SCRIPT_DIR/review-obj3.sh" "$TARGET"
  OBJ3_EXIT=$?
  if [ $GUARD_EXIT -ne 0 ] || [ $OBJ3_EXIT -ne 0 ]; then
    exit 1
  else
    exit 0
  fi
fi

echo -e "${BOLD}🔍 Running Complete Code Spec Review${NC}"
echo "   Target: $TARGET"
echo "   Objectives: guardrails (r4/db7/db8), obj3 (Security), obj1 (Orthodoxy), obj2 (Discoverability)"
echo "⏳ Running reviews in parallel (2-6 minutes)..."
echo ""

# Create temp files for each objective's output
TEMP_GUARD=$(mktemp)
TEMP_OBJ1=$(mktemp)
TEMP_OBJ2=$(mktemp)
TEMP_OBJ3=$(mktemp)

# Cleanup function
cleanup() {
  local exit_code=$?
  rm -f "$TEMP_GUARD" "$TEMP_OBJ1" "$TEMP_OBJ2" "$TEMP_OBJ3"
  # Kill background processes if still running
  jobs -p | xargs -r kill 2>/dev/null || true
  exit $exit_code
}
trap cleanup EXIT INT TERM

# Run all three reviews in parallel
echo "Starting parallel reviews..."
"$SCRIPT_DIR/review-guardrails.sh" "$TARGET" > "$TEMP_GUARD" 2>&1 &
PID_GUARD=$!
"$SCRIPT_DIR/review-obj3.sh" "$TARGET" > "$TEMP_OBJ3" 2>&1 &
PID_OBJ3=$!
"$SCRIPT_DIR/review-obj1.sh" "$TARGET" > "$TEMP_OBJ1" 2>&1 &
PID_OBJ1=$!
"$SCRIPT_DIR/review-obj2.sh" "$TARGET" > "$TEMP_OBJ2" 2>&1 &
PID_OBJ2=$!

# Wait with timeout and progress indicator
ELAPSED=0
echo -n "Progress: "
while true; do
  # Check if all processes are done
  if ! kill -0 "$PID_GUARD" 2>/dev/null && \
     ! kill -0 "$PID_OBJ1" 2>/dev/null && \
     ! kill -0 "$PID_OBJ2" 2>/dev/null && \
     ! kill -0 "$PID_OBJ3" 2>/dev/null; then
    break
  fi

  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo ""
    echo ""
    echo -e "${RED}❌ Timeout after ${TIMEOUT}s${NC}"
    echo ""
    echo "The review is taking longer than expected."
    echo "You can:"
    echo "  1. Increase timeout: TIMEOUT=900 $0 $TARGET"
    echo "  2. Review a smaller target (specific file instead of directory)"
    echo "  3. Run individual objectives: ./codespec/scripts/review-obj3.sh $TARGET"
    exit 2
  fi

  sleep 5
  echo -n "."
  ELAPSED=$((ELAPSED + 5))
done
echo " done! (${ELAPSED}s)"
echo ""

# Wait for all processes and collect exit codes
EXIT_GUARD=0
EXIT_OBJ1=0
EXIT_OBJ2=0
EXIT_OBJ3=0

if wait "$PID_GUARD"; then
  EXIT_GUARD=0
else
  EXIT_GUARD=$?
fi

if wait "$PID_OBJ1"; then
  EXIT_OBJ1=0
else
  EXIT_OBJ1=$?
fi

if wait "$PID_OBJ2"; then
  EXIT_OBJ2=0
else
  EXIT_OBJ2=$?
fi

if wait "$PID_OBJ3"; then
  EXIT_OBJ3=0
else
  EXIT_OBJ3=$?
fi

# Update ledger with violations (synchronous for reliability)
# This ensures ledger is updated before script exits, making tests deterministic
# and errors visible to users. Performance overhead: ~200-500ms (negligible).
echo ""
echo "📝 Updating violations ledger..."
if yarn tsx "$SCRIPT_DIR/../lib/update-all-reviews.ts" \
  "guard:$TEMP_GUARD" \
  "obj1:$TEMP_OBJ1" \
  "obj2:$TEMP_OBJ2" \
  "obj3:$TEMP_OBJ3" 2>&1 | tee /tmp/codespec-ledger-update.log; then
  echo "✅ Ledger updated successfully"
else
  echo "⚠️  Ledger update failed (see /tmp/codespec-ledger-update.log)"
  echo "   Reviews completed but violations not saved to ledger"
fi
echo ""

# Print detailed results for each objective
if [ $EXIT_GUARD -ne 0 ]; then
  echo -e "${RED}${BOLD}🔴 [guardrails] Secret Automation Violations${NC}"
  echo "────────────────────────────────────────────────────────────────────"
  cat "$TEMP_GUARD"
  echo ""
fi

if [ $EXIT_OBJ3 -ne 0 ]; then
  echo -e "${RED}${BOLD}🔴 [obj3] Security Violations (Highest Priority)${NC}"
  echo "────────────────────────────────────────────────────────────────────"
  cat "$TEMP_OBJ3"
  echo ""
fi

if [ $EXIT_OBJ1 -ne 0 ]; then
  echo -e "${YELLOW}${BOLD}🟡 [obj1] Orthodoxy Violations${NC}"
  echo "────────────────────────────────────────────────────────────────────"
  cat "$TEMP_OBJ1"
  echo ""
fi

if [ $EXIT_OBJ2 -ne 0 ]; then
  echo -e "${BLUE}${BOLD}🟢 [obj2] Discoverability Violations${NC}"
  echo "────────────────────────────────────────────────────────────────────"
  cat "$TEMP_OBJ2"
  echo ""
fi

# Exit with failure if any critical (obj3) violations found
if [ $EXIT_GUARD -ne 0 ] || [ $EXIT_OBJ3 -ne 0 ]; then
  exit 1
fi

# Exit with warning if orthodoxy violations found (but security passed)
if [ $EXIT_OBJ1 -ne 0 ]; then
  exit 1
fi

# Exit success (obj2 violations are informational)
exit 0
