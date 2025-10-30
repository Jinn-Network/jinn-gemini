# Production Memory System Test Guide

This guide explains how to test the memory system in a live production environment with the marketplace and worker.

## Prerequisites

### 1. Services Running
```bash
# Terminal 1: Ponder (indexer)
cd ponder && yarn dev

# Terminal 2: Control API
yarn control-api

# Terminal 3: Worker (with memory system enabled)
yarn mech
```

### 2. Environment Variables

Ensure these are set in `.env`:
```bash
# Blockchain
RPC_URL=<your-rpc-url>
MECH_ADDRESS=<your-mech-contract-address>
MARKETPLACE_ADDRESS=<marketplace-contract-address>
ETHEREUM_PRIVATE_KEY=<your-private-key>

# Services
PONDER_GRAPHQL_URL=http://localhost:42069/graphql
CONTROL_API_URL=http://localhost:3042/graphql

# Memory System
DISABLE_MEMORY_INJECTION=false  # Must be false or unset
```

### 3. Database
```bash
# Apply migration if not already done
supabase db push
```

## Test Execution

### Option 1: Automated Production Test

Run the comprehensive test script:
```bash
npx tsx scripts/test-memory-production.ts
```

**What it does:**
1. Creates a test job payload
2. Uploads to IPFS
3. Submits to marketplace contract
4. Monitors for completion
5. Searches for created MEMORY artifacts
6. Validates memory structure

**Expected output:**
```
🧪 Production Memory System Test
📮 Submitting job to marketplace...
   TX: 0x...
   ✅ Confirmed in block 12345
📬 Request ID: 123
⏳ Waiting for worker to process job...
✅ Job completed and delivered!
🔍 Searching for created memories...
✅ Found 1 memory artifact(s):
📝 Memory 1:
   Name: OLAS Contract Address
   Type: MEMORY
   Tags: olas, contract, ethereum
🎉 PRODUCTION TEST PASSED!
```

### Option 2: Manual Testing

If you want to manually observe the flow:

#### Step 1: Submit a Job

Use an existing script or the test script to submit a job:
```bash
# The job should be simple and likely to succeed
# Example: "What is the OLAS token contract address on Base?"
npx tsx scripts/test-memory-production.ts
```

#### Step 2: Monitor Worker Logs

Watch the worker terminal for these key log messages:

```
[Worker] Processing request <requestId>
[Worker] Searching for relevant memories
[Worker] Execution completed
[Worker] Starting reflection step
[Worker] Reflection step completed
```

**Key indicators:**
- ✅ "Starting reflection step" appears after COMPLETED jobs
- ✅ "Reflection step completed" confirms memory was attempted
- ❌ "Starting reflection step" should NOT appear for FAILED jobs

#### Step 3: Verify Memory Creation

After the job completes, search for memories:
```bash
npx tsx scripts/test-memory-search.ts
```

Expected output should show MEMORY artifacts with:
- `type: 'MEMORY'`
- `tags: [array of relevant tags]`
- `contentPreview`: Content snippet
- `utilityScore`: Initially 0 or undefined

#### Step 4: Test Memory Injection

Submit a similar job to test that memories are discovered and injected:

1. Submit a job with similar jobName or prompt
2. Watch worker logs for:
   ```
   Searching for relevant memories
   Found relevant memories
   Injected memories into context
   ```
3. The job should complete faster with the pre-existing knowledge

#### Step 5: Test Memory Rating

Rate the memory that was created:
```bash
npx tsx scripts/test-memory-rating.ts
```

This will:
- Find the first memory
- Rate it +1
- Rate it -1
- Verify score changes correctly

## Validation Checklist

After running the test, verify:

- [ ] Job was submitted to marketplace
- [ ] Worker picked up and processed the job
- [ ] Job status changed to COMPLETED
- [ ] "Starting reflection step" appeared in logs
- [ ] MEMORY artifact was created
- [ ] Memory has `type='MEMORY'`
- [ ] Memory has relevant tags
- [ ] Memory has content
- [ ] Memory is searchable via `search_memories`
- [ ] Ponder indexed the memory (appears in GraphQL)
- [ ] Similar jobs discover the memory
- [ ] Memory injection adds content to prompt
- [ ] Rating updates work correctly

## Troubleshooting

### No reflection step triggered
- Check job status is `COMPLETED` (not `FAILED` or other)
- Verify `finalize_job` tool is being called by agent
- Look for errors in worker logs

### Memory not created
- Check reflection agent has `create_artifact` tool available
- Verify IPFS upload succeeded
- Check for errors in reflection step logs

### Memory not indexed
- Confirm Ponder is running and synchronized
- Wait 30-60 seconds for indexing
- Check Ponder logs for errors
- Verify Ponder schema includes new fields

### Memory not found in search
- Ensure `type='MEMORY'` was set during creation
- Check Ponder GraphQL directly:
  ```graphql
  query {
    artifacts(where: { type: { equals: "MEMORY" } }, limit: 5) {
      items { id name type tags }
    }
  }
  ```

### Memory not injected
- Verify `DISABLE_MEMORY_INJECTION` is false or unset
- Check job has a `jobName` field
- Confirm `search_memories` returns results
- Look for "Memory injection failed" warnings in logs

## Success Metrics

A successful production test demonstrates:

1. **End-to-End Flow**: Job → Execution → Reflection → Memory Creation → Indexing
2. **Memory Discovery**: Subsequent jobs find relevant memories
3. **Memory Injection**: Found memories are added to agent context
4. **Memory Rating**: Utility scores can be updated
5. **No Regressions**: Existing job execution still works

## Next Steps After Success

1. **Document Findings**: Update JINN-231 with test results
2. **Run Benchmarks**: Execute baseline and with-memory benchmark suites
3. **Measure Impact**: Compare KPIs (success rate, tokens, time, errors)
4. **Decide on Phase 2**: Based on measured improvements

## Quick Reference Commands

```bash
# Run production test
npx tsx scripts/test-memory-production.ts

# Search for memories
npx tsx scripts/test-memory-search.ts

# Test rating
npx tsx scripts/test-memory-rating.ts

# Check Ponder for memories
curl -X POST http://localhost:42069/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ artifacts(where: {type: {equals: \"MEMORY\"}}, limit: 5) { items { id name type tags } } }"}'

# Monitor worker
tail -f worker.log | grep -E "(reflection|memory|MEMORY)"
```

