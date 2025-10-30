# Memory System Test Execution Guide

This guide provides step-by-step instructions for executing the memory system tests.

## Prerequisites

1. Supabase migration applied: `supabase db push`
2. Ponder running: `yarn ponder:dev` (or `ponder start`)
3. Control API running: `npx tsx control-api/server.ts`
4. Worker running (for integration tests): `npx tsx worker/mech_worker.ts`

## Functional Tests

### Test 1: Memory Creation (Reflection)

**Objective**: Verify reflection step creates MEMORY artifacts after completed jobs.

**Method 1: Using Test Script (Standalone)**
```bash
npx tsx scripts/test-memory-creation.ts
```

**Method 2: Using Worker (Real Integration Test)**
1. Ensure worker is running with memory system enabled
2. Submit a job via the mech contract or dispatch tools
3. Monitor worker logs for:
   - "Processing request"
   - "Execution completed"
   - "Starting reflection step"
   - "Reflection step completed"
4. Run search script to verify memory was created:
   ```bash
   npx tsx scripts/test-memory-search.ts
   ```

**Expected Results**:
- Worker logs show reflection step triggered
- A new artifact with `type='MEMORY'` exists
- Memory has relevant `tags` and `content`

---

### Test 2: Memory Discovery & Injection

**Objective**: Verify similar jobs discover and use existing memories.

**Prerequisites**: Test 1 must pass (at least one memory exists)

**Method**:
1. Ensure worker is running with `DISABLE_MEMORY_INJECTION` NOT set (or set to `false`)
2. Submit a new job similar to the one from Test 1
3. Monitor worker logs for:
   - "Searching for relevant memories"
   - "Found relevant memories"
   - "Injected memories into context"
4. Observe that the job completes faster/more efficiently

**Test Script** (demonstrates search, but can't test full worker injection):
```bash
npx tsx scripts/test-memory-injection.ts
```

**Expected Results**:
- Worker logs confirm memories were found and injected
- Agent's effective prompt includes memory content
- Job completes more efficiently than baseline

---

### Test 3: Memory Rating

**Objective**: Verify rate_memory updates utility scores correctly.

**Prerequisites**: 
- Control API running
- At least one memory exists

**Method**:
```bash
npx tsx scripts/test-memory-rating.ts
```

**Expected Results**:
- Rating +1 increases score by 1, increments access_count
- Rating -1 decreases score by 1, increments access_count
- Database (utility_scores table) reflects changes

**Manual Verification**:
```sql
SELECT * FROM utility_scores ORDER BY updated_at DESC LIMIT 5;
```

---

### Test 4: Negative Case - No Reflection on Failure

**Objective**: Verify failed jobs do NOT trigger reflection.

**Method**:
```bash
npx tsx scripts/test-negative-case.ts
```

**Or via worker**:
1. Submit a job that will fail (e.g., malformed request, impossible task)
2. Monitor worker logs
3. Verify "Starting reflection step" does NOT appear
4. Confirm no new MEMORY was created

**Expected Results**:
- Failed job logs show error/failure
- NO "Starting reflection step" message
- NO new MEMORY artifact created

---

## Benchmarking Tests

### Setup

Create a clean environment:
```bash
# Optional: Reset database for clean baseline
supabase db reset

# Ensure Ponder is synchronized
cd ponder && yarn ponder start
```

### Phase 1: Baseline (Memory System Disabled)

Run 50 iterations (10 per job × 5 jobs) WITHOUT memory:
```bash
npx tsx scripts/benchmark-memory-system.ts --baseline
```

**Output**: `benchmark-results/benchmark-baseline-<timestamp>.json`

**Duration**: Approximately 10-20 minutes (depends on job complexity and API rate limits)

---

### Phase 2: With Memory System

Run 50 iterations WITH memory system enabled:
```bash
npx tsx scripts/benchmark-memory-system.ts --with-memory
```

**Notes**:
- Early iterations will build the knowledge base
- Later iterations should benefit from accumulated memories
- Some memories may be created during reflection steps

**Output**: `benchmark-results/benchmark-with-memory-<timestamp>.json`

**Duration**: Approximately 10-20 minutes

---

### Phase 3: Comparison & Analysis

Compare the two reports:
```bash
npx tsx scripts/benchmark-memory-system.ts --compare \
  benchmark-results/benchmark-baseline-<timestamp1>.json \
  benchmark-results/benchmark-with-memory-<timestamp2>.json
```

**Expected Output**:
```
📈 COMPARISON: BASELINE vs WITH-MEMORY
==================================================
Success Rate: +X.XX%
Avg Duration: -X.XX%
Avg Tokens: -X.XX%
Avg Tool Calls: +/-X.XX
Avg Tool Errors: -X.XX
==================================================

🎯 VERDICT:
✅ Memory system shows SIGNIFICANT IMPROVEMENT
```

**Success Criteria** (from proposal):
- At least 2 KPIs show measurable improvement:
  - Success rate increase
  - Token consumption decrease (5-15%)
  - Duration decrease
  - Tool errors reduction (10-20%)

---

## Troubleshooting

### "No memories found"
- Check that Ponder is running and synchronized
- Verify Ponder GraphQL endpoint is accessible
- Run reflection tests first to create memories

### "Control API connection failed"
- Ensure Control API is running on port 3042
- Check `CONTROL_API_URL` environment variable
- Verify Supabase credentials are correct

### "Memory injection not working"
- Check `DISABLE_MEMORY_INJECTION` is not set to 'true'
- Verify worker logs show "Searching for relevant memories"
- Ensure job has a `jobName` field (required for search)

### "Reflection step not triggering"
- Verify job status is `COMPLETED` (not `FAILED` or `DELEGATING`)
- Check worker logs for any reflection errors
- Ensure `create_artifact` tool is available during reflection

---

## Manual Inspection

### View all memories in Ponder:
```graphql
query {
  artifacts(where: { type: { equals: "MEMORY" } }, limit: 10) {
    items {
      id
      name
      topic
      tags
      utilityScore
      accessCount
      contentPreview
      blockTimestamp
    }
  }
}
```

### View utility scores in Supabase:
```sql
SELECT 
  us.*,
  a.name as artifact_name
FROM utility_scores us
LEFT JOIN artifacts a ON a.id = us.artifact_id
ORDER BY us.score DESC, us.access_count DESC;
```

### Check recent worker activity:
```bash
tail -f worker.log | grep -E "(reflection|memory|MEMORY)"
```

---

## Test Results Documentation

After completing tests, document results in Linear:
1. Update JINN-231 with test outcomes
2. Note any failures or unexpected behaviors
3. Include benchmark comparison statistics
4. Attach relevant log excerpts
5. Recommend next steps based on results

---

## Quick Test Checklist

- [ ] Test 1: Memory creation via reflection
- [ ] Test 2: Memory discovery and injection
- [ ] Test 3: Utility score updates
- [ ] Test 4: No reflection on failure
- [ ] Baseline benchmark (50 iterations)
- [ ] With-memory benchmark (50 iterations)
- [ ] Comparison analysis
- [ ] Results documented in Linear
- [ ] Decision on Phase 2 implementation




