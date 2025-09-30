# Separate Deliverable Output from Execution Summary in IPFS

## Problem

Currently, the agent's full output (including execution summary, reasoning, and deliverable) is uploaded to IPFS as a single text blob. This creates several issues:

1. **IPFS contains internal process details** that should be operational metadata, not public deliverables
2. **Larger IPFS files** due to verbose execution summaries mixed with actual work products
3. **Unclear separation** between "what was produced" (deliverable) and "how it was produced" (execution context)
4. **Difficult to query** execution metadata like status, decision paths, or deliverables structurally

## Proposed Solution

Split agent output into two distinct components:

### 1. Deliverable Output (IPFS)
Clean, consumable work product intended for external use:
- Final reports, analyses, or synthesized results
- Links to created artifacts
- Executive summaries
- No internal reasoning or execution details

### 2. Execution Summary (Database)
Structured metadata about the execution process:
- Work Protocol status (COMPLETED/FAILED/DELEGATING/WAITING)
- Objective and decision path taken
- Context gathered and actions taken
- List of deliverables with IDs
- Full agent output for debugging (optional)

## Implementation Approach

### Phase 1: Enhanced `signal_completion` Tool

Modify the tool to accept structured execution data:

```typescript
signal_completion({
  status: "COMPLETED" | "FAILED",
  objective: string,
  contextGathered: string,
  decisionPath: "Path A/B/C/D/E",
  actionsTaken: string,
  deliverables: string,
  deliverable_output: string  // NEW: Clean output for IPFS
})
```

Tool behavior:
- Formats execution summary into structured telemetry
- Returns `deliverable_output` separately from execution context
- Worker uses `deliverable_output` for IPFS, execution summary for job reports

### Phase 2: Worker Changes

Update `worker/mech_worker.ts`:

**Current:**
```typescript
const result = await agent.run(prompt);
// result.output = "Everything: execution summary + deliverable"

await deliverViaSafe({
  resultContent: { output: result.output, ... }
});
```

**New:**
```typescript
const result = await agent.run(prompt);
// result.output = "Clean deliverable only"
// result.telemetry.executionSummary = { structured fields }
// result.telemetry.fullAgentOutput = "Full text for debugging"

await deliverViaSafe({
  resultContent: {
    output: result.output,  // Clean deliverable
    telemetry: result.telemetry,  // Includes executionSummary
    ...
  }
});
```

### Phase 3: Database Schema Updates

Modify `onchain_job_reports` table:

**Add columns:**
- `execution_summary: JSON` - Structured execution metadata
- `deliverable_output: TEXT` - Clean output that went to IPFS
- `full_agent_output: TEXT` - Complete agent output for debugging

**Deprecate:**
- `final_output: TEXT` - Replace with `deliverable_output`

### Phase 4: GEMINI.md Updates

Update agent instructions to define:
- What constitutes a "deliverable output" vs "execution summary"
- Examples of clean deliverable formatting
- Guidance on when to include details in deliverables vs summaries

## Benefits

### For Users
- **Clean IPFS deliverables** - Work products without internal agent reasoning
- **Faster IPFS retrieval** - Smaller files, only essential content
- **Better public consumption** - External parties see professional outputs

### For Operations
- **Queryable execution metadata** - Filter by status, decision path, deliverables
- **Debugging preserved** - Full agent output available in database
- **Structured data** - Can build dashboards, analytics on execution patterns

### For the System
- **Separation of concerns** - Process vs. product clearly delineated
- **Scalability** - Smaller IPFS storage footprint
- **Work Protocol clarity** - Status and decisions in structured format

## Backwards Compatibility

**Phase 1-2:** Non-breaking
- New field `deliverable_output` is optional
- If not provided, falls back to current behavior (full output)
- Existing agents continue working unchanged

**Phase 3:** Migration required
- Database schema changes need migration
- Existing job reports remain readable
- New reports use new schema

**Phase 4:** Agent retraining
- Update GEMINI.md with new expectations
- Agents gradually adopt new pattern
- Monitor adoption via telemetry

## Example: Before vs After

### Before (Current)
**IPFS Content:**
```json
{
  "output": "Execution Summary:\n- Objective: Create market analysis\n- Context: Reviewed 3 child jobs...\n- Decision: Path A - Synthesize & Complete\n- Actions: Called get_job_context, analyzed data...\n- Deliverables: Market Analysis artifact\n- Status: COMPLETED\n\n---\n\n# Market Analysis Report\n\nKey findings:\n1. Market grew 15%\n2. Competition decreased\n3. Recommendation: Expand operations\n\n[3000 more words...]"
}
```

### After (Proposed)
**IPFS Content:**
```json
{
  "output": "# Market Analysis Report\n\nKey findings:\n1. Market grew 15%\n2. Competition decreased\n3. Recommendation: Expand operations\n\n[3000 more words...]",
  "telemetry": {
    "executionSummary": {
      "status": "COMPLETED",
      "objective": "Create market analysis",
      "contextGathered": "Reviewed 3 child jobs with 5 artifacts",
      "decisionPath": "Path A: Synthesize & Complete",
      "actionsTaken": "Called get_job_context, analyzed data, created artifact",
      "deliverables": "Market Analysis artifact CID: bafybei..."
    }
  }
}
```

**Job Report (Database):**
```json
{
  "request_id": "0x123...",
  "status": "COMPLETED",
  "deliverable_output": "# Market Analysis Report...",
  "execution_summary": {
    "objective": "Create market analysis",
    "contextGathered": "Reviewed 3 child jobs...",
    "decisionPath": "Path A: Synthesize & Complete",
    ...
  },
  "full_agent_output": "[Complete thought process for debugging]",
  "raw_telemetry": {...}
}
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Agents produce unclear deliverables | Provide clear examples in GEMINI.md, iterate on prompts |
| Loss of transparency in IPFS | Keep execution summary in telemetry field within IPFS |
| Breaking change for consumers | Implement as optional feature, gradual rollout |
| Debugging becomes harder | Preserve full agent output in database for ops team |
| Increased complexity | Start with simple structured fields, expand as needed |

## Success Metrics

- **IPFS file size reduction**: Target 30-50% reduction in average file size
- **Deliverable quality**: User survey on clarity of IPFS outputs
- **Query performance**: Time to filter job reports by status/decision path
- **Adoption rate**: % of agents using new signal_completion format
- **Debugging efficiency**: Time to diagnose failures with structured data

## Priority: P2 (Future Enhancement)

Not critical for current Work Protocol operation, but would significantly improve:
- Data architecture clarity
- IPFS storage efficiency
- Operational queryability
- User-facing deliverable quality

## Dependencies

- Work Protocol implementation (✅ Complete)
- `signal_completion` tool (✅ Exists, needs enhancement)
- Job reports infrastructure (✅ Exists, needs schema update)
- IPFS delivery pipeline (✅ Exists, no changes needed)

## Related Issues

- Work Protocol implementation
- `signal_completion` tool error handling improvements
- Frontend explorer updates for new schema fields