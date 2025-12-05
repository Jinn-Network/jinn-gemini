# Project Jinn – Agent Operational Guide

<!--
**AGENT INSTRUCTIONS**:
This file contains your OPERATIONAL CONTEXT. It is designed to be high-density and action-focused.
For deep architecture and implementation details, see the linked files in `docs/documentation/`.

**MAINTENANCE RULES**:
- Keep this file under 400 lines
- Use bullet points and code blocks, not prose
- Focus on WHAT and HOW, not WHY
- Move deep technical content to `docs/documentation/` and link it here
- DO NOT create .md files for progress summaries
- Incorporate learnings into this file or `docs/spec/`
-->

---

## Critical Agent Rules

- **DO NOT** create .md documentation files for progress summaries
- **DO** incorporate learnings into AGENT_README.md or `docs/spec/`
- **DO** write progress summaries to corresponding Linear issues
- **DO** add gotchas to this file's "Blood-Written Rules" section
- **DO** use this file for operational context, `docs/documentation/` for deep dives

---

## System Architecture (10-Second Overview)

**On-Chain Event Loop:**
```
dispatch_new_job (MCP) → Base Marketplace Contract → Ponder Indexer → Worker Claims Request
  → Agent Executes (with MCP tools) → Worker Delivers to Chain → Ponder Indexes Result
```

**Key Components:**
- **Ponder** (Railway: `https://jinn-gemini-production.up.railway.app/graphql`): Indexes on-chain events, provides GraphQL reads
- **Control API** (Local: `http://localhost:4001/graphql`): Secure write gateway for off-chain data
- **Worker** (`worker/mech_worker.ts`): Polls Ponder, claims jobs, executes Agent, delivers results
- **Agent** (`gemini-agent/agent.ts`): Spawns Gemini CLI with MCP tools, executes job logic
- **MCP Server** (`gemini-agent/mcp/server.ts`): Provides tools like `dispatch_new_job`, `create_artifact`, `get_details`

**Memory System:**
- Jobs generate SITUATION artifacts with 256-dim embeddings
- Indexed into `node_embeddings` table (pgvector)
- Recognition phase queries similar past jobs before execution
- Reflection phase creates MEMORY artifacts for reuse

---

## Quick Start

**Prerequisites:** Node.js, Yarn, Gemini CLI (authenticated), Supabase project

```bash
# 1. Install
yarn install

# 2. Configure .env (minimal)
SUPABASE_URL=https://clnwgxgvmnrkwqdblqgf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<key>
PONDER_PORT=42069
CONTROL_API_PORT=4001
USE_TSX_MCP=1

# 3. Start full stack
yarn dev:stack

# 4. Access services
# Ponder: http://localhost:42069/graphql
# Control API: http://localhost:4001/graphql
```

---

## Monorepo Layout

```
ponder/                 # Indexer (Base chain events)
control-api/            # Secure write API (Supabase)
gemini-agent/           # Agent + MCP server
  ├── agent.ts          # Gemini CLI spawner
  ├── mcp/server.ts     # Tool server
  └── mcp/tools/        # Tool implementations
worker/                 # Job orchestrator
  ├── mech_worker.ts    # Main loop
  ├── recognition/      # Pre-job learning
  ├── execution/        # Agent execution
  └── reflection/       # Post-job learning
frontend/explorer/      # Next.js UI
packages/               # Shared libs
  └── mech-client-ts/   # On-chain interaction
```

---

## Key Commands

**Development:**
```bash
yarn dev:stack              # Ponder + Control API + Worker
yarn dev:mech               # Worker only
yarn dev:mech --single      # Single job (exit after)
yarn dev:mech --workstream=0x...  # Filter by workstream
yarn mcp:start              # MCP server only
```

**Inspection:**
```bash
yarn inspect-job-run <requestId>          # Full job run snapshot
yarn inspect-job <jobDefinitionId>        # Job definition history
yarn inspect-workstream <workstreamId>    # Workstream graph
```

**Testing:**
```bash
yarn test                   # All tests
yarn test:coverage          # With coverage
cd frontend/explorer && yarn test  # Frontend only
```

**Production:**
```bash
yarn build                  # Build worker + MCP
yarn frontend:build         # Build frontend
yarn start:all              # Start both services
```

---

## MCP Tools (Quick Reference)

**Universal Tools** (always available):
- `list_tools` – Catalog all available tools
- `get_details` – Fetch request/artifact data from Ponder (supports request IDs, artifact IDs, CIDs, job def UUIDs)
- `dispatch_new_job` – Create job definition + post marketplace request
- `dispatch_existing_job` – Re-run existing job definition
- `create_artifact` – Upload to IPFS (returns CID)
- `search_similar_situations` – Semantic search over past job contexts
- `inspect_situation` – Inspect memory system for a request

**Critical Parameters:**
- `dispatch_new_job`:
  - `blueprint` (required): JSON string with assertions array (see Blueprint Design below)
  - `model`: `'gemini-2.5-flash'` (default) or `'gemini-2.5-pro'`
  - `enabledTools`: Array of tool names
  - `dependencies`: Array of job definition UUIDs (must complete before this job)
  - `responseTimeout`: Max 300 seconds (marketplace enforces 5-minute limit)
  - `skipBranch`: Auto-detected (no need to specify) - branches skipped when CODE_METADATA_REPO_ROOT unset

**Tool Behavior:**
- Tools do NOT write directly to database
- Output captured in telemetry
- Worker persists to Control API after job completion

**Deep Reference:** `docs/documentation/AGENT_MCP_REFERENCE.md`

---

## Blueprint Design (Critical)

**Blueprints define WHAT (outcomes), not HOW (process).**

**Structure:**
```json
{
  "assertions": [
    {
      "id": "REQ-001",
      "assertion": "Declarative statement of WHAT must be satisfied",
      "examples": {
        "do": ["Positive example 1", "Positive example 2"],
        "dont": ["Negative example 1", "Negative example 2"]
      },
      "commentary": "WHY this assertion exists (rationale, not implementation)"
    }
  ]
}
```

**Key Requirements:**
- **Quantify Everything**: "minimum 3 distinct sources with URLs" not "multiple sources"
- **Inline Attribution**: "Volume $378M (defillama.com)" not generic footer
- **Statistical Context**: All metrics need 7-day average comparison
- **Verification Assertion**: Add VERIFICATION-001 for blueprints with 3+ assertions

❌ **Wrong**: "If initial web searches return aggregate data, delegate to child jobs"  
✅ **Correct**: "Analysis must include protocol-specific breakdowns with 7-day historical comparisons"

**Full Style Guide:** `docs/spec/blueprint/style-guide.md`

---

## Environment Variables

**Required:**
```bash
SUPABASE_URL=https://clnwgxgvmnrkwqdblqgf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<key>
```

**Optional (with defaults):**
```bash
PONDER_PORT=42069
PONDER_GRAPHQL_URL=http://localhost:42069/graphql  # Local override
CONTROL_API_PORT=4001
CONTROL_API_URL=http://localhost:4001/graphql
USE_TSX_MCP=1                    # Dev: run MCP with tsx
PONDER_START_BLOCK=38187727      # Universal indexing start (Nov 15, 2025)
```

**Worker Config:**
```bash
MECH_TARGET_REQUEST_ID=0x...     # Process specific request
RPC_URL=<base-rpc-url>           # Base network RPC
```

**OLAS (see OLAS_ARCHITECTURE_GUIDE.md):**
```bash
OPERATE_PASSWORD=<password>
BASE_LEDGER_RPC=<rpc-url>
STAKING_PROGRAM=<program>
```

---

## Ponder Deployment

**Production:** Railway at `https://jinn-gemini-production.up.railway.app/graphql`  
**Auto-Deploy:** Pushes to GitHub trigger Railway redeployment  
**Local:** `http://localhost:42069/graphql` (ONLY for testing Ponder changes)

**CRITICAL: Railway Ponder is Primary**
- System depends on Railway for all normal operations
- Run Ponder locally ONLY to test indexing changes before pushing
- Validation scripts/worker/frontend default to Railway

**Universal Mech Indexing:**
- Ponder now indexes ALL Mechs participating in the marketplace
- Uses factory pattern: `MechMarketplace.CreateMech` events
- Start block: 38187727 (November 15, 2025)
- No need to configure specific Mech addresses

**Testing Workflow:**
1. Make changes in `ponder/src/index.ts` or `ponder/ponder.schema.ts`
2. Test locally: `cd ponder && yarn dev`
3. Verify with local worker/frontend
4. Push to GitHub
5. Railway auto-redeploys (~2-3 minutes)
6. Verify in production

---

## Real-Time Updates (Ponder Native SSE)

**Architecture:** Frontend uses Ponder's built-in `client.live()` API for real-time updates  
**Endpoint:** `/sql/*` on same port as GraphQL (42069)  
**Protocol:** Server-Sent Events (SSE) via Ponder's native implementation

**Key Features:**
- Zero additional infrastructure (no separate realtime server)
- Automatic updates when blockchain data changes
- Polling fallback when SSE disconnected
- Connection status indicator in UI

**Implementation:**
```typescript
// Frontend hook usage
import { useRealtimeData } from '@/hooks/use-realtime-data'

const { status, isConnected } = useRealtimeData(
  'requests', // Collection name (or undefined for all)
  {
    enabled: true,
    onEvent: () => refetchData(), // Called on any update
    onError: (error) => console.error(error)
  }
)
```

**No Configuration Required:**
- Frontend automatically derives SSE URL from `NEXT_PUBLIC_SUBGRAPH_URL`
- Replaces `/graphql` with `/sql` for Ponder client endpoint
- No separate environment variables needed

**Status Indicator:**
- 🟢 Green "Live" → SSE connected
- 🟡 Yellow "Connecting" → Attempting connection
- ⚫ Gray "Polling" → Disconnected, using fallback
- 🔴 Red "Fallback" → Error state

---

## Workstream Filtering

**What is a Workstream?**
- Root job (no parent) + all descendant child jobs
- Workstream ID = root job's request ID
- Ponder computes `workstreamId` at index time

**Usage:**
```bash
# Process only jobs in specific workstream
yarn dev:mech --workstream=0x0447dd1e...

# Step through one job at a time
yarn dev:mech --workstream=0x0447dd1e... --single
```

**Use Cases:**
- Isolated testing without interference
- Debugging specific job chains
- Parallel workers on different workstreams

**Deep Reference:** `docs/documentation/WORKER_INTERNALS.md`

---

## Blood-Written Rules (Common Gotchas)

### 1. RPC Rate Limits
**QuickNode Free Tier:** 15 req/sec  
**Solution:** Add 70ms delay between calls, use exponential backoff

### 2. IPFS Timeouts
**Issue:** Gateway timeouts, content-type mismatches  
**Solution:** Multi-gateway failover (Autonolas → Cloudflare → IPFS.io → DWeb)  
**Verification:** Always test CID fetches after upload

### 3. Marketplace Timeout
**Hard Limit:** 300 seconds (5 minutes) enforced on-chain  
**Solution:** Break complex jobs into smaller sub-jobs  
**Planning:** Max ~10-15 tool calls per job (~5-30s each)

### 4. Agent Polling Loops
**Issue:** Agents check child status repeatedly after dispatching  
**Solution:** FINALIZE IMMEDIATELY after `dispatch_new_job`. System auto-redispatches parent when children complete.  
**Cost:** Each iteration = 2-5K tokens wasted

### 5. Transaction "Not Found"
**Issue:** RPC transient errors during delivery/dispatch  
**Solution:** Built-in retry logic (3 attempts, exponential backoff)  
**Debugging:** Check BaseScan for actual transaction status

### 6. Ponder Indexing Failures
**Issue:** IPFS content-type `application/octet-stream` instead of `application/json`  
**Solution:** Applied fix in `ponder/src/index.ts` (2025-11-19)  
**Verification:** Check Railway logs for "Indexed MarketplaceRequest"

### 7. Wallet/Safe Architecture (OLAS)
**CRITICAL:** Each service deployment creates NEW Safe (even with same Master Wallet)  
**Recovery:** Agent keys in `/.operate/keys/` survive service deletion  
**Details:** `docs/documentation/OLAS_ARCHITECTURE_GUIDE.md`

### 8. Branch Creation Auto-Detection
**Behavior:** `dispatch_new_job` auto-skips branch creation when `CODE_METADATA_REPO_ROOT` not set  
**Logic:**
1. If `CODE_METADATA_REPO_ROOT` unset AND no parent branch context → Skip branches (artifact-only)
2. If inside job with parent branch context → Inherit context, create child branches
3. If `skipBranch: true` explicitly set → Always skip (override)

**Use Cases:**
- Research/analysis jobs with no code changes → artifact-only mode (no repo needed)
- Code-changing jobs inside ventures → set `CODE_METADATA_REPO_ROOT` via worker
- Child jobs inherit parent's repo context automatically

**No Manual Config:** Don't specify `skipBranch: true` explicitly - let auto-detection handle it  
**Error Prevention:** Eliminates "CODE_METADATA_REPO_ROOT must be set" failures for research jobs

**Artifact-Only Mode:**
When no code metadata is present (pure research/analysis jobs), the system automatically adapts:

- **Blueprint Filtering:** Git-related assertions (`SYS-GIT-001`, `SYS-PARENT-ROLE-001`) are removed from the system prompt
- **Tool Filtering:** Coding and git tools are excluded from the agent's available toolset:
  - Removed: `process_branch`, `write_file`, `replace`, `run_shell_command`
  - Available: Job management, artifacts, search, web fetch, read-only file tools
- **Workspace Isolation:** No code directories are mounted, preventing file system access

This ensures artifact-only agents cannot attempt code modifications and focus solely on research, analysis, and artifact creation.

### 9. Job Status from Ponder
**Architecture:** Job status comes from `job_definition.lastStatus` field in Ponder (extracted from delivery payloads)  
**Never Infer:** Don't check individual requests to guess status - Ponder already has the correct value  
**Status Flow:** `lastStatus` (Ponder) → `job-context-utils` (lowercase) → `JobContextProvider.mapJobStatus()` (uppercase) → `ChildWorkAssertionProvider` (CTX assertions)  
**Verification:** Check logs for "Hierarchy status verification" and "CTX-CHILD assertions generated"  
**Implementation:** `gemini-agent/mcp/tools/shared/job-context-utils.ts` line 238-255

### 10. Recognition Learning Mimicry (2025-11-28)
**Issue:** Agents mimicking delegation narratives without executing tool calls  
**Root Cause:** Recognition learnings framed as imperative instructions ("Use dispatch_new_job") instead of historical observations ("Called dispatch_new_job 3 times")  
**Symptom:** Execution summary claims "Dispatched child jobs" but telemetry shows zero dispatch_new_job calls  
**Fix Applied:** 
- Recognition prompt now emphasizes "OBSERVED TOOL USAGE" not generic advice
- RecognitionProvider prefixes actions with "[Historical Pattern]" 
- System blueprint (SYS-GUIDE-004) warns: "Stating 'I dispatched' without calling dispatch_new_job is a critical failure"
**Files Changed:** `worker/recognition_helpers.ts`, `worker/prompt/providers/assertions/RecognitionProvider.ts`, `worker/prompt/system-blueprint.json`  
**Prevention:** Recognition learnings must describe WHAT PAST JOBS DID (tool sequences), not WHAT CURRENT JOB SHOULD DO

### 11. Job Definitions and Workstream Queries (2025-11-29)
**Issue:** Querying `job_definition.workstreamId` returns incomplete results  
**Root Cause:** Job definitions can be reused across workstreams, so `workstreamId` only stores the FIRST workstream  
**Solution:** Query `requests` table by `workstreamId`, extract unique `jobDefinitionId` values, then batch-fetch definitions  
**Prevention:**
```typescript
// ❌ Wrong:
const jobs = await query('jobDefinitions', { where: { workstreamId } })

// ✅ Correct:
const requests = await query('requests', { where: { workstreamId } })
const jobDefIds = [...new Set(requests.map(r => r.jobDefinitionId))]
const jobs = await query('jobDefinitions', { where: { id_in: jobDefIds } })
```

### 12. Stale Hierarchy in Status Inference (2025-12-01) [FIXED]
**Issue:** Jobs cycle through WAITING status multiple times instead of COMPLETED after children finish  

**Root Cause CONFIRMED:** `inferJobStatus()` used `metadata.additionalContext.hierarchy` which is a frozen snapshot from dispatch time. When parent executes 2-5 minutes later, child statuses in hierarchy are stale (show "active" even though Ponder has "delivered").

**Evidence from Test (2025-12-01):**
- Test job: Trade Idea Generation & Synthesis (23783b40-2ba3-4a21-a998-3ce233ef497c)
- Live Ponder query showed: 3 children, ALL delivered
- Job status in Ponder: WAITING (incorrect)
- Discrepancy: Hierarchy snapshot outdated, live query proves all children complete

**Solution Implemented:**
Query live child delivery status from Ponder during `inferJobStatus()` instead of trusting hierarchy snapshot. Hierarchy still used for agent context but NOT for completion logic.

**Code Changes:**
- `worker/status/childJobs.ts`: Added `getAllChildrenForJobDefinition()` to query fresh data across all job runs
- `worker/status/inferStatus.ts`: Live query path with hierarchy comparison logging
- Added `[STATUS_INFERENCE]` logging markers for debugging
- Decision logic: Always prefer live Ponder data, fall back to hierarchy only if query fails

**Testing:**
- Test script: `scripts/test-waiting-fix.sh` (includes integrated dispatch)
- Full analysis: `WAITING_CYCLES_ANALYSIS.md`
- ✅ **Fix verified in production** (2025-12-01): Job transitioned WAITING → COMPLETED using live query
- Test evidence: Request 0x034f18be..., Tx 0xba971e60...

**Prevention:**
Never rely on `hierarchy.status` for terminal state decisions. Always query Ponder directly for child delivery status. Hierarchy is for context/planning only.

### 13. Double Execution via Ponder Latency (2025-12-02) [FIXED]
**Issue:** Worker claims same job twice because Ponder indexer lags behind chain delivery
**Root Cause:** Ponder says `delivered: false` while chain has 0 undelivered requests. Worker loop previously trusted Ponder when RPC returned empty set.
**Solution:** `worker/mech_worker.ts` now distinguishes between RPC error (null) and empty set. If RPC confirms 0 undelivered requests, we trust chain and filter out Ponder's stale candidates.
**Fix Applied:** Updated `filterUnclaimed` to trust empty on-chain sets.

### 14. Stale Claim Blocking (2025-12-02) [FIXED]
**Issue:** Worker skips jobs stuck IN_PROGRESS for hours, never re-attempts them
**Root Cause:** Control API returned existing IN_PROGRESS claims indefinitely (line 204-206). Worker client added `alreadyClaimed` logic but inverted the handling - treated stale as "skip" instead of "retry".
**Evidence:** Request `0x486db...be542` stuck IN_PROGRESS for 643 minutes, worker kept skipping it
**Solution:** Control API now detects stale claims (>5 minutes) and allows re-claiming with fresh timestamp. Worker client simplified to trust Control API's decision.
**Fix Applied:** 
- `control-api/server.ts`: Added age check (300s threshold) before returning existing claim
- `worker/control_api_client.ts`: Removed confusing client-side stale detection
**Prevention:** Control API is single source of truth for claim staleness, using 5-minute threshold

### 15. Blueprint Date Scope vs Execution Date Confusion (2025-12-04)
**Issue:** Research job dispatched for Dec 1st data but agent researched Dec 3rd instead (workstream 0x6f71ed1e)
**Root Cause:** Script injected target date in blueprint context ("December 1, 2025 to December 2, 2025"), but agent executed on Dec 3rd and used "today"/"current date" from Gemini CLI environment, overriding the blueprint instruction.
**Evidence:** 
- Dispatch script set context: "TARGET DATE SCOPE: 00:00 UTC December 1, 2025 to 00:00 UTC December 2, 2025"
- Job execution timestamp: 1764780883 (Dec 3, 2025 16:54 UTC)
- All child jobs named "*- 2025-12-03" despite blueprint specifying Dec 1st
**Root Problem:** Blueprint's DATA-SCOPE assertion was too weak - didn't emphasize that target date ≠ execution date. Agent performed web searches without explicit date strings (e.g., "Ethereum TVL" instead of "Ethereum TVL 2025-12-01").
**Solution:**
1. Enhanced DATA-SCOPE assertion with explicit parsing instructions and web search requirements
2. Modified dispatch script to use dynamic date calculation (defaults to yesterday for data availability)
3. Added CRITICAL DATE CONSTRAINT in context with multiple repetitions of the target date
4. Changed job naming: `Ethereum On-chain Activity – {YYYY-MM-DD} – {random-word}` to make date scope visible
5. Added DATA-SOURCES assertion for high-quality source selection (Etherscan, DeFiLlama, Dune, etc.)
6. Enhanced MARKET-METRICS and PROTOCOL-DEPTH assertions to require inline source attribution and 7-day comparisons
**Files Changed:**
- `scripts/ventures/ethereum-protocol-research.ts`: Dynamic date handling, explicit job naming, strengthened context injection
- `blueprints/ethereum-protocol-research.json`: 6 new/enhanced assertions for date handling and data quality
**Prevention:** 
- Blueprint must explicitly instruct: "Parse context field for exact date, NOT 'today'"
- All web searches must include date string: "Ethereum metrics YYYY-MM-DD"
- Child job names must propagate target date for clarity
- Inline source attribution prevents vague aggregate claims

---

## Test Infrastructure Gotchas

### Git Fixtures Must Have Main Branch
**Issue:** Test git fixtures need `main` branch with initial commit for `dispatch_new_job` to create job branches
**Solution:** `tests-next/helpers/git-fixture.ts` verifies and creates `main` branch after clone if missing
**Error Message:** `code_metadata.ts` now provides explicit instructions when base branch doesn't exist
**Prevention:** Ensure test git templates have commits on `main` branch

### Git Clone from Local Path Needs --no-hardlinks
**Issue:** `git clone` from local directory creates hardlinks by default, which can cause empty clones with no commits
**Solution:** Use `git clone --no-hardlinks` when cloning from local template directories
**Prevention:** Always use `--no-hardlinks` flag for local repository clones in tests

### Mocking pg.Client Requires EventEmitter
**Issue:** `pg.Client` extends `EventEmitter`, code registers error listeners via `client.on('error', ...)`
**Solution:** Test mocks must extend `EventEmitter` from `node:events`
**Prevention:** When mocking third-party libraries, check full interface including inherited classes

### Blueprint Format Changed to JSON
**Issue:** Tests expecting old GEMINI.md markdown format fail when `buildPrompt()` returns JSON
**Solution:** Parse JSON output and check structure fields: `parsed.context`, `parsed.assertions`, etc.
**Prevention:** When changing output formats, search for all test assertions using old format

### Ponder Startup Requires Valid RPC URL
**Issue:** Ponder config calls `getStartBlock()` which makes RPC call during initialization. Invalid/unreachable RPC causes 30s timeout before Ponder starts
**Symptom:** Tests with `rpcUrl: 'http://127.0.0.1:8545'` hang for 30s during `withProcessHarness` before any test code runs
**Solution:** Always use real RPC (Tenderly VNet) or set `PONDER_START_BLOCK` env var to skip RPC call
**Prevention:** Use `withTenderlyVNet` for all tests that need Ponder, even if not dispatching transactions

---

## Documentation Map

**Operational (this file):**
- Quick start, commands, environment variables
- MCP tool reference, blueprint design
- Blood-written rules (gotchas)

**Deep Architecture:**
- `docs/documentation/AGENT_MCP_REFERENCE.md` – MCP tools, schemas, adding tools
- `docs/documentation/WORKER_INTERNALS.md` – Telemetry, context management, Control API
- `docs/documentation/MEMORY_ARCHITECTURE.md` – Semantic search, SITUATION artifacts, recognition/reflection
- `docs/documentation/OLAS_ARCHITECTURE_GUIDE.md` – Wallet/Safe setup, staking, mech deployment (1700+ lines)

**Specs & Guides:**
- `docs/spec/blueprint/style-guide.md` – Blueprint writing guide
- `docs/documentation/GETTING_STARTED.md` – First-time setup walkthrough
- `ARCHITECTURE_WALLET_SAFES.md` – OLAS wallet deep dive
- `MAINNET_SAFETY.md` – Recovery procedures

---

## IPFS Delivery Architecture

**Critical Understanding:**

1. **Upload:** Worker uploads to Autonolas registry with `wrap-with-directory: true`
2. **On-Chain:** Only 32-byte SHA256 digest stored in `Deliver` event
3. **Ponder:** Reconstructs directory CID, fetches: `{dir-CID}/{requestId}`

**Common Mistake:**
❌ Testing `https://gateway.autonolas.tech/ipfs/f01551220{digest}` (returns binary)  
✅ Testing `https://gateway.autonolas.tech/ipfs/{dir-CID}/{requestId}` (returns JSON)

**Deep Reference:** `docs/documentation/WORKER_INTERNALS.md` (IPFS section)

---

## Context Management

**Three Mechanisms:**

1. **Blueprint-Driven Execution**
   - Blueprints at root of IPFS metadata
   - Assertions define success criteria
   - Agent has full autonomy on execution strategy

2. **Dependency Management**
   - Jobs can require other jobs to complete first
   - `dependencies: ['<job-def-id-1>', '<job-def-id-2>']`
   - Worker enforces recursive completion checking

3. **Progress Checkpointing (Recognition Phase)**
   - For jobs in a workstream
   - Queries completed jobs via Ponder
   - AI generates progress summary
   - Injects into agent context

**Deep Reference:** `docs/documentation/WORKER_INTERNALS.md`

---

## Memory System

**Two Pathways:**

1. **Semantic Graph Search (SITUATION artifacts)**
   - Embeddings of entire job executions
   - Vector search over `node_embeddings` table
   - Recognition phase queries before execution
   - Reflection phase creates after execution

2. **Tag-Based Memory (MEMORY artifacts)**
   - Keyword extraction from `jobName`
   - Tag matching via Ponder
   - Content injection into prompt

**CLI Inspection:**
```bash
yarn inspect-job-run <requestId>          # Full snapshot
tsx scripts/memory/inspect-situation.ts <requestId>  # Memory details
```

**Deep Reference:** `docs/documentation/MEMORY_ARCHITECTURE.md`

---

## Worker Telemetry

**Captured Automatically:**
- Initialization, recognition, execution, reflection, delivery
- Uploaded to IPFS as `WORKER_TELEMETRY` artifact
- Persisted to Supabase via Control API
- Viewable in Explorer UI

**Inspection:**
- Navigate to `/requests/{requestId}` in Explorer
- Expand "Worker Telemetry" card
- View timeline, events, metadata, raw JSON

**Deep Reference:** `docs/documentation/WORKER_INTERNALS.md`

---

## Testing & Debugging

**Single Job Execution:**
```bash
MECH_TARGET_REQUEST_ID=0x... yarn mech --single
```

**Workstream Isolation:**
```bash
yarn dev:mech --workstream=0x... --single
```

**Memory System Validation:**
```bash
# Step 1: Create memory
yarn tsx scripts/dispatch-memory-test.ts
MECH_TARGET_REQUEST_ID=<id> yarn mech --single

# Step 2: Reuse memory
# Modify script with similar jobName
yarn tsx scripts/dispatch-memory-test.ts
MECH_TARGET_REQUEST_ID=<new-id> yarn mech --single

# Step 3: Check logs for "Found relevant memories"
```

**Ponder Local Testing:**
```bash
cd ponder && yarn dev
# Verify with local worker: PONDER_GRAPHQL_URL=http://localhost:42069/graphql yarn dev:mech
```

---

## OLAS Integration

**For OLAS service deployment, staking, and mech operations:**
- Full guide: `docs/documentation/OLAS_ARCHITECTURE_GUIDE.md` (1700+ lines)
- Quick start: `docs/documentation/GETTING_STARTED.md`
- Safety: `MAINNET_SAFETY.md`

**Key Concepts:**
- Master Wallet (EOA) → Master Safe → Service Safe → Agent Key
- Each service deployment = NEW Safe
- Agent keys survive service deletion
- Interactive setup: `yarn setup:service --chain=base`

---

## Control API Integration

**Purpose:** Secure write gateway for on-chain job data

**Endpoint:** `http://localhost:4001/graphql`

**Requirements:**
- Header: `X-Worker-Address: 0x...` (mandatory)
- Validates `request_id` exists in Ponder before writes

**Key Mutations:**
- `claimRequest` – Idempotent claim
- `createJobReport` – Job execution report
- `createArtifact` – Artifact metadata
- `createMessage` – Job messages

**Environment:**
```bash
USE_CONTROL_API=true            # Enable (default)
CONTROL_API_URL=http://localhost:4001/graphql
```

---

## Troubleshooting Quick Reference

**Gemini CLI EPERM:**
```bash
./scripts/clear-gemini-chat-cache.sh
# or
rm -rf ~/.gemini/tmp/*/chats/*
```

**Ponder Not Indexing:**
- Check Railway logs for errors
- Verify IPFS gateway accessible
- Test CID fetch manually

**Worker Stuck:**
```bash
ps aux | grep mech
kill -9 <pid>
```

**OLAS Authentication:**
```bash
rm -rf olas-operate-middleware/.operate
yarn setup:service --chain=base
```

**Balance Check (Before Transactions):**
```bash
yarn tsx scripts/check-balances.ts
```

---

## Key File Locations

**Worker:**
- `worker/mech_worker.ts` – Main loop
- `worker/recognition/runRecognition.ts` – Pre-job learning
- `worker/execution/runAgent.ts` – Agent execution
- `worker/reflection/runReflection.ts` – Post-job learning
- `worker/situation_encoder.ts` – SITUATION artifact creation

**Agent:**
- `gemini-agent/agent.ts` – Gemini CLI spawner
- `gemini-agent/mcp/server.ts` – Tool server
- `gemini-agent/mcp/tools/` – Tool implementations

**Ponder:**
- `ponder/src/index.ts` – Event handlers
- `ponder/ponder.schema.ts` – GraphQL schema
- `ponder/ponder.config.ts` – Network config

**Scripts:**
- `scripts/inspect-job-run.ts` – Job inspection
- `scripts/inspect-job.ts` – Job definition history
- `scripts/inspect-workstream.ts` – Workstream graph
- `scripts/memory/inspect-situation.ts` – Memory inspection

---

## Constants

**Supabase Project ID:** clnwgxgvmnrkwqdblqgf

**Base Mainnet Contracts:**
- Mech Marketplace: `0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020`
- OLAS Token: `0x54330d28ca3357F294334BDC454a032e7f353416`
- AgentsFun1 Staking: `0x2585e63df7BD9De8e058884D496658a030b5c6ce`

**Production Endpoints:**
- Ponder: `https://jinn-gemini-production.up.railway.app/graphql`
- Explorer: `https://jinn-gemini-production.up.railway.app/`

---

**End of Operational Guide**

*For deep architecture, see `docs/documentation/`. Keep this file under 400 lines.*



