# Unit Test Backlog - Prioritized by Business Impact

**Last Updated**: November 7, 2025
**Purpose**: GitHub-issue-ready backlog of unit tests to write
**Total Estimated Effort**: 52-68 days (10-14 weeks for one engineer)

---

## How to Use This Document

Each section below is a GitHub issue template. To create issues:

1. Copy issue template to GitHub
2. Assign priority label (P0, P1, P2, P3)
3. Assign to engineer
4. Track progress via GitHub Projects

**Issue Format**:
```markdown
**Title**: [Test] Unit tests for [Module Name]
**Labels**: testing, unit-test, [priority]
**Estimate**: [days]
**Description**: [below]
```

---

## P0 - CRITICAL (Week 1-2, 10 days)

### Issue #1: Unit Tests for Delivery Payload Construction

**Labels**: `testing`, `unit-test`, `P0-critical`, `delivery`
**Estimate**: 2 days
**Priority**: CRITICAL
**Module**: `worker/delivery/payload.ts`

#### Description

Create comprehensive unit tests for delivery payload construction. This module constructs the IPFS metadata uploaded to the marketplace - bugs here cause failed deliveries and financial loss.

#### Test Coverage Required

- [  ] `constructPayload()` - Constructs valid IPFS payload from execution result
  - Happy path: valid telemetry → correct payload structure
  - Edge case: Missing optional fields (artifacts, telemetry)
  - Edge case: Oversized output (>10KB) → truncated correctly
  - Edge case: Unicode and special characters in output
  - Edge case: Malformed telemetry (missing required fields)

- [  ] `validatePayload()` - Validates payload before IPFS upload
  - Rejects empty request ID
  - Rejects invalid artifact CIDs
  - Validates status enum (COMPLETED, FAILED, WAITING)
  - Ensures execution summary exists
  - Checks IPFS hash format

- [  ] `formatArtifacts()` - Formats artifacts for IPFS payload
  - Handles empty artifacts array
  - Includes all required fields (cid, name, topic)
  - Sorts artifacts by index
  - Truncates artifact content preview to 100 chars

#### Acceptance Criteria

- [  ] All functions covered with unit tests
- [  ] 80%+ line coverage
- [  ] All edge cases tested
- [  ] Tests run in <100ms total
- [  ] All mocks use `vi.mock()`

#### Dependencies

None - pure functions, easy to test

---

### Issue #2: Unit Tests for Delivery Report Formatting

**Labels**: `testing`, `unit-test`, `P0-critical`, `delivery`
**Estimate**: 1 day
**Priority**: CRITICAL
**Module**: `worker/delivery/report.ts`

#### Description

Test report formatting for IPFS deliveries. Ensures execution summaries are properly formatted and readable.

#### Test Coverage Required

- [  ] `formatReport()` - Formats execution result as markdown report
  - Includes execution summary section
  - Includes artifacts section with links
  - Includes status and timestamp
  - Handles missing execution summary gracefully

- [  ] `extractExecutionSummary()` - Extracts summary from agent output
  - Finds `### Execution Summary` section
  - Returns first bullet points
  - Handles multiple summary sections (takes first)
  - Returns null if no summary found

#### Acceptance Criteria

- [  ] 80%+ coverage
- [  ] Tests run in <50ms

---

### Issue #3: Unit Tests for Delivery Validation

**Labels**: `testing`, `unit-test`, `P0-critical`, `delivery`
**Estimate**: 1 day
**Priority**: CRITICAL
**Module**: `worker/delivery/validation.ts`

#### Description

Test delivery validation logic that prevents invalid deliveries from being submitted on-chain.

#### Test Coverage Required

- [  ] `validateDelivery()` - Validates complete delivery before submission
  - Rejects missing request ID
  - Rejects invalid IPFS hash format
  - Validates all artifacts have CIDs
  - Ensures status is terminal (COMPLETED or FAILED)
  - Validates gas limit is within bounds

- [  ] `validateArtifactCid()` - Validates single artifact CID
  - Accepts valid IPFS CID (Qm...46 chars)
  - Rejects empty string
  - Rejects non-IPFS format

#### Acceptance Criteria

- [  ] 80%+ coverage
- [  ] Tests run in <50ms

---

### Issue #4: Unit Tests for Transaction Construction

**Labels**: `testing`, `unit-test`, `P0-critical`, `delivery`
**Estimate**: 2 days
**Priority**: CRITICAL
**Module**: `worker/delivery/transaction.ts`

#### Description

Test on-chain transaction construction for deliveries. Bugs here cause failed transactions and wasted gas.

#### Test Coverage Required

- [  ] `constructDeliverTransaction()` - Constructs deliver() transaction
  - Sets correct contract address
  - Encodes requestId correctly (bytes32)
  - Encodes IPFS hash correctly (hex format)
  - Sets appropriate gas limit
  - Includes correct nonce

- [  ] `encodeIpfsHash()` - Converts IPFS CID to bytes format
  - Handles Qm-prefixed CIDs
  - Converts to hex correctly
  - Validates input format

- [  ] `estimateGas()` - Estimates gas for delivery transaction
  - Returns reasonable estimate (100k-500k)
  - Handles estimation errors gracefully
  - Adds 20% buffer to estimate

#### Acceptance Criteria

- [  ] 80%+ coverage
- [  ] Mock ethers.js contract calls
- [  ] Tests run in <100ms

---

### Issue #5: Unit Tests for LocalTransactionQueue

**Labels**: `testing`, `unit-test`, `P0-critical`, `queue`
**Estimate**: 3 days
**Priority**: CRITICAL
**Module**: `worker/queue/LocalTransactionQueue.ts`

#### Description

Test transaction queue that manages on-chain submissions. Bugs cause duplicate transactions, lost transactions, or nonce issues.

#### Test Coverage Required

- [  ] `enqueue()` - Adds transaction to queue
  - Assigns correct nonce
  - Prevents duplicate enqueues (idempotency)
  - Respects queue capacity limits
  - Returns transaction ID

- [  ] `dequeue()` - Removes transaction from queue
  - Returns oldest pending transaction
  - Skips confirmed transactions
  - Returns null when queue empty

- [  ] `updateStatus()` - Updates transaction status after confirmation
  - Updates status from PENDING → CONFIRMED
  - Records confirmation block number
  - Frees up nonce for reuse

- [  ] `retryTransaction()` - Retries failed transaction
  - Assigns new nonce
  - Increments retry count
  - Respects max retry limit (3)

- [  ] `getNonce()` - Gets next available nonce
  - Returns sequential nonce
  - Handles nonce gaps correctly
  - Recovers from stuck transactions

- [  ] `persist()` / `restore()` - Saves/loads queue state
  - Persists queue to file
  - Restores queue on restart
  - Handles corrupted state file

#### Acceptance Criteria

- [  ] 85%+ coverage
- [  ] All concurrency edge cases tested
- [  ] Mock file system for persistence
- [  ] Tests run in <200ms

---

### Issue #6: Unit Tests for Transaction Queue Factory

**Labels**: `testing`, `unit-test`, `P0-critical`, `queue`
**Estimate**: 0.5 days
**Priority**: CRITICAL
**Module**: `worker/queue/TransactionQueueFactory.ts`

#### Description

Test queue factory that creates queue instances. Simple but critical.

#### Test Coverage Required

- [  ] `createQueue()` - Creates queue instance
  - Creates LocalTransactionQueue by default
  - Validates config parameters
  - Returns ITransactionQueue interface

#### Acceptance Criteria

- [  ] 80%+ coverage
- [  ] Tests run in <50ms

---

### Issue #7: Unit Tests for MCP enqueue-transaction Tool

**Labels**: `testing`, `unit-test`, `P0-critical`, `mcp-tools`
**Estimate**: 1 day
**Priority**: CRITICAL
**Module**: `gemini-agent/mcp/tools/enqueue-transaction.ts`

#### Description

Test MCP tool that enqueues transactions. Used by agents to submit on-chain transactions.

#### Test Coverage Required

- [  ] `enqueueTransaction()` - Enqueues transaction via queue
  - Validates transaction parameters
  - Returns transaction ID
  - Handles queue full error
  - Formats response as MCP tool result

#### Acceptance Criteria

- [  ] 80%+ coverage
- [  ] Mock TransactionQueue
- [  ] Tests run in <100ms

---

**P0 Total**: 7 issues, 10.5 days effort

---

## P1 - HIGH PRIORITY (Month 1, 28 days)

### Issue #8: Unit Tests for Status Inference

**Labels**: `testing`, `unit-test`, `P1-high`, `status`
**Estimate**: 2 days
**Module**: `worker/status/inferStatus.ts`

#### Test Coverage Required

- [  ] `inferStatus()` - Infers job status from execution output
  - COMPLETED: "### Execution Summary\n- Completed all tasks"
  - WAITING: "waiting on child jobs"
  - FAILED: "Error:" or exception message
  - WAITING (default): No clear status signal
  - Handles ambiguous outputs correctly

#### Acceptance Criteria

- [  ] 80%+ coverage, 50+ test cases for different output formats

---

### Issue #9: Unit Tests for Parent Dispatch Logic

**Labels**: `testing`, `unit-test`, `P1-high`, `status`
**Estimate**: 2 days
**Module**: `worker/status/parentDispatch.ts`

#### Test Coverage Required

- [  ] `shouldDispatchParent()` - Determines if parent should be dispatched
  - Dispatches when child status is COMPLETED
  - Does NOT dispatch when child status is WAITING
  - Does NOT dispatch when child status is FAILED (TBD - depends on policy)
  - Handles missing parent job gracefully

- [  ] `constructParentDispatchMessage()` - Builds message for parent
  - Includes child status
  - Includes child output summary
  - Includes child request ID

#### Acceptance Criteria

- [  ] 80%+ coverage

---

### Issue #10: Unit Tests for Child Job Tracking

**Labels**: `testing`, `unit-test`, `P1-high`, `status`
**Estimate**: 1 day
**Module**: `worker/status/childJobs.ts`

#### Test Coverage Required

- [  ] `getChildJobs()` - Fetches child jobs from subgraph
  - Returns children for given parent request
  - Handles no children case
  - Filters by job definition ID

---

### Issue #11: Unit Tests for Retry Strategy

**Labels**: `testing`, `unit-test`, `P1-high`, `status`
**Estimate**: 1 day
**Module**: `worker/status/retryStrategy.ts`

#### Test Coverage Required

- [  ] `shouldRetry()` - Determines if job should be retried
  - Retries on transient errors (RPC timeout, quota exceeded)
  - Does NOT retry on permanent errors (invalid input)
  - Respects max retry count (3)

- [  ] `getRetryDelay()` - Calculates exponential backoff delay
  - 1st retry: 1s, 2nd: 2s, 3rd: 4s
  - Adds jitter (±20%)

---

### Issue #12: Unit Tests for Telemetry Parser

**Labels**: `testing`, `unit-test`, `P1-high`, `execution`
**Estimate**: 2 days
**Module**: `worker/execution/telemetryParser.ts`

#### Test Coverage Required

- [  ] `parseTelemetry()` - Extracts tool calls from agent output
  - Parses standard tool call format
  - Handles nested JSON in tool results
  - Extracts error messages
  - Handles malformed tool call text
  - Returns empty array if no tool calls found

---

### Issue #13: Unit Tests for runAgent Execution Logic

**Labels**: `testing`, `unit-test`, `P1-high`, `execution`
**Estimate**: 2 days
**Module**: `worker/execution/runAgent.ts`

#### Test Coverage Required

- [  ] `runAgent()` - Executes agent via Gemini API
  - Handles streaming responses
  - Parses tool calls correctly
  - Handles execution errors
  - Returns execution result with telemetry

(See issue for full details)

---

### Issue #14: Unit Tests for IPFS Metadata Fetching

**Labels**: `testing`, `unit-test`, `P1-high`, `metadata`
**Estimate**: 1 day
**Module**: `worker/metadata/fetchIpfsMetadata.ts`

---

### Issue #15: Unit Tests for Job Context Construction

**Labels**: `testing`, `unit-test`, `P1-high`, `metadata`
**Estimate**: 2 days
**Module**: `worker/metadata/jobContext.ts`

---

### Issue #16: Unit Tests for Prompt Building

**Labels**: `testing`, `unit-test`, `P1-high`, `metadata`
**Estimate**: 1.5 days
**Module**: `worker/metadata/prompt.ts`

---

### Issue #17: Unit Tests for MechConfig Validation

**Labels**: `testing`, `unit-test`, `P1-high`, `config`
**Estimate**: 1 day
**Module**: `worker/config/MechConfig.ts`

---

### Issue #18: Unit Tests for ServiceConfig Validation

**Labels**: `testing`, `unit-test`, `P1-high`, `config`
**Estimate**: 1 day
**Module**: `worker/config/ServiceConfig.ts`

---

### Issue #19: Unit Tests for Config Validation Utilities

**Labels**: `testing`, `unit-test`, `P1-high`, `config`
**Estimate**: 1 day
**Module**: `worker/validation.ts`

---

### Issue #20-23: Unit Tests for Contract Managers (4 issues)

**Modules**: OlasContractManager, OlasStakingManager, SafeAddressPredictor, MechMarketplace
**Estimate**: 1 day each × 4 = 4 days

---

### Issue #24-28: Unit Tests for MCP Core Tools (5 issues)

**Modules**: dispatch_new_job, create_artifact, search-jobs, search-artifacts, get-details
**Estimate**: 1 day each × 5 = 5 days

---

**P1 Total**: 21 issues, ~28 days effort

---

## P2 - MEDIUM PRIORITY (Quarter 1, 10 days)

### Recognition & Reflection Tests (5 issues, 5 days)

- Issue #29: `initialSituation.ts` (1 day)
- Issue #30: `runRecognition.ts` (1 day)
- Issue #31: `telemetryAugment.ts` (1 day)
- Issue #32: `memoryArtifacts.ts` (1 day)
- Issue #33: `runReflection.ts` (1 day)

### MCP Utility Tools (3 issues, 3 days)

- Issue #34: `list-tools.ts` (1 day)
- Issue #35: `embed_text.ts` (1 day)
- Issue #36: `inspect_situation.ts` (1 day)

### Worker Utilities (2 issues, 2 days)

- Issue #37: `tool_utils.ts` (1 day)
- Issue #38: `worker_telemetry.ts` (1 day)

---

**P2 Total**: 10 issues, ~10 days effort

---

## P3 - LOW PRIORITY (Backlog, 3 days)

### Integration Tests (2 issues, 2 days)

- Issue #39: Civitai tools (1 day for all 5 tools)
- Issue #40: Zora tools (1 day for all 2 tools)

### Logging (1 issue, 1 day)

- Issue #41: Error formatting and telemetry logging (1 day)

---

**P3 Total**: 3 issues, ~3 days effort

---

## Summary

| Priority | Issues | Effort (days) | Timeline |
|----------|--------|---------------|----------|
| P0 | 7 | 10.5 | Week 1-2 |
| P1 | 21 | ~28 | Month 1-2 |
| P2 | 10 | ~10 | Quarter 1 |
| P3 | 3 | ~3 | Backlog |
| **Total** | **41** | **51.5** | **Q1-Q2 2026** |

---

## Parallel Execution Strategy

To accelerate, assign issues to multiple engineers:

**Engineer A** (P0 Delivery): Issues #1-4 (6 days)
**Engineer B** (P0 Queue): Issues #5-7 (4.5 days)
**Engineer C** (P1 Status): Issues #8-11 (6 days)
**Engineer D** (P1 Execution): Issues #12-13 (4 days)

**Parallelized Timeline**: 10 days instead of 51.5 days (80% faster)

---

## GitHub Project Setup

**Recommended Board Structure**:

**Columns**:
1. Backlog (P2, P3)
2. Ready (P0, P1 prioritized)
3. In Progress
4. Review
5. Done

**Labels**:
- `testing`, `unit-test` (all issues)
- `P0-critical`, `P1-high`, `P2-medium`, `P3-low` (priority)
- `delivery`, `queue`, `status`, `execution`, etc. (domain)

**Milestones**:
- M1: P0 Complete (Week 2)
- M2: P1 Complete (Month 2)
- M3: P2 Complete (Quarter 1)

---

## Success Metrics

**Week 2** (P0 Complete):
- [  ] 9 P0 modules have 80%+ coverage
- [  ] CI enforcing P0 coverage gates
- [  ] Zero critical bugs in delivery/queue

**Month 2** (P1 Complete):
- [  ] 40 P1 modules have 60%+ coverage
- [  ] Overall coverage reaches 50%
- [  ] Test pyramid ratio improves to 60/25/15

**Quarter 1** (P2 Complete):
- [  ] Overall coverage reaches 60%
- [  ] Test pyramid ratio reaches 65/23/12

**Quarter 2** (All Complete):
- [  ] Overall coverage reaches 70%
- [  ] Test pyramid ratio reaches 70/20/10
- [  ] Zero untested P0/P1 modules

---

## Issue Template (Copy This)

```markdown
**Title**: [Test] Unit tests for [Module Name]

**Labels**: `testing`, `unit-test`, `[priority]`, `[domain]`

**Estimate**: [X] days

**Priority**: [P0/P1/P2/P3]

**Module**: `[file path]`

## Description

[Brief description of module and why tests are needed]

## Test Coverage Required

- [  ] `[function name]()` - [description]
  - [test case 1]
  - [test case 2]
  - [edge case 1]

## Acceptance Criteria

- [  ] [Coverage target]% line coverage
- [  ] All edge cases tested
- [  ] Tests run in <[X]ms
- [  ] All mocks use `vi.mock()`

## Dependencies

[List any blockers or dependencies]

## Related Issues

- Related to #[issue number]
```

---

## Next Steps

1. **Review backlog** with team
2. **Create GitHub issues** for P0 (7 issues)
3. **Assign to engineers** based on expertise
4. **Begin Phase 0** (P0 critical path)
5. **Track progress** via GitHub Projects

---

**Audit Complete!** All phases delivered:
- ✅ Phase 1: Test Inventory
- ✅ Phase 2: Module Coverage Map
- ✅ Phase 3: Gap Analysis
- ✅ Phase 4: Duplication Analysis
- ✅ Phase 5: Migration Roadmap
- ✅ Phase 6: Testing Standards
- ✅ Phase 7: Unit Test Backlog

**Total Deliverables**: 7 comprehensive documents ready for team review and implementation.
