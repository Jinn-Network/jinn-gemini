# Root Cause: Multiple WAITING Cycles

**Issue:** Jobs like "Trade Idea Generation & Synthesis" cycle through WAITING status 4+ times instead of transitioning to COMPLETED after children complete.

---

## The Root Cause: Stale Hierarchy Data

### Data Flow Timeline

1. **Dispatch Time (T0):** Parent is auto-dispatched by child completion
   - `buildJobHierarchy()` queries Ponder for `job_definition.lastStatus`
   - Returns hierarchy with child status (e.g., "WAITING")
   - Hierarchy embedded in `additionalContext` → uploaded to IPFS
   
2. **Indexing Time (T1):** Child deliveries update Ponder
   - Child jobs complete and deliver
   - Ponder indexes deliveries, updates `job_definition.lastStatus` to "COMPLETED"
   - **BUT: Parent job already dispatched with stale hierarchy data**

3. **Execution Time (T2):** Parent job runs
   - Worker fetches IPFS metadata (contains stale hierarchy from T0)
   - `inferJobStatus()` uses `metadata.additionalContext.hierarchy`
   - Checks `extractChildrenFromHierarchy()` → sees child status = "WAITING" (stale!)
   - Returns `status: 'WAITING'` even though Ponder now shows child = "COMPLETED"

4. **Delivery Time (T3):** Parent delivers WAITING
   - Child completes again → triggers another parent dispatch
   - Cycle repeats with fresh (but still slightly stale) hierarchy

### Code Path

```typescript
// gemini-agent/mcp/tools/shared/job-context-utils.ts:238-255
const rawStatus = job.lastStatus?.toUpperCase();  // ← From Ponder at dispatch time
let status: 'active' | 'completed' | 'failed' | 'unknown' = 'unknown';

if (rawStatus === 'COMPLETED') {
    status = 'completed';
} else if (rawStatus === 'DELEGATING' || rawStatus === 'WAITING' || rawStatus === 'PENDING') {
    status = 'active';  // ← Stale "WAITING" from T0 mapped to "active"
}

hierarchy.push({ jobId, status, ... });
```

```typescript
// worker/status/inferStatus.ts:102-106
if (children.active.length > 0) {
  return {
    status: 'WAITING',  // ← Block completion due to stale hierarchy
    message: `Waiting for ${children.active.length} active child job(s) to complete`
  };
}
```

---

## Why This Happens

**Hierarchy is a snapshot, not a query.**

- Built once at parent dispatch time
- Embedded in IPFS metadata (immutable)
- Worker uses this frozen snapshot during execution
- No live query to Ponder during status inference

**The 5-minute window:**
- Parent dispatch (T0): Hierarchy shows child = "WAITING"
- Child completes + indexes (T1): Ponder shows child = "COMPLETED" 
- Parent runs 2-3 minutes later (T2): Still using T0 hierarchy
- Gap = indexing delay + worker claim delay + execution time

---

## Evidence from Workstream Data

**"Trade Idea Generation & Synthesis" (4 runs):**
1. Run 1 (T1): 2025-11-27 18:27:17 → WAITING
2. Run 2 (T2): 2025-11-28 14:15:55 → WAITING (+19h 48m)
3. Run 3 (T3): 2025-11-28 14:28:47 → WAITING (+12m)
4. Run 4 (T4): 2025-11-28 17:09:09 → WAITING (+2h 40m)

**Pattern:** Long gaps between runs, suggesting worker is correctly waiting for children to complete. But when parent re-runs, it still sees stale "WAITING" status in hierarchy.

---

## The Solution

### Option A: Query Fresh Child Status During Inference (Recommended)

Modify `inferJobStatus()` to **always** query Ponder for live child statuses instead of trusting hierarchy:

```typescript
// worker/status/inferStatus.ts

export async function inferJobStatus(params: {
  requestId: string;
  error: any;
  telemetry: any;
  delegatedThisRun?: boolean;
  metadata?: IpfsMetadata;
}): Promise<FinalStatus> {
  const { requestId, error, telemetry, delegatedThisRun, metadata } = params;

  // ... FAILED and DELEGATING checks unchanged ...

  // 3. ALWAYS query live child status from Ponder (don't trust hierarchy)
  const jobDefinitionId = metadata?.jobDefinitionId;
  
  if (jobDefinitionId) {
    // Query all requests for this job definition (across all runs)
    const allRequestsForJob = await queryRequestsByJobDefinition(jobDefinitionId);
    
    // For each request, get its direct children
    const allChildrenAcrossRuns: Array<{id: string, delivered: boolean}> = [];
    for (const req of allRequestsForJob) {
      const childResult = await getChildJobStatus(req.id);
      allChildrenAcrossRuns.push(...childResult.childJobs);
    }
    
    // Dedupe children by request ID
    const uniqueChildren = new Map<string, boolean>();
    for (const child of allChildrenAcrossRuns) {
      if (!uniqueChildren.has(child.id)) {
        uniqueChildren.set(child.id, child.delivered);
      }
    }
    
    const undeliveredChildren = Array.from(uniqueChildren.entries())
      .filter(([_, delivered]) => !delivered);
    
    if (undeliveredChildren.length > 0) {
      return {
        status: 'WAITING',
        message: `Waiting for ${undeliveredChildren.length} child job(s) to deliver`
      };
    }
    
    // All children delivered → COMPLETED
    return {
      status: 'COMPLETED',
      message: uniqueChildren.size > 0
        ? `All ${uniqueChildren.size} child job(s) delivered`
        : 'Job completed direct work'
    };
  }

  // Fallback: per-request checking (existing logic)
  const childJobResult = await getChildJobStatus(requestId);
  // ... rest unchanged ...
}
```

**Benefits:**
- Guarantees fresh status from Ponder (single source of truth)
- No reliance on stale hierarchy snapshots
- Automatically handles all child jobs across all runs

**Trade-offs:**
- Additional Ponder queries during status inference (~2-3 queries per job)
- Slightly slower inference (acceptable for correctness)

---

### Option B: Refresh Hierarchy Before Execution

Update hierarchy data at worker claim time by re-querying Ponder:

```typescript
// worker/mech_worker.ts (in processRequest after fetchMetadata)

async function processRequest(request: UnclaimedRequest) {
  const metadata = await fetchMetadata(request.dataCID);
  
  // Refresh hierarchy if job has children
  if (metadata.additionalContext?.hierarchy && metadata.jobDefinitionId) {
    mcpLogger.info('Refreshing stale hierarchy data from Ponder');
    const freshHierarchy = await buildJobHierarchy(
      metadata.jobDefinitionId,
      maxDepth: 3
    );
    metadata.additionalContext.hierarchy = freshHierarchy.hierarchy;
    metadata.additionalContext.summary = freshHierarchy.summary;
  }
  
  // Continue with execution...
}
```

**Benefits:**
- Maintains hierarchy structure for agent context
- Single refresh point (before execution)

**Trade-offs:**
- Still a snapshot (could become stale during long-running jobs)
- Requires rebuilding entire hierarchy graph

---

### Option C: Hybrid Approach (Best)

1. **Use hierarchy for agent context** (planning, messages, artifacts)
2. **Query live status for inference** (completion checking)

```typescript
// Keep hierarchy in additionalContext for agent visibility
// BUT: inferJobStatus() queries Ponder directly for child.delivered status
// Combines benefits of both approaches
```

---

## Recommendation

**Implement Option A immediately:**
- Fixes the bug at the root (stale status checks)
- Simple, reliable, single source of truth
- Performance impact acceptable (~300ms per status check)

**Future optimization:**
- Add caching layer for child status queries (TTL = 30s)
- Batch child status queries if performance becomes an issue

---

## Testing Plan

1. **Find a WAITING job with completed children:**
   ```bash
   yarn inspect-workstream 0x0d2dcd01a6c0f62dafbc93bc314bd7b766296e8b6cbebf5ae62815ecb453594c
   # Identify job: "Trade Idea Generation & Synthesis" (lastStatus: WAITING)
   ```

2. **Manually verify children are completed in Ponder:**
   ```graphql
   query {
     requests(where: { sourceRequestId: "0x138d94f21d6f0eed3acb5d7743ff6a9edfca9bff8c2f5743aad02482717e481f" }) {
       items { id delivered }
     }
   }
   ```

3. **Apply fix to inferJobStatus()**

4. **Re-run job and verify:**
   ```bash
   MECH_TARGET_REQUEST_ID=0x138d94f21d6f0eed3acb5d7743ff6a9edfca9bff8c2f5743aad02482717e481f yarn mech --single
   # Expected: Status transitions to COMPLETED (not WAITING)
   ```

---

## Files to Modify

1. **worker/status/inferStatus.ts** – Add live Ponder queries
2. **worker/status/childJobs.ts** – Add `queryRequestsByJobDefinition()` helper
3. **worker/status/inferStatus.ts** – Remove reliance on `metadata.additionalContext.hierarchy` for status checking

---

**Next Steps:** Implement Option A fix and test with current WAITING jobs.

