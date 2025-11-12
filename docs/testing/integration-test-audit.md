# Integration Test Audit - Coverage & Value Analysis

**Last Updated**: November 7, 2025
**Purpose**: Comprehensive audit of integration test coverage against architectural boundaries, with focus on real integration value vs code exercises
**Auditor**: Integration test analysis (complementing unit test audit by other dev)

---

## Executive Summary

**Current State**:
- **Total Integration Tests**: 11 tests (44% of test suite)
- **True Integration Tests**: 6 tests (test real component boundaries)
- **Misclassified as Integration**: 5 tests (actually unit tests with mocks)
- **Critical Gaps**: 7 of 10 architectural boundaries have NO integration tests

**Key Findings**:
1. 🔴 **Most "integration tests" are actually mocked unit tests** - they don't test real component interactions
2. 🔴 **Critical integration boundaries untested** - Control API validation, delivery flow, work protocol
3. 🟡 **Existing integration tests focus on Git** - good coverage there, but narrow scope
4. 🟢 **Test infrastructure is mature** - `tests-next/` framework supports real integration testing

**Risk Assessment**: **HIGH** - Critical system integration points (data flow validation, persistence boundaries, work protocol) have zero integration test coverage

---

## Part 1: Integration Boundary Mapping

### What is a TRUE Integration Test?

**Definition**: Tests that validate **data flow and contracts between two or more real components**, not mocked implementations.

**Characteristics**:
- ✅ Uses **real** filesystem, git repos, HTTP servers where appropriate
- ✅ Tests **data transformation** across component boundaries
- ✅ Validates **error propagation** between layers
- ✅ Tests **idempotency** and retry behavior
- ✅ Runs in **reasonable time** (100ms - 5s, not 60s+)
- ❌ Does NOT use full blockchain/worker (that's system test)
- ❌ Does NOT mock all dependencies (that's unit test)

---

## The 10 Critical Integration Boundaries (from Architecture Requirements)

### Boundary 1: On-Chain Events → Ponder Indexer

**Description** (ARQ-001, ARQ-004): Ponder indexes on-chain events, resolves IPFS content, creates queryable GraphQL schema

**Integration Points**:
- Blockchain event parsing
- IPFS gateway fetching with retries
- PostgreSQL indexing
- Relationship construction (parent/child jobs)
- Embedding extraction from SITUATION artifacts

**Current Coverage**: 🔴 **NONE** (only tested at system level)

**Why Critical**: If Ponder fails to index events or resolve IPFS content, entire system breaks (job discovery, delivery confirmation)

**Missing Integration Tests**:
1. **Ponder IPFS Resolution Integration**
   - Mock blockchain events, real IPFS gateway
   - Test: Event → Fetch IPFS → Parse JSON → Store in DB
   - Validates: IPFS timeout handling, malformed JSON, missing fields
   - Runtime: ~2s

2. **Ponder SITUATION Indexing Integration**
   - Mock delivery event with SITUATION artifact
   - Real IPFS fetch, real pgvector insert
   - Test: Delivery → Fetch artifact → Validate embedding → Upsert node_embeddings
   - Validates: Embedding format, dimension validation, upsert idempotency
   - Runtime: ~3s

3. **Ponder Job Hierarchy Construction**
   - Mock multiple request events with parent/child relationships
   - Test: Events → Parse sourceJobDefinitionId → Build hierarchy
   - Validates: Relationship integrity, circular dependency detection
   - Runtime: ~1s

**Priority**: **P1** (High) - Ponder failures cascade to entire system

**Estimated Effort**: 4 days

---

### Boundary 2: Ponder GraphQL API → Worker

**Description** (ARQ-003, ARQ-004): Worker polls Ponder via GraphQL to discover unclaimed jobs

**Integration Points**:
- GraphQL query construction
- Job filtering (unclaimed, by mech address)
- IPFS hash resolution to full metadata
- Error handling (Ponder unavailable, malformed responses)

**Current Coverage**: 🔴 **NONE** (only tested at system level)

**Why Critical**: Worker can't discover work if Ponder queries fail

**Missing Integration Tests**:
1. **Worker Job Discovery Integration**
   - Real Ponder GraphQL server (Ponder test mode)
   - Seed database with test requests
   - Test: Worker queries → Filters unclaimed → Returns job metadata
   - Validates: Query correctness, filtering logic, pagination
   - Runtime: ~2s

2. **Worker Job Context Retrieval Integration**
   - Real Ponder with seeded job hierarchy
   - Test: get_job_context MCP tool → Queries Ponder → Returns parent/sibling/child context
   - Validates: Hierarchy queries, completed children detection, artifact accumulation
   - Runtime: ~2s

**Priority**: **P1** (High) - Core worker loop depends on this

**Estimated Effort**: 3 days

---

### Boundary 3: Worker → Control API → Supabase

**Description** (ARQ-005, ARQ-008): Control API validates all off-chain writes, injects lineage, prevents direct Supabase access

**Integration Points**:
- Request validation against Ponder
- Lineage injection (request_id, worker_address)
- Idempotent operations (claims, reports)
- Error propagation to worker

**Current Coverage**: 🔴 **NONE** (only tested at system level)

**Why Critical**: **CRITICAL** - This is the validation gateway preventing malformed data and invalid lineage

**Missing Integration Tests**:
1. **Control API Validation Gateway Integration**
   - Real Control API + mocked Ponder queries
   - Test: claimRequest with invalid requestId → Control API validates against Ponder → Returns error
   - Validates: Request validation BEFORE database write
   - Runtime: ~1s

2. **Control API Lineage Injection Integration**
   - Real Control API + real Supabase (test schema)
   - Test: createJobReport → Control API injects request_id and worker_address → Writes to Supabase
   - Validates: Lineage fields auto-injected, no manual construction
   - Runtime: ~1s

3. **Control API Idempotency Integration**
   - Real Control API + real Supabase
   - Test: claimRequest called twice with same requestId → Second call returns existing claim, no duplicate
   - Validates: ON CONFLICT handling, idempotent behavior
   - Runtime: ~1s

**Priority**: **P0** (Critical) - JINN-195 proved this is essential for data integrity

**Estimated Effort**: 3 days

---

### Boundary 4: Worker → Agent (Settings Generation, Tool Isolation)

**Description** (ARQ-007, EXQ-006, EXQ-008): Worker generates per-job settings, controls tool access, spawns isolated agent process

**Integration Points**:
- Settings template selection (dev vs prod)
- Tool filtering (universal + enabled tools only)
- Environment variable injection
- Settings cleanup after execution

**Current Coverage**: 🟡 **PARTIAL** - MCP stdout cleanliness tested, but not settings generation

**Existing Tests**:
- `tests/unit/mcp-stdout-clean.test.ts` - Validates MCP server stdout (should be reclassified as integration)

**Why Critical**: Tool isolation is security boundary - agents must not access tools they shouldn't have

**Missing Integration Tests**:
1. **Agent Settings Generation Integration**
   - Real worker settings generation logic
   - Test: Generate settings for job with specific enabledTools → Validate only allowed tools in settings.json
   - Validates: Tool filtering, template selection, env var injection
   - Runtime: ~500ms

2. **Agent Tool Isolation Integration**
   - Spawn real Gemini agent with restricted settings
   - Test: Agent attempts to call excluded tool → Tool call fails or returns error
   - Validates: Tool access control enforced by Gemini CLI
   - Runtime: ~3s

**Priority**: **P1** (High) - Security boundary

**Estimated Effort**: 2 days

---

### Boundary 5: Agent → MCP Tools → Tool Handlers

**Description** (EXQ-005, EXQ-009, EXQ-010): Agent calls MCP tools, tools execute and return structured JSON, worker parses telemetry

**Integration Points**:
- Tool registration in MCP server
- Zod schema validation
- Tool handler execution
- Structured response format
- Telemetry capture

**Current Coverage**: 🔴 **NONE** (only tested at system level)

**Why Critical**: Tool output capture is foundation for artifact extraction, status inference, reflection

**Missing Integration Tests**:
1. **MCP Tool Output Capture Integration**
   - Real MCP server with test tools
   - Mock Gemini client calling tools
   - Test: Tool call → Handler executes → Returns structured JSON → Captured in telemetry
   - Validates: Response format, JSON structure, error handling
   - Runtime: ~2s

2. **MCP Tool Validation Integration**
   - Real MCP server with Zod schemas
   - Test: Tool call with invalid params → Zod validation fails → Returns error
   - Validates: Input validation before handler execution
   - Runtime: ~1s

**Priority**: **P1** (High) - Foundation for worker-agent contract

**Estimated Effort**: 3 days

---

### Boundary 6: MCP Tools → IPFS (Artifact Upload)

**Description** (PER-003, PER-005): Tools upload content to IPFS, return CIDs, worker includes in delivery payload

**Integration Points**:
- IPFS registry upload (Autonolas infrastructure)
- CID extraction from response
- Content-addressed verification
- Error handling (timeout, network failure)

**Current Coverage**: 🔴 **NONE** (only tested at system level)

**Why Critical**: Artifact persistence - if IPFS upload fails silently, artifacts are lost

**Missing Integration Tests**:
1. **Artifact Upload Integration**
   - Real create_artifact tool handler
   - Real IPFS registry (Autonolas)
   - Test: create_artifact → Upload to IPFS → Return CID → Verify content retrievable
   - Validates: Upload success, CID format, content addressability
   - Runtime: ~3s

2. **IPFS Failure Handling Integration**
   - Mock IPFS registry with timeout/error simulation
   - Test: create_artifact → IPFS timeout → Tool returns error, no partial upload
   - Validates: Error propagation, cleanup on failure
   - Runtime: ~2s

**Priority**: **P1** (High) - Data persistence boundary

**Estimated Effort**: 2 days

---

### Boundary 7: Worker → Blockchain (Safe Transactions, Delivery)

**Description** (ARQ-001, LCQ-010, PER-005): Worker submits delivery via Gnosis Safe, waits for on-chain confirmation

**Integration Points**:
- Safe transaction construction
- Nonce management
- IPFS digest extraction from directory CID
- Transaction signing
- Blockchain submission
- Event confirmation

**Current Coverage**: 🔴 **NONE** (only tested at system level with VNets)

**Why Critical**: **CRITICAL** - Delivery finality, financial transactions

**Missing Integration Tests**:
1. **Delivery Transaction Construction Integration**
   - Real delivery payload construction
   - Mock Safe transaction builder
   - Test: Delivery → Upload to IPFS → Extract digest → Construct OlasMech.deliver() call
   - Validates: IPFS directory CID handling, digest extraction, calldata encoding
   - Runtime: ~2s

2. **Safe Transaction Queue Integration**
   - Real transaction queue implementation
   - Mock blockchain RPC
   - Test: Enqueue delivery → Queue assigns nonce → Transaction built correctly
   - Validates: Nonce management, queue ordering, idempotency
   - Runtime: ~1s

**Priority**: **P0** (Critical) - Financial boundary, from coverage-gaps-prioritized.md

**Estimated Effort**: 4 days

---

### Boundary 8: Worker → Git (Auto-Commit, PR Creation, Lineage)

**Description** (ARQ-009): Worker checks out job branches, auto-commits changes, creates PRs with lineage tracking

**Integration Points**:
- Branch checkout/creation
- Working tree status detection
- Auto-commit with derived message
- Push to remote
- PR creation via GitHub API

**Current Coverage**: 🟢 **GOOD** - Multiple integration tests covering git operations

**Existing Tests**:
- `tests/git/worker-git-auto-commit.test.ts` - Auto-commit flow with real git repos ✅
- `tests/git/worker-git-lineage.test.ts` - Branch lineage, PR creation ✅
- `tests/unit/worker-git-ops.test.ts` - Git helper functions (misclassified, should be integration) ✅

**Why This Works Well**:
- Uses real git repositories (not mocked)
- Tests actual file system operations
- Validates git command execution
- Tests error conditions (dirty tree, merge conflicts)

**Assessment**: ✅ **EXEMPLARY** - This is what all integration tests should look like

**Gaps** (Minor):
- No test for git operation failures (network down during push)
- No test for concurrent git operations (race conditions)

**Priority**: **P2** (Low) - Already well-covered

**Estimated Effort**: 1 day (minor additions)

---

### Boundary 9: Recognition/Reflection → Memory System (Embeddings, Vector Search)

**Description** (MEM-001 to MEM-010): Recognition searches for similar situations, reflection creates MEMORY artifacts, both use embeddings

**Integration Points**:
- Embedding generation (OpenAI API)
- Vector storage in pgvector
- Cosine similarity search
- IPFS artifact fetching
- Learning extraction and formatting

**Current Coverage**: 🟡 **PARTIAL** - Workflow tested but with ALL mocks

**Existing Tests**:
- `tests-next/integration/situation-workflow.integration.test.ts` - Mocks pg, embed_text, create_artifact
- `tests/e2e/situation-recognition.e2e.test.ts` - Also mocks everything (redundant)

**Problem**: Both tests mock ALL dependencies, so they don't test real integration - they're glorified unit tests

**Why Critical**: Memory system is core learning mechanism - if embeddings aren't stored correctly, learning breaks

**Missing Integration Tests**:
1. **Embedding Storage Integration**
   - Real pgvector database (test schema)
   - Real embedding generation (or stable mock with real vectors)
   - Test: Create situation → Generate embedding → Store in node_embeddings → Validate vector format
   - Validates: VECTOR(256) type, model/dim constraints, upsert idempotency
   - Runtime: ~2s

2. **Vector Search Integration**
   - Real pgvector with seeded embeddings
   - Real cosine similarity query
   - Test: Search query → Generate embedding → Vector search → Return top-k with scores
   - Validates: ivfflat index usage, similarity ranking, score calculation
   - Runtime: ~1s

3. **Recognition Phase Integration**
   - Real pgvector + real IPFS gateway
   - Test: Recognition → Embed query → Vector search → Fetch SITUATION artifacts from IPFS → Format learnings
   - Validates: Full recognition flow with real I/O
   - Runtime: ~4s

**Priority**: **P1** (High) - Core learning system

**Estimated Effort**: 3 days

---

### Boundary 10: Work Protocol (Dispatch, Parent Re-Dispatch, Hierarchy)

**Description** (LCQ-001 to LCQ-010): Jobs delegate to children, children notify parents on completion, parent synthesizes results

**Integration Points**:
- dispatch_new_job creates child job definition
- Child completion triggers parent re-dispatch
- Parent queries for completed children
- Status inference based on hierarchy state

**Current Coverage**: 🔴 **NONE** (only tested at system level)

**Why Critical**: **CRITICAL** - Work protocol is fundamental to hierarchical task decomposition

**Missing Integration Tests**:
1. **Child Dispatch Integration**
   - Real dispatch_new_job MCP tool
   - Real Control API + Supabase
   - Mock Ponder queries
   - Test: dispatch_new_job → Creates job definition → Stores metadata → Links parent
   - Validates: sourceJobDefinitionId set, hierarchy integrity
   - Runtime: ~2s

2. **Parent Re-Dispatch Integration**
   - Real worker status inference logic
   - Mock Ponder with completed child
   - Test: Child completes → Worker extracts sourceRequestId → Dispatches parent job definition
   - Validates: Automatic parent notification, no manual intervention
   - Runtime: ~1s

3. **Job Context Accumulation Integration**
   - Real get_job_context tool
   - Mock Ponder with multiple runs of same job
   - Test: Query job context → Returns all runs → Shows completed children → Includes artifacts
   - Validates: Context accumulation across runs, artifact access
   - Runtime: ~1s

**Priority**: **P0** (Critical) - Core work protocol, fundamental to system design

**Estimated Effort**: 4 days

---

## Part 2: Existing Integration Test Value Assessment

### Test 1: `tests-next/integration/env-controller.integration.test.ts`

**What it tests**: Environment snapshot and restore for test isolation

**Components involved**:
- Real filesystem
- Environment variable manipulation

**Assessment**: ✅ **TRUE INTEGRATION TEST** (tests real filesystem)

**Value Score**: **7/10**
- ✅ Tests real component (filesystem)
- ✅ Tests data persistence and restoration
- ✅ Essential for test infrastructure
- ⚠️ Not testing production system integration
- ⚠️ Limited to test helper functionality

**Recommendation**: **KEEP** - Essential test infrastructure

---

### Test 2: `tests-next/integration/situation-workflow.integration.test.ts`

**What it tests**: Situation artifact creation and semantic search

**Components involved**:
- Mocked PostgreSQL (fake in-memory implementation)
- Mocked embed_text tool
- Mocked create_artifact tool

**Assessment**: ❌ **NOT A TRUE INTEGRATION TEST** (all components mocked)

**Value Score**: **4/10**
- ❌ Mocks ALL external dependencies
- ❌ Doesn't test real database interactions
- ❌ Doesn't test real embedding generation
- ❌ Doesn't test real IPFS upload
- ✅ Good test logic and assertions
- ⚠️ This is actually a unit test of workflow orchestration

**Problem**: Tests business logic but not integration boundaries

**Recommendation**: **REFACTOR**
1. Keep test logic as unit test (all mocks = unit test)
2. Create NEW integration test with real pgvector + real IPFS

---

### Test 3: `tests/git/worker-git-auto-commit.test.ts`

**What it tests**: Worker auto-commit after job completion

**Components involved**:
- Real git repository (temp directory)
- Real worker orchestration
- Real Ponder + Control API (from shared infrastructure)
- Real agent execution (Gemini CLI)

**Assessment**: ✅ **TRUE INTEGRATION TEST** (tests real components at boundary)

**Value Score**: **9/10**
- ✅ Uses real git repository
- ✅ Tests real file system operations
- ✅ Tests worker-git integration boundary
- ✅ Tests auto-commit logic with real state
- ✅ Tests error conditions
- ✅ Validates commit message formatting
- ⚠️ Takes ~60s (borderline system test duration)

**Recommendation**: **KEEP** - Exemplary integration test, possibly optimize runtime

---

### Test 4: `tests/git/worker-git-lineage.test.ts`

**What it tests**: Git branch lineage and PR creation

**Components involved**:
- Real git repository
- Real worker execution
- Real GitHub API (or mock)
- Real Ponder + Control API

**Assessment**: ✅ **TRUE INTEGRATION TEST**

**Value Score**: **9/10**
- ✅ Tests real git operations
- ✅ Tests branch hierarchy
- ✅ Tests PR creation flow
- ✅ Validates code metadata in branches
- ⚠️ Long runtime (~120s)

**Recommendation**: **KEEP** - Critical git lineage validation

---

### Test 5: `tests/unit/mcp-stdout-clean.test.ts`

**What it tests**: MCP server stdout cleanliness (JSON-RPC only, no logs)

**Components involved**:
- Real MCP server process (spawned with tsx)
- Real stdout/stderr streams

**Assessment**: ✅ **TRUE INTEGRATION TEST** (misclassified as unit)

**Value Score**: **8/10**
- ✅ Spawns real MCP server
- ✅ Tests real stdout/stderr separation
- ✅ Tests protocol compliance
- ✅ Fast (~2s runtime)
- ⚠️ Misclassified location (should be in integration/)

**Recommendation**: **RECLASSIFY** as integration test, keep logic

---

### Test 6: `tests/unit/worker-git-ops.test.ts`

**What it tests**: Git helper functions (autoCommit, PR formatting)

**Components involved**:
- Real temporary git repositories
- Real git command execution

**Assessment**: ✅ **TRUE INTEGRATION TEST** (misclassified as unit)

**Value Score**: **6/10**
- ✅ Uses real git repos
- ✅ Tests real git operations
- ⚠️ Overlaps with worker-git-auto-commit.test.ts (~40% duplication)
- ⚠️ Tests helpers that could be pure functions

**Recommendation**: **REFACTOR**
1. Extract pure functions (extractExecutionSummary, deriveCommitMessage) → TRUE unit tests
2. Keep integration test for autoCommitIfNeeded with real git
3. Delete redundant parts covered by worker-git-auto-commit.test.ts

---

### Test 7: `tests/unit/search-similar-situations.test.ts`

**What it tests**: Vector similarity search logic

**Components involved**:
- Mocked PostgreSQL client
- In-memory cosine similarity calculation

**Assessment**: ❌ **NOT A TRUE INTEGRATION TEST** (database mocked)

**Value Score**: **5/10**
- ✅ Good test of search algorithm
- ✅ Tests cosine similarity math
- ❌ Doesn't test real database
- ❌ Doesn't test pgvector queries
- ❌ Doesn't test ivfflat index behavior

**Problem**: This is a unit test of the search logic, not an integration test

**Recommendation**: **RECLASSIFY** as unit test, CREATE NEW integration test with real pgvector

---

### Test 8: `tests/e2e/situation-recognition.e2e.test.ts`

**What it tests**: Recognition workflow

**Components involved**:
- Mocked PostgreSQL
- Mocked IPFS
- Mocked embeddings

**Assessment**: ❌ **NOT A TRUE INTEGRATION TEST** (all mocked)

**Value Score**: **2/10**
- ❌ Everything mocked (not E2E despite name)
- ❌ Redundant with situation-workflow.integration.test.ts
- ❌ Misnamed (not end-to-end)
- ✅ Tests workflow logic

**Recommendation**: ❌ **DELETE** - Fully redundant, misleadingly named

---

## Part 3: Integration Test Coverage Heat Map

### Legend:
- 🟢 **GREEN**: Well-tested integration boundary (real components, good coverage)
- 🟡 **YELLOW**: Partial coverage (happy path only, or mocked components)
- 🔴 **RED**: No integration tests (only system tests or unit tests)

### Heat Map:

| Boundary | Coverage | Tests | Score | Priority |
|----------|----------|-------|-------|----------|
| **1. On-Chain → Ponder** | 🔴 RED | 0 | 0% | P1 |
| **2. Ponder → Worker** | 🔴 RED | 0 | 0% | P1 |
| **3. Worker → Control API → Supabase** | 🔴 RED | 0 | 0% | **P0** |
| **4. Worker → Agent (Settings)** | 🟡 YELLOW | 1 | 30% | P1 |
| **5. Agent → MCP Tools** | 🔴 RED | 0 | 0% | P1 |
| **6. MCP Tools → IPFS** | 🔴 RED | 0 | 0% | P1 |
| **7. Worker → Blockchain** | 🔴 RED | 0 | 0% | **P0** |
| **8. Worker → Git** | 🟢 GREEN | 3 | 90% | P2 |
| **9. Recognition/Reflection → Memory** | 🟡 YELLOW | 2 | 20% | P1 |
| **10. Work Protocol** | 🔴 RED | 0 | 0% | **P0** |

**Overall Integration Coverage**: **14%** (measured by boundary coverage, not line coverage)

**Critical Finding**: Only 1 of 10 architectural boundaries has real integration test coverage

---

## Part 4: Misclassified Tests Summary

### Tests Labeled "Integration" That Are Actually Unit Tests:
1. `tests-next/integration/situation-workflow.integration.test.ts` - All mocks, no real I/O
2. `tests/unit/search-similar-situations.test.ts` - Mocked DB, should be unit test

### Tests Labeled "Unit" That Are Actually Integration Tests:
3. `tests/unit/mcp-stdout-clean.test.ts` - Spawns real process
4. `tests/unit/worker-git-ops.test.ts` - Uses real git repos

### Tests Labeled "E2E" That Are Actually Unit Tests:
5. `tests/e2e/situation-recognition.e2e.test.ts` - All mocked, not E2E

**Impact**: Test organization misleading, runtimes unpredictable, coverage metrics inaccurate

---

## Part 5: Critical Gaps Analysis

### P0 Critical Gaps (Immediate Risk):

#### Gap 1: Control API Validation Gateway (Boundary 3)
**Risk**: Data integrity, invalid lineage, database corruption
**Business Impact**: JINN-195 showed this prevents invalid writes
**Evidence**: No integration test validates Control API blocks invalid requestIds
**Mitigation**: Write integration test with real Control API + mocked Ponder queries

#### Gap 2: Delivery Transaction Construction (Boundary 7)
**Risk**: Failed deliveries, lost work, financial losses
**Business Impact**: If delivery transaction malformed, funds stuck
**Evidence**: Only tested at system level (slow feedback, hard to debug)
**Mitigation**: Write integration test for delivery payload → IPFS → transaction construction

#### Gap 3: Work Protocol Parent Re-Dispatch (Boundary 10)
**Risk**: Broken hierarchical task decomposition
**Business Impact**: Parent jobs never resume, workflows stuck
**Evidence**: No test validates automatic parent dispatch on child completion
**Mitigation**: Write integration test for child completion → parent dispatch flow

---

### P1 High Priority Gaps:

#### Gap 4: Ponder IPFS Resolution (Boundary 1)
**Risk**: Failed job discovery, missing metadata
**Business Impact**: If IPFS fetch fails, Ponder can't index jobs
**Mitigation**: Integration test with real IPFS gateway + mocked blockchain

#### Gap 5: MCP Tool Output Capture (Boundary 5)
**Risk**: Artifact loss, telemetry corruption
**Business Impact**: If tool outputs not captured, artifacts disappear
**Mitigation**: Integration test for tool call → telemetry capture → artifact extraction

#### Gap 6: Recognition Phase Integration (Boundary 9)
**Risk**: Learning system doesn't work, no memory accumulation
**Business Impact**: Agents can't learn from past executions
**Mitigation**: Integration test with real pgvector + real IPFS fetches

---

## Part 6: Integration Test Backlog (Prioritized)

### Phase 0: Critical (Week 1-2) - P0 Gaps

**1. Control API Validation Gateway Integration Test** ✅ COMPLETE
- **File**: `tests-next/integration/control-api/validation-gateway.integration.test.ts`
- **Status**: ✅ **4 tests passing** (Day 1-2 complete)
- **What**: Test Control API validates requestId against Ponder before Supabase write
- **Components**: Real Control API server, real Ponder, real Supabase, real Tenderly VNet
- **Tests**:
  - ✅ Invalid requestId → Write blocked with error
  - ✅ Valid requestId → Write succeeds
  - ✅ Idempotent operations (claim twice)
  - ✅ Lineage fields auto-injected
- **Runtime**: ~90s total (sequential execution)
- **Effort**: 2 days (actual)

**2. Delivery Flow Integration Test** 🔜 IN PROGRESS (Day 3-4)
- **File**: `tests-next/integration/worker/delivery-flow.integration.test.ts`
- **Status**: Being implemented
- **What**: Test delivery construction → IPFS upload → transaction building
- **Components**: Real delivery payload builder, real IPFS registry, mocked blockchain
- **Tests**:
  - Delivery payload → IPFS directory CID → Extract digest → Verify retrievable
  - CID hex digest conversion (bidirectional)
  - Delivery validation logic
  - Error handling (IPFS timeout)
- **Runtime**: ~30s total (estimated)
- **Effort**: 1-2 days (estimated)

**3. Work Protocol Parent Re-Dispatch Integration Test** ❌ DEFERRED TO PHASE 1 SYSTEM TESTS
- **File**: ~~`tests-next/integration/work-protocol/parent-dispatch.integration.test.ts`~~ (abandoned)
- **Status**: ❌ **ABANDONED** as integration test
- **Reason**: Crosses integration/system boundary - requires full worker context, MCP subprocess, blockchain transactions
- **What Happened**: Attempted implementation revealed this is a **system test** (5+ components), not integration test (2-3 components)
- **Alternative Coverage**:
  - ✅ Unit tests: Decision logic (`shouldDispatchParent()`) tested at unit level - **COMPLETE**
  - 🔜 System tests: Full workflow will be tested in Phase 1 with real worker execution
- **Lessons Learned**:
  - Integration tests must have explicit, mockable boundaries
  - Worker-internal functions designed for production ≠ testable in isolation
  - If test needs 5+ real components running, it's system-level
- **Effort Spent**: 3 hours (investigation + implementation attempt + analysis)

**Phase 0 Revised Total**: 2 critical integration tests (Control API ✅ + Delivery Flow 🔜), not 3

**Phase 0 Success Criteria**: 8 tests passing across 2 critical integration suites
- ✅ Control API: 4 tests passing
- 🔜 Delivery Flow: 4 tests planned

---

### Phase 1: High Priority (Week 3-4) - P1 Gaps

**4. Ponder IPFS Resolution Integration Test**
- **File**: `tests-next/integration/ponder/ipfs-resolution.integration.test.ts`
- **Components**: Mocked blockchain events, real IPFS gateway, real PostgreSQL
- **Runtime**: ~3s
- **Effort**: 2 days

**5. Ponder SITUATION Indexing Integration Test**
- **File**: `tests-next/integration/ponder/situation-indexing.integration.test.ts`
- **Components**: Mocked delivery event, real IPFS, real pgvector
- **Runtime**: ~3s
- **Effort**: 2 days

**6. MCP Tool Output Capture Integration Test**
- **File**: `tests-next/integration/mcp/tool-output-capture.integration.test.ts`
- **Components**: Real MCP server, mock Gemini client, real tool handlers
- **Runtime**: ~2s
- **Effort**: 2 days

**7. Recognition Phase Integration Test**
- **File**: `tests-next/integration/recognition/recognition-phase.integration.test.ts`
- **Components**: Real pgvector, real IPFS gateway, real embedding generation
- **Runtime**: ~4s
- **Effort**: 2 days

**8. Worker Job Discovery Integration Test**
- **File**: `tests-next/integration/worker/job-discovery.integration.test.ts`
- **Components**: Real Ponder GraphQL (test mode), seeded database
- **Runtime**: ~2s
- **Effort**: 2 days

**Phase 1 Total**: 10 days, 5 critical integration tests

---

### Phase 2: Medium Priority (Month 2) - Refinements

**9. Agent Settings Generation Integration Test**
- **File**: `tests-next/integration/agent/settings-generation.integration.test.ts`
- **Effort**: 1 day

**10. Agent Tool Isolation Integration Test**
- **File**: `tests-next/integration/agent/tool-isolation.integration.test.ts`
- **Effort**: 2 days

**11. Embedding Storage Integration Test**
- **File**: `tests-next/integration/memory/embedding-storage.integration.test.ts`
- **Effort**: 1 day

**12. Vector Search Integration Test**
- **File**: `tests-next/integration/memory/vector-search.integration.test.ts`
- **Effort**: 1 day

**13. Artifact Upload Integration Test**
- **File**: `tests-next/integration/ipfs/artifact-upload.integration.test.ts`
- **Effort**: 1 day

**Phase 2 Total**: 6 days, 5 integration tests

---

## Part 7: Test Refactoring Recommendations

### Immediate Refactoring (Week 1):

**1. Reclassify Misplaced Tests**
- Move `tests/unit/mcp-stdout-clean.test.ts` → `tests-next/integration/mcp/stdout-clean.integration.test.ts`
- Move `tests/unit/worker-git-ops.test.ts` → Extract pure functions to unit/, keep git integration part

**2. Delete Redundant Test**
- Delete `tests/e2e/situation-recognition.e2e.test.ts` (fully redundant)

**3. Refactor Mocked "Integration" Tests**
- Rename `tests-next/integration/situation-workflow.integration.test.ts` → `tests-next/unit/worker/situation-workflow.test.ts` (it's a unit test)
- Create NEW `tests-next/integration/memory/situation-workflow.integration.test.ts` with real pgvector + IPFS

**Effort**: 2 days

---

## Part 8: Success Criteria for Integration Tests

### Definition of "Done" for Integration Test:

An integration test is valuable if it:

1. ✅ **Tests Real Component Boundaries**
   - Uses real filesystem, git, HTTP servers, databases where appropriate
   - Mocks ONLY external services (blockchain, expensive APIs)
   - Does NOT mock the boundary being tested

2. ✅ **Tests Data Transformation**
   - Validates data format changes across boundary
   - Tests serialization/deserialization
   - Validates protocol compliance

3. ✅ **Tests Error Propagation**
   - Component A failure → Component B handles error correctly
   - Retries and timeouts work as expected
   - Graceful degradation validated

4. ✅ **Tests Idempotency**
   - Operations can be safely retried
   - No duplicate data on retry
   - State consistency maintained

5. ✅ **Runs in Reasonable Time**
   - Target: 100ms - 5s
   - Max acceptable: 10s
   - If longer, consider splitting or making system test

6. ✅ **Tests Protocol Requirements**
   - Maps directly to ARQ/EXQ/LCQ/MEM/PER requirements from blueprint
   - Validates assertions from architecture docs

---

## Part 9: Integration Test Standards (Additions to testing-standards-proposal.md)

### Integration Test Checklist:

Before writing an integration test, ask:

1. **What boundary am I testing?** (On-chain→Ponder? Worker→Control API?)
2. **Which components are real?** (At least 2 real components required)
3. **Which components are mocked?** (Only external services, not the boundary)
4. **What data transformation am I validating?** (Input format → Output format)
5. **What failure mode am I testing?** (Component down, timeout, malformed data)
6. **How long will this test run?** (Target: <5s, max: 10s)

If you answer:
- "All components are mocked" → This is a **unit test**, not integration
- "Testing 5+ components" → This is a **system test**, not integration
- "Testing one component in isolation" → This is a **unit test**, not integration

---

## Conclusion

### Key Findings:

1. **🔴 CRITICAL**: Only 14% of architectural boundaries have integration test coverage
2. **🔴 CRITICAL**: 3 of 5 "integration tests" are actually unit tests with all mocks
3. **🟢 POSITIVE**: Git integration tests are exemplary - use as model for others
4. **🟡 CONCERN**: Test organization misleading (unit tests labeled as integration)

### Immediate Actions (Week 1):

1. ✅ Write 3 P0 integration tests (Control API, Delivery, Work Protocol) - **6 days**
2. ✅ Reclassify misplaced tests - **0.5 days**
3. ✅ Delete redundant E2E test - **0.5 days**

### Short Term (Month 1):

4. ✅ Write 5 P1 integration tests (Ponder, MCP, Recognition) - **10 days**
5. ✅ Refactor mocked "integration" tests to be true integration tests - **2 days**

### Success Metrics:

- **Target**: 70% of architectural boundaries with integration tests (7 of 10)
- **Target**: All "integration tests" test real component boundaries (no all-mocked tests)
- **Target**: Integration test pyramid at 20% of total tests (currently 44%)

### Risk Mitigation:

By writing integration tests for P0 boundaries, we mitigate:
- ✅ Data integrity violations (Control API validation)
- ✅ Failed deliveries (delivery flow)
- ✅ Broken workflows (work protocol)
- ✅ Lost artifacts (IPFS integration)

**Estimated Total Effort**: 21 days for complete integration test coverage

---

**Next Steps**: Review this audit with team, prioritize P0 integration tests, begin implementation in Week 1
