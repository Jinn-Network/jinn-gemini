# Test Inventory & Classification

**Last Updated**: November 7, 2025
**Purpose**: Complete inventory of all test files, accurate classification by type, and coverage mapping

## Executive Summary

- **Total Tests**: 25 test files (20 legacy + 5 new)
- **True Unit Tests**: 9 (36%)
- **Integration Tests**: 11 (44%)
- **System Tests**: 5 (20%)
- **Misclassified**: ~7 tests in `tests/unit/` are actually integration tests

## Test Classification Matrix

### ✅ Unit Tests (Pure logic, mocked I/O, <100ms)

| Test File | Lines | Source Module(s) Covered | Status |
|-----------|-------|-------------------------|--------|
| `tests/unit/situation-encoder.test.ts` | 135 | `worker/situation_encoder.ts` | ✅ Production |
| `tests/unit/recognition-helpers.test.ts` | 101 | `worker/recognition_helpers.ts` | ✅ Production |
| `tests/unit/worker/git/branch.test.ts` | 148 | `worker/git/branch.ts` | ✅ Production |
| `tests/unit/worker/git/workingTree.test.ts` | 188 | `worker/git/workingTree.ts` | ✅ Production |
| `tests/codespec/ledger.test.ts` | 189 | `codespec/lib/ledger.ts` | ✅ Production |
| `tests-next/unit/control-api-config.test.ts` | 44 | `env/control.ts` (`isControlApiEnabled` only) | ✅ Production |

**Misclassified as Unit (Actually Integration):**
| Test File | Lines | Why It's Integration | Should Move To |
|-----------|-------|---------------------|----------------|
| `tests/unit/mcp-stdout-clean.test.ts` | ~150 | Spawns real MCP server process | `tests-next/integration/` |
| `tests/unit/worker-git-ops.test.ts` | ~200 | Uses real temp git repos | `tests-next/integration/git/` |
| `tests/unit/search-similar-situations.test.ts` | 135 | Mocks pg but tests full query flow | `tests-next/integration/` |
| `tests/unit/worker/git/autoCommit.test.ts` | (deleted) | Used real git repos | N/A |

### 🔗 Integration Tests (Component boundaries, real FS/git, 100ms-5s)

| Test File | Lines | Components Tested | Infrastructure |
|-----------|-------|-------------------|----------------|
| **Legacy Tests (tests/)** |
| `tests/unit/mcp-stdout-clean.test.ts` | ~150 | MCP server stdout cleanliness | Real MCP process |
| `tests/unit/worker-git-ops.test.ts` | ~200 | Git helper functions (autoCommit, PR format) | Temp git repos |
| `tests/unit/search-similar-situations.test.ts` | 135 | Vector DB search with mocked pg | Mocked Postgres |
| `tests/git/worker-git-auto-commit.test.ts` | 117 | Worker auto-commit flow | Ponder, Control API, Git, Worker |
| `tests/git/worker-git-lineage.test.ts` | 697 | Git lineage, branch ancestry, PR creation | Full stack + GitHub API |
| `tests/e2e/situation-recognition.e2e.test.ts` | 209 | Recognition workflow with mocked deps | Mocked pg, IPFS, artifacts |
| **New Tests (tests-next/)** |
| `tests-next/integration/env-controller.integration.test.ts` | 24 | Env loading, snapshot/restore | Real filesystem |
| `tests-next/integration/situation-workflow.integration.test.ts` | 225 | Situation artifact creation & search | Mocked pg, embed, artifacts |

### 🏗️ System Tests (Full E2E, real infrastructure, 30s-600s)

| Test File | Duration | Infrastructure | Purpose |
|-----------|----------|---------------|---------|
| **Legacy Tests (tests/)** |
| `tests/marketplace/marketplace-dispatch.test.ts` | ~180s | Tenderly VNet, Ponder, Control API, IPFS | dispatch_new_job → IPFS → Ponder indexing |
| `tests/marketplace/marketplace-lineage.test.ts` | ~180s | Tenderly VNet, Ponder, Control API, IPFS | Lineage propagation through system |
| `tests/marketplace/marketplace-context-envelope.test.ts` | 300s | Tenderly VNet, Ponder, Control API, IPFS | Context envelope with child jobs |
| `tests/marketplace/marketplace-message-system.test.ts` | 60s | Tenderly VNet, Ponder, Control API, IPFS | Message creation and indexing |
| `tests/marketplace/marketplace-code-metadata.test.ts` | 240s | Tenderly VNet, Ponder, Control API, IPFS, Git | Code metadata embedding in dispatch |
| `tests/worker/worker-artifact-creation.test.ts` | 600s | Full stack + Worker | Worker creates artifact via MCP tool |
| `tests/worker/worker-work-protocol.test.ts` | 600s | Full stack + Worker | Work Protocol auto-dispatch behavior |
| `tests/service-deployment/service-deployment.e2e.test.ts` | 900s | Tenderly VNet, OLAS middleware | Full OLAS service deployment |
| **New Tests (tests-next/)** |
| `tests-next/system/harness.system.test.ts` | 240s | Tenderly VNet, Ponder, Control API | Infrastructure harness smoke test |
| `tests-next/system/worker-basic-execution.system.test.ts` | 600s | Full stack + Worker | Basic worker execution cycle |

## Coverage by Source Module

### 🟢 Good Coverage (Unit + Integration)

| Module | Unit Tests | Integration Tests | System Tests |
|--------|-----------|------------------|--------------|
| `worker/situation_encoder.ts` | ✅ 1 | - | - |
| `worker/recognition_helpers.ts` | ✅ 1 | - | - |
| `worker/git/branch.ts` | ✅ 1 | - | - |
| `worker/git/workingTree.ts` | ✅ 1 | - | - |
| `worker/git/autoCommit.ts` | - | ✅ 2 | - |
| `worker/git/pr.ts` | - | ✅ 1 | - |
| `codespec/lib/ledger.ts` | ✅ 1 | - | - |
| `env/control.ts` (partial) | ✅ 1 | - | - |

### 🟡 Partial Coverage (System tests only)

| Module | Coverage | Notes |
|--------|----------|-------|
| MCP Tools (dispatch, create_artifact, etc.) | System only | Tested indirectly via worker execution |
| Worker orchestration | System only | Tested via full stack tests |
| Delivery system | System only | Tested via worker artifact/dispatch tests |
| Recognition/Reflection | Integration + System | Mocked integration + E2E |

### 🔴 No Coverage (Critical Gaps)

| Module | Priority | Reason |
|--------|----------|--------|
| `worker/delivery/payload.ts` | P0 | Handles delivery transaction construction |
| `worker/delivery/report.ts` | P0 | Formats reports for delivery |
| `worker/delivery/validation.ts` | P0 | Validates deliveries before submission |
| `worker/delivery/transaction.ts` | P0 | Constructs blockchain transactions |
| `worker/queue/LocalTransactionQueue.ts` | P0 | Manages transaction queue |
| `worker/config/MechConfig.ts` | P1 | Configuration validation |
| `worker/config/ServiceConfig.ts` | P1 | Service configuration |
| `worker/contracts/OlasContractManager.ts` | P1 | Contract interactions |
| `worker/contracts/OlasStakingManager.ts` | P1 | Staking management |
| `worker/contracts/SafeAddressPredictor.ts` | P1 | Safe address prediction |
| `worker/execution/runAgent.ts` | P1 | Agent execution orchestration |
| `worker/execution/telemetryParser.ts` | P1 | Telemetry parsing |
| `worker/metadata/fetchIpfsMetadata.ts` | P1 | IPFS metadata fetching |
| `worker/metadata/jobContext.ts` | P1 | Job context construction |
| `worker/metadata/prompt.ts` | P1 | Prompt building |
| `worker/orchestration/contexts.ts` | P1 | Context management |
| `worker/orchestration/env.ts` | P1 | Environment setup |
| `worker/orchestration/jobRunner.ts` | P1 | Job runner orchestration |
| `worker/recognition/initialSituation.ts` | P2 | Initial situation creation |
| `worker/recognition/runRecognition.ts` | P2 | Recognition execution |
| `worker/recognition/telemetryAugment.ts` | P2 | Telemetry augmentation |
| `worker/reflection/memoryArtifacts.ts` | P2 | Memory artifact creation |
| `worker/reflection/runReflection.ts` | P2 | Reflection execution |
| `worker/status/childJobs.ts` | P1 | Child job tracking |
| `worker/status/inferStatus.ts` | P1 | Status inference |
| `worker/status/parentDispatch.ts` | P1 | Parent dispatch logic |
| `worker/status/retryStrategy.ts` | P1 | Retry strategy |
| `worker/validation.ts` | P1 | General validation utilities |
| `worker/tool_utils.ts` | P2 | Tool utilities |
| `worker/artifacts.ts` | P2 | Artifact utilities |
| `worker/worker_telemetry.ts` | P2 | Telemetry collection |
| `worker/control_api_client.ts` | P1 | Control API client |
| ~40 MCP Tools | P1 | Only tested via system tests |

## Duplication Analysis

### ✅ Valuable Duplication (Different Test Levels)
- **Git operations**: Unit tests (branch.test.ts, workingTree.test.ts) + Integration tests (worker-git-auto-commit.test.ts, worker-git-lineage.test.ts) + System tests (via worker execution)
  - **Value**: Tests pure functions at unit level, integration at git level, E2E at worker level

- **Situation workflow**: Integration test (situation-workflow.integration.test.ts) + E2E test (situation-recognition.e2e.test.ts)
  - **Value**: Integration tests with mocks vs E2E with real infrastructure

### ⚠️ Questionable Duplication
- **Git auto-commit**: Tested in `worker-git-ops.test.ts` (unit-like but uses real git) AND `worker-git-auto-commit.test.ts` (integration)
  - **Recommendation**: Keep integration test, add pure unit tests for helper functions

### ❌ No Significant Redundancy
Most tests cover different aspects or layers of the system.

## Test Framework Evolution

### Legacy Framework (tests/)
- **Global Setup**: `tests/helpers/setup.ts` (VNet creation, Ponder, Control API)
- **Shared Helpers**: `tests/helpers/shared.ts` (~1000 LOC)
- **Test Isolation**: Moderate (shared VNet per suite)
- **Run Time**: Slow (sequential, infrastructure overhead)
- **Config**: `vitest.config.ts` with 8 projects (marketplace, worker, git, service, unit, codespec, e2e, integration)

### New Framework (tests-next/)
- **Env Management**: `env-controller.ts` (snapshot/restore)
- **Infrastructure Harness**: `process-harness.ts` (Ponder, Control API lifecycle)
- **Tenderly Integration**: `tenderly-runner.ts` (VNet creation per test)
- **Test Isolation**: High (ephemeral VNets, env snapshots)
- **Run Time**: Optimized (parallel-safe, faster setup)
- **Config**: `vitest.config.next.ts` with 3 projects (unit-next, integration-next, system-next)

## Migration Recommendations

### Phase A: Migrate True Unit Tests (Low Risk, ~8 tests)
1. ✅ `tests-next/unit/control-api-config.test.ts` - Already migrated
2. 🚀 `tests/unit/situation-encoder.test.ts` → `tests-next/unit/worker/situation-encoder.test.ts`
3. 🚀 `tests/unit/recognition-helpers.test.ts` → `tests-next/unit/worker/recognition-helpers.test.ts`
4. 🚀 `tests/unit/worker/git/branch.test.ts` → `tests-next/unit/worker/git/branch.test.ts`
5. 🚀 `tests/unit/worker/git/workingTree.test.ts` → `tests-next/unit/worker/git/workingTree.test.ts`
6. 🚀 `tests/codespec/ledger.test.ts` → `tests-next/unit/codespec/ledger.test.ts`

### Phase B: Reclassify as Integration (~7 tests)
1. 🔄 `tests/unit/mcp-stdout-clean.test.ts` → `tests-next/integration/mcp/stdout-clean.integration.test.ts`
2. 🔄 `tests/unit/worker-git-ops.test.ts` → `tests-next/integration/git/git-ops.integration.test.ts`
3. 🔄 `tests/unit/search-similar-situations.test.ts` → `tests-next/integration/recognition/search-similar-situations.integration.test.ts`
4. 🔄 `tests/git/worker-git-auto-commit.test.ts` → `tests-next/integration/git/auto-commit.integration.test.ts`
5. 🔄 `tests/git/worker-git-lineage.test.ts` → `tests-next/integration/git/lineage.integration.test.ts`
6. ✅ `tests-next/integration/env-controller.integration.test.ts` - Already migrated
7. ✅ `tests-next/integration/situation-workflow.integration.test.ts` - Already migrated

### Phase C: Migrate System Tests (~7 tests)
1. ✅ `tests-next/system/worker-basic-execution.system.test.ts` - Already migrated
2. 🚀 `tests/marketplace/marketplace-dispatch.test.ts` → `tests-next/system/marketplace-dispatch.system.test.ts`
3. 🚀 `tests/marketplace/marketplace-lineage.test.ts` → `tests-next/system/marketplace-lineage.system.test.ts`
4. 🚀 `tests/marketplace/marketplace-context-envelope.test.ts` → `tests-next/system/marketplace-context-envelope.system.test.ts`
5. 🚀 `tests/marketplace/marketplace-message-system.test.ts` → `tests-next/system/marketplace-message-system.system.test.ts`
6. 🚀 `tests/marketplace/marketplace-code-metadata.test.ts` → `tests-next/system/marketplace-code-metadata.system.test.ts`
7. 🚀 `tests/worker/worker-artifact-creation.test.ts` → `tests-next/system/worker-artifact-creation.system.test.ts`
8. 🚀 `tests/worker/worker-work-protocol.test.ts` → `tests-next/system/worker-work-protocol.system.test.ts`
9. 🚀 `tests/service-deployment/service-deployment.e2e.test.ts` → `tests-next/system/service-deployment.system.test.ts`
10. ✅ `tests-next/system/harness.system.test.ts` - Already migrated
11. 🚀 `tests/e2e/situation-recognition.e2e.test.ts` → Consider deprecating (covered by situation-workflow.integration.test.ts + system tests)

### Phase D: Deprecate (~1 test)
1. ❌ `tests/e2e/situation-recognition.e2e.test.ts` - Redundant with new integration + system tests

## Test Health Metrics

### Code Coverage (Estimated)
- **Worker Core**: ~15% (only system tests)
- **Git Operations**: ~60% (unit + integration)
- **Recognition/Reflection**: ~30% (integration + system)
- **Delivery System**: 0% (no unit tests)
- **MCP Tools**: ~10% (system tests only)
- **Config/Validation**: ~5% (one function tested)
- **Contracts**: 0% (no tests)
- **Transaction Queue**: 0% (no tests)

### Test Pyramid Health (Current)
```
        System (20%)        Target: 10%
      /            \
  Integration (44%)         Target: 20%
 /                  \
Unit (36%)                  Target: 70%
```

**Current pyramid is inverted** - too many slow tests, not enough fast unit tests.

### Test Execution Time (Estimated)
- **Unit Tests**: ~5s total (9 tests)
- **Integration Tests**: ~2min total (11 tests)
- **System Tests**: ~50min total (5 tests)
- **Total**: ~52min for full test suite

## Key Findings

### ✅ Strengths
1. **System Tests**: Comprehensive E2E coverage of critical user flows
2. **Git Operations**: Well-tested at multiple levels
3. **Recognition/Reflection**: Good integration test coverage
4. **New Framework**: Modern, isolated, parallel-safe infrastructure

### ⚠️ Weaknesses
1. **Inverted Pyramid**: Only 36% unit tests (target: 70%)
2. **Delivery System**: Zero unit test coverage (P0 critical path)
3. **MCP Tools**: Only tested via slow system tests
4. **Config/Validation**: Almost no coverage
5. **Contracts**: Zero coverage
6. **Misclassified Tests**: ~7 tests in wrong category

### 🔴 Critical Gaps (P0)
1. `worker/delivery/*` - No unit tests for delivery system
2. `worker/queue/*` - No tests for transaction queue
3. `worker/contracts/*` - No tests for contract interactions

### 📈 Opportunities
1. **Extract Pure Functions**: Many integration tests could have companion unit tests
2. **Mock Boundaries**: Many system tests could be integration tests with mocked I/O
3. **Test Generation**: Use AI to generate unit tests for untested modules
4. **Coverage Gates**: Enforce minimum coverage in CI (currently no gates)

## Recommendations

### Immediate Actions (Week 1)
1. ✅ Complete this inventory
2. Create migration plan with timeline
3. Add coverage reporting to CI
4. Block PRs that drop coverage >5%

### Short Term (Month 1)
1. Migrate Phase A (true unit tests) to tests-next/
2. Write unit tests for delivery system (P0)
3. Write unit tests for transaction queue (P0)
4. Add unit tests for config validation (P1)

### Medium Term (Quarter 1)
1. Migrate Phase B & C (integration + system)
2. Write unit tests for MCP tools (P1)
3. Write unit tests for orchestration (P1)
4. Achieve 50% overall coverage

### Long Term (Year 1)
1. Deprecate legacy test framework
2. Achieve 70% overall coverage
3. Maintain healthy test pyramid (70/20/10)
4. Quarterly test health reviews

---

**Next Steps**: Proceed to Phase 2 (Module Coverage Mapping) to create detailed heat map of source → test coverage.
