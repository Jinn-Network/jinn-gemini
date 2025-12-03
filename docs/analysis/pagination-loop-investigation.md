# Pagination Loop Investigation (JINN-248)

**Date**: 2025-12-02  
**Issue**: Agent killed by loop protection after 10 identical "paginating to next batch" outputs  
**Job**: `ethereum-protocol-research` (0x486db2d5c01a6228eb7ae45d0f4f915e491e25cce7fed110d2ccf4b584cbe542)

---

## Incident Summary

### What Happened
Agent execution terminated after ~9 minutes when loop protection detected 10 consecutive identical stdout chunks:

```
Okay, artifacts retrieved. Now paginating to the next batch using the cursor to complete the data set.
```

**Terminal Evidence** (lines 716-728 of `terminals/7.txt`):
- Lines 716-724: Agent outputs identical message 9 times (visible)
- Line 725: Loop protection triggers: `WARN: Terminating process due to identical chunk repetition`
- Line 726: `identicalChunks: 10, maxIdenticalChunks: 10`

### Context
- **Job Phase**: Execution (after recognition and progress summarization)
- **Workstream State**: 26 completed jobs, 100+ artifacts available
- **Agent Plan**: Review completed children (12 CTX-CHILD assertions), synthesize final deliverable
- **Last Tool Call**: `search_artifacts` with pagination cursor (line 713-715: "I have retrieved the first two artifacts...")

---

## Root Cause Analysis

### The Pagination Trap

#### 1. Tool Design Issue: Database-Client Pagination Mismatch

**Location**: `gemini-agent/mcp/tools/search-artifacts.ts` lines 39-120

```typescript
// Step 1: Query Ponder database (HARD LIMIT: 100 items)
const artifactsGql = `query SearchArtifacts($q: String!, $limit: Int!) {
  artifacts(where: { ... }, limit: $limit) { items { ... } }
}`;
const variables = { q: query, limit: 100 };  // ← Always fetches 100 max

// Step 2: Apply client-side token-budget pagination
const composed = composeSinglePageResponse(enrichedArtifacts, {
  startOffset: keyset.offset,
  pageTokenBudget: 10000,  // ← 10k token budget per page
  // ...
});
```

**The Problem**:
- Database returns **fixed set** of 100 artifacts (or fewer if less match query)
- Client-side pagination operates on **same 100-item array** using offset
- When token budget (10k) is smaller than encoded size of 100 artifacts, only first N artifacts fit in page
- Agent receives `has_more: true` and `next_cursor` with advanced offset (e.g., offset=5)
- **Next call**: Fetches same 100 artifacts from database, applies offset=5 client-side, gets artifacts 5-10
- **Result**: Agent sees "new" artifacts (different offsets), produces same output, repeats

#### 2. Agent Behavior Issue: Exhaustive Artifact Retrieval Attempt

**Location**: Terminal lines 708-715

```
I will begin by contextualizing the job, starting with a thorough review of the blueprint...
I have retrieved the first two artifacts: `ethereum_protocol_activity_report.md`...
The tool indicates more results are available, so I will now fetch the next batch...
```

**The Problem**:
- Blueprint includes 12 CTX-CHILD assertions (requiring child job review)
- Agent interprets this as: "Must review ALL artifacts from ALL completed children"
- Workstream has 26 completed jobs × ~4 artifacts/job = 100+ artifacts
- Agent attempts exhaustive pagination to "get complete picture"
- No awareness that pagination is futile (same results) or unnecessary (sampling would suffice)

---

## Why Loop Protection Triggered

**Location**: `gemini-agent/agent.ts` lines 418-431

```typescript
// Check for identical chunk repetition
chunkHistory.push(chunk);
if (chunkHistory.length > this.MAX_IDENTICAL_CHUNKS) {
  chunkHistory.shift();
}

const identicalChunks = chunkHistory.filter(c => c === chunk).length;
if (identicalChunks >= this.MAX_IDENTICAL_CHUNKS) {  // Default: 10
  agentLogger.warn({ identicalChunks, maxIdenticalChunks: this.MAX_IDENTICAL_CHUNKS }, 
    'Terminating process due to identical chunk repetition');
  terminated = true;
  terminationReason = `Identical chunks repeated ${identicalChunks} times`;
  geminiProcess.kill('SIGTERM');
  return;
}
```

**Trigger Conditions Met**:
1. Agent produced same stdout text 10 times: "Okay, artifacts retrieved. Now paginating..."
2. No tool calls between outputs (agent was in pure reasoning loop)
3. Each iteration took ~10-30 seconds (total ~9 minutes before kill)
4. Loop protection correctly identified pathological behavior and terminated

**Loop Protection Working as Designed**:
- Prevents infinite loops from wasting compute/tokens
- Preserves partial output and telemetry for debugging
- Allows investigation of what caused loop (this document)

---

## Impact Assessment

### Immediate Impact
- **Job Status**: FAILED (killed by loop protection)
- **Tokens Wasted**: ~40k tokens on repetitive pagination
- **Time Lost**: ~9 minutes of execution
- **Workstream State**: PRESERVED (parent job can be re-run)

### Systemic Risk
- **Frequency**: RARE - requires:
  1. Large workstream (50+ artifacts)
  2. Agent attempting exhaustive artifact review
  3. Tool returning pagination signals on same database page
- **Similar Tools Affected**: `search_jobs` uses same pagination pattern
- **Blast Radius**: Limited to jobs attempting exhaustive search with pagination

---

## Solutions

### Solution 1: Short-Term (Agent Prompting) ✅ RECOMMENDED

**Approach**: Add blueprint assertion to prevent exhaustive artifact retrieval

**Implementation**:
```json
{
  "id": "CTX-001",
  "assertion": "When reviewing completed children, SAMPLE artifacts instead of exhaustive retrieval. Do NOT paginate through all artifacts.",
  "examples": {
    "do": [
      "Call search_artifacts ONCE without cursor to sample recent artifacts",
      "Review first 5-10 artifacts to understand patterns",
      "Delegate child job if exhaustive artifact analysis required"
    ],
    "dont": [
      "Paginate through all artifacts using cursor",
      "Attempt to fetch every artifact from 50+ artifact workstream",
      "Spend more than 1-2 search_artifacts calls per job"
    ]
  },
  "commentary": "Artifact sampling provides sufficient context. Exhaustive review is unnecessary and risks pagination loops."
}
```

**Pros**:
- Immediate deployment (no code changes)
- Prevents agent from attempting exhaustive retrieval
- Reduces token usage even when pagination works correctly

**Cons**:
- Relies on agent following instructions (not guaranteed)
- Doesn't fix underlying tool design issue

**Deployment**: Add to `ethereum-protocol-research` blueprint and template blueprints for synthesis jobs

---

### Solution 2: Medium-Term (Tool Improvement) ⚠️ PARTIAL FIX

**Approach**: Make `composeSinglePageResponse` aware of upstream database limit to prevent false pagination signals

**Implementation**:
```typescript
// gemini-agent/mcp/tools/search-artifacts.ts
export async function searchArtifacts(params: SearchArtifactsParams) {
  const DATABASE_LIMIT = 100;
  const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };
  
  // Fetch from Ponder
  const variables = { q: query, limit: DATABASE_LIMIT };
  const artifacts = json?.data?.artifacts?.items || [];
  
  // Apply pagination
  const composed = composeSinglePageResponse(enrichedArtifacts, {
    startOffset: keyset.offset,
    pageTokenBudget: 10000,
    // NEW: Pass database limit to prevent false pagination
    upstreamLimit: DATABASE_LIMIT,
  });
  
  return { content: [{ type: 'text', text: JSON.stringify({ 
    data: composed.data, 
    meta: { ok: true, ...composed.meta }
  }) }] };
}

// gemini-agent/mcp/tools/shared/context-management.ts
export function composeSinglePageResponse(
  allItems: any[],
  opts: ComposeSinglePageOptions & { upstreamLimit?: number } = {}
): ComposeSinglePageResult {
  const page = buildSinglePageFromItems(allItems, opts);
  
  // NEW: If next offset exceeds upstream limit, no more results exist
  const upstreamLimit = opts.upstreamLimit;
  if (upstreamLimit && page.nextCursor) {
    const decoded = decodeCursor<{ offset: number }>(page.nextCursor);
    if (decoded && decoded.offset >= upstreamLimit) {
      page.nextCursor = undefined;  // No more results possible
    }
  }
  
  return { meta: { ...meta, next_cursor: page.nextCursor }, data: page.pageItems };
}
```

**Pros**:
- Fixes false pagination signals when client budget < database page size
- Prevents pagination loops even if agent ignores prompting
- Small, focused change (~10 lines)

**Cons**:
- Doesn't address agent behavior (agent might still try pagination, just stops sooner)
- Only fixes offset-based pagination (not keyset/cursor-based from external APIs)
- Requires testing across all tools using `composeSinglePageResponse`

**Testing Required**:
- `search_artifacts` with 100+ results and 10k token budget
- `search_jobs` with 100+ results and 10k token budget
- Edge case: exactly 100 results (should return `has_more: false`)

---

### Solution 3: Long-Term (Architecture) ⏰ FUTURE WORK

**Approach**: Replace offset-based pagination with keyset pagination or streaming API

**Option A: Keyset Pagination**
```graphql
query SearchArtifacts($q: String!, $lastId: String, $limit: Int!) {
  artifacts(
    where: { OR: [...], id_gt: $lastId },
    orderBy: { id: "asc" },
    limit: $limit
  ) {
    items { id, name, cid, ... }
  }
}
```

**Option B: Server-Side Token Budget**
- Move token-budget pagination to Ponder indexer
- Return pre-paginated results that respect token limits
- Eliminate client-side `composeSinglePageResponse` complexity

**Pros**:
- Eliminates offset/limit mismatch entirely
- Scales to arbitrary result set sizes
- Enables true incremental pagination

**Cons**:
- Requires Ponder schema changes (add `id_gt` filter)
- Breaking change for existing tool consumers
- More complex error handling (keyset invalidation)

**Timeline**: Q1 2025 (after current workstream stabilization)

---

## Recommendations

### Immediate Actions (This Week)
1. ✅ **Add anti-pagination assertion** to `ethereum-protocol-research` blueprint
2. ✅ **Update AGENT_README.md** with gotcha documentation (lines 2255-2284)
3. 🔲 **Implement Solution 2** (upstreamLimit fix) in `composeSinglePageResponse`
4. 🔲 **Add unit test** for pagination boundary conditions

### Short-Term (This Sprint)
5. 🔲 **Audit all `composeSinglePageResponse` call sites** for similar issues:
   - `search_jobs` (same pattern)
   - `civitai_search_images` (uses external API cursor)
   - `civitai_search_models` (uses external API cursor)
6. 🔲 **Add integration test**: Agent with 100+ artifact workstream, verify no pagination loops

### Long-Term (Q1 2025)
7. 🔲 **Design keyset pagination RFC** for Ponder + MCP tools
8. 🔲 **Evaluate server-side token budgets** (move logic to indexer)

---

## Related Issues

- **JINN-202**: Agent polling loops after delegation (similar loop protection trigger, different root cause)
- **JINN-186**: Workstream completion detection (related to exhaustive child review patterns)
- **Loop Protection Spec**: `docs/spec/blueprint/requirements/execution.md` lines 104-141

---

## Appendix: Terminal Logs

**Full Log Location**: `/Users/gcd/.cursor/projects/Users-gcd-Repositories-main-jinn-cli-agents/terminals/7.txt`

**Key Events**:
```
[2025-12-02 09:17:33.105] Claimed request 0x486db2d5c01a6228eb7ae45d0f4f915e491e25cce7fed110d2ccf4b584cbe542
[2025-12-02 09:17:35.147] Starting AI summarization of workstream progress (26 completed jobs)
[2025-12-02 09:18:15.984] AI summarization completed (6272 chars, 31669 tokens)
[2025-12-02 09:18:25.632] Recognition phase produced learnings (1 learning)
[2025-12-02 09:18:25.638] CTX-CHILD assertions generated for 12 completed children
[2025-12-02 09:18:25.889] Spawning Gemini CLI (model: gemini-2.5-pro, phase: execution)

# Agent output (lines 708-724):
I will begin by contextualizing the job...
I have retrieved the first two artifacts...
Okay, artifacts retrieved. Now paginating to the next batch using the cursor to complete the data set.
Okay, artifacts retrieved. Now paginating to the next batch using the cursor to complete the data set.
Okay, artifacts retrieved. Now paginating to the next batch using the cursor to complete the data set.
... (repeated 7 more times)

[2025-12-02 09:27:22.398] WARN: Terminating process due to identical chunk repetition
    identicalChunks: 10
    maxIdenticalChunks: 10
```

**Time Breakdown**:
- Progress summarization: 43 seconds (09:17:35 → 09:18:15)
- Recognition phase: 8 seconds (09:18:16 → 09:18:25)
- Execution setup: 1 second (09:18:25 → 09:18:25)
- Pagination loop: ~9 minutes (09:18:25 → 09:27:22) ← **Problem**

**Token Costs**:
- Progress summarization: 31,669 tokens
- Recognition phase: ~8,000 tokens (estimated)
- Pagination loop: ~40,000 tokens (estimated, 10 iterations × 4k tokens/page)
- **Total wasted**: ~80k tokens on job that never produced deliverable

---

## Testing Notes

### Reproduction Steps
1. Create workstream with 50+ completed jobs (each producing 2-4 artifacts)
2. Dispatch synthesis job with blueprint requiring "review completed children"
3. Agent will attempt `search_artifacts` pagination
4. Verify loop protection triggers after 10 identical chunks

### Verification of Fix
1. Apply Solution 1 (assertion) or Solution 2 (upstreamLimit)
2. Re-run same scenario
3. Expected behavior:
   - **With Solution 1**: Agent calls `search_artifacts` once, samples first page, proceeds to synthesis
   - **With Solution 2**: Agent sees `has_more: false` after first page, stops pagination
4. Job completes successfully with <5 `search_artifacts` calls

