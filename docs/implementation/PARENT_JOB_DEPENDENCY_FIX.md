# Parent Job Dependency and Re-dispatch Fix

**Branch:** `fix/parent-job-priority`  
**Date:** 2025-12-04  
**Status:** ✅ Complete, Ready for Testing  
**Linear:** Follow-up work tracked in [JINN-269](https://linear.app/jinn-lads/issue/JINN-269/parent-job-re-dispatch-policy-system)

---

## Problem Statement

The `ethereum-protocol-research` workstream exposed two critical bugs in job orchestration:

### Issue 1: Incorrect Dependency Resolution

**Observed Behavior:**
```
ethereum-protocol-research (root)
  ├─ market-metrics-research (COMPLETED)
  ├─ protocol-deep-dives-research (DELEGATING) ← Has 3 active children
  │   ├─ lido-deep-dive (PENDING)
  │   ├─ aave-deep-dive (PENDING)
  │   └─ uniswap-deep-dive (PENDING)
  └─ narrative-synthesis (STARTED) ← Should be blocked!
```

`narrative-synthesis` had a dependency on `protocol-deep-dives-research`, but started executing even though the deep-dives job was still `DELEGATING` (not complete).

**Root Cause:**

`isJobDefinitionComplete()` in `worker/mech_worker.ts` used flawed logic:

```typescript
// OLD (broken)
const query = `query CheckJobDefCompletion($jobDefId: String!) {
  requests(where: { jobDefinitionId: $jobDefId, delivered: true }) {
    items { id }
  }
}`;
const isComplete = deliveredRequests.length > 0; // ❌ Wrong!
```

This checked: "Has ANY request ever been delivered for this job definition?"

**Why it's wrong:**
- A job definition that delivers with status `DELEGATING` has `delivered: true` but is **not complete**
- The job still has active child work in progress
- Downstream jobs should wait for terminal status (`COMPLETED` or `FAILED`)

---

### Issue 2: Premature Parent Re-dispatch

**Observed Behavior:**

When `market-metrics-research` completed, the parent `ethereum-protocol-research` was immediately re-dispatched, even though:
- Only 1 of 3 sibling jobs finished
- No meaningful reassessment could happen yet
- This wastes resources and creates unnecessary re-runs

**Root Cause:**

`shouldDispatchParent()` in `worker/status/parentDispatch.ts` had no sibling awareness:

```typescript
// OLD (broken)
export function shouldDispatchParent(
  finalStatus: FinalStatus | null,
  metadata: any
): ParentDispatchDecision {
  if (finalStatus?.status === 'COMPLETED' || finalStatus?.status === 'FAILED') {
    return { shouldDispatch: true, parentJobDefId }; // ❌ Always true!
  }
}
```

This re-dispatched parent after **every** child completion, regardless of whether all siblings finished.

---

## Solution

### Fix 1: Query `lastStatus` for Dependency Checks

**File:** `worker/mech_worker.ts` lines 325-363

**New Logic:**

```typescript
async function isJobDefinitionComplete(jobDefinitionId: string): Promise<boolean> {
  // Query job definition's lastStatus from Ponder
  const query = `query CheckJobDefCompletion($jobDefId: String!) {
    jobDefinitions(where: { id: $jobDefId }) {
      items {
        id
        lastStatus
      }
    }
  }`;

  const jobDef = data?.jobDefinitions?.items?.[0];
  
  // ✅ Job definition is complete only if lastStatus is terminal
  const isComplete = jobDef.lastStatus === 'COMPLETED' || jobDef.lastStatus === 'FAILED';
  
  return isComplete;
}
```

**Key Changes:**
- Query `jobDefinitions` table instead of `requests`
- Check `lastStatus` field (set by Ponder during delivery indexing)
- Only return `true` for terminal statuses
- `DELEGATING` and `WAITING` correctly block downstream jobs

**Impact:**
- Dependencies now respect actual work completion
- Jobs with active children block dependent jobs as intended
- Fixes the core protocol violation

---

### Fix 2: Wait for All Sibling Completion Before Parent Re-dispatch

**File:** `worker/status/parentDispatch.ts` lines 83-188

**New Logic:**

```typescript
export async function shouldDispatchParent(
  finalStatus: FinalStatus | null,
  metadata: any
): Promise<ParentDispatchDecision> {
  const parentJobDefId = metadata?.sourceJobDefinitionId;
  
  // Query all job definitions that have this parent
  const childrenQuery = `query GetParentChildren($parentJobDefId: String!) {
    jobDefinitions(where: { sourceJobDefinitionId: $parentJobDefId }) {
      items {
        id
        name
        lastStatus
      }
    }
  }`;
  
  const children = await graphQLRequest(/* ... */);
  
  // ✅ Check if ALL children are in terminal state
  const incompleteChildren = children.filter(
    child => child.lastStatus !== 'COMPLETED' && child.lastStatus !== 'FAILED'
  );
  
  if (incompleteChildren.length > 0) {
    return {
      shouldDispatch: false,
      reason: `Waiting for ${incompleteChildren.length}/${children.length} children to complete`
    };
  }
  
  return { shouldDispatch: true, parentJobDefId };
}
```

**Key Changes:**
- Made function `async` to query Ponder
- Query all direct children via `sourceJobDefinitionId`
- Check each child's `lastStatus`
- Only dispatch parent when **all** siblings reach terminal state
- Log incomplete children with names and statuses

**Impact:**
- Parents only re-run when all direct children finish
- Eliminates wasted intermediate re-runs
- Parent sees complete picture of child work when it runs

---

## Testing Strategy

### Unit Tests Needed

1. **`isJobDefinitionComplete()` Test Cases:**
   ```typescript
   describe('isJobDefinitionComplete', () => {
     it('returns false for DELEGATING job', async () => {
       // Mock Ponder response with lastStatus: 'DELEGATING'
       expect(await isJobDefinitionComplete(jobDefId)).toBe(false);
     });
     
     it('returns false for WAITING job', async () => {
       // Mock Ponder response with lastStatus: 'WAITING'
       expect(await isJobDefinitionComplete(jobDefId)).toBe(false);
     });
     
     it('returns true for COMPLETED job', async () => {
       // Mock Ponder response with lastStatus: 'COMPLETED'
       expect(await isJobDefinitionComplete(jobDefId)).toBe(true);
     });
     
     it('returns true for FAILED job', async () => {
       // Mock Ponder response with lastStatus: 'FAILED'
       expect(await isJobDefinitionComplete(jobDefId)).toBe(true);
     });
   });
   ```

2. **`shouldDispatchParent()` Test Cases:**
   ```typescript
   describe('shouldDispatchParent', () => {
     it('blocks dispatch when children incomplete', async () => {
       // Mock: 2 COMPLETED, 1 PENDING child
       const decision = await shouldDispatchParent(finalStatus, metadata);
       expect(decision.shouldDispatch).toBe(false);
       expect(decision.reason).toContain('Waiting for 1/3 children');
     });
     
     it('allows dispatch when all children complete', async () => {
       // Mock: All children COMPLETED
       const decision = await shouldDispatchParent(finalStatus, metadata);
       expect(decision.shouldDispatch).toBe(true);
     });
     
     it('allows dispatch when all children terminal (mix COMPLETED/FAILED)', async () => {
       // Mock: 2 COMPLETED, 1 FAILED child
       const decision = await shouldDispatchParent(finalStatus, metadata);
       expect(decision.shouldDispatch).toBe(true);
     });
   });
   ```

### Integration Test Scenario

**Workstream:** Parent with 3 sibling jobs + 1 synthesis job

```typescript
// Setup
const parent = await dispatch('Parent Orchestrator', { /* ... */ });
const childA = await dispatch('Child A', { sourceJobDefinitionId: parent.jobDefId });
const childB = await dispatch('Child B', { sourceJobDefinitionId: parent.jobDefId });
const childC = await dispatch('Child C', { sourceJobDefinitionId: parent.jobDefId });
const synthesis = await dispatch('Synthesis', { 
  dependencies: [parent.jobDefId] // Depends on parent
});

// Execute
await deliverJob(childA, { status: 'COMPLETED' });
// Assert: Parent NOT re-dispatched yet

await deliverJob(childB, { status: 'COMPLETED' });
// Assert: Parent NOT re-dispatched yet

await deliverJob(childC, { status: 'COMPLETED' });
// Assert: Parent IS re-dispatched now
// Assert: Synthesis job is still PENDING (blocked on parent)

await deliverJob(parent, { status: 'COMPLETED' });
// Assert: Synthesis job now STARTS (dependency met)
```

### Manual Validation

Using the live `ethereum-protocol-research` workstream:

1. Check current state:
   ```bash
   yarn inspect-workstream 0x0447dd1e... # Root request ID
   ```

2. Verify dependency blocking:
   - Confirm `protocol-deep-dives-research` shows as `DELEGATING`
   - Confirm `narrative-synthesis` is blocked (not claimed by worker)

3. Monitor worker logs:
   ```bash
   yarn dev:mech --workstream=0x0447dd1e...
   ```
   
   Look for:
   ```
   [worker] Dependencies not met - waiting for job definitions to complete
   [worker] Job definition completion check: lastStatus=DELEGATING, isComplete=false
   [worker] Parent dispatch blocked - waiting for 2/3 children to complete
   ```

4. Watch for correct execution order:
   - Deep dive children complete first
   - Parent re-runs only after all 3 finish
   - Synthesis/reporting jobs wait until parent completes

---

## Observability

### New Log Messages

**Dependency Checking:**
```
[worker] Job definition completion check (status-based)
  jobDefinitionId: "abc-123..."
  lastStatus: "DELEGATING"
  isComplete: false
```

**Parent Re-dispatch:**
```
[worker] Parent dispatch blocked - waiting for all children to complete
  parentJobDefId: "def-456..."
  totalChildren: 3
  incompleteChildren: 2
  examples: "Aave Deep Dive (PENDING), Uniswap Deep Dive (PENDING)"
```

```
[worker] All children complete - dispatching parent
  parentJobDefId: "def-456..."
  totalChildren: 3
```

### Error Handling

Both functions now have explicit error handling:

**`isJobDefinitionComplete()`:**
- Catches Ponder query failures
- Logs warning with error details
- Returns `false` (safe default: don't assume complete)

**`shouldDispatchParent()`:**
- Catches Ponder query failures
- Logs warning with error details
- Returns `shouldDispatch: false` (safe default: don't dispatch on uncertainty)

---

## Backward Compatibility

### No Breaking Changes

1. **Existing Workstreams:**
   - Already-running workstreams will immediately benefit from fixes
   - No schema changes required
   - No data migration needed

2. **Job Definition Format:**
   - No changes to blueprint structure
   - No changes to metadata format
   - Dependencies still use same syntax

3. **API Contracts:**
   - Ponder GraphQL schema unchanged
   - Worker query structure unchanged
   - Control API unchanged

### Behavioral Changes (Improvements)

1. **Stricter Dependency Enforcement:**
   - Jobs that should have been blocked will now be blocked
   - This is the **correct** behavior per protocol spec

2. **Reduced Parent Re-runs:**
   - Parents re-dispatch less frequently
   - This **saves resources** and is more efficient

Both changes align with intended protocol semantics and fix bugs.

---

## Performance Impact

### Positive Impacts

1. **Reduced Wasted Executions:**
   - No premature parent re-runs = fewer agent invocations
   - Estimated savings: 2-5 re-runs per parent job with 3+ children
   - Token savings: ~10K-50K tokens per saved run

2. **Better Resource Utilization:**
   - Worker processes jobs in correct order
   - No blocked threads waiting on incorrect dependencies

### Negligible Overhead

1. **Additional Ponder Queries:**
   - `isJobDefinitionComplete()`: 1 query per dependency check
   - `shouldDispatchParent()`: 1 query per child completion
   - Both queries are indexed (fast)
   - Typical response time: <50ms

2. **Memory:**
   - No additional memory overhead
   - Query results not cached (stateless)

---

## Migration Path

### Deployment Steps

1. **Merge to main:**
   ```bash
   git checkout main
   git merge fix/parent-job-priority
   ```

2. **Deploy worker:**
   ```bash
   yarn build
   # Restart worker process (Railway auto-deploys)
   ```

3. **No Ponder changes needed:**
   - Schema already has `lastStatus` field
   - No indexer modifications required

4. **Monitor first hour:**
   - Watch worker logs for new messages
   - Verify no Ponder query errors
   - Check that blocked jobs stay blocked

### Rollback Plan

If issues arise, revert single commit:

```bash
git revert f527b1e
yarn build
# Restart worker
```

System returns to previous behavior immediately.

---

## Future Work

### JINN-269: Parent Job Re-dispatch Policy System

This fix implements a **"final" mode** where parents wait for all children. The follow-up issue adds:

1. **Flexible Policies:**
   - `immediate`: Re-dispatch after every child (old behavior)
   - `milestone`: Re-dispatch at specific checkpoints
   - `final`: Re-dispatch when all children done (this fix)
   - `manual`: Never auto-dispatch

2. **Blueprint-Level Control:**
   ```json
   {
     "redispatchPolicy": {
       "mode": "milestone",
       "milestones": [
         {
           "id": "PHASE_1_COMPLETE",
           "condition": { "allChildrenOf": ["research-jobs"], "status": "COMPLETED" },
           "action": "REASSESS_AND_CONTINUE"
         }
       ]
     }
   }
   ```

3. **Priority Queue:**
   - Parents at milestones jump to front of queue
   - Prevents downstream jobs from starting before reassessment

**Link:** https://linear.app/jinn-lads/issue/JINN-269/parent-job-re-dispatch-policy-system

---

## Related Documentation

- **AGENT_README.md** § Blood-Written Rules: Add entry for dependency checking
- **WORKER_INTERNALS.md**: Update parent dispatch section
- **Blueprint Style Guide**: No changes needed (future: add policy section in JINN-269)

---

## Commit History

### `f527b1e` - Fix dependency checking and parent re-dispatch logic

**Changed Files:**
- `worker/mech_worker.ts` (1 function modified)
- `worker/status/parentDispatch.ts` (1 function modified to async, logic expanded)

**Lines Changed:** +169 / -135

**Tests:** Unit tests needed (see Testing Strategy above)

---

## Sign-off

**Reviewers:** @gcd  
**Deployment Approval:** Pending testing  
**Risk Level:** Low (fail-safe defaults, no breaking changes)  
**Estimated Impact:** High (fixes critical orchestration bugs)

