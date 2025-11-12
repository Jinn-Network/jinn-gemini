# Module Coverage Map

**Last Updated**: November 7, 2025
**Purpose**: Heat map showing which source modules have test coverage, at what level, and priorities for gap-filling

## Legend

- 🟢 **Good Coverage**: Unit + Integration tests
- 🟡 **Partial Coverage**: System tests only OR one level missing
- 🔴 **No Coverage**: Completely untested
- 📊 **Coverage %**: Estimated line coverage based on existing tests

## Worker System Modules (81 files)

### Core Worker & Orchestration

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/mech_worker.ts` | 🟡 | ❌ | ❌ | ✅ | ~20% | P1 |
| `worker/orchestration/contexts.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/orchestration/env.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/orchestration/jobRunner.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/orchestration/index.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |

**Analysis**: Core orchestration has no unit/integration tests. Only tested via full worker execution (system tests).

**Testability**: HIGH - These modules contain pure coordinator logic that should be easy to unit test with mocked I/O.

---

### Delivery System

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/delivery/payload.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | **P0** |
| `worker/delivery/report.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | **P0** |
| `worker/delivery/validation.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | **P0** |
| `worker/delivery/transaction.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | **P0** |
| `worker/delivery/index.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P0 |

**Analysis**: **CRITICAL GAP** - Delivery system constructs on-chain transactions with user funds. Zero unit test coverage.

**Testability**: MEDIUM - Some complex logic with blockchain dependencies, but core payload construction is pure and testable.

**Business Impact**: CRITICAL - Bugs here could lead to:
- Lost funds (incorrect transaction construction)
- Failed deliveries (validation errors)
- Data corruption (malformed payloads)

---

### Execution

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/execution/runAgent.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/execution/telemetryParser.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/execution/artifacts.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/execution/index.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P1 |

**Analysis**: Execution layer has no dedicated tests. Telemetry parsing especially risky (manual parsing of agent output).

**Testability**: HIGH - Telemetry parser is pure function, easy to test with sample outputs.

---

### Git Operations

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/git/autoCommit.ts` | 🟢 | ⚠️ | ✅ | ✅ | ~70% | ✅ |
| `worker/git/branch.ts` | 🟢 | ✅ | ✅ | ✅ | ~75% | ✅ |
| `worker/git/workingTree.ts` | 🟢 | ✅ | ✅ | ✅ | ~70% | ✅ |
| `worker/git/pr.ts` | 🟡 | ❌ | ✅ | ✅ | ~50% | P2 |
| `worker/git/push.ts` | 🟡 | ❌ | ✅ | ✅ | ~50% | P2 |
| `worker/git/repoManager.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/git/index.ts` | 🟢 | ⚠️ | ✅ | ✅ | ~60% | ✅ |

**Analysis**: **BEST COVERAGE** in the codebase. Git operations have unit, integration, and system tests.

**Gaps**:
- `autoCommit.ts` has integration tests but missing unit tests for helper functions (extractExecutionSummary, deriveCommitMessage)
- `pr.ts` and `push.ts` only tested via integration/system
- `repoManager.ts` completely untested

---

### Metadata Management

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/metadata/fetchIpfsMetadata.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/metadata/jobContext.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/metadata/prompt.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/metadata/index.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P1 |

**Analysis**: Metadata construction is critical for job execution. No dedicated tests.

**Testability**: HIGH - These are mostly pure transformation functions.

---

### Recognition & Reflection

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/situation_encoder.ts` | 🟢 | ✅ | ✅ | ✅ | ~80% | ✅ |
| `worker/recognition_helpers.ts` | 🟢 | ✅ | ❌ | ✅ | ~75% | ✅ |
| `worker/situation_artifact.ts` | 🟡 | ❌ | ✅ | ✅ | ~50% | P2 |
| `worker/recognition/initialSituation.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/recognition/runRecognition.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/recognition/telemetryAugment.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/recognition/index.ts` | 🟡 | ❌ | ✅ | ✅ | ~40% | P2 |
| `worker/reflection/memoryArtifacts.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/reflection/runReflection.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/reflection/index.ts` | 🟡 | ❌ | ❌ | ✅ | ~20% | P2 |

**Analysis**: Helper functions well-tested, but orchestration modules untested.

**Testability**: HIGH - Pure functions with well-defined inputs/outputs.

---

### Status Management

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/status/childJobs.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/status/inferStatus.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/status/parentDispatch.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/status/retryStrategy.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/status/index.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P1 |

**Analysis**: Status inference and Work Protocol logic completely untested at unit level.

**Testability**: HIGH - State machine logic, pure functions, easy to test.

**Business Impact**: HIGH - Incorrect status inference leads to incorrect parent dispatches and broken workflows.

---

### Configuration

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/config/MechConfig.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/config/ServiceConfig.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/config.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/ServiceConfigReader.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/ServiceConfigLoader.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/validation.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |

**Analysis**: Configuration validation completely untested.

**Testability**: HIGH - Config parsing and validation are pure functions.

**Business Impact**: MEDIUM - Bad config can break deployments, but caught early in dev.

---

### Contracts & Blockchain

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/contracts/OlasContractManager.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/contracts/MechMarketplace.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/contracts/OlasContractInterfaces.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/OlasStakingManager.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/OlasServiceManager.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/SafeAddressPredictor.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/ServiceStateTracker.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/StakingManagerFactory.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/MechMarketplaceRequester.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |

**Analysis**: **MAJOR GAP** - All contract interaction code untested.

**Testability**: MEDIUM - Requires mocked ethers.js providers, but doable.

**Business Impact**: HIGH - Contract bugs can lead to failed transactions, wasted gas, incorrect state.

---

### Transaction Queue

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/queue/ITransactionQueue.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | **P0** |
| `worker/queue/LocalTransactionQueue.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | **P0** |
| `worker/queue/TransactionQueueFactory.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | **P0** |
| `worker/queue/types.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P0 |
| `worker/queue/index.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P0 |

**Analysis**: **CRITICAL GAP** - Transaction queue manages on-chain submissions. Zero coverage.

**Testability**: HIGH - Queue operations are stateful but testable with in-memory state.

**Business Impact**: CRITICAL - Queue bugs can lead to:
- Duplicate transactions (wasted gas)
- Lost transactions (failed deliveries)
- Race conditions (corrupted state)

---

### Utilities & Helpers

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/tool_utils.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/artifacts.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/worker_telemetry.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/control_api_client.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/job_env_context.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/DelayUtils.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P3 |
| `worker/constants.ts` | N/A | N/A | N/A | N/A | N/A | N/A |
| `worker/types.ts` | N/A | N/A | N/A | N/A | N/A | N/A |

**Analysis**: Utility modules untested. Some low priority (DelayUtils), others high (control_api_client).

---

### MCP & Middleware

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/mcp/dispatcher.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/mcp/tools.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/mcp/index.ts` | 🟡 | ❌ | ⚠️ | ✅ | ~30% | P2 |
| `worker/OlasOperateWrapper.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `worker/SimplifiedServiceBootstrap.ts` | 🟡 | ❌ | ❌ | ✅ | ~20% | P2 |
| `worker/EoaExecutor.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `worker/IExecutor.ts` | N/A | N/A | N/A | N/A | N/A | N/A |
| `worker/TransactionProcessor.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |

---

### Logging

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `worker/logging/errors.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P3 |
| `worker/logging/telemetryLogs.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P3 |

---

## MCP Tools (gemini-agent/mcp/tools/) - 40+ files

| Tool Category | Status | Unit | Integration | System | Coverage % | Priority |
|---------------|--------|------|-------------|---------|-----------|----------|
| **Job Management** | | | | | | |
| `dispatch_new_job.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P1 |
| `dispatch_existing_job.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P1 |
| `get-details.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P1 |
| `search-jobs.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P1 |
| `get_job_context.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| **Artifact Management** | | | | | | |
| `create_artifact.ts` | 🟡 | ❌ | ❌ | ✅ | ~20% | P1 |
| `search-artifacts.ts` | 🟡 | ❌ | ❌ | ✅ | ~15% | P1 |
| **Memory & Recognition** | | | | | | |
| `search_similar_situations.ts` | 🟢 | ⚠️ | ✅ | ✅ | ~60% | P2 |
| `inspect_situation.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `embed_text.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| **Messaging** | | | | | | |
| `send-message.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| `create_message.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| **GitHub Tools** | | | | | | |
| `github_tools.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| **Transaction Queue** | | | | | | |
| `enqueue-transaction.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P0 |
| `get-transaction-status.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P0 |
| **Wallet** | | | | | | |
| `manage-wallet.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |
| **Civitai** (5 tools) | | | | | | |
| `civitai-*.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P3 |
| **Zora** (2 tools) | | | | | | |
| `zora-*.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P3 |
| **Utilities** | | | | | | |
| `list-tools.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |
| `shared/*.ts` (10+ files) | 🔴 | ❌ | ❌ | ❌ | 0% | P1-P3 |

**Analysis**: MCP tools only tested via slow system tests. Need unit tests for:
- Input validation
- Error handling
- Response formatting
- Business logic

---

## Environment & Configuration (env/)

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `env/control.ts` | 🟡 | ⚠️ | ✅ | ✅ | ~20% | P1 |
| `env/index.ts` | 🔴 | ❌ | ❌ | ❌ | 0% | P1 |

**Analysis**: Only `isControlApiEnabled()` function tested. Rest of env management untested.

---

## CodeSpec System (codespec/)

| Module | Status | Unit | Integration | System | Coverage % | Priority |
|--------|--------|------|-------------|---------|-----------|----------|
| `codespec/lib/ledger.ts` | 🟢 | ✅ | ❌ | ❌ | ~70% | ✅ |
| `codespec/lib/*.ts` (other) | 🔴 | ❌ | ❌ | ❌ | 0% | P2 |

---

## Coverage Summary by Domain

| Domain | Total Modules | Unit Tested | Integration Tested | System Tested | Avg Coverage | Priority |
|--------|---------------|-------------|-------------------|---------------|--------------|----------|
| **Delivery** | 5 | 0 | 0 | 1 | ~3% | **P0** |
| **Transaction Queue** | 5 | 0 | 0 | 0 | 0% | **P0** |
| **Git Operations** | 7 | 3 | 7 | 7 | ~65% | ✅ |
| **Recognition & Reflection** | 10 | 2 | 2 | 5 | ~45% | P2 |
| **Status Management** | 5 | 0 | 0 | 1 | ~3% | P1 |
| **Execution** | 4 | 0 | 0 | 1 | ~3% | P1 |
| **Metadata** | 4 | 0 | 0 | 1 | ~3% | P1 |
| **Orchestration** | 5 | 0 | 0 | 1 | ~4% | P1 |
| **Configuration** | 6 | 0 | 0 | 0 | 0% | P1 |
| **Contracts** | 9 | 0 | 0 | 0 | 0% | P1 |
| **MCP Tools** | 40+ | 0 | 1 | 10 | ~5% | P1 |
| **MCP Shared** | 15 | 0 | 0 | 0 | 0% | P1-P3 |
| **Utilities** | 8 | 0 | 0 | 0 | 0% | P2-P3 |

---

## Priority Classification

### P0 - Critical (Must Test Immediately)
**Impact**: Financial loss, data corruption, system failure

1. **Delivery System** (5 modules, 0% coverage)
   - `worker/delivery/payload.ts`
   - `worker/delivery/report.ts`
   - `worker/delivery/validation.ts`
   - `worker/delivery/transaction.ts`

2. **Transaction Queue** (5 modules, 0% coverage)
   - `worker/queue/LocalTransactionQueue.ts`
   - `worker/queue/TransactionQueueFactory.ts`
   - `gemini-agent/mcp/tools/enqueue-transaction.ts`
   - `gemini-agent/mcp/tools/get-transaction-status.ts`

**Total**: 9 P0 modules, 0% average coverage

---

### P1 - High Priority (Test Within Month)
**Impact**: Workflow failures, incorrect behavior, reliability issues

1. **Status Management** (5 modules)
2. **Execution** (4 modules)
3. **Metadata** (4 modules)
4. **Orchestration** (5 modules)
5. **Configuration** (6 modules)
6. **Contracts** (9 modules)
7. **MCP Core Tools** (15 modules)
8. **Control API** (1 module)

**Total**: 49 P1 modules, ~5% average coverage

---

### P2 - Medium Priority (Test Within Quarter)
**Impact**: User experience, maintainability, observability

1. **Recognition & Reflection** (8 untested modules)
2. **MCP Utilities** (5 modules)
3. **Utilities** (5 modules)
4. **CodeSpec** (5 modules)

**Total**: 23 P2 modules, ~10% average coverage

---

### P3 - Low Priority (Test When Time Permits)
**Impact**: Minor features, rarely-used paths

1. **Civitai Integration** (5 modules)
2. **Zora Integration** (2 modules)
3. **Logging** (2 modules)
4. **DelayUtils** (1 module)

**Total**: 10 P3 modules, 0% coverage

---

## Heat Map Visualization

```
🔴🔴🔴🔴🔴  Delivery System (P0)
🔴🔴🔴🔴🔴  Transaction Queue (P0)
🟢🟢🟢🟡🟡  Git Operations (Good)
🔴🔴🔴🔴🔴  Status Management (P1)
🔴🔴🔴🔴    Execution (P1)
🔴🔴🔴🔴    Metadata (P1)
🔴🔴🔴🔴🔴  Orchestration (P1)
🔴🔴🔴🔴🔴🔴 Configuration (P1)
🔴🔴🔴🔴🔴🔴🔴🔴🔴 Contracts (P1)
🟡🟢🔴🔴🔴🔴🔴🔴🔴🔴 Recognition (P2)
🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 MCP Tools (P1)
```

**Legend**: 🟢 = Good | 🟡 = Partial | 🔴 = None

---

## Testability Assessment

### HIGH Testability (Easy to Unit Test)
- Delivery payload/report construction
- Status inference logic
- Telemetry parser
- Metadata transformations
- Config validation
- Recognition helpers (already tested)
- Utility functions

### MEDIUM Testability (Requires Mocking)
- Contract interactions (mock ethers.js)
- IPFS fetching (mock HTTP)
- Control API client (mock HTTP)
- MCP tools (mock MCP client)
- Transaction queue (mock state)

### LOW Testability (Complex Integration)
- Worker orchestration (too many dependencies)
- Full git workflows (complex state management)
- Service bootstrap (external processes)

**Recommendation**: Focus on HIGH testability modules first for quick wins.

---

## Next Steps

Based on this coverage map, proceed to:
1. **Phase 3**: Gap Analysis by Priority (detailed P0/P1 analysis)
2. **Phase 4**: Duplication Detection (identify redundant coverage)
3. **Phase 5**: Migration Strategy (move legacy tests to new framework)
4. **Phase 6**: Testing Standards (define coverage requirements)
5. **Phase 7**: Unit Test Backlog (create actionable GitHub issues)

---

**Key Insight**: 58 of 81 worker modules (71%) have ZERO unit test coverage. Most critical gaps are in delivery system and transaction queue (P0) and status/execution/metadata (P1).
