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
WORKER_STUCK_EXIT_CYCLES=5  # Optional watchdog exit for stuck cycles

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

**Parallel Workers:**
```bash
# Easy way: use the parallel launcher
yarn dev:mech:parallel --workers=3 --workstream=0x...
yarn dev:mech:parallel -w 3 -s 0x... --runs=10  # limit to 10 jobs per worker

# Manual way: set WORKER_ID per process
WORKER_ID=worker-1 yarn dev:mech --workstream=0x... &
WORKER_ID=worker-2 yarn dev:mech --workstream=0x... &
WORKER_ID=worker-3 yarn dev:mech --workstream=0x... &

# Directory structure (each worker gets isolated clone):
# ~/.jinn-repos/workers/worker-1/{repo}/
# ~/.jinn-repos/workers/worker-2/{repo}/
# ~/.jinn-repos/workers/default/{repo}/   (no WORKER_ID)

# Cleanup orphaned worker directories
yarn cleanup:workers --dry-run  # preview what would be deleted
yarn cleanup:workers            # interactive delete
yarn cleanup:workers --force    # delete without prompting
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

**Launching Workstreams:**
```bash
# Launch a blueprint-based workstream (.json extension optional)
yarn launch:workstream x402-data-service

# Preview without creating repo or dispatching
yarn launch:workstream x402-data-service --dry-run

# Skip GitHub repository creation (artifact-only mode)
yarn launch:workstream x402-data-service --skip-repo

# Customize model and context
yarn launch:workstream x402-data-service --model gemini-2.5-pro --context "Initial audit"
```

**Workstream Launcher Details:**
- Auto-creates private GitHub repository (name derived from blueprint)
- If repo exists, appends 3-letter suffix: `x402-data-service` → `x402-data-service-abc`
- Job name uses same suffix: `X402 Data Service – ABC` (no date in job name)
- Initializes with main branch and README.md
- Clones locally to `~/.jinn/workstreams/<repo-name>`
- Sets `CODE_METADATA_REPO_ROOT` for the workstream
- Dispatches job with blueprint

**GitHub Token Requirements:**
- `GITHUB_TOKEN` environment variable required for repo creation
- **Fine-grained token (recommended)**: "Administration" repository permissions (write)
- **Classic token**: `repo` scope (full control of private repositories)
- If conflicts with existing token (e.g., `gh` CLI), override in `.env`

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
  "invariants": [
    {
      "id": "GOAL-001",
      "form": "constraint",
      "description": "Declarative statement of WHAT must be satisfied",
      "examples": {
        "do": ["One specific, actionable positive example"],
        "dont": ["One specific negative example"]
      },
      "commentary": "WHY this invariant exists (rationale, not implementation)"
    }
  ]
}
```

**Invariant Forms:** `boolean`, `threshold`, `range`, `directive`, `sequence`, `constraint`

**Key Requirements:**
- **Quantify Everything**: "minimum 3 distinct sources with URLs" not "multiple sources"
- **Inline Attribution**: "Volume $378M (defillama.com)" not generic footer
- **Consolidated Examples**: 1-2 high-quality do/dont examples per invariant
- **Specific & Actionable**: Examples should be scenario-based, not generic

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
PONDER_START_BLOCK=38187727      # OlasMech Deliver start block (factory scan fixed at 10,000,000)
```

**Worker Config:**
```bash
MECH_TARGET_REQUEST_ID=0x...     # Process specific request
RPC_URL=<base-rpc-url>           # Base network RPC
GEMINI_QUOTA_CHECK_MODEL=auto-gemini-3   # Optional: model for quota check pings
GEMINI_QUOTA_CHECK_TIMEOUT_MS=10000      # Optional: quota check timeout (ms)
GEMINI_QUOTA_BACKOFF_MS=60000            # Optional: base backoff (ms)
GEMINI_QUOTA_MAX_BACKOFF_MS=600000       # Optional: max backoff (ms)
```

**OLAS (see OLAS_ARCHITECTURE_GUIDE.md):**
```bash
OPERATE_PASSWORD=<password>
BASE_LEDGER_RPC=<rpc-url>
STAKING_PROGRAM=<program>
```

---

## Worker Deployment

**CRITICAL: Worker Runs Locally from Current Branch**
- The production worker is NOT deployed to Railway or any cloud service
- Worker runs locally via `yarn dev:mech` from whatever git branch is currently checked out
- Changes to worker code, agent code, or system blueprints take effect immediately on the current branch
- No merge/deploy cycle needed - just ensure you're on the correct branch before running

**Implication for Testing:**
- To test new features, ensure you're on the branch with those changes
- Run `yarn dev:mech` to start the worker with current branch code
- Jobs dispatched to the workstream will be processed by this local worker

**Railway Worker Service (if used):**
- Service name: `jinn-worker`
- Set `WORKER_STUCK_EXIT_CYCLES` to auto-exit after N stuck cycles (lets Railway restart the service)
- Recommended: `WORKER_STUCK_EXIT_CYCLES=5`

**Gemini Quota Handling:**
- Worker checks Gemini quota before claiming new jobs.
- If quota is exhausted mid-run, the worker stays live, polls until restored, then resumes execution.

---

## Ponder Deployment

**Production:** Railway at `https://jinn-gemini-production.up.railway.app/graphql`
**Auto-Deploy:** Pushes to GitHub trigger Railway redeployment
**Local:** `http://localhost:42069/graphql` (ONLY for testing Ponder changes)

**CRITICAL: Railway Ponder is Primary**
- System depends on Railway for all normal operations
- Run Ponder locally ONLY to test indexing changes before pushing
- Validation scripts/worker/frontend default to Railway

**Global Jinn Explorer Architecture:**
- Ponder indexes **all Jinn requests** across **all mechs** (not single-tenant)
- NetworkId filtering: `networkId === "jinn"` or undefined (legacy) → INDEX; else skip
- MarketplaceDelivery handler tracks delivered status for ANY mech delivering Jinn requests
- OlasMech:Deliver handler resolves IPFS artifacts (delegating delivered status to MarketplaceDelivery)
- Frontend can filter by `mech` (requested mech) or `deliveryMech` (actual deliverer)

**Factory Mech Indexing (split start blocks):**
- Mechs discovered via `MechMarketplace.CreateMech` (factory pattern)
- Factory scan start block: 20,000,000 (~Jan 2024, covers all Jinn marketplace history)
- OlasMech `Deliver` indexing start: `PONDER_START_BLOCK` (default 38187727, Nov 15 2025) to cap event volume
- Delivery handlers: `MarketplaceDelivery` (delivered status) + `OlasMech:Deliver` (IPFS artifacts)

**Factory Pattern Gotcha:**
- `startBlock` normally lives at top-level; use `factory().startBlock` only when discovery and child indexing need different ranges (we do: 10,000,000 vs 38,187,727)

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

**Request IPFS Raw View & networkId visibility:**
- **location**: Explorer `requests` detail page → `Raw` tab → `Request IPFS Content` card
- **behavior**: Frontend renders the full IPFS payload (not just `blueprint`), preserving metadata fields like `networkId: "jinn"` for inspection
- **source**: `frontend/explorer/src/components/job-phases/job-detail-layout.tsx` (`requestIpfsRawContent` state set from `fetchIpfsContent(record.ipfsHash)`)
- **UI contract (2025-12-05):** Raw tab uses `RawSection` + `RawContentBlock` helpers with shadcn `ScrollArea` + `bg-muted` backgrounds; avoid reintroducing ad-hoc `pre` styling or gray backgrounds that reduce contrast

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

## Cyclic Jobs (Continuous Operation)

Root jobs can be launched with `cyclic: true` in IPFS metadata (set via launcher scripts, NOT agents). Worker auto-redispatches after completion. Agent receives CYCLE invariants guiding reassessment and delegation.

**Reference:** `docs/documentation/WORKER_INTERNALS.md` (Cyclic Jobs section)

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

### 9. Custom SSH Aliases Break Worker Clones (2026-01-20)
**Issue:** `codeMetadata.repo.remoteUrl` or `additionalContext.workspaceRepo.url` may carry SSH host aliases (e.g., `git@ritsukai:`) that are not resolvable on other machines.  
**Impact:** Worker attempts to clone and fails with "Could not resolve hostname".  
**Prevention:** Normalize SSH URLs to `git@github.com:` at dispatch time, or omit code metadata for artifact-only jobs.

### 10. SSH Publickey Failures Need HTTPS Fallback (2026-01-20)
**Issue:** `git@github.com:` clone fails with "Permission denied (publickey)" on machines without SSH keys.  
**Impact:** Worker cannot bootstrap repo even when a `GITHUB_TOKEN` is available.  
**Prevention:** Attempt HTTPS clone using `GITHUB_TOKEN` when SSH auth fails.

### 11. HTTPS Clone 403 Indicates Token Lacks Repo Access (2026-01-20)
**Issue:** HTTPS clone fails with `403` and "Write access to repository not granted" despite `GITHUB_TOKEN`.  
**Impact:** Worker cannot bootstrap repo; job must fail early.  
**Prevention:** Ensure token has access to the private repo (fine-grained token with repo read).

### 12. Workstream Repo Must Be Explicit in Input Config (2026-01-20)
**Issue:** Workstreams launched without `repoUrl` in input config default to creating or using unintended repos.  
**Impact:** Jobs clone the wrong repository and fail on permissions or apply changes to the wrong codebase.  
**Prevention:** Set `repoUrl` in the input config (e.g., `configs/longevity.json`) so launcher resolves the correct repo.

### 13. launch:workstream Needs HTTPS Fallback (2026-01-20)
**Issue:** `launch:workstream` clones via `git@github.com` and fails without SSH keys.  
**Impact:** Dispatch never happens even if `GITHUB_TOKEN` is present.  
**Prevention:** Use HTTPS clone fallback with `GITHUB_TOKEN` when SSH auth fails.

### 9. Beads Lock File Blocks Branch Checkout
**Issue:** `git checkout` fails if a worker repo has a dirty `.beads/daemon.lock`, causing job runs to fail before execution.  
**Solution:** Remove stray lock files in worker clones or disable beads/hooks for the repo; keep worker repos clean before checkout.

### 52. Transport Error Should Not Auto-Complete Jobs (2026-01-18)
**Issue:** Jobs marked COMPLETED when Gemini CLI crashes, because status inference sees old children delivered.  
**Root Cause:** Transport error recovery accepted COMPLETED from `inferJobStatus` without verifying agent actually ran.  
**Fix:** Only accept COMPLETED if there's evidence of execution (output, tool calls, or partial output).

### 53. Workstream Overrides Must Be Explicit in IPFS Payloads (2026-01-18)
**Issue:** Redispatch scripts attempted to preserve `workstreamId`, but the payload builder dropped the value when run outside an agent context, creating a new workstream.  
**Fix:** Accept `workstreamId` in `buildIpfsPayload` and include it in the payload when provided.

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

### 15. Ponder Global vs Single-Tenant Architecture (2025-12-05)
**Issue:** Original Ponder design filtered requests by mech address, treating system as single-tenant. Colleague mechs' activity invisible in frontend, breaking global Jinn marketplace view.
**Root Cause:** `MarketplaceRequest` handler had implicit mech filtering; no `MarketplaceDelivery` handler; `OlasMech:Deliver` set `delivered: true` directly instead of delegating to marketplace.
**Solution:**
1. Removed mech filtering from request indexing - ALL Jinn requests indexed regardless of `priorityMech`
2. Added `MarketplaceDelivery` handler as source of truth for `delivered` status across all mechs
3. OlasMech:Deliver now only handles IPFS artifact resolution, not delivered status
4. Added schema fields: `deliveryMech`, `deliveryTxHash`, `deliveryBlockNumber`, `deliveryBlockTimestamp`
5. Frontend queries updated to include delivery mech fields and support filtering by any mech
**Files Changed:**
- `ponder/src/index.ts`: NetworkId filtering without mech filtering, MarketplaceDelivery handler (batch), OlasMech:Deliver delegating delivered status
- `ponder/ponder.schema.ts`: Added marketplace delivery fields with index on `deliveryMech`
- `frontend/explorer/src/lib/subgraph.ts`: Updated Request interface and GraphQL queries
- `frontend/explorer/src/components/subgraph-detail-view.tsx`: Added delivery mech field labels and ordering
- `docs/implementation/NETWORKID-AND-DELIVERY-SYNC.md`: Updated to reflect global explorer architecture
**Prevention:**
- Ponder is a **global Jinn explorer** (all Jinn requests/deliveries), not single-mech view
- NetworkId (`"jinn"` or undefined) gates indexing, NOT mech address
- MarketplaceDelivery handler is source of truth for delivered status
- Frontend can filter by `mech` (requested) or `deliveryMech` (actual deliverer)

### 16. Tenderly VNet Factory Pattern Indexing (2025-12-08) [FIXED]
**Issue:** Integration tests timeout waiting for Ponder to index `Deliver` events after successful dispatch to Tenderly VNets
**Root Causes:**
1. **Factory pattern scanning from wrong block:** Factory requires scanning `MechMarketplace.CreateMech` events from block 25M to discover mech addresses. VNets fork from block ~40M but don't contain historical blocks, so factory scan finds zero mechs.
2. **Child start block evaluated at module-load time:** `getChildStartBlock()` was called during module initialization (line 49), before test env vars were set. Tests set `PONDER_START_BLOCK=39204916` but config read it as `undefined` and defaulted to 38187727.
3. **MechMarketplace still scanning from block 0:** Even when `FACTORY_START_BLOCK=0` bypassed factory pattern on `OlasMech`, `MechMarketplace` contract still started at `FACTORY_START_BLOCK` (0), causing Ponder to backfill from non-existent blocks.

**Evidence:**
- Test output: "Setting PONDER_START_BLOCK to 39204760"
- Ponder logs: "backfill (21.9%) Block 2792632" (wrong start block!)
- VNet at block ~39,205,000 but Ponder stuck at 2.7M
- Debug file showed `Child Start Block: 38187727` (default, not env var)

**Solution Implemented:**
1. **Bypass factory pattern in test mode:** When `FACTORY_START_BLOCK=0`, set `address: undefined` on `OlasMech` to index from all addresses
2. **Lazy evaluation of child start block:** Changed line 191 from using `childStartBlock` constant to calling `getChildStartBlock()` directly, so env var is read after test sets it
3. **MechMarketplace conditional start:** When `FACTORY_START_BLOCK=0`, use `getChildStartBlock()` for marketplace too, so both contracts scan from same recent block in test mode

**Files Changed:**
- `ponder/ponder.config.ts`:
  - Line 164: `startBlock: FACTORY_START_BLOCK === 0 ? getChildStartBlock() : FACTORY_START_BLOCK` (marketplace)
  - Line 191: `startBlock: getChildStartBlock()` (child contract, lazy eval)
  - Removed module-level `childStartBlock` constant
  - Enhanced debug logging
- `tests-next/helpers/process-harness.ts`: Already sets `PONDER_FACTORY_START_BLOCK: '0'` (line 272)

**Test Results:**
All 6 integration tests in `validation-gateway.integration.test.ts` now pass (was 1/6, now 6/6):
- ✅ blocks claim when requestId not found (9.4s)
- ✅ allows claim when requestId exists (26.2s) 
- ✅ handles idempotent claims (26.6s)
- ✅ injects lineage fields (27.0s)
- ✅ allows re-claiming stale jobs (27.3s)
- ✅ blocks re-claiming fresh jobs (26.6s)

**Prevention:**
1. **Never evaluate env vars at module-load time** - always use lazy evaluation (function calls) in config objects
2. **When bypassing factory pattern in tests**, ensure ALL contracts using the factory start block also use the test start block
3. **Factory pattern + chain forks = incompatible** - either use `address: undefined` or seed factory events before testing

### 17. Gemini CLI Hangs + File Path Issues in Test Environments (2025-12-08) [FIXED]
**Issue 1:** System tests timeout after 300 seconds during agent execution phase. Gemini CLI subprocess spawns successfully but produces zero stdout/stderr.
**Root Cause:** Gemini CLI v0.11.2 hangs during initialization when spawned with `cwd` pointing to ephemeral/temporary directories. Tests create git fixtures in `/var/folders/.../jinn-gemini-tests/{random}/git-fixtures/fixture-{timestamp}-{uuid}`, which causes CLI to hang (likely filesystem metadata/permission issues with transient paths).

**Issue 2:** Agent creates files in `gemini-agent/` directory instead of repository root when using stable `cwd`.
**Root Cause:** Native tools (`write_file`, etc.) resolve relative paths based on CLI's `cwd`. When `cwd` is set to stable `gemini-agent/` directory (to fix Issue 1), relative file paths like `olas-staking-optimization.md` are created in `gemini-agent/` instead of the git fixture repository root.

**Solution Implemented:**
1. **Stable cwd with workspace exposure**: Use `gemini-agent/` as `cwd` in test environments (prevents hang), but expose workspace path via `JINN_WORKSPACE_DIR` env var
2. **Absolute path instruction**: Added `SYS-TOOLS-002` system blueprint assertion requiring absolute paths using `metadata.workspacePath`
3. **Metadata enhancement**: BlueprintBuilder now includes `metadata.workspacePath` in the prompt (sourced from `JINN_WORKSPACE_DIR` or `CODE_METADATA_REPO_ROOT`)

**Files Changed:**
- `gemini-agent/agent.ts`: Added `JINN_WORKSPACE_DIR` to env vars (line 392), kept stable cwd logic
- `worker/prompt/system-blueprint.json`: Added SYS-TOOLS-002 for absolute path requirement
- `worker/prompt/BlueprintBuilder.ts`: Added workspacePath to metadata section
- `tests-next/system/memory-system.system.test.ts`: Updated MEM-002B blueprint instructions to require absolute paths

**Prevention:** 
1. Never spawn external CLIs with `cwd` pointing to temporary test fixtures
2. Always instruct agents to use absolute paths for file operations when workspace differs from cwd
3. Expose workspace path in blueprint metadata for agent consumption

### 18. Blueprint Date Scope vs Execution Date Confusion (2025-12-04)
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

### 19. Gemini CLI Hangs in Git Repository Directories (2025-12-09)
**Issue:** Worker hangs after "Spawning Gemini CLI" for jobs with code workspaces (git repos). Artifact-only jobs work fine. CLI says "No input provided via stdin" when tested manually.
**Root Cause:** CLI v0.11.2 handles positional prompts differently depending on `cwd`:
- Directory WITHOUT `.git`: positional prompt argument works
- Directory WITH `.git`: positional prompt IGNORED, expects `-p` flag or stdin

The agent was passing prompts as positional arguments (`args.push(prompt)`), which worked from `gemini-agent/` but failed from workspace directories like `~/jinn-repos/repo-name/`.
**Diagnosis Steps:**
1. Test CLI from agent dir: `cd gemini-agent && npx @google/gemini-cli --yolo "test"` → works
2. Test CLI from workspace: `cd ~/jinn-repos/repo && npx @google/gemini-cli --yolo "test"` → "No input provided"
3. Test with -p flag: `cd ~/jinn-repos/repo && npx @google/gemini-cli --yolo -p "test"` → works
**Solution:** Changed `gemini-agent/agent.ts` from `args.push(prompt)` to `args.push('-p', prompt)` to explicitly use the `-p` flag for non-interactive mode.
**Prevention:** Always use explicit `-p` flag for CLI prompts, not positional arguments.

### 20. Auto-Dispatch sourceRequestId Null – workstreamId Conditional (2025-12-08)
**Issue:** Auto-dispatched child requests had `sourceRequestId: null` instead of parent's request ID, breaking hierarchy tracking.
**Root Cause:** `dispatch_existing_job.ts` conditionally skipped setting `sourceRequestId` when `workstreamId` was provided, assuming workstream preservation meant no hierarchy tracking needed.
**Evidence:**
- Test: `tests-next/system/memory-system.system.test.ts:1191` expected `sourceRequestId` to be parent's request ID but received null
- Auto-dispatch flow: grandchild completes → `parentDispatch.ts` queries child's workstream → calls `dispatch_existing_job` with workstreamId
- Lines 127-133 in `dispatch_existing_job.ts`: `if (!workstreamId) { lineageContext.sourceRequestId = context.requestId }`
**Root Problem:** Logic assumed workstream-preserving requests don't need hierarchy. False - auto-dispatch REQUIRES both:
1. Same workstream (grandchild → child rerun)
2. Proper parent linkage (child sourceRequestId = parent requestId)
**Solution:** Remove conditional, always set `sourceRequestId`/`sourceJobDefinitionId` when available in context:
```typescript
// Before (wrong):
if (!workstreamId) {
  if (context.requestId) lineageContext.sourceRequestId = context.requestId;
  if (context.jobDefinitionId) lineageContext.sourceJobDefinitionId = context.jobDefinitionId;
}

// After (correct):
if (context.requestId) lineageContext.sourceRequestId = context.requestId;
if (context.jobDefinitionId) lineageContext.sourceJobDefinitionId = context.jobDefinitionId;
```
**Files Changed:**
- `gemini-agent/mcp/tools/dispatch_existing_job.ts:125-133` – Removed workstreamId conditional
**Prevention:** Workstream preservation and hierarchy tracking are independent concerns - don't conflate them.
**Related:** Gotchas #12 (stale hierarchy), #13 (Ponder latency)

### 21. NetworkId Filtering Bug – Reading from Non-Existent Event Arg (2025-12-09) [FIXED]
**Issue:** Non-Jinn requests (e.g., mech `0xe535d7acdeed905dddcb5443f41980436833ca2b`) appearing in frontend explorer despite networkId filtering being in place.
**Root Cause:** `ponder/src/index.ts` tried to read `networkId` from `event.args.networkId` in the `MarketplaceRequest` handler. However, the `MarketplaceRequest` event ABI has NO `networkId` field – it only exists in the IPFS metadata.
**Evidence:**
- The `MarketplaceRequest` event has fields: `priorityMech`, `requester`, `numRequests`, `requestIds`, `requestDatas` (checked ABI)
- Code at line 254: `const networkId = event.args.networkId ? String(event.args.networkId) : undefined;` → ALWAYS undefined
- Filter check: `if (networkId && networkId !== "jinn")` → never triggers because undefined is falsy
- IPFS metadata (containing actual `networkId`) fetched AFTER the filter check

**Bug Flow:**
```
1. MarketplaceRequest event emitted
2. Code reads event.args.networkId → always undefined
3. Filter check: (undefined && undefined !== "jinn") = false → passes all requests
4. Pre-seeds DB with request row
5. Fetches IPFS metadata (too late for filtering)
6. Non-Jinn requests now in DB
```

**Solution:**
1. **Moved IPFS fetch before DB writes** – Fetch metadata first to verify networkId
2. **Extract networkId from IPFS content** – `const networkId = typeof content.networkId === "string" ? content.networkId : undefined;`
3. **Filter before any DB operations** – `if (networkId && networkId !== "jinn") { continue; }`
4. **Skip requests on IPFS failure** – Cannot verify networkId without metadata, safer to skip

**Files Changed:**
- `ponder/src/index.ts`: Reordered MarketplaceRequest handler – IPFS fetch → networkId check → DB insert

**Prevention:**
- Always verify event ABI before reading from `event.args` – non-existent fields return undefined
- NetworkId is an application-level concept (IPFS metadata), NOT a chain-level event field
- After deploying fix, Ponder must reindex from scratch to purge incorrectly indexed requests

### 22. Verification Dispatch Loses WorkstreamId (2025-12-09) [FIXED]
**Issue:** Jobs dispatched for verification (verification phase after reviewing children) lose their workstreamId, causing them to fall outside `--workstream` filter and remain PENDING indefinitely.
**Root Causes:**
1. `dispatchForVerification` in `worker/status/parentDispatch.ts` didn't query or pass workstreamId to `dispatchExistingJob`
2. `withJobContext` type in `worker/mcp/tools.ts` omitted `workstreamId` field, preventing TypeScript from accepting it

**Evidence:**
- "Protocol Deep Dive Research 2025-12-09" dispatched 3 times, third dispatch had wrong workstreamId
- Parent job "Ethereum on-chain activity" stuck in DELEGATING because child remained PENDING
- Verification dispatch at line 272-289 called `dispatchExistingJob` without workstreamId parameter
- Parent dispatch at line 675-690 correctly passed workstreamId, but verification dispatch did not

**Solution:**
1. Added `workstreamId?: string` to `withJobContext` context type (`worker/mcp/tools.ts` line 18)
2. Modified `dispatchForVerification` to query workstreamId from Ponder before dispatch (similar to parent dispatch logic at lines 532-551)
3. Passed workstreamId to both `withJobContext` and `dispatchExistingJob` in verification dispatch call

**Files Changed:**
- `worker/mcp/tools.ts`: Added workstreamId to context type
- `worker/status/parentDispatch.ts`: Query and pass workstreamId in dispatchForVerification (lines 240-262, 272-290)

**Prevention:**
- All auto-dispatch flows (parent dispatch, verification dispatch, delegation) must preserve workstreamId
- Always query workstreamId from current request before re-dispatching
- Use same pattern for all dispatch flows: query from Ponder → pass to withJobContext → pass to dispatchExistingJob

### 23. Circular Dependency: Child Depends on Parent (2025-12-09) [FIXED]
**Issue:** Agent dispatched child jobs with dependencies set to the parent job ID, creating a deadlock where parent waits for children and children wait for parent.
**Root Cause:** 
1. System blueprint `SYS-DEPS-001` was ambiguous about dependency targets
2. No tool-level validation prevented setting parent as a dependency
3. Agent misunderstood that dependencies are for sibling ordering, not parent-child relationships

**Evidence:**
- "Protocol Deep Dive" job dispatched 3 children (Uniswap, Aave, Lido deep dives)
- Each child had `dependencies: ["774e69fc-6328-4acd-85be-26b0e5242a25"]` (the parent's ID)
- Children remained PENDING indefinitely because parent could never complete

**Why This Is a Deadlock:**
```
Parent waits for children (via status inference) → children PENDING
Children wait for parent (via dependencies) → parent DELEGATING
Both wait forever
```

**Solution:**
1. Added validation in `dispatch_new_job.ts` to reject dependencies that include `context.jobDefinitionId` (the parent)
2. Updated `SYS-DEPS-001` in `system-blueprint.json` to emphasize that dependencies are for true input/output ordering, with a coding-default pattern: scaffold → implement → integrate
3. Added clear error message: "Child job cannot depend on its parent job... Dependencies should only be between sibling jobs"

**Files Changed:**
- `gemini-agent/mcp/tools/dispatch_new_job.ts`: Added circular dependency check (CIRCULAR_DEPENDENCY error code)
- `worker/prompt/system-blueprint.json`: Clarified SYS-DEPS-001 that dependencies are for sibling ordering

**Prevention:**
- Parent-child coordination is automatic (status inference handles it)
- Dependencies exist solely to order sibling execution (child A before child B)
- Tool now rejects any attempt to set parent as dependency with clear error message

### 24. Verification Run Incorrectly Blocked Parent Dispatch (2025-12-09, REFIXED 2025-12-11)
**Issue:** Jobs with children enter an infinite loop: parent run → verification run → parent run → verification run → ...
**Original Root Cause:** After a verification run completes, `dispatchParentIfNeeded()` triggered re-dispatch of the same job because `shouldRequireVerification()` saw children and requested another verification.

**First Fix (2025-12-09, INCORRECT):** Added early return when `isVerificationRun: true` to block parent dispatch entirely. This broke the case where a child job's verification run should notify its parent.

**Second Fix (2025-12-11):** Removed the early return. The `shouldRequireVerification()` function already returns `requiresVerification: false` for verification runs (line 264-271), which prevents infinite self-dispatch. The early return was blocking legitimate parent dispatches.

**Correct Flow:**
```
Parent Job dispatches Child Job → Child dispatches its grandchildren →
   Grandchildren complete → Child re-runs (review phase) →
   Child completes → dispatches Child for verification →
   Child verification run completes (no more delegation) →
   `shouldRequireVerification()` returns requiresVerification: false →
   `shouldDispatchParent()` → Parent is dispatched ✓
```

**Files Changed:**
- `worker/status/parentDispatch.ts`: Removed incorrect early return, verification runs now proceed to parent dispatch check

**Prevention:**
- Verification run is a GATE before parent dispatch, not a blocker
- The `requiresVerification` check handles re-dispatching for more verification if needed
- After successful verification (no more delegation), parent should be dispatched


### 25. Conflicting Operate Service Configs (2025-12-09)
**Issue:** `dispatch_new_job` fails with "Service target mech address not configured. Check .operate service config (MECH_TO_CONFIG)."  
**Root Cause:** `.operate/services/` contained an extra service dir (`sc-a455...`) without `config.json`/`MECH_TO_CONFIG`; loader picked it first alphabetically, so mech mapping was missing.  
**Solution:** Remove stale service dirs without `config.json`, or ensure they include valid `MECH_TO_CONFIG`. Keep only the intended service (e.g., `sc-bec48f4e-54bc-4b10-9c2f-649926359c20`).  
**Prevention:** Before dispatching, ensure `.operate/services/` has a single valid service config with `config.json` providing `MECH_TO_CONFIG`; delete orphaned directories that lack config.

### 26. Phantom Blueprint Assertion & Tool Visibility (2025-12-10)
**Issue:** Request `0x4fa4bdd6...bcc3a` (workstream `0x771a17b...98ba`) referenced `SYS-PARENT-ROLE-001` even though the arcade blueprint lacked that assertion. Same job’s search-job tool call failed due to a mispointed Ponder URL, and Explorer UI only displayed tool arguments (no outputs), making debugging harder.  
**Prevention:** Audit blueprint-to-assertion injection to prevent non-existent assertions, validate Ponder endpoint selection for search tools, and expose tool call outputs in Explorer for faster failure diagnosis.

### 27. Dependency Merge Missing & Hidden in UI (2025-12-10)
**Issue:** Documentation request `0x233f1768...978f` with three dependencies did not merge dependency branches into the docs branch before running. Explorer also shows no dependency metadata or merge attempt outcomes (success/conflict/blocked), leaving dependency management opaque.  
**Prevention:** Ensure worker merges dependency branches (or surfaces conflicts as failures) before execution; add frontend visibility for dependency lists and merge attempt results to aid debugging.

**Prevention:** Emit a single authoritative child list field; keep other context fields for non-child metadata to avoid ambiguity in agents/telemetry.

### 29. Ponder Artifact Content Missing (2025-12-11)
**Issue:** `getDependencyBranchInfo` failed with "Cannot query field 'content'" because Ponder intentionally excludes full artifact content.
**Root Cause:** Ponder indexer only stores metadata (`cid`, `contentPreview`, `topic`) to prevent DB bloat. Full JSON content lives only on IPFS.
**Solution applied:** Reverted to "Fast Path" parsing (regex on `contentPreview`) instead of trying to query non-existent `content` field.
**Trade-off:**
- **Fast Path (Current):** Regex parse `contentPreview`. Fast, 0 network, but fragile if string format changes.
- **Robust Path (Ideal):** Fetch full JSON from IPFS using `cid`. Robust but slower (async fetch).
**Fix:** Removed invalid `content` field from GraphQL query in `mech_worker.ts`.


### 30. Parent Only Merged Documentation Branch (2025-12-10)
**Issue:** Parent request `0x5e8f2bd3...858c7` had multiple completed child branches (2048-game, arcade-infra-ui, minesweeper-game, snake-game, documentation) and prompt assertions CTX-BRANCH-REVIEW-PRIORITY / CTX-CHILD-001..006, but only the documentation branch (`job/814554d8-...-documentation`) was populated/reviewed/merged. Other child branches were ignored.  
**Prevention:** Ensure parent reviews and processes all child branches listed in context, not just the prioritized one; primary-task assertion should not suppress integration of additional completed children.

### 31. Gemini CLI Token Overflow from node_modules Scanning (2025-12-11)
**Issue:** Job `service-scaffolding` (workstream `0x9045ca50...`) failed with "The input token count exceeds the maximum number of tokens" despite a 26KB prompt. Gemini CLI returned 400 error then 429 (rate limit from retry).
**Root Cause:** Scaffolding job ran `npm install` creating 652MB of `node_modules/` but no `.gitignore` was created. Gemini CLI scans the workspace directory and tried to include all files in context, causing token overflow.
**Evidence:**
- Prompt file was only 26KB (~6-8K tokens)
- Repo size was 713MB, with 652MB in `node_modules/`
- No `.gitignore` file present
**Solution:**
1. Always create `.gitignore` FIRST before running `npm install`
2. Blueprint assertions should explicitly require `.gitignore` creation
3. Updated `x402-service-optimizer.json` blueprint to include `.gitignore` in SCAFFOLD-001
**Prevention:**
- Blueprints for coding jobs MUST include `.gitignore` creation as an early assertion
- Consider adding automatic `.gitignore` generation in workstream launcher
- The `.gitignore` should exclude: `node_modules/`, `dist/`, `.env`, `*.log`, `.DS_Store`

### 32. Infinite Re-Execution Loop on Delivery Nonce Failure (2025-12-11)
**Issue:** Job `service-scaffolding` completed execution but delivery failed with "nonce too low: next nonce 1167, tx nonce 1161". Worker then re-claimed and re-executed the same job in an infinite loop.
**Root Cause:** 
1. Mech-client caches the agent wallet's nonce
2. When multiple deliveries happen, the cached nonce becomes stale
3. Delivery fails but Control API allows re-claiming (doesn't track execution completion)
4. Worker re-executes the same job wastefully
**Evidence:**
- Agent wallet nonce on-chain: 1167 (confirmed)
- Transaction attempted with nonce: 1161 (stale, 6 behind)
- Control API re-claimed the job despite prior execution
**Solution:**
1. Added `executedJobsThisSession` Set in `worker/mech_worker.ts` to track executed jobs
2. Check before claiming to skip jobs already executed in this session
3. Mark jobs as executed in `finally` block even if delivery fails
**Prevention:**
- The mech-client should refresh nonce before each delivery attempt
- Control API should track execution completion separately from delivery status
- Workers should maintain session-local execution history to prevent re-execution

### 33. Re-Dispatched Jobs Missing codeMetadata.repo.remoteUrl (2025-12-11) [FIXED]
**Issue:** Verification/parent jobs looked for files in wrong directory (`gemini-agent/` instead of workspace). Jobs failed with "file not found" errors despite code existing in the correct repo.
**Root Cause:** `dispatchExistingJob` re-collected git metadata via `collectLocalCodeMetadata()` instead of reusing the job definition's stored `codeMetadata`. If `git remote get-url` failed (branch without upstream tracking), `repo.remoteUrl` was undefined. The IPFS payload had `codeMetadata` (object exists) but no valid `remoteUrl`. Worker then skipped repo setup and agent fell back to `agentRoot`.
**Evidence:**
- Workstream `0x7edd4dd122c8ad35cab2572cfd1763875a3d79dc6a9b6073ae6de6844a877b25` (X402 Service Optimizer)
- Verification job looked in `/Users/.../jinn-cli-agents/gemini-agent/services/x402-optimizer/`
- Correct path: `~/.jinn/workstreams/x402-service-optimizer-gsn/services/x402-optimizer/`
**Solution:**
1. Modified `dispatchExistingJob` to query `codeMetadata` from the job definition via GraphQL
2. If job definition has valid `codeMetadata.repo.remoteUrl`, reuse it instead of re-collecting
3. Only fall back to `collectLocalCodeMetadata` for original dispatches or artifact-only jobs
**Files Changed:**
- `gemini-agent/mcp/tools/dispatch_existing_job.ts`: Added `codeMetadata` to GraphQL query, prioritize existing data over re-collection
**Prevention:**
- Re-dispatches should reuse stored metadata, not re-compute it
- Git state can change between dispatches; original dispatch captures the correct data
- Avoid fragile git operations during critical dispatch paths

### 34. x402-Builder Dispatched Without codeMetadata (2025-12-12) [FIXED]
**Issue:** x402-service-optimizer workstream had all jobs fail with "process_branch tool not found" despite being a coding workstream with an associated GitHub repository.
**Root Cause:** The x402-builder service (`services/x402-builder/index.tsx`) created a GitHub repo but did NOT include `codeMetadata` in the IPFS payload when dispatching the job:
```typescript
// BEFORE (broken):
ipfsJsonContents: [{
  blueprint, jobName, model, jobDefinitionId, nonce
  // NO codeMetadata!
}]
```
Without `codeMetadata`, the worker treats the job as artifact-only (`isCodingJob = false`), and `toolPolicy.ts` excludes coding tools (`process_branch`, `write_file`, `replace`, `run_shell_command`).
**Evidence:**
- Workstream `0x1479a1eb90f4997dd8ba327af56505adb926119321a517235f6386e82d71c323`
- Log: `No code metadata - artifact-only job`
- Multiple "Process Branch Tool Not Found" bug report artifacts
- Children created bug reports instead of code
**Solution:**
1. Fixed `x402-builder/index.tsx` to include `codeMetadata` and `branchName` in IPFS payload
2. Added validation in `worker/orchestration/jobRunner.ts` to warn when coding tools are enabled but no codeMetadata
**Files Changed:**
- `services/x402-builder/index.tsx`: Added `codeMetadata`, `branchName`, `baseBranch` to `ipfsJsonContents`
- `worker/orchestration/jobRunner.ts`: Added MISCONFIGURATION warning for coding tools without codeMetadata
**Prevention:**
- Any service that creates a repo MUST include `codeMetadata` in the dispatch payload
- Worker now logs `MISCONFIGURATION: Coding tools enabled without codeMetadata` to catch this early
- The codeMetadata must include at minimum: `repo.remoteUrl`, `baseBranch`, `branch.name`

### 35. Hackathon Direction: Job Templates as x402 Services (2025-12-15)
**Decision:** Productize reusable workflows as **x402-paid callable templates** distributed via the Coinbase x402 bazaar, with Explorer surfacing a catalog.
**Key Points (Daily 2025-12-15):**
- **Distribution**: x402 bazaar is a permissionless discovery channel; ship a single (or few) x402 endpoint(s) that list templates + execute by template ID.
- **Scope realism**: Full “data services” (DBs, migrations, server ops) are not the near-term goal; **workflows/templates are already a product**.
- **Output determinism**: Templates need an **OutputSpec** (schema + mapping) to extract deterministic response fields from the delivery payload.
- **Pricing/budgeting**: Derive price from **historical run cost**; support **budget caps** for callers; longer-term tokenomics possible.
- **Security**: Public templates with web/shell/git expand attack surface; do not run public execution on local machines; enforce tool restrictions.
- **Terminology**: Prefer “job template” (document/policies) vs “job instance” (stateful execution). Current `jobDefinition` behaves like an instance container.

### 36. get_details and search_jobs Fail with promptContent Schema Mismatch (2025-12-16) [FIXED]
**Issue:** Agents calling `get_details` or `search_jobs` for job definitions received errors like "Cannot query field 'promptContent' on type 'jobDefinition'".
**Root Cause:** The GraphQL queries in both tools used the field name `promptContent` which was an old field name. Ponder schema was updated to use `blueprint` instead, but the tool queries were never updated.
**Evidence:**
- Telemetry: `"errors": ["jobDefinition:79ce4091-...: Cannot query field \"promptContent\" on type \"jobDefinition\"."]`
- Agent response: "I can't retrieve job definitions due to a `get_details` tool bug"
**Solution:**
1. Changed `get-details.ts` line 259: `promptContent` → `blueprint`
2. Changed `search-jobs.ts` lines 56, 61, 64: `promptContent` → `blueprint`, `promptContent_contains` → `blueprint_contains`
**Files Changed:**
- `gemini-agent/mcp/tools/get-details.ts`: Updated GraphQL query
- `gemini-agent/mcp/tools/search-jobs.ts`: Updated GraphQL query and comment
**Prevention:**
- When renaming Ponder schema fields, grep entire codebase for old field names
- Add integration tests that exercise real GraphQL queries against Ponder schema

### 37. Agent Ignores STRAT-DELEGATE and Executes Directly (2025-12-18) [FIXED]
**Issue:** Agent received `STRAT-DELEGATE` invariant saying "DELEGATION REQUIRED: You have 9 goal invariants" but executed 13 web searches directly instead of calling `dispatch_new_job`.
**Root Cause:** `STRAT-DELEGATE` was a "directive" (advisory) not a "constraint" (mandatory). Agent treated it as a suggestion and chose to execute work directly.
**Evidence:**
- Telemetry: 13 `google_web_search` calls, 0 `dispatch_new_job` calls
- Agent researched pain points itself instead of delegating to children
**Solution:**
1. Changed `form: 'directive'` → `form: 'constraint'` in `StrategyInvariantProvider.ts`
2. Added blocking language: "You MUST NOT execute GOAL-* invariants directly"
3. Added `measurement` field: "Verify dispatch_new_job was called at least once"
4. Added explicit dont examples: "Call google_web_search before dispatching children"
5. Changed commentary: "you are an ORCHESTRATOR not an EXECUTOR"
**Files Changed:**
- `worker/prompt/providers/invariants/StrategyInvariantProvider.ts`: Strengthened STRAT-DELEGATE constraint
**Prevention:**
- Strategy invariants that require delegation must be `form: 'constraint'` not `form: 'directive'`
- Include measurement fields that can detect violation (e.g., "dispatch_new_job must be called")
- Add explicit negative examples showing what NOT to do first

### 38. Invalid Tool Name `web_search` (2026-01-15)
**Issue:** Default tool lists referenced `web_search`, but the registry/policy expects `google_web_search`. This causes "tool not found" failures at runtime.
**Root Cause:** Tool name drift between launcher defaults/docs and the actual registry.
**Prevention:**
- Use `google_web_search` (and `web_fetch` where needed) for web research tools
- Validate enabledTools against the tool registry before dispatch

### 39. Avoid Registry-Based enabledTools Validation (2026-01-16)
**Issue:** `validateEnabledTools` depended on a runtime registry that was empty in some contexts (gateway/launchers), rejecting valid tools and blocking dispatch.
**Prevention:**
- Rely on `computeToolPolicy()` + settings `includeTools` to enforce access
- Keep template `availableTools` whitelist enforcement for child dispatch

### 40. Universal Tools Must Have a Single Source (2026-01-15)
**Issue:** Different "universal tools" lists in IPFS payload builder and tool policy caused drift and confusion about actual tool availability.
**Prevention:**
- Define universal tools in one module (`toolPolicy.ts`)
- Import from that module rather than duplicating lists in helpers

### 45. Template Tool Policy Split (2026-01-16)
**Issue:** Templates mixed universal tools with template-specific tools, and child jobs could request tools outside the intended scope.
**Prevention:**
- Keep universal tools centralized in `toolPolicy.ts`
- Templates declare `requiredTools` and `availableTools` (whitelist)
- Dispatch enforces `enabledTools ⊆ availableTools`

### 46. list_tools Must Be Policy-Scoped (2026-01-16)
**Issue:** `list_tools` returned the full tool catalog, leading agents to attempt tools that were not enabled for the current workstream.
**Prevention:**
- Scope `list_tools` to `JINN_AVAILABLE_TOOLS` or `JINN_REQUIRED_TOOLS` plus universal tools
- Fall back to the full catalog only when no tool policy is provided in job context

### 47. Template Tool Policy Uses Annotated Tools List (2026-01-16)
**Issue:** Duplicating `requiredTools` and `availableTools` in template metadata caused drift and accidental mismatches.
**Prevention:**
- Use a single `tools` list with `{ name, required }` annotations
- Reject templates that do not provide an annotated `tools` list

### 48. Universal + Required Tools Are Always Available (2026-01-16)
**Issue:** Agents assumed child jobs could not delegate/search because those tools weren't listed in enabledTools.
**Prevention:**
- Universal tools are always available to every agent (dispatch, search, artifact, file ops)
- Template required tools are always inherited by all children in the workstream
- Use `enabledTools` to add domain-specific tools only (blog_*, analytics, etc.)

### 49. dispatch_existing_job Supports Blueprint Override (2026-01-17)
**Feature:** `dispatch_existing_job` accepts a `blueprint` parameter to override the job definition blueprint.
**Behavior:**
- Blueprint is validated like `dispatch_new_job` (JSON parse, schema validation, semantic validation)
- Ponder updates the job definition blueprint on the next request
- Supports iterating on job behavior without creating a new job definition
**Deprecated:** The `prompt` parameter has been removed.

### 50. Cyclic Re-dispatch Requires Script Support (2026-01-17)
**Issue:** `dispatch_existing_job` does not accept a `cyclic` flag.
**Prevention:**
- Use `scripts/redispatch-job.ts --cyclic` to re-dispatch an existing job into the same workstream with `cyclic: true`
- The script builds IPFS metadata directly; MCP tool does not support cyclic overrides

### 51. Beads Runtime Files Should Be Ignored (2026-01-17)
**Issue:** `.beads/daemon.lock` and `.beads/metadata.json` are local runtime artifacts and should not be tracked.
**Prevention:**
- Add them to `.gitignore` and keep them untracked.

### 54. Worker Auto-Adds `.beads/beads.db` to Job Branches (2026-01-18)
**Issue:** Worker repo setup can auto-add `.beads/beads.db` to `.gitignore` and commit it on job branches, reintroducing beads references.
**Prevention:** Disable beads-related repo setup for workstreams that must remain bead-free; scrub job branches if any `.beads` entries appear.

### 55. Limit Cyclic Runs with --max-cycles (2026-01-20)
**Issue:** Cyclic workstreams keep redispatching the root job, making iterative template updates hard to test.
**Prevention:** Run the worker with `--max-cycles=1` to stop after a full cycle completes. In parallel mode, use `--max-cycles=1` so workers share a stop signal via `WORKER_STOP_FILE` and exit after finishing their current job.

### 56. Base Branch May Exist Only on Origin (2026-01-20)
**Issue:** Fresh worker clones can fail `git checkout -b <job-branch> <baseBranch>` if the base branch exists only as `origin/<baseBranch>`.
**Prevention:** Resolve base branches with a local fallback to `origin/<baseBranch>` before creating job branches.
---

### 57. Lingering Processes Block Worker Clone Cleanup (2026-01-20)
**Issue:** Workers spawn Gemini CLI → MCP servers → Chrome browsers. When workers exit (normally or abnormally), these child processes become orphaned and hold file handles open in worker clone directories. Subsequent restarts fail with `ENOTEMPTY` during cleanup because the OS can't delete directories with open file handles.
**Prevention:** Before attempting to delete worker clone directories, use `lsof +D <dir>` to find all processes using them and `kill -9` them. The `dev-mech-parallel.ts` script now does this automatically via `killProcessesUsingWorkerDirs()`.
---

### 58. Parallel Auto-Dispatch Can Double-Dispatch Parent Jobs (2026-01-20)
**Issue:** In parallel runs, multiple workers can reach the "verification → parent dispatch" path for the same parent job around the same time. The `checkRecentDispatch` guard is not sufficient to prevent both workers from dispatching, resulting in multiple parent redispatches (observed multiple dispatch transactions for parent job definition `5c04adf1-...` within seconds).
**Prevention:** Add a cross-worker idempotency guard (e.g., Control API lock, shared stop file, or on-chain/Control API uniqueness check) around parent dispatch so only one worker can dispatch per parent completion window.
---

### 59. Undelivered Set RPC Reverts (2026-01-21)
**Issue:** Worker logs "Failed to get undelivered set; returning null" with "Error happened while trying to execute a function inside a smart contract" during `getUndeliveredSet`.
**Impact:** `filterUnclaimed()` falls back to trusting Ponder (keeps requests), which can cause repeated polling without progress and missed on-chain filtering.
**Where:** `worker/mech_worker.ts` in `getUndeliveredSet` and `filterUnclaimed` fallback path.
**Prevention:** Treat this as an RPC/contract read failure; verify Base RPC health and marketplace contract calls before assuming worker logic is broken.

### 60. dispatch_existing_job Missing Env Var Inheritance (2026-01-22) [FIXED]
**Issue:** Jobs dispatched via `dispatch_existing_job` failed with "Missing required environment variables" (e.g., `TELEGRAM_CHAT_ID`) even though jobs dispatched via `dispatch_new_job` in the same workstream worked correctly.
**Root Cause:** `dispatch_existing_job.ts` manually built the IPFS payload without inheriting `JINN_INHERITED_ENV` - the env var propagation mechanism used by `dispatch_new_job` via `buildIpfsPayload()`.
**Impact:** Template configs with `inputSchema.envVar` mappings (e.g., `telegramChatId → TELEGRAM_CHAT_ID`) were not passed to children dispatched via `dispatch_existing_job`.
**Fix:** Added `JINN_INHERITED_ENV` inheritance logic to `dispatch_existing_job.ts` (lines 236-246), matching the behavior in `ipfs-payload-builder.ts:172-181`.
**Files Changed:** `gemini-agent/mcp/tools/dispatch_existing_job.ts`

### 61. Browser Automation Uses Extension-Based Architecture (2026-01-22)
**Issue:** Browser automation tools failed with "browser is already running" when multiple workers ran concurrently.
**Root Cause:** The global chrome-devtools-mcp extension at `~/.gemini/extensions/chrome-devtools-mcp` launched Chrome without `--isolated=true`, causing all instances to share `~/.cache/chrome-devtools-mcp/chrome-profile` → lock conflict.
**Solution:** Migrated from mcpServers-based config to extension-based architecture:
1. Added `browser_automation` to `EXTENSION_META_TOOLS` in `toolPolicy.ts`
2. Extension config is patched after install to include `--isolated=true` (creates temp user-data-dir per instance)
3. Removed `chrome-devtools` from `settings.template.dev.json` and `settings.template.json`
4. Browser tools are blocked via `excludeTools` when `browser_automation` not in `enabledTools`
**Files Changed:**
- `gemini-agent/toolPolicy.ts`: Added browser_automation to EXTENSION_META_TOOLS
- `gemini-agent/agent.ts`: Added `patchBrowserExtensionConfig()`, removed chrome-devtools mcpServers logic, added excludeTools blocking
- `gemini-agent/settings.template.dev.json`: Removed chrome-devtools server
- `gemini-agent/settings.template.json`: Removed chrome-devtools server
**Prevention:** Never add browser automation directly to settings templates. Use the extension system with `--isolated=true` to ensure concurrent workers don't conflict.

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

### Tenderly VNet Connection Timeouts (2025-12-09) [FIXED]
**Issue:** Integration tests fail with `ConnectTimeoutError` when connecting to Tenderly VNet endpoints
**Root Cause:** Transient network issues when calling Tenderly API (createVnet, fundAddress, deleteVnet). Default `fetch()` has no retry logic, single timeout causes immediate test failure.
**Error:** `ConnectTimeoutError: Connect Timeout Error (attempted address: virtual.base.eu.rpc.tenderly.co:443, timeout: 10000ms)`
**Solution:** Added `fetchWithRetry()` helper in `scripts/lib/tenderly.ts` with exponential backoff (3 retries, 1s/2s/4s delays). Applied to `createVnet`, `fundAddress`, and `deleteVnet` methods.
**Prevention:** External API calls in test infrastructure must have retry logic for network reliability.

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
- `docs/documentation/JOB_TERMINOLOGY.md` – Job template vs instance terminology, API naming guidelines

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

**Ethereum Mainnet Contracts (veOLAS):**
- VoteWeighting: `0x95418b46d5566D3d1ea62C12Aea91227E566c5c1` (for staking nominations)
- veOLAS: `0x7e01A500805f8A52Fad229b3015AD130A332B7b3`

**Jinn Staking Contract (Base):**
- Activity Checker: `0x1dF0be586a7273a24C7b991e37FE4C0b1C622A9B`
- Staking Contract: `0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139`
- Nomination: Use `addNomineeEVM(address, chainId)` NOT `addNominee`
- Full staking guide: `docs/implementation/JINN-STAKING-GUIDE.md`

**veOLAS Voting Mechanics:**
- Vote weight decays linearly based on lock expiration (slope-based)
- UI "veOLAS" display = projected OLAS rewards, NOT raw voting power
- Vote cooldown: 10 days per nominee per address
- Generate Safe batches: `yarn tsx scripts/generate-safe-batch.ts` (new lock) or `generate-safe-batch-increase.ts` (add to existing)
- Simulate before execution: `yarn tsx scripts/simulate-safe-batch.ts <safe-address> <json-file>`

**Production Endpoints:**
- Ponder: `https://jinn-gemini-production.up.railway.app/graphql`
- Explorer: `https://jinn-gemini-production.up.railway.app/`

---

**End of Operational Guide**

*For deep architecture, see `docs/documentation/`. Keep this file under 400 lines.*
