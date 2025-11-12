# Test Migration Roadmap

**Last Updated**: November 7, 2025
**Purpose**: Detailed plan to migrate legacy tests (tests/) to new framework (tests-next/)

## Executive Summary

- **Total Legacy Tests**: 20 files
- **Already Migrated**: 3 files (control-api-config, worker-basic-execution, env-controller)
- **To Migrate**: 17 files
- **To Deprecate**: 1 file (situation-recognition E2E)
- **Estimated Total Effort**: 15-20 days
- **Target Completion**: End of Q1 2026

---

## Migration Philosophy

### Why Migrate?

1. **Better Isolation**: Tests-next uses env snapshots + ephemeral VNets → no cross-test pollution
2. **Parallel Execution**: Tests-next designed for parallel execution → faster CI
3. **Modern Helpers**: tests-next/helpers/ are composable, type-safe, well-documented
4. **Clearer Organization**: Unit/Integration/System directories match test types
5. **Maintainability**: Consistent patterns across all tests

### Migration Principles

✅ **DO**:
- Mirror source directory structure in tests-next/unit/
- Use new helper functions (env-controller, process-harness, tenderly-runner)
- Add missing coverage during migration (don't just copy-paste)
- Write migration notes in test file header

❌ **DON'T**:
- Break existing tests during migration (keep both until new tests proven)
- Change test assertions without reason (preserve test intent)
- Migrate tests that should be deprecated
- Rush migration (quality over speed)

---

## Migration Phases

### Phase A: Migrate True Unit Tests (Low Risk, 6 tests, 5 days)

These are already isolated, just need directory reorganization.

---

#### A1. Situation Encoder

**Source**: `tests/unit/situation-encoder.test.ts`
**Destination**: `tests-next/unit/worker/situation-encoder.test.ts`
**Effort**: 0.5 days
**Risk**: LOW
**Dependencies**: None

**Migration Checklist**:
- [  ] Copy test file to new location
- [  ] Update import paths (../../worker/ → ../../../worker/)
- [  ] Run test suite to ensure passing
- [  ] Add test file header:
  ```typescript
  /**
   * Unit Test: Situation Encoder
   * Migrated from: tests/unit/situation-encoder.test.ts
   * Migration Date: [DATE]
   *
   * Tests encodeSituation() function for building structured situation payloads.
   * Pure unit test - all I/O mocked via vi.mock().
   */
  ```
- [  ] Delete old test file (after new test proven in CI)

---

#### A2. Recognition Helpers

**Source**: `tests/unit/recognition-helpers.test.ts`
**Destination**: `tests-next/unit/worker/recognition-helpers.test.ts`
**Effort**: 0.5 days
**Risk**: LOW

**Migration Checklist**: Same as A1

---

#### A3. Git Branch Operations

**Source**: `tests/unit/worker/git/branch.test.ts`
**Destination**: `tests-next/unit/worker/git/branch.test.ts`
**Effort**: 0.5 days
**Risk**: LOW
**Special**: Uses real git repos - acceptable for git operations

**Migration Checklist**: Same as A1

---

#### A4. Git Working Tree

**Source**: `tests/unit/worker/git/workingTree.test.ts`
**Destination**: `tests-next/unit/worker/git/workingTree.test.ts`
**Effort**: 0.5 days
**Risk**: LOW

**Migration Checklist**: Same as A1

---

#### A5. CodeSpec Ledger

**Source**: `tests/codespec/ledger.test.ts`
**Destination**: `tests-next/unit/codespec/ledger.test.ts`
**Effort**: 0.5 days
**Risk**: LOW

**Migration Checklist**: Same as A1

---

#### A6. Auto-Commit Helpers (NEW - Extract from Integration Test)

**Source**: NONE (new test)
**Destination**: `tests-next/unit/worker/git/auto-commit-helpers.test.ts`
**Effort**: 2 days
**Risk**: MEDIUM
**Dependencies**: Requires extracting pure functions from `worker/git/autoCommit.ts`

**Refactoring Required**:
1. Extract `extractExecutionSummary(output: string): string | null`
2. Extract `deriveCommitMessage(summary: string, status: FinalStatus, context: CommitContext): string`
3. Make these pure, exported functions
4. Write unit tests for them

**Test Coverage**:
```typescript
describe('extractExecutionSummary', () => {
  it('extracts summary from ### Execution Summary section');
  it('returns null when no summary section found');
  it('handles multiple summary sections (takes first)');
  it('trims whitespace correctly');
});

describe('deriveCommitMessage', () => {
  it('uses summary first bullet as commit message');
  it('falls back to generic message when summary empty');
  it('truncates long messages to 72 chars');
  it('includes job ID in fallback message');
});
```

---

**Phase A Total**: 5 days, 6 new unit tests

---

### Phase B: Reclassify & Migrate Integration Tests (7 tests, 5 days)

These tests use real infrastructure but are misclassified as "unit". Need to move to integration/ directory and update to use new helpers.

---

#### B1. MCP Stdout Clean

**Source**: `tests/unit/mcp-stdout-clean.test.ts`
**Destination**: `tests-next/integration/mcp/stdout-clean.integration.test.ts`
**Effort**: 0.5 days
**Risk**: LOW

**Changes Required**:
- Move to integration/ directory
- Keep real MCP server spawning (that's the whole point)
- Update to use `withTestEnv()` for env management
- Add `.integration.test.ts` suffix

---

#### B2. Worker Git Operations

**Source**: `tests/unit/worker-git-ops.test.ts`
**Destination**: DEPRECATE (redundant with git integration tests)
**Effort**: 1 day
**Risk**: LOW

**Deprecation Strategy**:
1. Audit assertions in worker-git-ops.test.ts
2. Ensure all assertions covered by:
   - New unit tests (auto-commit-helpers.test.ts) OR
   - Existing integration tests (worker-git-auto-commit.test.ts)
3. Delete file

**Assertions to Port** (if not covered):
- formatSummaryForPr() edge cases
- autoCommitIfNeeded() error handling

---

#### B3. Search Similar Situations

**Source**: `tests/unit/search-similar-situations.test.ts`
**Destination**: `tests-next/integration/recognition/search-similar-situations.integration.test.ts`
**Effort**: 0.5 days
**Risk**: LOW

**Changes Required**:
- Move to integration/recognition/
- Keep pg mocking (acceptable for integration test)
- Add proper test header

---

#### B4. Git Auto-Commit Flow

**Source**: `tests/git/worker-git-auto-commit.test.ts`
**Destination**: `tests-next/integration/git/auto-commit.integration.test.ts`
**Effort**: 1 day
**Risk**: MEDIUM

**Changes Required**:
- Use `withProcessHarness()` for Ponder/Control API
- Use `withTenderlyVNet()` for blockchain
- Use `withGitFixture()` for git repo management
- Update assertions to use new helper patterns

---

#### B5. Git Lineage

**Source**: `tests/git/worker-git-lineage.test.ts`
**Destination**: `tests-next/integration/git/lineage.integration.test.ts`
**Effort**: 1.5 days
**Risk**: HIGH (largest, most complex test)

**Changes Required**:
- Same as B4
- This test is 697 LOC, will need careful refactoring
- Consider splitting into multiple integration tests:
  - `lineage-basic.integration.test.ts` (branch ancestry)
  - `lineage-pr-creation.integration.test.ts` (PR workflow)

---

#### B6. Env Controller

**Status**: ✅ **ALREADY MIGRATED**
**Location**: `tests-next/integration/env-controller.integration.test.ts`

---

#### B7. Situation Workflow

**Status**: ✅ **ALREADY MIGRATED**
**Location**: `tests-next/integration/situation-workflow.integration.test.ts`

---

**Phase B Total**: 5 days, 5 migrated integration tests (2 already done)

---

### Phase C: Migrate System Tests (7 tests, 5-7 days)

These tests use full infrastructure and are correctly classified. Need to update to use new helpers.

---

#### C1. Marketplace Dispatch

**Source**: `tests/marketplace/marketplace-dispatch.test.ts`
**Destination**: `tests-next/system/marketplace/dispatch.system.test.ts`
**Effort**: 1 day
**Risk**: MEDIUM

**Changes Required**:
- Use `withSuiteEnv()` → `withTestEnv()` → `withTenderlyVNet()` → `withProcessHarness()`
- Replace `getSharedInfrastructure()` with context from harness
- Update import paths

**Template**:
```typescript
describe('Marketplace: Dispatch', () => {
  it('dispatch_new_job → IPFS → Ponder', async () => {
    await withSuiteEnv(async () => {
      await withTestEnv(async () => {
        await withTenderlyVNet(async (tenderlyCtx) => {
          await withProcessHarness(
            { rpcUrl: tenderlyCtx.rpcUrl, startWorker: false },
            async (ctx) => {
              // Test logic here
              // Use ctx.gqlUrl, ctx.controlUrl
            }
          );
        });
      });
    });
  });
});
```

---

#### C2-C5. Other Marketplace Tests

**Tests**:
- marketplace-lineage.test.ts
- marketplace-context-envelope.test.ts
- marketplace-message-system.test.ts
- marketplace-code-metadata.test.ts

**Effort**: 1 day each × 4 = 4 days
**Risk**: MEDIUM
**Strategy**: Same as C1

---

#### C6-C7. Worker Tests

**Tests**:
- worker-artifact-creation.test.ts
- worker-work-protocol.test.ts

**Effort**: 1 day each × 2 = 2 days
**Risk**: HIGH (uses Worker)
**Strategy**: Same as C1, but with `startWorker: true`

---

#### C8. Worker Basic Execution

**Status**: ✅ **ALREADY MIGRATED**
**Location**: `tests-next/system/worker-basic-execution.system.test.ts`

---

#### C9. Harness Smoke Test

**Status**: ✅ **ALREADY MIGRATED**
**Location**: `tests-next/system/harness.system.test.ts`

---

#### C10. Service Deployment

**Source**: `tests/service-deployment/service-deployment.e2e.test.ts`
**Destination**: `tests-next/system/service-deployment.system.test.ts`
**Effort**: 1 day
**Risk**: LOW (standalone test, no shared infrastructure)

**Changes Required**:
- Minimal - this test is already well-isolated
- Just move file and update imports

---

**Phase C Total**: 7 days, 8 migrated system tests (2 already done)

---

### Phase D: Deprecate Redundant Tests (1 test, 0.5 days)

#### D1. Situation Recognition E2E

**Source**: `tests/e2e/situation-recognition.e2e.test.ts`
**Action**: ❌ **DELETE**
**Reason**: Fully redundant with `tests-next/integration/situation-workflow.integration.test.ts`
**Effort**: 0.5 days

**Deprecation Checklist**:
- [  ] Verify all assertions covered by situation-workflow.integration.test.ts
- [  ] Add note in migration PR about deprecation reason
- [  ] Delete file
- [  ] Update vitest.config.ts to remove e2e project (if no other e2e tests remain)

---

## Migration Timeline

### Week 1-2: Phase A (Unit Tests)
**Goal**: Migrate 6 true unit tests
**Effort**: 5 days
**Deliverables**:
- 5 migrated unit tests
- 1 new unit test (auto-commit-helpers)

### Week 3-4: Phase B (Integration Tests)
**Goal**: Reclassify and migrate integration tests
**Effort**: 5 days
**Deliverables**:
- 3 new integration tests (mcp-stdout-clean, search-similar-situations, auto-commit)
- 2 migrated integration tests (git-auto-commit, git-lineage)
- 1 deprecated test (worker-git-ops)

### Week 5-8: Phase C (System Tests)
**Goal**: Migrate system tests to new harness
**Effort**: 7 days
**Deliverables**:
- 6 migrated marketplace tests
- 2 migrated worker tests

### Week 8: Phase D (Deprecation)
**Goal**: Clean up redundant tests
**Effort**: 0.5 days
**Deliverables**:
- 1 deprecated test (situation-recognition E2E)

**Total Timeline**: 8 weeks (1.5 sprint iterations)
**Total Effort**: 17.5 days

---

## Migration Process

### Standard Migration Flow

1. **Branch**: Create feature branch `migrate-test-[name]`
2. **Copy**: Copy test file to new location (don't move yet)
3. **Update Imports**: Fix import paths for new location
4. **Add Header**: Document migration date and source
5. **Update Helpers**: Replace old helpers with new ones
6. **Run Tests**: Ensure all tests pass in new location
7. **PR**: Create PR with migration (keep both old and new)
8. **CI Validation**: Verify both old and new tests pass in CI
9. **Monitor**: Watch for 1 week in production
10. **Cleanup**: Delete old test file

### Risk Mitigation

**Dual-Run Period**: Keep both old and new tests for 1-2 weeks
- Old tests run on `main` branch
- New tests run on `main` branch
- Both must pass for CI to succeed

**Rollback Plan**: If new test has issues, revert migration PR and investigate

---

## Helper Function Migration Guide

### Old Helper → New Helper Mapping

| Old Helper | New Helper | Notes |
|------------|------------|-------|
| `getSharedInfrastructure()` | `withProcessHarness()` | Returns {gqlUrl, controlUrl} via callback |
| `resetTestEnvironment()` | `withTestEnv()` | Automatic env snapshot/restore |
| Manual VNet creation | `withTenderlyVNet()` | Automatic VNet creation/cleanup |
| `createTestJob()` | Same | No change needed |
| `waitForRequestIndexed()` | Same | No change needed |
| `runWorkerOnce()` | Same | No change needed |

### Example Migration

**Before (Legacy)**:
```typescript
describe('My Test', () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  it('does something', async () => {
    const { gqlUrl, controlUrl } = getSharedInfrastructure();
    // ... test logic
  });
});
```

**After (New Framework)**:
```typescript
describe('My Test', () => {
  it('does something', async () => {
    await withSuiteEnv(async () => {
      await withTestEnv(async () => {
        await withTenderlyVNet(async (tenderlyCtx) => {
          await withProcessHarness(
            { rpcUrl: tenderlyCtx.rpcUrl, startWorker: false },
            async (ctx) => {
              // Use ctx.gqlUrl, ctx.controlUrl
              // ... test logic
            }
          );
        });
      });
    });
  });
});
```

---

## Parallel Migration Strategy

To accelerate migration, tests can be migrated in parallel by different engineers:

**Track 1 (Engineer A)**: Phase A (Unit Tests) - 5 days
**Track 2 (Engineer B)**: Phase B (Integration Tests) - 5 days
**Track 3 (Engineer C)**: Phase C (Marketplace System Tests) - 5 days
**Track 4 (Engineer D)**: Phase C (Worker System Tests) - 2 days

**Parallelized Timeline**: 5 days instead of 17.5 days (70% faster)

---

## Success Criteria

### Per-Phase Success Criteria

**Phase A**:
- [  ] All 6 unit tests passing in tests-next/
- [  ] Old unit tests still passing (dual-run)
- [  ] CI green with both old and new tests

**Phase B**:
- [  ] All 3 new integration tests passing
- [  ] 2 migrated integration tests passing
- [  ] Old tests deprecated (worker-git-ops)

**Phase C**:
- [  ] All 6 marketplace system tests passing
- [  ] All 2 worker system tests passing
- [  ] Old tests still passing (dual-run for 1 week)

**Phase D**:
- [  ] Redundant E2E test deleted
- [  ] No broken imports or references

### Overall Success Criteria

- [  ] All 20 legacy tests migrated or deprecated
- [  ] CI runs both old and new for 1 week (dual-run)
- [  ] New tests proven stable (no flakes)
- [  ] Old tests deleted
- [  ] Legacy `tests/` directory deprecated
- [  ] All tests use new framework exclusively

---

## Post-Migration Cleanup

After all tests migrated and proven stable (1-2 weeks dual-run):

1. **Delete Legacy Tests**:
   ```bash
   rm -rf tests/unit/
   rm -rf tests/marketplace/
   rm -rf tests/worker/
   rm -rf tests/git/
   rm -rf tests/e2e/
   rm -rf tests/service-deployment/
   rm -rf tests/codespec/
   ```

2. **Delete Legacy Helpers**:
   ```bash
   rm -rf tests/helpers/
   ```

3. **Update Config**:
   - Remove legacy test projects from `vitest.config.ts`
   - Keep only `tests-next` projects

4. **Update Documentation**:
   - Update README.md to reference tests-next/
   - Update CONTRIBUTING.md with new test patterns
   - Archive migration docs

5. **Celebrate** 🎉

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| New tests flaky | MEDIUM | HIGH | Dual-run period, extensive monitoring |
| Breaking changes in helpers | LOW | MEDIUM | Keep old helpers during migration |
| Migration takes longer than estimated | MEDIUM | LOW | Parallel tracks, flexible timeline |
| Lost test coverage during migration | LOW | HIGH | Dual-run ensures no coverage loss |
| Regression in migrated tests | LOW | HIGH | Code review, CI validation |

---

## Open Questions

1. **Should we migrate tests in feature branches or dedicated migration branch?**
   - **Recommendation**: Feature branches per phase (easier to review)

2. **Should we keep legacy tests after migration?**
   - **Recommendation**: Yes, for 1-2 weeks dual-run, then delete

3. **Should we update test assertions during migration?**
   - **Recommendation**: Only if clearly wrong; preserve test intent

4. **Should we split large tests during migration?**
   - **Recommendation**: Yes, if >500 LOC (e.g., git-lineage)

---

## Next Steps

1. **Review Migration Plan**: Team review of this roadmap
2. **Assign Tracks**: Assign phases to engineers
3. **Create GitHub Issues**: One issue per phase
4. **Begin Phase A**: Start with low-risk unit test migration
5. **Monitor Progress**: Weekly sync on migration status

---

**Next**: Proceed to Phase 6 (Testing Standards) to define coverage requirements and PR gates for the future.
