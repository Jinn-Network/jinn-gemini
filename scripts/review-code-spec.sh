#!/usr/bin/env bash
set -euo pipefail

# Code Spec Review Script (Orchestrator)
# Runs all three objective-specific reviews in parallel and aggregates results
# Usage:
#   ./scripts/review-code-spec.sh worker/mech_worker.ts    # Review specific file
#   ./scripts/review-code-spec.sh worker/                  # Review directory
#   ./scripts/review-code-spec.sh --diff                   # Review staged changes
#   TIMEOUT=60 ./scripts/review-code-spec.sh <target>      # Custom timeout
#   ./scripts/review-code-spec.sh --obj3-only --diff       # Security only (fast)

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

# Check for obj3-only mode (fast security check for pre-commit)
if [ "$TARGET" = "--obj3-only" ]; then
  shift
  TARGET="${1:---diff}"
  echo "🔒 Running Security Review Only (obj3)"
  exec "$(dirname "$0")/review-obj3.sh" "$TARGET"
fi

echo -e "${BOLD}🔍 Running Complete Code Spec Review${NC}"
echo "   Target: $TARGET"
echo "   Objectives: obj3 (Security), obj1 (Orthodoxy), obj2 (Discoverability)"
echo "⏳ Running reviews in parallel (2-6 minutes)..."
echo ""

# Create temp files for each objective's output
TEMP_OBJ1=$(mktemp)
TEMP_OBJ2=$(mktemp)
TEMP_OBJ3=$(mktemp)

# Cleanup function
cleanup() {
  local exit_code=$?
  rm -f "$TEMP_OBJ1" "$TEMP_OBJ2" "$TEMP_OBJ3"
  # Kill background processes if still running
  jobs -p | xargs -r kill 2>/dev/null || true
  exit $exit_code
}
trap cleanup EXIT INT TERM

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run all three reviews in parallel
echo "Starting parallel reviews..."
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
  if ! kill -0 "$PID_OBJ1" 2>/dev/null && \
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
    echo "  3. Run individual objectives: ./scripts/review-obj3.sh $TARGET"
    exit 2
  fi

  sleep 5
  echo -n "."
  ELAPSED=$((ELAPSED + 5))
done
echo " done! (${ELAPSED}s)"
echo ""

# Wait for all processes and collect exit codes
wait "$PID_OBJ1"
EXIT_OBJ1=$?
wait "$PID_OBJ2"
EXIT_OBJ2=$?
wait "$PID_OBJ3"
EXIT_OBJ3=$?

# Extract violation counts from each output
extract_violation_count() {
  local output="$1"
  # Look for "Total violations found: N" or "Found N violation(s)"
  local count=$(echo "$output" | grep -o -E '(Total violations found|Found): [0-9]+' | grep -o '[0-9]\+' | head -1)
  if [ -z "$count" ]; then
    # Try alternative format
    count=$(echo "$output" | grep -o -E 'Found [0-9]+ .* violation' | grep -o '[0-9]\+' | head -1)
  fi
  echo "${count:-0}"
}

OBJ1_VIOLATIONS=$(extract_violation_count "$(cat "$TEMP_OBJ1")")
OBJ2_VIOLATIONS=$(extract_violation_count "$(cat "$TEMP_OBJ2")")
OBJ3_VIOLATIONS=$(extract_violation_count "$(cat "$TEMP_OBJ3")")
TOTAL_VIOLATIONS=$((OBJ1_VIOLATIONS + OBJ2_VIOLATIONS + OBJ3_VIOLATIONS))

# Print aggregated header
echo "════════════════════════════════════════════════════════════════════"
echo -e "${BOLD}Code Spec Review: Complete Analysis${NC}"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo -e "${BOLD}Executive Summary${NC}"
echo ""
printf "%-30s %-15s %-10s %-10s\n" "Objective" "Violations" "Severity" "Status"
echo "────────────────────────────────────────────────────────────────────"

# obj3 status
if [ $EXIT_OBJ3 -eq 0 ]; then
  printf "%-30s %-15s %-10s %-10s\n" "obj3: Security" "$OBJ3_VIOLATIONS" "🔴 Critical" "✅ PASS"
else
  printf "%-30s %-15s %-10s %-10s\n" "obj3: Security" "$OBJ3_VIOLATIONS" "🔴 Critical" "❌ FAIL"
fi

# obj1 status
if [ $EXIT_OBJ1 -eq 0 ]; then
  printf "%-30s %-15s %-10s %-10s\n" "obj1: Orthodoxy" "$OBJ1_VIOLATIONS" "🟡 Warning" "✅ PASS"
else
  printf "%-30s %-15s %-10s %-10s\n" "obj1: Orthodoxy" "$OBJ1_VIOLATIONS" "🟡 Warning" "⚠️  WARN"
fi

# obj2 status
if [ $EXIT_OBJ2 -eq 0 ]; then
  printf "%-30s %-15s %-10s %-10s\n" "obj2: Discoverability" "$OBJ2_VIOLATIONS" "🟢 Info" "✅ PASS"
else
  printf "%-30s %-15s %-10s %-10s\n" "obj2: Discoverability" "$OBJ2_VIOLATIONS" "🟢 Info" "ℹ️  INFO"
fi

echo "────────────────────────────────────────────────────────────────────"
printf "%-30s %-15s\n" "TOTAL" "$TOTAL_VIOLATIONS violations"
echo "════════════════════════════════════════════════════════════════════"
echo ""

# Print detailed results for each objective
if [ $OBJ3_VIOLATIONS -gt 0 ] || [ $EXIT_OBJ3 -ne 0 ]; then
  echo -e "${RED}${BOLD}🔴 [obj3] Security Violations (Highest Priority)${NC}"
  echo "────────────────────────────────────────────────────────────────────"
  cat "$TEMP_OBJ3"
  echo ""
else
  echo -e "${GREEN}🔴 [obj3] Security: No violations detected ✅${NC}"
  echo ""
fi

if [ $OBJ1_VIOLATIONS -gt 0 ] || [ $EXIT_OBJ1 -ne 0 ]; then
  echo -e "${YELLOW}${BOLD}🟡 [obj1] Orthodoxy Violations${NC}"
  echo "────────────────────────────────────────────────────────────────────"
  cat "$TEMP_OBJ1"
  echo ""
else
  echo -e "${GREEN}🟡 [obj1] Orthodoxy: No violations detected ✅${NC}"
  echo ""
fi

if [ $OBJ2_VIOLATIONS -gt 0 ] || [ $EXIT_OBJ2 -ne 0 ]; then
  echo -e "${BLUE}${BOLD}🟢 [obj2] Discoverability Violations${NC}"
  echo "────────────────────────────────────────────────────────────────────"
  cat "$TEMP_OBJ2"
  echo ""
else
  echo -e "${GREEN}🟢 [obj2] Discoverability: No violations detected ✅${NC}"
  echo ""
fi

# Final action items
echo "════════════════════════════════════════════════════════════════════"
echo -e "${BOLD}Action Items${NC}"
echo "════════════════════════════════════════════════════════════════════"
echo ""

if [ $OBJ3_VIOLATIONS -gt 0 ]; then
  echo -e "${RED}⚠️  CRITICAL: Fix $OBJ3_VIOLATIONS security violation(s) before commit${NC}"
fi

if [ $OBJ1_VIOLATIONS -gt 0 ]; then
  echo -e "${YELLOW}⚠️  WARNING: Address $OBJ1_VIOLATIONS orthodoxy violation(s) before merge${NC}"
fi

if [ $OBJ2_VIOLATIONS -gt 0 ]; then
  echo -e "${BLUE}ℹ️  INFO: Consider improving $OBJ2_VIOLATIONS discoverability issue(s)${NC}"
fi

if [ $TOTAL_VIOLATIONS -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed! Code follows spec guidelines.${NC}"
fi

echo ""
echo "📚 Resources:"
echo "   - Full spec: docs/spec/code-spec/spec.md"
echo "   - Usage guide: docs/spec/code-spec/USAGE.md"
echo "   - Known issues: docs/spec/code-spec/VIOLATIONS.md"
echo ""
echo "🔧 Individual reviews:"
echo "   - Security only: ./scripts/review-obj3.sh $TARGET"
echo "   - Orthodoxy only: ./scripts/review-obj1.sh $TARGET"
echo "   - Discoverability only: ./scripts/review-obj2.sh $TARGET"
echo ""

# Exit with failure if any critical (obj3) violations found
if [ $EXIT_OBJ3 -ne 0 ]; then
  exit 1
fi

# Exit with warning if orthodoxy violations found (but security passed)
if [ $EXIT_OBJ1 -ne 0 ]; then
  exit 1
fi

# Exit success (obj2 violations are informational)
exit 0
