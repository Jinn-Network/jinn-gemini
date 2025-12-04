<!-- 0a2087a1-6a71-41bc-b799-6e538f5aa577 b5925ff6-6e79-4c60-a54e-5a620ae646b3 -->
# Plan: Verify Dependency and Parent Dispatch Fixes

We will verify the fixes by confirming unit tests cover the new logic and replacing the misclassified system test with a genuine end-to-end integration test.

## 1. Verify Code Exports

- **File:** [worker/mech_worker.ts](worker/mech_worker.ts) line 325
- **Action:** Confirm `isJobDefinitionComplete` is exported (already done: `export async function isJobDefinitionComplete`).

## 2. Verify Dependency Unit Tests

- **File:** [tests-next/unit/worker/dependencies.test.ts](tests-next/unit/worker/dependencies.test.ts)
- **Action:** Confirm tests exist for `isJobDefinitionComplete` with `lastStatus` logic:
- Test cases should verify `COMPLETED`/`FAILED` return `true`, `DELEGATING`/`WAITING` return `false`.
- If tests are missing or incomplete, update them.

## 3. Verify Parent Dispatch Unit Tests

- **File:** [tests-next/unit/worker/status/parentDispatch.test.ts](tests-next/unit/worker/status/parentDispatch.test.ts) lines 99-329
- **Status:** Already comprehensive with scenarios for:
- All children complete (COMPLETED only, or mixed COMPLETED/FAILED)
- Any child WAITING or DELEGATING blocks dispatch
- No children found (safety fallback)
- Query failure (fail-safe)
- **Action:** No changes needed - tests already cover the sibling-aware logic.

## 4. Replace Misclassified System Test

- **File:** [tests-next/system/parent-redispatch.system.test.ts](tests-next/system/parent-redispatch.system.test.ts)
- **Current State:** Unit test masquerading as system test (uses `vi.mock` to stub HTTP/MCP)
- **Action:** Replace entire file with genuine system test that:

1. **Boots Full Stack:** `withSuiteEnv` + `withTestEnv` + `withTenderlyVNet` + `withProcessHarness`
2. **Creates Parent Job:** Dispatch parent with simple blueprint (no actual children dispatched by agent)
3. **Dispatches 2 Children:** Use `withJobContext` to set parent lineage, dispatch both child jobs manually
4. **Runs Worker on Child 1:** Execute worker via `runWorkerOnce`, wait for delivery via `waitForDeliveryIndexed`
5. **Asserts No Parent Re-dispatch:** Query `getRequestsByJobDefinition(parentJobDefId)` - should return 1 request only
6. **Runs Worker on Child 2:** Execute worker, wait for delivery
7. **Asserts Parent Re-dispatched:** Query again - should now return 2 requests (original + auto-dispatched after both children complete)
8. **Verifies Ponder Indexing:** Uses `waitForRequestIndexed` with predicates to ensure all data is ready before assertions

### To-dos

- [ ] Move mock system test to unit suite
- [ ] Export isJobDefinitionComplete from worker
- [ ] Implement true system test with live Ponder
- [ ] Update dependency unit tests