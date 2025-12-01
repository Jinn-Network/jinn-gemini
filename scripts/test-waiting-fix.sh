#!/bin/bash
set -e

echo "========================================="
echo "Testing WAITING Status Fix"
echo "========================================="
echo ""

# Test target (job that's currently WAITING)
JOB_ID="23783b40-2ba3-4a21-a998-3ce233ef497c"
JOB_NAME="Trade Idea Generation & Synthesis"
WORKSTREAM_ID="0x0d2dcd01a6c0f62dafbc93bc314bd7b766296e8b6cbebf5ae62815ecb453594c"
PONDER_URL="https://jinn-gemini-production.up.railway.app/graphql"

echo "Test Configuration:"
echo "  Job ID: $JOB_ID"
echo "  Job Name: $JOB_NAME"
echo "  Workstream: $WORKSTREAM_ID"
echo ""

# ============================================================
# Step 1: Check BEFORE state
# ============================================================
echo "Step 1: Checking current job status in Ponder..."
echo "----------------------------------------"

node -e "
const https = require('https');
https.request({
  hostname: 'jinn-gemini-production.up.railway.app',
  path: '/graphql',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      const job = data?.data?.jobDefinition;
      if (job) {
        console.log('  Job Name:', job.name);
        console.log('  Current Status:', job.lastStatus);
        console.log('  Source Job ID:', job.sourceJobDefinitionId || 'null (root job)');
      } else {
        console.log('  ERROR: Job not found');
      }
    } catch (e) {
      console.log('  ERROR:', e.message);
    }
  });
}).end(JSON.stringify({ 
  query: 'query { jobDefinition(id: \"$JOB_ID\") { id name lastStatus sourceJobDefinitionId } }' 
}));
" 2>&1

echo ""

# ============================================================
# Step 2: Dispatch a new request for the WAITING job
# ============================================================
echo "Step 2: Dispatching new request for WAITING job..."
echo "----------------------------------------"

# Use dedicated dispatch script and extract request ID
DISPATCH_OUT=$(yarn --silent tsx scripts/dispatch-for-test.ts "$JOB_ID" "Test run to verify WAITING status fix" 2>&1)
REQUEST_ID=$(echo "$DISPATCH_OUT" | grep "^0x" | tail -1)

if [ $? -ne 0 ] || [ -z "$REQUEST_ID" ]; then
  echo "  ✗ Failed to dispatch job"
  echo "  Output: $REQUEST_ID"
  exit 1
fi

echo "  ✓ Dispatched job successfully"
echo "  Request ID: $REQUEST_ID"
echo ""
echo "  Waiting 10 seconds for Ponder to index the request..."
sleep 10
echo ""

# ============================================================
# Step 3: Run worker on the new request
# ============================================================
echo "Step 3: Running worker to process the new request..."
echo "----------------------------------------"
echo "  Target Request: $REQUEST_ID"
echo "  Look for [STATUS_INFERENCE] markers in the logs"
echo ""

# Run worker and capture logs
MECH_TARGET_REQUEST_ID=$REQUEST_ID yarn mech --single 2>&1 | tee /tmp/waiting-fix-test.log

echo ""

# ============================================================
# Step 4: Extract and analyze logs
# ============================================================
echo "Step 4: Analyzing logs for status inference decisions..."
echo "----------------------------------------"

if grep -q "\[STATUS_INFERENCE\]" /tmp/waiting-fix-test.log; then
  echo "✓ Found status inference logs"
  echo ""
  echo "Key log entries:"
  grep "\[STATUS_INFERENCE\]" /tmp/waiting-fix-test.log | while read -r line; do
    echo "  $line"
  done
else
  echo "✗ No status inference logs found"
  echo "  This might mean:"
  echo "  - No job was processed (check if workstream has pending jobs)"
  echo "  - Logging not working as expected"
fi

echo ""

# ============================================================
# Step 5: Check AFTER state
# ============================================================
echo "Step 5: Checking updated status in Ponder..."
echo "----------------------------------------"

sleep 5  # Wait for Ponder to index the delivery

node -e "
const https = require('https');
https.request({
  hostname: 'jinn-gemini-production.up.railway.app',
  path: '/graphql',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      const job = data?.data?.jobDefinition;
      if (job) {
        console.log('  Job Name:', job.name);
        console.log('  Updated Status:', job.lastStatus);
      } else {
        console.log('  ERROR: Job not found');
      }
    } catch (e) {
      console.log('  ERROR:', e.message);
    }
  });
}).end(JSON.stringify({ 
  query: 'query { jobDefinition(id: \"$JOB_ID\") { id name lastStatus } }' 
}));
" 2>&1

echo ""
echo "========================================="
echo "Test Complete"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Review logs at: /tmp/waiting-fix-test.log"
echo "  2. Check for hierarchy vs live query comparison"
echo "  3. Verify if status transitioned (WAITING → COMPLETED)"
echo "  4. Document findings in WAITING_CYCLES_ANALYSIS.md"

