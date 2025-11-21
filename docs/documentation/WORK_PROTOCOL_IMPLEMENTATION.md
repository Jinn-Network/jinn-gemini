# Work Protocol Implementation Plan

## Overview
This document outlines the implementation plan for integrating the Work Protocol into the Jinn agent system. The protocol enables agents to signal their execution status and automatically trigger parent job review when needed.

## Key Components

### 1. Agent Output Modification (gemini-agent/agent.ts)

**Current State:**
- Agent returns `{ output: string, telemetry: JobTelemetry }`
- Output is extracted from Gemini CLI execution
- No structured status signaling

**Required Changes:**
- Modify agent to append FinalStatus JSON to output
- Ensure FinalStatus is the last structured element in output
- Format: `FinalStatus: {"status": "STATUS_CODE", "message": "Human-readable summary"}`

**Implementation Steps:**
1. Add FinalStatus generation logic in `agent.ts`
2. Detect execution path during agent run
3. Append appropriate FinalStatus before returning output
4. Handle error cases with FAILED status

### 2. Worker FinalStatus Parser (worker/mech_worker.ts)

**Current State:**
- Worker stores agent output directly
- No parsing of structured status signals
- No automatic parent job dispatch

**Required Changes:**
- Parse FinalStatus from agent output
- Extract status code and message
- Store status in job report metadata
- Trigger parent dispatch on COMPLETED/FAILED

**Implementation Steps:**
1. Add `parseFinalStatus()` function to extract status from output
2. Store parsed status in job report
3. Implement dispatch logic based on status

### 3. Parent Job Dispatch Logic

**Current State:**
- Manual dispatch via `dispatch_existing_job` tool
- Parent tracking via `sourceRequestId` and `parent_job_definition_id`
- No automatic workflow management

**Required Changes:**
- Automatic parent dispatch when child completes/fails
- Pass child results via message field
- Prevent duplicate dispatches

**Implementation Steps:**
1. After parsing FinalStatus, check if status requires parent dispatch
2. Fetch parent job definition ID from metadata
3. Call `dispatchExistingJob` with parent ID and child results
4. Track dispatch to prevent loops

## Implementation Phases

### Phase 1: Core Infrastructure (Priority: High)
1. **FinalStatus Parser**
   - Location: `worker/mech_worker.ts`
   - Function: `parseFinalStatus(output: string): { status: string, message: string } | null`
   - Extract JSON from output using regex pattern
   - Validate status against allowed codes

2. **Status Storage**
   - Modify job report creation to include parsed status
   - Add status field to job report metadata
   - Ensure backward compatibility

### Phase 2: Agent Integration (Priority: High)
1. **Agent Status Detection**
   - Add logic to determine execution path
   - Map execution outcomes to status codes:
     - Task completed → COMPLETED
     - Child jobs dispatched → DELEGATING  
     - Waiting for siblings → WAITING
     - Errors/blockers → FAILED

2. **FinalStatus Generation**
   - Create helper function to format FinalStatus
   - Append to output before returning
   - Ensure consistent formatting

### Phase 3: Workflow Automation (Priority: Medium)
1. **Parent Job Dispatch**
   - Implement automatic dispatch on COMPLETED/FAILED
   - Use existing `dispatchExistingJob` function
   - Pass child results in message field

2. **Loop Prevention**
   - Track recent dispatches
   - Implement cooldown period
   - Validate parent exists before dispatch

### Phase 4: Testing & Validation (Priority: High)
1. **Unit Tests**
   - FinalStatus parser tests
   - Status detection logic tests
   - Parent dispatch tests

2. **Integration Tests**
   - End-to-end workflow tests
   - Multi-level job hierarchy tests
   - Error handling tests

## Code Locations

### Files to Modify:
1. **gemini-agent/agent.ts**
   - Add FinalStatus generation
   - Modify output formatting

2. **worker/mech_worker.ts**
   - Add FinalStatus parser
   - Implement parent dispatch logic
   - Modify `runAgentForRequest()` and `storeOnchainReport()`

3. **gemini-agent/mcp/tools/get-details.ts** and **gemini-agent/mcp/tools/search-artifacts.ts**
   - Ensure parent job info is available
   - May need to enhance context retrieval

### New Functions to Add:

```typescript
// In worker/mech_worker.ts

interface FinalStatus {
  status: 'COMPLETED' | 'DELEGATING' | 'WAITING' | 'FAILED';
  message: string;
}

function parseFinalStatus(output: string): FinalStatus | null {
  // Parse FinalStatus: {"status": "...", "message": "..."} from output
  const pattern = /FinalStatus:\s*(\{[^}]+\})/;
  const match = output.match(pattern);
  if (!match) return null;
  
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.status && parsed.message) {
      return parsed as FinalStatus;
    }
  } catch {}
  return null;
}

async function dispatchParentIfNeeded(
  status: FinalStatus,
  metadata: any,
  childRequestId: string,
  childOutput: string
): Promise<void> {
  if (status.status !== 'COMPLETED' && status.status !== 'FAILED') {
    return; // Only dispatch on terminal states
  }
  
  const parentJobDefId = metadata?.sourceJobDefinitionId;
  if (!parentJobDefId) return;
  
  // Dispatch parent with child results
  await dispatchExistingJob({
    jobId: parentJobDefId,
    message: JSON.stringify({
      childRequestId,
      childStatus: status.status,
      childMessage: status.message,
      childOutput: childOutput.substring(0, 1000) // Truncate for message
    })
  });
}
```

## Migration Strategy

1. **Backward Compatibility**
   - Support agents without FinalStatus (assume COMPLETED)
   - Gradual rollout with feature flag
   - Monitor and validate behavior

2. **Rollout Plan**
   - Deploy parser without dispatch first
   - Monitor status extraction accuracy
   - Enable parent dispatch after validation
   - Update all agents to include FinalStatus

## Success Metrics

1. **Functional Metrics**
   - FinalStatus parse success rate > 95%
   - Parent job dispatch accuracy > 99%
   - No infinite dispatch loops

2. **Performance Metrics**
   - Parser execution < 10ms
   - Dispatch latency < 1s
   - No increase in failed jobs

## Risk Mitigation

1. **Parsing Failures**
   - Fallback to default behavior
   - Log parsing failures for debugging
   - Monitor parse success rate

2. **Dispatch Loops**
   - Implement dispatch tracking
   - Add cooldown periods
   - Maximum dispatch limit per job

3. **Parent Job Errors**
   - Validate parent exists before dispatch
   - Handle dispatch failures gracefully
   - Log all dispatch attempts

## Timeline

- Week 1: Implement core parser and status storage
- Week 2: Integrate agent FinalStatus generation
- Week 3: Add parent dispatch logic
- Week 4: Testing and validation
- Week 5: Gradual rollout and monitoring

## Dependencies

- Existing dispatch tools (dispatch_existing_job)
- Job metadata storage (sourceJobDefinitionId)
- GraphQL queries for job relationships
- Control API for job management

## Open Questions

1. Should WAITING status have a timeout?
2. How to handle orphaned child jobs?
3. Should we add a REVIEWING status for human intervention?
4. Maximum depth for job hierarchies?