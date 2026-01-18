# Measurement Artifact ID Robustness

## Current State Analysis

### How Measurement IDs Are Written

**Location:** `gemini-agent/mcp/tools/create_measurement.ts`

When an agent calls `create_measurement`, the `invariant_id` field is:

1. **Validated minimally** - Only checks it's a non-empty string (`.min(1)`)
2. **No registry validation** - No check against known invariant IDs
3. **Agent-specified** - The agent chooses what ID to use

```typescript
// Current validation - accepts ANY non-empty string
invariant_id: z.string().min(1).describe('The invariant ID being measured')
```

**Result:** Agents create measurements with ad-hoc IDs like:
- `JOB-WRITER-DRAFT-POST`
- `JOB-GROWTH-TRACKING-DAILY`
- `JOB-MANAGER-DELEGATE`

### How Invariant IDs Are Defined

**Locations:** Multiple providers generate invariants with systematic IDs

| Prefix | Source | Example |
|--------|--------|---------|
| `SYS-` | `system-blueprint.json` (static) | `SYS-014` |
| `GOAL-` | Blueprint template JSON | `GOAL-MISSION`, `GOAL-CONTENT` |
| `STRAT-` | `StrategyInvariantProvider` (dynamic) | `STRAT-DELEGATE` |
| `COORD-` | `CoordinationInvariantProvider` (dynamic) | `COORD-BRANCH-REVIEW` |
| `QUAL-` | `QualityInvariantProvider` (dynamic) | `QUAL-VERIFY` |

### How Measurement IDs Are Read (Matching)

**Location:** `packages/shared-ui/src/lib/invariant-utils.ts`

```typescript
// Simple string equality match
const measurement = measurements.get(inv.id);
```

The matching is **exact string comparison**:
- Measurements keyed by `invariant_id` from artifact JSON
- Looked up using `inv.id` from the invariant definition
- No fuzzy matching, no normalization, no fallbacks

### The Core Problem

**Agents don't know the exact invariant IDs they should use.**

When an agent measures something, it invents an ID based on what it thinks it's measuring:
- Agent sees invariant description: "Ensure content quality score >= 70"
- Agent creates measurement with ID: `JOB-WRITER-CONTENT-QUALITY`
- Actual invariant ID is: `GOAL-CONTENT`
- **Result:** No match, shows as "Unknown"

---

## Robustness Suggestions

### Option 1: Pass Invariant ID to Agent (Recommended)

**Change:** Include the exact `invariant.id` in the agent's blueprint context.

Currently, agents see invariants like:
```json
{
  "type": "FLOOR",
  "metric": "content_quality_score",
  "min": 70,
  "description": "Content quality score >= 70"
}
```

They should see:
```json
{
  "id": "GOAL-CONTENT",
  "type": "FLOOR",
  "metric": "content_quality_score",
  "min": 70,
  "description": "Content quality score >= 70"
}
```

**Implementation:**
1. Ensure `invariantsProse` rendering includes the ID prominently
2. Update system prompt (SYS-014) to instruct: "Use the exact invariant ID provided"

### Option 2: Validate ID at Creation Time

**Change:** `create_measurement` validates `invariant_id` against a known registry.

**Challenges:**
- Agent doesn't have access to full invariant list at MCP tool level
- Would require passing valid IDs through execution context
- Adds coupling between tool and blueprint system

**Implementation:**
1. Pass `validInvariantIds: string[]` to agent context
2. MCP tool validates against this list
3. Return error if ID doesn't match

### Option 3: Fuzzy Matching at Read Time

**Change:** Allow partial/fuzzy matching when looking up measurements.

**Example:**
- Measurement ID: `JOB-CONTENT-QUALITY`
- Invariant ID: `GOAL-CONTENT`
- Match if: Both contain "CONTENT" or similar heuristic

**Challenges:**
- False positives (wrong measurement matched to invariant)
- Performance overhead
- Hard to define "close enough"

**Not recommended** - too fragile.

### Option 4: Metric-Based Matching (Fallback)

**Change:** If ID doesn't match, try matching by `metric` field.

```typescript
// Current: ID-only matching
const measurement = measurements.get(inv.id);

// Enhanced: ID first, then metric fallback
let measurement = measurements.get(inv.id);
if (!measurement && inv.metric) {
  measurement = findByMetric(measurements, inv.metric);
}
```

**Challenges:**
- Requires measurements to include `metric` field
- Not all invariants have unique metrics

---

## Recommended Implementation Plan

### Phase 1: Make IDs Visible to Agents

1. **Update `invariantsProse` rendering** to prominently include IDs:
   ```
   ## GOAL-CONTENT (FLOOR)
   Metric: content_quality_score >= 70
   Status: No measurement yet
   ```

2. **Update system blueprint (SYS-014)** with explicit instruction:
   ```
   When creating measurements, use the EXACT invariant ID shown
   (e.g., "GOAL-CONTENT", not a custom ID like "JOB-WRITER-QUALITY")
   ```

### Phase 2: Add ID Validation

1. **Add `validInvariantIds` to agent context** in `BlueprintBuilder`
2. **Update `create_measurement` tool** to warn (not error) on unknown IDs
3. **Log mismatches** for debugging/monitoring

### Phase 3: Migration

1. **Existing measurements** with old IDs will naturally age out
2. **New measurements** will use correct IDs
3. **Monitor** match rate improvement over time

---

## DELEGATED Type Deprecation

### Current Usage

The `DELEGATED` measurement type was created to indicate "this invariant's work was delegated to a child job."

**Locations to update:**

| File | Change |
|------|--------|
| `gemini-agent/mcp/tools/create_measurement.ts` | Remove DELEGATED schema and handling |
| `packages/shared-ui/src/lib/invariant-types.ts` | Remove from type union |
| `packages/shared-ui/src/lib/invariant-utils.ts` | Remove from parsing/matching |
| `worker/prompt/types.ts` | Remove from MeasurementInfo type |
| `worker/prompt/providers/context/MeasurementContextProvider.ts` | Remove from type inference |
| `worker/prompt/system-blueprint.json` | Remove DELEGATED examples from SYS-014 |

### Why Deprecate

1. **Delegation is orchestration, not measurement** - The fact that work was delegated doesn't measure an invariant's health
2. **Semantic mismatch** - "Delegated" is a process state, not a measurement value
3. **Simpler model** - Four types (FLOOR, CEILING, RANGE, BOOLEAN) are sufficient
4. **No measurement = Unknown** - If there's no measurement, that's valid state (Unknown)

### Migration Path

1. **Remove DELEGATED from schema** - Tool will reject DELEGATED type
2. **Update system prompt** - Remove DELEGATED examples from SYS-014
3. **Graceful parsing** - Parser can still read old DELEGATED artifacts (treat as Unknown)
4. **No data migration needed** - Old artifacts remain, just won't match invariants

---

## Summary

| Issue | Solution | Priority | Status |
|-------|----------|----------|--------|
| Agents invent IDs | Include exact ID in prose context | High | ✅ Implemented |
| No validation | Warn on unknown IDs | Medium | Deferred |
| DELEGATED type | Remove from schema, update prompts | High | ✅ Implemented |
| Fuzzy matching | Not recommended | - | N/A |
| Measurements not indexed | Extract create_measurement tool calls | High | ✅ Implemented |

---

## Additional Fix: Measurement Artifact Extraction

### Issue Discovered

The `extractArtifactsFromTelemetry` function in `worker/artifacts.ts` only extracted artifacts from `create_artifact` tool calls, missing `create_measurement` tool calls entirely.

### Fix Applied

Updated the extraction logic to include both tools:

```typescript
// Before: Only create_artifact
if (toolCall.tool === 'create_artifact' && toolCall.success && toolCall.result) {

// After: Both artifact-producing tools
const isArtifactTool = toolCall.tool === 'create_artifact' || toolCall.tool === 'create_measurement';
if (isArtifactTool && toolCall.success && toolCall.result) {
```

This ensures measurement artifacts are properly recorded via the Control API and indexed by Ponder, allowing the frontend to display them.

The key insight: **The invariant ID must flow from the blueprint definition to the measurement creation.** Currently there's a gap where agents guess the ID instead of using the authoritative one.

---

## Additional Fix: GoalInvariantProvider ID Preservation

### Issue Discovered

The `GoalInvariantProvider` (in `JobInvariantProvider.ts`) was transforming IDs:

```typescript
// Before: Added JOB- prefix to non-prefixed IDs
const id = inv.id.startsWith('JOB-') || inv.id.startsWith('GOAL-') ? inv.id : `JOB-${inv.id}`;
```

This caused template IDs like `DELEGATE-STRATEGY` to become `JOB-DELEGATE-STRATEGY`, breaking measurement matching.

### Fix Applied

Changed to preserve original IDs:

```typescript
// After: Preserve original template IDs
const id = inv.id;
```

Template authors should use appropriate prefixes (`GOAL-`, `JOB-`, `DELEGATE-`, `TECH-`, etc.) and those IDs will flow through unchanged to the agent and measurements.

---

## Implementation (Completed)

### Changes Made

1. **Updated system-blueprint.json to typed format**:
   - Converted all system invariants to use `type: "BOOLEAN"` with `condition` and `assessment` fields
   - Old format used `invariant` field (string) which didn't match the Invariant type union
   - This fix resolved "Unknown invariant type: undefined" error during prose rendering

2. **Updated GoalInvariantProvider** (`JobInvariantProvider.ts`):
   - Removed automatic `JOB-` prefix addition
   - Invariant IDs are now preserved exactly as defined in templates
   - This ensures measurement IDs match template IDs

3. **Removed DELEGATED type** from:
   - `gemini-agent/mcp/tools/create_measurement.ts` - Schema and handlers
   - `packages/shared-ui/src/lib/invariant-types.ts` - Type definitions
   - `packages/shared-ui/src/lib/invariant-utils.ts` - Parsing logic
   - `worker/prompt/types.ts` - MeasurementInfo type
   - `worker/prompt/providers/context/MeasurementContextProvider.ts` - Type inference

2. **Updated system blueprint** (`worker/prompt/system-blueprint.json`):
   - SYS-014: Emphasizes using EXACT invariant IDs, removed DELEGATED example
   - SYS-015: Removed DELEGATED guidance, added "don't measure delegated work"

3. **Enhanced prose rendering** (`worker/prompt/invariant-renderer.ts`):
   - Format changed from `ID: constraint` to `[ID] (TYPE) - constraint`
   - Added measurement hint: `→ To measure: create_measurement({ invariant_id: 'ID', invariant_type: 'TYPE', ... })`
   - Agents now see exactly what ID and type to use

4. **Updated tool description** in create_measurement schema:
   - Added: "IMPORTANT: Use the EXACT invariant ID from your blueprint"
   - Improved examples to use realistic IDs like `GOAL-CONTENT`, `GOAL-MISSION`
