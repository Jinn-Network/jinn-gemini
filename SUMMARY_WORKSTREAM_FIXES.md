# Workstream Analysis & Fixes Summary

**Date:** 2025-11-29  
**Workstream:** `0x0d2dcd01a6c0f62dafbc93bc314bd7b766296e8b6cbebf5ae62815ecb453594c`

---

## What Was Fixed

### 1. `inspect-workstream.ts` - Job Definitions vs Job Runs ✅

**Problem:**  
Script counted 21 "jobs" but UI showed 12. Confusion between:
- **Job Definitions** (unique jobs) = 12
- **Job Runs** (executions) = 21

**Root Cause:**  
Job definitions can span multiple workstreams, so `job_definition.workstreamId` only stores the FIRST workstream. To find all jobs in a workstream, must query `requests` table by `workstreamId`, then extract unique `jobDefinitionId` values.

**Fix Applied:**
```typescript
// OLD (broken): Query job definitions directly by workstreamId
const jobDefs = await query({ where: { workstreamId } })

// NEW (correct): Extract job def IDs from requests
const requests = await query({ where: { workstreamId } })
const jobDefIds = [...new Set(requests.map(r => r.jobDefinitionId))]
const jobDefs = await query({ where: { id_in: jobDefIds } })
```

**Output Now Shows:**
```json
{
  "stats": {
    "uniqueJobs": 12,
    "totalJobRuns": 21,
    "jobsInWaiting": 4,
    "jobsCompleted": 8
  },
  "jobs": [
    {
      "id": "23783b40-...",
      "name": "Trade Idea Generation & Synthesis",
      "lastStatus": "WAITING",
      "executionCount": 4,
      "runs": [...]
    }
  ]
}
```

---

### 2. `frontend/explorer/src/app/workstreams/[id]/page.tsx` - Batch Job Definition Queries ✅

**Problem:**  
Workstream page called `getJobDefinition()` in a loop for each unique job, making N separate GraphQL queries.

**Fix Applied:**
```typescript
// OLD (N queries):
for (const job of allJobs) {
  const jobDef = await getJobDefinition(job.jobDefinitionId) // 🐌
}

// NEW (1 batch query):
const uniqueJobDefIds = [...new Set(allJobs.map(j => j.jobDefinitionId))]
const jobDefsResponse = await request(query, { ids: uniqueJobDefIds })
const jobDefsById = new Map(jobDefsResponse.items.map(jd => [jd.id, jd]))
```

**Performance:** O(N) queries → O(1) batch query

---

## What Was Discovered (Not Broken)

### Auto-Redispatch Works Correctly!

**User Question:** "Why do jobs stay in WAITING status?"

**Answer:** They don't stay forever - they get re-dispatched multiple times!

**Evidence from Data:**
- "Trade Idea Generation & Synthesis" executed 4 times
- "ethereum-protocol-research" executed 5 times  
- "Protocol Analysis: Ethereum DeFi" executed 3 times

**How It Works:**
1. Job dispatches children → Finishes with `status: 'WAITING'`
2. Worker delivers to chain, Ponder indexes
3. **Children complete** → Worker's `dispatchParentIfNeeded()` auto-creates new request
4. Parent job re-runs with updated child context
5. Repeat until all work done

**Worker Code:**
```typescript
// worker/status/parentDispatch.ts:83-107
export function shouldDispatchParent(finalStatus, metadata) {
  if (finalStatus.status !== 'COMPLETED' && finalStatus.status !== 'FAILED') {
    return { shouldDispatch: false };
  }
  
  if (!metadata?.sourceJobDefinitionId) {
    return { shouldDispatch: false };
  }
  
  return { shouldDispatch: true }; // ✓ Auto-dispatch parent
}
```

---

## The Real Question: Why Multiple WAITING Cycles?

**Observation:**  
Jobs end in `WAITING` multiple times instead of transitioning to `COMPLETED` after children finish.

**Expected Behavior:**
1. Run 1: Dispatch 3 children → `WAITING`
2. Children complete → Auto-redispatch parent
3. Run 2: Synthesize child outputs → `COMPLETED` ✓

**Actual Behavior:**
1. Run 1: Dispatch 3 children → `WAITING`
2. Children complete → Auto-redispatch parent
3. Run 2: Still reports `WAITING` (why?)
4. Auto-redispatch again
5. Run 3: Still `WAITING`...
6. Run 4: Still `WAITING`...

**Possible Causes:**

### A. Hierarchy Data Stale
```typescript
// worker/status/inferStatus.ts:85-107
if (hierarchy && jobDefinitionId) {
  const children = extractChildrenFromHierarchy(hierarchy, jobDefinitionId);
  
  if (children.active.length > 0) {
    return { status: 'WAITING' }; // ← If this fires, children data is stale
  }
  
  return { status: 'COMPLETED' };
}
```

If `extractChildrenFromHierarchy()` uses cached metadata instead of querying fresh Ponder data, it won't see children are done.

### B. Agent Dispatches NEW Children Each Time
Agent might be:
1. Seeing children are complete
2. Deciding to dispatch DIFFERENT children for next phase
3. Never reaching final synthesis step

**Check blueprint:** Does `ethereum-protocol-research.json` guide the agent to a clear terminal state?

### C. Worker Status Inference Bug
`extractChildrenFromHierarchy()` might not be correctly determining if children are in terminal states.

---

## Next Steps

### Immediate: Inspect Latest WAITING Job Run

```bash
# Get the most recent "Trade Idea Generation" run (4th execution)
yarn inspect-job-run 0x138d94f21d6f0eed3acb5d7743ff6a9edfca9bff8c2f5743aad02482717e481f

# Check:
# 1. Does hierarchy show children as COMPLETED?
# 2. Did agent report "All children completed" but still return WAITING?
# 3. What does telemetry show for status inference?
```

### Medium: Add Logging to Status Inference

```typescript
// worker/status/inferStatus.ts:101
if (children.active.length > 0) {
  workerLogger.info({
    jobDefId: jobDefinitionId,
    activeChildren: children.active.map(c => ({ 
      id: c.id, 
      name: c.jobName, 
      lastStatus: c.lastStatus 
    })),
    completedChildren: children.completed.length
  }, 'Status: WAITING due to active children');
  
  return { status: 'WAITING', ... };
}
```

### Long-term: Terminal State Enforcement

Add validation that parent jobs MUST transition to `COMPLETED` when all children done:

```typescript
// worker/orchestration/jobRunner.ts (after status inference)
if (finalStatus.status === 'WAITING' && allChildrenComplete(hierarchy)) {
  workerLogger.error({
    requestId,
    jobDefId: metadata.jobDefinitionId,
    children: hierarchy
  }, 'BUG: Job reported WAITING but all children are complete');
  
  // Force COMPLETED if no new work dispatched
  finalStatus = { status: 'COMPLETED', message: 'All children complete' };
}
```

---

## Files Modified

1. `scripts/inspect-workstream.ts` - Fixed job definition query logic
2. `frontend/explorer/src/app/workstreams/[id]/page.tsx` - Batch-fetch job definitions
3. `WAITING_STATUS_ROOT_CAUSE.md` - Root cause analysis (created)
4. `SUMMARY_WORKSTREAM_FIXES.md` - This file (created)

---

## Gotchas for AGENT_README.md

### Gotcha #11: Job Definitions and Workstream Queries

**Issue:** Querying `job_definition.workstreamId` returns incomplete results  
**Root Cause:** Job definitions can be reused across workstreams, so `workstreamId` only stores the FIRST workstream  
**Solution:** Query `requests` table by `workstreamId`, extract unique `jobDefinitionId` values, then batch-fetch definitions  
**Prevention:**
```typescript
// ❌ Wrong:
const jobs = await query('jobDefinitions', { where: { workstreamId } })

// ✅ Correct:
const requests = await query('requests', { where: { workstreamId } })
const jobDefIds = [...new Set(requests.map(r => r.jobDefinitionId))]
const jobs = await query('jobDefinitions', { where: { id_in: jobDefIds } })
```

### Gotcha #12: Stale Hierarchy in Status Inference

**Issue:** Jobs cycle through WAITING status instead of transitioning to COMPLETED  
**Root Cause:** Hierarchy is a frozen snapshot from dispatch time, not a live query  
**Solution:** Query Ponder directly in `inferJobStatus()` for live child.delivered status  
**Details:** See `WAITING_CYCLES_ROOT_CAUSE.md` for full analysis and fix implementation

---

**End of Summary**

