# Recognition Quality Problem: Learning from Incomplete Workstreams

**Date**: 2025-11-17  
**Issue**: Recognition system learns from individual job success without considering workstream-level completion

## Problem Statement

The current recognition system performs semantic search across all completed jobs to find similar past situations. However, it has no concept of **workstream-level success**—whether a job contributed to a successful end-to-end workflow or was part of an abandoned/failed workstream.

### Real-World Example

Job run `0xf6fc13ecca8c6806dccf7fe0b2d3fd276a44a095539b8c0bacdc1661f5e3d10b` (ethereum-protocol-research):

1. Recognition phase found similar past jobs that "successfully" delegated to child jobs
2. Agent learned: "Decompose research", "Use existing blueprints from `blueprints/` directory"
3. **But**: Those past workstreams never completed—they were abandoned mid-execution

The agent is learning patterns from **locally successful but globally failed workflows**.

## Current Architecture

### What's Indexed in `node_embeddings`

```sql
CREATE TABLE node_embeddings (
  node_id TEXT PRIMARY KEY,           -- Request ID
  vec VECTOR(256) NOT NULL,            -- Semantic embedding
  summary TEXT,                        -- Searchable summary
  meta JSONB DEFAULT '{}'              -- Job metadata
);
```

**`meta` contains:**
- `job`: {jobName, prompt, tools, model, requestId}
- `context`: {parent, children, siblings}
- `artifacts`: Array of created artifacts
- `recognition`: Learnings used by this job
- `execution`: {finalStatus, finalOutputSummary, trace}

**`meta` does NOT contain:**
- ❌ Workstream completion status
- ❌ Root job final outcome
- ❌ Whether this contributed to successful delivery
- ❌ Quality/usefulness markers

### Current Vector Search

```typescript
// gemini-agent/mcp/tools/search_similar_situations.ts
SELECT node_id, summary, meta, score
FROM (
  SELECT node_id, summary, meta,
         1 - (vec <=> $1::vector) AS score
  FROM node_embeddings
) AS scored
ORDER BY score DESC
LIMIT $2;
```

**No filtering** for:
- Workstream success
- Root job completion
- Job quality/utility

## Why This Matters

**Impact on agent behavior:**
- Learns ineffective delegation patterns from failed workstreams
- Perpetuates patterns that seemed locally good but globally bad
- No pressure toward convergence on successful strategies
- "Zombie patterns" persist: behaviors that don't crash but don't deliver value

**Observed symptoms:**
- Agent copies blueprint directory usage without question
- Repeats delegation patterns even when simpler approaches work
- No evolutionary pressure toward efficient solutions

## Potential Solutions

### Option 1: Workstream Completion Tracking (Lazy Evaluation)

**Concept**: Mark situations with workstream success status retroactively when root jobs complete.

**Implementation:**

```sql
-- Add workstream tracking to meta during indexing
meta JSONB: {
  ...existing fields...,
  workstream: {
    id: "0x...",
    isRoot: true,
    rootJobStatus: "COMPLETED" | "FAILED" | null,
    completedAt: "2025-11-17T...",
    completionVerified: true  -- Set when root delivers
  }
}
```

**Recognition search filter:**
```sql
WHERE meta->'workstream'->>'completionVerified' = 'true'
  AND meta->'workstream'->>'rootJobStatus' = 'COMPLETED'
```

**Pros:**
- Objective metric (workstream completed = good pattern)
- Automatic - no manual curation
- Retroactive application to existing data

**Cons:**
- Requires backfill logic when root completes
- Child jobs don't know outcome until much later
- Complexity: tracking workstream state across distributed jobs

**Effort**: Medium (1-2 days)

---

### Option 2: Explicit Quality Curation

**Concept**: Manual tagging of "golden path" examples by humans or automated quality checks.

**Implementation:**

```sql
-- Add quality markers
meta JSONB: {
  ...existing fields...,
  quality: {
    verified: true,
    verifiedBy: "human" | "automated",
    verifiedAt: "2025-11-17T...",
    tags: ["efficient", "correct", "exemplar"]
  }
}
```

**Curation interface:**
```bash
yarn tsx scripts/memory/curate-situation.ts <requestId> --verify --tags efficient,correct
```

**Recognition search filter:**
```sql
WHERE meta->'quality'->>'verified' = 'true'
```

**Pros:**
- High signal - only learn from verified good examples
- Human judgment for nuanced quality
- Explicit control over learning corpus

**Cons:**
- Manual labor required
- Doesn't scale without automation
- Risk of stale examples as system evolves

**Effort**: Low initial (half day), ongoing maintenance

---

### Option 3: Time-Based Decay + Recency Bias

**Concept**: Weight recent completions higher, assume failures naturally fade with system improvements.

**Implementation:**

```typescript
// Modify scoring to include recency
SELECT node_id, summary, meta,
       (1 - (vec <=> $1::vector)) * recency_weight AS score
FROM (
  SELECT *,
    CASE 
      WHEN updated_at > NOW() - INTERVAL '7 days' THEN 1.0
      WHEN updated_at > NOW() - INTERVAL '30 days' THEN 0.7
      WHEN updated_at > NOW() - INTERVAL '90 days' THEN 0.4
      ELSE 0.2
    END as recency_weight
  FROM node_embeddings
) AS weighted
ORDER BY score DESC
```

**Pros:**
- Simple to implement
- Naturally evolves with system improvements
- No backfill or curation needed

**Cons:**
- Assumes newer = better (not always true)
- Still learns from recent failures
- Loses valuable old examples

**Effort**: Low (1-2 hours)

---

### Option 4: Outcome-Based Re-Ranking

**Concept**: Perform semantic search first, then re-rank results by workstream success probability.

**Implementation:**

```typescript
// Two-phase search:
// 1. Semantic similarity (top 20)
const candidates = await searchSimilarSituations(embedding, k: 20);

// 2. Re-rank by success heuristics
const reranked = candidates
  .map(c => ({
    ...c,
    successScore: calculateSuccessScore(c.meta)
  }))
  .sort((a, b) => b.successScore - a.successScore)
  .slice(0, 5);

function calculateSuccessScore(meta: any): number {
  let score = 0.5; // baseline
  
  // +0.3 if workstream completed
  if (meta.workstream?.completionVerified) score += 0.3;
  
  // +0.2 if artifacts created
  if (meta.artifacts?.length > 0) score += 0.2;
  
  // -0.2 if FAILED status
  if (meta.execution?.finalStatus === 'FAILED') score -= 0.2;
  
  // Recency bonus
  const age = Date.now() - new Date(meta.updatedAt).getTime();
  const daysSince = age / (1000 * 60 * 60 * 24);
  if (daysSince < 7) score += 0.1;
  
  return score;
}
```

**Pros:**
- Combines semantic similarity with quality signals
- Flexible - easy to tune heuristics
- Works with existing data

**Cons:**
- Heuristic-based (may not capture true quality)
- Requires tuning based on observed patterns
- Still needs workstream completion data

**Effort**: Low-Medium (half day)

---

## Recommended Approach

**Phase 1 (Immediate)**: Option 3 + Option 4 combined
- Add time-based decay to vector search
- Implement outcome-based re-ranking with available heuristics
- **Effort**: Half day
- **Impact**: Reduces learning from old failures, prioritizes artifact-producing jobs

**Phase 2 (Next sprint)**: Option 1 (Workstream tracking)
- Add workstream completion metadata to situations
- Backfill logic when root jobs deliver
- Update search to filter for completed workstreams
- **Effort**: 2 days
- **Impact**: Objective quality signal for recognition

**Phase 3 (Future)**: Option 2 (Curation tooling)
- Build CLI for manual verification of exemplar runs
- Integrate with recognition search as highest-priority source
- **Effort**: 1 day + ongoing curation
- **Impact**: Golden examples for critical job types

## Implementation Checklist

- [ ] Add `recency_weight` to vector search scoring
- [ ] Implement `calculateSuccessScore()` re-ranking function
- [ ] Update `node_embeddings` schema to include `workstream` metadata
- [ ] Add backfill logic in ponder `Deliver` handler for root completions
- [ ] Update recognition search to filter `completionVerified: true`
- [ ] Update `AGENT_README.md` with recognition quality considerations
- [ ] Add tests for workstream-aware recognition filtering

## Metrics to Track

**Before/After comparison:**
- Recognition match quality (manual review of top-5 matches)
- Workstream completion rate for jobs using recognition
- Agent efficiency (steps to completion)
- Pattern repetition vs. innovation rate

## Related Files

- `worker/recognition/runRecognition.ts` - Recognition phase orchestration
- `gemini-agent/mcp/tools/search_similar_situations.ts` - Vector search
- `ponder/src/index.ts` - Situation indexing (lines 680-720)
- `worker/situation_encoder.ts` - Situation metadata construction
- `migrations/create_node_embeddings.sql` - Database schema

