# JINN-247: Job Run Issues and Fixes

**Date**: 2025-11-17  
**Request**: 0x4c4514918735a947a25d7cd9af7e3d374ed4c2cfef32175b9617e95b317c6be6  
**Job**: ethereum-protocol-research

## Issues Identified

### 1. Recognition Phase JSON Parsing Corruption

**Symptom**: Recognition agent JSON output was being corrupted with line breaks mid-string:
```json
"sourceRequestId": "0x80a5588b8d6bdb329369aa956802
596e6e6b0070f0241b8ab0151f19f11be3c7",
```

**Root Cause**: 
- `agentLogger.output()` in `logging/index.ts` used `console.log()`
- This sent agent output through the pino logger pipeline
- When running with `| tsx logging/dev-pretty-cli.ts`, the output got piped through `pino-pretty`
- `pino-pretty` wraps long lines, breaking valid JSON structure

**Fix**: Changed `agentLogger.output()` to use `process.stdout.write()` directly:
```typescript
output(message: string) {
  // Write directly to stdout to bypass pino-pretty line wrapping
  process.stdout.write(`\x1b[95m${message}\x1b[0m\n`);
}
```

**Impact**: Recognition learnings now parse correctly, enabling proper prompt augmentation.

---

### 2. Duplicate Dispatch Call Counting

**Symptom**: Status inference reported "Dispatched 7 child job(s)" when only 3 distinct jobs were created (the rest were retries).

**Root Cause**:
- Agent retried failed dispatches (skipBranch error, "Transaction not found" error)
- `countSuccessfulDispatchCalls()` counted all successful tool calls, not unique jobs
- Retry attempts were summed into the total

**Example**:
- 3 successful dispatches (protocol-activity-analysis, smart-contract-events, whale-movements-analysis)
- 4 retry attempts due to transient errors
- Reported: "Dispatched 7 child job(s)" ❌
- Actual: 3 distinct child jobs ✓

**Fix**: Modified `countSuccessfulDispatchCalls()` to track unique `jobDefinitionId` values:
```typescript
export function countSuccessfulDispatchCalls(telemetry: any): number {
  const toolCalls = getToolCalls(telemetry);
  // Track unique job definition IDs to avoid counting retries
  const uniqueJobDefs = new Set<string>();
  
  toolCalls.forEach(call => {
    if (!call || !call.success) return;
    const toolName = typeof call.tool === 'string' ? call.tool : '';
    if (toolName && DISPATCH_TOOL_NAMES.has(toolName)) {
      const jobDefId = call.result?.data?.jobDefinitionId || 
                       call.result?.data?.id ||
                       call.result?.jobDefinitionId;
      if (jobDefId) {
        uniqueJobDefs.add(jobDefId);
      }
    }
  });
  
  return uniqueJobDefs.size;
}
```

**Impact**: Status messages now accurately reflect the number of distinct child jobs created.

---

### 3. CODE_METADATA_REPO_ROOT Error on Research Jobs

**Symptom**: Initial dispatch attempts failed with:
```
Error: CODE_METADATA_REPO_ROOT environment variable not set
```

**Root Cause**:
- Research-only jobs don't need git branches
- The system tried to create git branches for tracking code changes
- No CODE_METADATA_REPO_ROOT was set because these are artifact-only workflows

**Fix**: Agent discovered the `skipBranch: true` parameter through trial and error, but this should be a known pattern.

**Enhancement**: Added "System Gotchas" section to recognition prompts in `worker/recognition_helpers.ts`:
```typescript
### System Gotchas
Common issues encountered in past runs:
- **CODE_METADATA_REPO_ROOT errors:** For research-only jobs (no code changes), always use `skipBranch: true` in dispatch_new_job to avoid git branch creation errors
- **Transaction not found:** Blockchain RPC transient errors - retry dispatch calls that fail with this error
- **Duplicate dispatch counting:** System tracks unique job definitions, not total dispatch attempts - retries are normal
```

**Impact**: Future recognition phases will inject this knowledge, reducing trial-and-error debugging.

---

### 4. No Evidence of Recognition Learning Application

**Symptom**: Recognition phase extracted 5 learnings, but execution logs showed no evidence these influenced agent behavior.

**Root Cause**: 
- Insufficient logging to verify recognition learnings were injected
- No way to confirm agent actually used the injected context

**Fix**: Enhanced logging in `worker/orchestration/jobRunner.ts`:
```typescript
workerLogger.info({ 
  requestId: target.id, 
  prefixLength: prefix.length,
  learningsCount: recognition.rawLearnings?.length || 0,
  similarJobsCount: recognition.similarJobs?.length || 0,
  promptPreview: prefix.substring(0, 200)  // NEW
}, 'Augmented prompt with recognition learnings');
```

**Impact**: Operators can now verify:
1. How many learnings were injected
2. How many similar jobs were found
3. Preview of what was prepended to the prompt

---

## Files Modified

1. `logging/index.ts` - Fixed JSON corruption by bypassing pino-pretty
2. `worker/status/dispatchUtils.ts` - Fixed dispatch counting to track unique job definitions
3. `worker/recognition_helpers.ts` - Added system gotchas to recognition prompts
4. `worker/orchestration/jobRunner.ts` - Enhanced recognition injection logging
5. `AGENT_README.md` - Documented all fixes and gotchas

---

## Testing Recommendations

### Verify JSON Parsing Fix
```bash
# Run a job with recognition phase
yarn dev:mech --workstream=<workstream-id> --single

# Check that recognition output is valid JSON (no line breaks mid-string)
grep -A 20 "recognition" /tmp/mech.log | grep "sourceRequestId"
```

### Verify Dispatch Counting
```bash
# Dispatch a parent job that creates child jobs
yarn tsx scripts/dispatch-job.ts

# Run worker and check status message
yarn dev:mech --single

# Look for "Dispatched X child job(s)" - should match actual count, not retries
tail -f /tmp/mech.log | grep "Dispatched"
```

### Verify Recognition Gotchas Injection
```bash
# Run a job similar to past ethereum-protocol-research jobs
yarn dev:mech --workstream=<similar-workstream> --single

# Check that system gotchas are in the recognition prompt
tail -f /tmp/mech.log | grep -A 10 "System Gotchas"
```

### Verify Enhanced Logging
```bash
# Run any job with recognition
yarn dev:mech --single

# Check for enhanced recognition injection logs
tail -f /tmp/mech.log | grep "promptPreview"
```

---

## Related Issues

- **JINN-233**: Semantic graph search (recognition system)
- **JINN-246**: Workstream filtering (enables isolated testing)
- **dispatch_new_job fix (2025-11-17)**: Always posts new requests, even when reusing definitions

---

## Future Improvements

1. **Recognition Quality Metrics**: Track whether agents actually use injected learnings (requires telemetry analysis)
2. **Automatic skipBranch Detection**: Infer skipBranch from job metadata (no code metadata = skipBranch true)
3. **Retry Budget**: Limit dispatch retries to prevent excessive on-chain posts on persistent failures
4. **Recognition A/B Testing**: Compare execution quality with/without recognition to measure impact

