# Work Protocol Implementation Plan V2

## Overview
This document provides an implementation plan for integrating the Work Protocol into the Jinn agent system, enabling automatic parent job dispatch based on child job completion status.

## Status Workflow Behavior

The Work Protocol defines four statuses that control workflow automation:

| Status | Description | Parent Dispatch | Use Case |
|--------|-------------|----------------|----------|
| **COMPLETED** | Task finished successfully | ✅ Yes | Final deliverable ready for parent review |
| **FAILED** | Error requiring intervention | ✅ Yes | Escalate blocker to parent supervisor |
| **DELEGATING** | Dispatched child jobs | ❌ No | Waiting for child jobs to complete |
| **WAITING** | Needs sibling results | ❌ No | Cannot proceed without other job outputs |

This ensures parents are only activated when their attention is actually needed, preventing unnecessary job runs.

## System Architecture Understanding

### Current State
1. **Job Lineage**: Already tracked via `sourceJobDefinitionId` and `sourceRequestId` in the schema
2. **Context Flow**: Job context passes from parent to child automatically via dispatch tools
3. **Metadata Storage**: Job metadata stored in IPFS and accessible through the request
4. **Report Creation**: Worker creates job reports with status (COMPLETED/FAILED) after execution

### Key Components
- **Agent (gemini-agent/agent.ts)**: Executes tasks and returns output
- **Worker (worker/mech_worker.ts)**: Processes requests, runs agents, stores results
- **Dispatch Tools**: Create child jobs with proper lineage context
- **Ponder Schema**: Stores job relationships and metadata

## Implementation Plan

### Phase 1: Agent FinalStatus Output

#### 1.1 Update GEMINI.md Documentation
**File**: `gemini-agent/GEMINI.md`

Add new section after "Final Output: The Execution Summary":

```markdown
### Work Protocol Status Signaling

After completing the Execution Summary, you MUST include a FinalStatus signal to inform the worker of your completion state:

**Format:**
```json
FinalStatus: {"status": "STATUS_CODE", "message": "Brief summary of the outcome"}
```

**Status Codes:**
- `COMPLETED`: Task finished successfully, deliverables ready
- `DELEGATING`: Dispatched child jobs, awaiting their completion  
- `WAITING`: Cannot proceed without sibling job results
- `FAILED`: Encountered error requiring supervisor intervention

This signal enables automatic workflow management - the worker will dispatch your parent job when you signal COMPLETED or FAILED.
```

#### 1.2 Agent Behavior Changes
No code changes needed in agent.ts - the agent (Gemini CLI) will naturally include FinalStatus in its output when following the updated GEMINI.md instructions.

### Phase 2: Worker FinalStatus Parser

#### 2.1 Add Parser Function
**File**: `worker/mech_worker.ts`

Add after imports:

```typescript
interface FinalStatus {
  status: 'COMPLETED' | 'DELEGATING' | 'WAITING' | 'FAILED';
  message: string;
}

function parseFinalStatus(output: string): FinalStatus | null {
  if (!output) return null;
  
  // Match FinalStatus: {...} pattern
  const pattern = /FinalStatus:\s*(\{[^}]+\})/;
  const match = output.match(pattern);
  
  if (!match) {
    workerLogger.debug('No FinalStatus found in agent output');
    return null;
  }
  
  try {
    const parsed = JSON.parse(match[1]);
    
    // Validate structure
    if (!parsed.status || !parsed.message) {
      workerLogger.warn('Invalid FinalStatus structure', parsed);
      return null;
    }
    
    // Validate status code
    const validStatuses = ['COMPLETED', 'DELEGATING', 'WAITING', 'FAILED'];
    if (!validStatuses.includes(parsed.status)) {
      workerLogger.warn(`Invalid status code: ${parsed.status}`);
      return null;
    }
    
    return {
      status: parsed.status,
      message: parsed.message
    };
  } catch (e) {
    workerLogger.warn('Failed to parse FinalStatus', e);
    return null;
  }
}
```

#### 2.2 Modify storeOnchainReport
**File**: `worker/mech_worker.ts`

Update the `storeOnchainReport` function to include parsed status:

```typescript
async function storeOnchainReport(
  request: UnclaimedRequest, 
  workerAddress: string, 
  result: { output: string; telemetry: any }, 
  error?: any,
  metadata?: any  // Add metadata parameter
): Promise<FinalStatus | null> {
  try {
    // Parse FinalStatus from output
    const finalStatus = parseFinalStatus(result?.output || '');
    
    // Determine status for job report
    let reportStatus: string;
    if (error) {
      reportStatus = 'FAILED';
    } else if (finalStatus) {
      // Use the actual FinalStatus from agent (COMPLETED, DELEGATING, WAITING, or FAILED)
      reportStatus = finalStatus.status;
    } else {
      // Fallback for agents not using work protocol yet
      reportStatus = 'COMPLETED';
      workerLogger.debug('No FinalStatus found, defaulting to COMPLETED');
    }
    
    const payload = {
      status: reportStatus,  // Use actual work protocol status
      duration_ms: result?.telemetry?.duration || 0,
      total_tokens: result?.telemetry?.totalTokens || 0,
      tools_called: JSON.stringify(result?.telemetry?.toolCalls ?? []),
      final_output: result?.output || null,
      error_message: error ? (error.message || String(error)) : null,
      error_type: error ? 'AGENT_ERROR' : null,
      raw_telemetry: JSON.stringify({
        ...result?.telemetry ?? {},
        finalStatus,  // Include parsed status in telemetry
        sourceJobDefinitionId: metadata?.sourceJobDefinitionId  // Preserve parent reference
      })
    };
    await apiCreateJobReport(request.id, payload);
    
    // Return finalStatus for parent dispatch logic
    return finalStatus;
  } catch {
    return null;
  }
}
```

### Phase 3: Parent Job Dispatch

#### 3.1 Add Parent Dispatch Function
**File**: `worker/mech_worker.ts`

Add after `storeOnchainReport`:

```typescript
async function dispatchParentIfNeeded(
  finalStatus: FinalStatus | null,
  metadata: any,
  requestId: string,
  output: string
): Promise<void> {
  // Only dispatch on terminal states
  if (!finalStatus || (finalStatus.status !== 'COMPLETED' && finalStatus.status !== 'FAILED')) {
    workerLogger.debug(`Not dispatching parent - status: ${finalStatus?.status || 'none'}`);
    return;
  }
  
  // Get parent job ID from metadata
  const parentJobDefId = metadata?.sourceJobDefinitionId;
  if (!parentJobDefId) {
    workerLogger.debug('No parent job to dispatch');
    return;
  }
  
  try {
    workerLogger.info(`Dispatching parent job ${parentJobDefId} after child ${finalStatus.status}`);
    
    // Create message with child results
    const message = JSON.stringify({
      childRequestId: requestId,
      childStatus: finalStatus.status,
      childMessage: finalStatus.message,
      childOutput: output.length > 1000 ? output.substring(0, 1000) + '...' : output
    });
    
    // Dispatch parent job
    const result = await dispatchExistingJob({ 
      jobId: parentJobDefId,
      message
    });
    
    const dispatchResult = safeParseToolResponse(result);
    if (dispatchResult.ok) {
      workerLogger.info(`Parent job ${parentJobDefId} dispatched successfully`);
    } else {
      workerLogger.error(`Failed to dispatch parent job ${parentJobDefId}: ${dispatchResult.message}`);
    }
  } catch (e) {
    workerLogger.error(`Error dispatching parent job ${parentJobDefId}:`, e);
  }
}
```

#### 3.2 Integrate Parent Dispatch in processOnce
**File**: `worker/mech_worker.ts`

Modify the `processOnce` function around line 449:

```typescript
// After running agent and before storing report
const metadata = await fetchIpfsMetadata(target.ipfsHash);
result = await runAgentForRequest(target, metadata);

// ... artifact extraction ...

// Store report and get final status
const finalStatus = await storeOnchainReport(target, workerAddress, result, error, metadata);

// Dispatch parent if needed
await dispatchParentIfNeeded(finalStatus, metadata, target.id, result?.output || '');
```

### Phase 4: Testing Strategy

#### 4.1 Unit Tests
Create `worker/mech_worker.test.ts`:

```typescript
describe('FinalStatus Parser', () => {
  test('parses valid FinalStatus', () => {
    const output = 'Some output\nFinalStatus: {"status": "COMPLETED", "message": "Task done"}';
    const result = parseFinalStatus(output);
    expect(result).toEqual({ status: 'COMPLETED', message: 'Task done' });
  });
  
  test('returns null for missing FinalStatus', () => {
    const output = 'Some output without status';
    expect(parseFinalStatus(output)).toBeNull();
  });
  
  test('validates status codes', () => {
    const output = 'FinalStatus: {"status": "INVALID", "message": "Test"}';
    expect(parseFinalStatus(output)).toBeNull();
  });
});
```

#### 4.2 Integration Test Scenarios
1. **Single-level completion**: Child completes → Parent dispatched
2. **Multi-level hierarchy**: Grandchild completes → Parent waits → All complete → Grandparent dispatched
3. **Error propagation**: Child fails → Parent dispatched for review
4. **No parent case**: Root job completes → No dispatch
5. **Delegation flow**: Job delegates → No parent dispatch

## Implementation Order

1. **Week 1**: 
   - Add FinalStatus parser to mech_worker.ts
   - Update GEMINI.md with status signaling instructions
   - Create unit tests

2. **Week 2**:
   - Modify storeOnchainReport to capture FinalStatus
   - Implement dispatchParentIfNeeded function
   - Test with simple parent-child scenarios

3. **Week 3**:
   - Integration testing with multi-level hierarchies
   - Add monitoring and logging
   - Handle edge cases

4. **Week 4**:
   - Deploy to staging environment
   - Monitor agent adoption of FinalStatus
   - Gather metrics on dispatch accuracy

## Configuration

**Note:** The Work Protocol is a core system feature, not optional. No feature flag needed.

Optional tuning parameters:

```bash
# Delay before parent dispatch (ms) - for rate limiting
PARENT_DISPATCH_DELAY=5000

# Maximum parent dispatch retries on failure
MAX_PARENT_DISPATCH_RETRIES=3
```

## Monitoring & Metrics

Track these metrics:
- FinalStatus parse success rate
- Parent dispatch success rate (for COMPLETED/FAILED only)
- Average time from child completion to parent dispatch
- Status distribution (COMPLETED vs FAILED vs DELEGATING vs WAITING)
- Dispatch loop detection

## Important Notes on Job Status

**Change from Current System:**
- Currently, job reports only have status `COMPLETED` or `FAILED`
- With Work Protocol, job reports will have four possible statuses: `COMPLETED`, `FAILED`, `DELEGATING`, `WAITING`
- This allows the system to track workflow state more accurately
- Jobs with `DELEGATING` or `WAITING` status are still considered "in progress" from a workflow perspective

## Risk Mitigation

1. **Backward Compatibility**: Handle agents without FinalStatus (default to COMPLETED)
2. **Loop Prevention**: Track dispatches to prevent infinite loops
3. **Rate Limiting**: Add delays between dispatches
4. **Error Recovery**: Retry failed parent dispatches with backoff
5. **Status Validation**: Validate FinalStatus values before using

## Success Criteria

- 95% of agents include valid FinalStatus
- 99% accurate parent dispatch on COMPLETED/FAILED
- No infinite dispatch loops
- < 10s from child completion to parent dispatch
- No increase in failed jobs

## Notes

- The system already has all necessary infrastructure (lineage tracking, dispatch tools)
- Main change is behavioral - teaching agents to signal status and worker to respond
- Leverage existing `dispatchExistingJob` for parent dispatch
- Parent job receives child results via message field in additionalContext