<!-- d1e95ca2-a27d-4055-8b95-ed88343e3d76 dffc9749-5244-4f84-9302-ed503b6aed3d -->
# Comprehensive Backend Test Suite Gap Analysis

This plan addresses all identified test coverage gaps in the backend, prioritizing critical logic paths (status inference, stale reclaiming, RPC filtering) and aligning with the `tests-next` CI workflow.

## Phase 1: Critical Logic Verification (P0)

These tests cover logic that directly impacts job execution correctness, the ability to recover from stuck states, and the prevention of double-execution.

### 1. Child Job Status Inference

**Files**:

- `tests-next/unit/worker/status/getAllChildrenForJobDefinition.test.ts` (New)
- `tests-next/unit/worker/status/inferStatus.test.ts` (Update)

**Tasks**:

- **Create `getAllChildrenForJobDefinition.test.ts`**:
  - Test deduplication of children across multiple job runs.
  - Test handling of empty results vs. actual children.
  - Test error handling for failed status queries.
- **Update `inferStatus.test.ts`**:
  - Update mocks to support `getAllChildrenForJobDefinition`.
  - Add case: Infers `WAITING` when children are delivered but still `DELEGATING` or `WAITING` (activeChildren > 0).
  - Add case: Uses job-level child query when `jobDefinitionId` is present.

### 2. Worker RPC Filtering (Double-Execution Guard)

**Files**:

- `tests-next/unit/worker/mech_worker.test.ts` (New)

**Tasks**:

- **Test `getUndeliveredSet()`**:
  - Mock RPC failure (returns null) -> Verify function returns null (fail-safe).
  - Mock RPC success (returns set) -> Verify correct Set construction.
- **Test `filterUnclaimed()`**:
  - Case: RPC returns `null` (failure) -> Returns ALL Ponder requests (safe fallback).
  - Case: RPC returns empty `Set` (success) -> Filters ALL requests (trusts chain).
  - Case: RPC returns partial `Set` -> Filters only matching requests.
  - Verify logging output for filtering decisions.

### 3. Stale Job Reclaiming (Integration)

**Files**:

- `tests-next/integration/control-api/validation-gateway.integration.test.ts` (Update)

**Tasks**:

- **Add "Test 5: Control API allows re-claiming stale jobs"**:
  - **Setup**: Manually insert a claim into Supabase that is > 5 minutes old (`claimed_at < now - 5m`) and in `IN_PROGRESS` status, assigned to a different worker.
  - **Action**: Call `claimRequest` with the current test worker.
  - **Assert**: Request succeeds (no "already claimed" error).
  - **Assert**: Supabase record is updated with the new `worker_address` and a fresh `claimed_at`.

## Phase 2: Reliability & Client Logic (P1)

These tests ensure the worker correctly interacts with the Control API and robustly handles claim logic.

### 4. Control API Stale Detection (Unit)

**Files**:

- `tests-next/unit/control-api/staleClaimLogic.test.ts` (New)

**Tasks**:

- Isolate business logic for the 5-minute cutoff.
- Test boundary: Exactly 5 minutes.
- Test boundary: 4:59 vs 5:01.
- Test missing `claimed_at`.
- Test status checks: Ensure `COMPLETED` jobs are never re-claimed.

### 5. Control API Client

**Files**:

- `tests-next/unit/worker/control_api_client.test.ts` (New)

**Tasks**:

- **Test `claimRequest()`**:
  - Test successful claim structure parsing.
  - Test "already claimed" error mapping (`alreadyClaimed: true`).
  - Test network failure retry logic.
  - Verify headers (idempotency key, worker address) are set correctly.

## Phase 3: Extended Coverage (P2)

These tests cover helper functions, edge cases, and deeper integration scenarios.

### 6. Helper Functions

**Files**:

- `tests-next/unit/worker/dependencies.test.ts` (New)
- `tests-next/unit/worker/status/queryRequestsByJobDefinition.test.ts` (New)

**Tasks**:

- **Dependency Resolution**:
  - `checkDependenciesMet()`: Validates recursive dependency completion.
  - `resolveJobDefinitionId()`: Resolves job names to UUIDs within workstream.
  - `filterByDependencies()`: Correctly filters requests.
- **Request Querying**:
  - `queryRequestsByJobDefinition()`: Test pagination limits, empty results, retry logic.

### 7. Integration Scenarios

**Files**:

- `tests-next/integration/gemini-agent/search-pagination.integration.test.ts` (New)
- `tests-next/integration/ponder/last-status.integration.test.ts` (New)

**Tasks**:

- **Search Pagination**: Verify `upstreamLimit` behavior in actual GraphQL calls (ensure `hasMore` logic holds).
- **Ponder `lastStatus`**: Verify snapshot behavior vs. live worker queries (simulate run 1 DELEGATING -> run 2 COMPLETED).

## Verification Commands

```bash
# Phase 1 (P0) - Critical
yarn test:unit:next -- tests-next/unit/worker/status/getAllChildrenForJobDefinition.test.ts
yarn test:unit:next -- tests-next/unit/worker/status/inferStatus.test.ts
yarn test:unit:next -- tests-next/unit/worker/mech_worker.test.ts
yarn test:integration:next -- tests-next/integration/control-api/validation-gateway.integration.test.ts

# Phase 2 (P1) - Reliability
yarn test:unit:next -- tests-next/unit/control-api/staleClaimLogic.test.ts
yarn test:unit:next -- tests-next/unit/worker/control_api_client.test.ts

# Phase 3 (P2) - Extended
yarn test:unit:next -- tests-next/unit/worker/dependencies.test.ts
yarn test:unit:next -- tests-next/unit/worker/status/queryRequestsByJobDefinition.test.ts
yarn test:integration:next -- tests-next/integration/gemini-agent/search-pagination.integration.test.ts
yarn test:integration:next -- tests-next/integration/ponder/last-status.integration.test.ts

# Full Suite
yarn test:next
```

### To-dos

- [x] Create `getAllChildrenForJobDefinition.test.ts` (P0) ✅
- [x] Update `inferStatus.test.ts` with activeChildren logic (P0) ✅
- [x] Add stale job reclaiming test to `validation-gateway.integration.test.ts` (P0) ✅
- [x] Create `mech_worker.test.ts` for RPC filtering (P1) ✅
- [x] Create `control_api_client.test.ts` (P1) ✅
- [x] Create `staleClaimLogic.test.ts` (P1) ✅
- [x] Create `dependencies.test.ts` (P2) ✅
- [x] Create `queryRequestsByJobDefinition.test.ts` (P2) ✅

## Implementation Complete

All planned tests have been implemented. Summary:

### Phase 1 (P0) - Critical
✅ `tests-next/unit/worker/status/getAllChildrenForJobDefinition.test.ts` - 500+ lines, comprehensive coverage
✅ `tests-next/unit/worker/status/inferStatus.test.ts` - Updated with activeChildren logic, new test suite
✅ `tests-next/unit/worker/mech_worker.test.ts` - RPC filtering and double-execution prevention
✅ `tests-next/integration/control-api/validation-gateway.integration.test.ts` - Added Test 5 & 6 for stale reclaiming

### Phase 2 (P1) - Reliability
✅ `tests-next/unit/control-api/staleClaimLogic.test.ts` - Pure function tests for 5-minute threshold
✅ `tests-next/unit/worker/control_api_client.test.ts` - Client behavior, retries, error handling

### Phase 3 (P2) - Extended
✅ `tests-next/unit/worker/dependencies.test.ts` - Resolution and completion checking
✅ `tests-next/unit/worker/status/queryRequestsByJobDefinition.test.ts` - Query logic and retry behavior