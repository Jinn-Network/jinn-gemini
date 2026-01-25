# Project Jinn – Developer Guide (Agent Coder)

## What you can build right now

The current codebase is wired for an on-chain, event-driven loop on Base:

- Post jobs on-chain with MCP (`dispatch_new_job`) → Ponder indexes them → the mech worker claims via the Control API → the Agent runs with MCP tools → result is delivered on-chain and indexed back by Ponder.
- Reads come from the Ponder GraphQL API. Writes to off-chain tables go through the Control API with a required `X-Worker-Address` header.
- **Memory system**: Jobs generate SITUATION artifacts with embeddings, indexed by Ponder into `node_embeddings` table. Use `inspect_situation` MCP tool or CLI script to observe what the system remembers.

Use this guide to run the stack locally, understand the available tools/endpoints, and extend the Agent or MCP.

---

## Monorepo layout

- `ponder/`: Indexer for Base chain events (Ponder). Exposes GraphQL for `request`, `delivery`, and `artifact`.
- `control-api/`: GraphQL API for secure, auditable writes to Supabase `onchain_*` tables.
- `gemini-agent/`: The Agent class and MCP server (tools). Generates per-job Gemini settings and enforces loop protection.
- `frontend/explorer/`: Next.js explorer UI (optional during backend/dev work).
- `packages/`: Local packages (e.g., `wallet-manager`) and vendored `mech-client-ts` tarball used by MCP tools and worker.

---

## Quick start (local dev)

Prereqs: Node.js, Yarn, Gemini CLI (installed and authenticated on host), a Supabase project.

1) Install dependencies at repo root:
```bash
yarn install
```

2) Create `.env` at repo root (minimal):
```env
# Supabase (required by Control API)
SUPABASE_URL=https://clnwgxgvmnrkwqdblqgf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Optional; defaults shown
PONDER_PORT=42069
CONTROL_API_PORT=4001
# Ponder uses RPC_URL; optionally set PONDER_START_BLOCK to control OlasMech Deliver scan window
PONDER_START_BLOCK=38187727

# Dev: run MCP server with tsx
USE_TSX_MCP=1
```

3) Start the full dev stack (Ponder + Control API + worker):
```bash
yarn dev:stack
```

Services:
- Ponder GraphQL (reads): `http://localhost:42069/graphql`
- Control API (writes): `http://localhost:4001/graphql`

Run services individually when needed:
```bash
# Indexer
cd ponder && yarn dev

# Control API
yarn control:dev

# Mech worker (polls Ponder, claims work, runs Agent)
yarn dev:mech

# Mech worker with workstream filtering (process only specific workstream)
yarn dev:mech --workstream=0x9db9a919bc8aacd40f9ba9779ff156f29645a34fc2d916421afb040eb0db79d2

# Mech worker with workstream filtering + single-shot mode (debugging)
yarn dev:mech --workstream=0x9db9a919bc8aacd40f9ba9779ff156f29645a34fc2d916421afb040eb0db79d2 --single

# MCP server only (for direct tool use)
yarn mcp:start
```

---

## Environment variables (confirmed)

- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required by `control-api/server.ts`).
- Ponder: `PONDER_GRAPHQL_URL` (default `http://localhost:42069/graphql`), `RPC_URL`, `PONDER_START_BLOCK` (controls OlasMech Deliver start block; factory scan fixed at 10,000,000 in config).

Testing with .env.test

- For e2e/local tests, you can place a `.env.test` at the repo root containing test-only values (e.g., `MECH_SAFE_ADDRESS`, `MECH_ADDRESS`).
- Vitest automatically loads `.env.test` when running tests.
- Alternatively, set `JINN_ENV_PATH=/absolute/path/to/.env.test` to force a specific file.
- Control API: `CONTROL_API_PORT` (default `4001`). Requires `X-Worker-Address` on requests.
- Agent loop protection (optional, `gemini-agent/agent.ts`):
  - `AGENT_MAX_STDOUT_SIZE` (bytes, default 5MB)
  - `AGENT_MAX_CHUNK_SIZE` (bytes, default 100KB)
  - `AGENT_REPETITION_WINDOW` (lines, default 20)
  - `AGENT_REPETITION_THRESHOLD` (lines, default 10)
  - `AGENT_MAX_IDENTICAL_CHUNKS` (default 10)
- Code workflow: `CODE_METADATA_DEFAULT_BASE_BRANCH` (default `main`) sets the parent branch for new job definitions.
- GitHub automation: provide `GITHUB_TOKEN` (and optionally `GITHUB_REPOSITORY`, `GITHUB_API_URL`) so the worker can create PRs for completed jobs.
- Git lineage E2E tests (git suite):
  - `TEST_GITHUB_REPO` must point to a writable test repository (e.g., `https://github.com/ritsukai/test-repo.git`).
  - `GITHUB_TOKEN` must have push/PR permissions for that repo; cloning/pushing use HTTPS with the token.
  - The test harness derives `GITHUB_REPOSITORY` automatically, so no extra config is required once the env vars are set.

**IMPORTANT**: All wallet addresses, Safe addresses, private keys, and chain configuration are read exclusively from the `.operate` service profile via `env/operate-profile.ts`. The `.operate` directory path is hardcoded to `olas-operate-middleware/.operate` relative to the project root. Never hardcode addresses in scripts or configuration - always use `getMechAddress()`, `getServiceSafeAddress()`, `getServicePrivateKey()`, `getMechChainConfig()`, or `getServiceProfile()` from `env/operate-profile.ts` to ensure consistency across the codebase.

---

## Ponder (indexer) – reads

- Network: Base (8453). RPC: `RPC_URL`. Factory scan start block: `10,000,000` (fixed). Deliver scan start block: `PONDER_START_BLOCK` (default `38187727`).
- Contracts watched (factory pattern): `MechMarketplace` (request events + `CreateMech` discovery) and `OlasMech` (deliver events on discovered mechs).
- Schema (`ponder/ponder.schema.ts`):
  - `request(id, mech, sender, workstreamId?, requestData?, ipfsHash?, deliveryIpfsHash?, blockNumber, blockTimestamp, delivered, jobName?, enabledTools?[])`
  - `delivery(id, requestId, mech, mechServiceMultisig, deliveryRate, ipfsHash?, transactionHash, blockNumber, blockTimestamp)`
  - `artifact(id, requestId, name, cid, topic, contentPreview?)`
- Handlers (`ponder/src/index.ts`):
  - On `MarketplaceRequest`: upserts `request`, resolves `ipfsHash` → fetches `jobName` and `enabledTools` from IPFS, computes `workstreamId` by traversing up the `sourceRequestId` chain to find the root.
  - On `OlasMech:Deliver`: upserts `delivery`, marks `request.delivered`, resolves delivery JSON and upserts `artifact` rows (uses `event.args.data` for result digest; `MarketplaceDelivery` is not used because it omits result data).

**Deployment:**
- **Production**: Hosted on Railway at `https://jinn-gemini-production.up.railway.app/` (GraphQL endpoint)
- **Railway Auto-Deploy**: Pushes to GitHub trigger automatic redeployment (branch configured in Railway UI)
- **Local development**: `http://localhost:42069/graphql` (ONLY for testing Ponder changes before pushing)
- Frontend and worker default to Railway endpoint for production data
- Set `PONDER_GRAPHQL_URL` (worker) or `NEXT_PUBLIC_SUBGRAPH_URL` (frontend) to override

**CRITICAL: Railway Ponder is the Primary Dependency**
- The system depends on the Railway-hosted Ponder instance for all normal operations
- Running Ponder locally is ONLY for testing indexing changes before deployment
- Validation scripts, worker, and frontend all default to Railway Ponder
- Do NOT run local Ponder unless you are specifically testing indexing logic changes

**Schema Notes:**
- The `jobDefinition` table includes a `workstreamId` field that is populated during indexing
- `workstreamId` is set in both the `MarketplaceRequest` handler (after computing the workstream root) and the `OlasMech:Deliver` handler (propagated from the request)
- Existing job definitions created before this field was added will have `null` workstreamId until they receive a new request

**Environment Configuration:**
```bash
# Default (uses Railway Ponder - RECOMMENDED):
# No configuration needed - Railway endpoint is the default

# Override for local Ponder testing ONLY:
PONDER_GRAPHQL_URL=http://localhost:42069/graphql
NEXT_PUBLIC_SUBGRAPH_URL=http://localhost:42069/graphql
```

**Testing Workflow for Ponder Changes:**
1. Make indexing changes in `ponder/src/index.ts` or `ponder/ponder.schema.ts`
2. Test locally: `cd ponder && yarn dev`
3. Verify changes work with local worker/frontend
4. Push to GitHub (Railway monitors the branch configured in Railway UI)
5. Railway automatically redeploys Ponder with your changes
6. Wait ~2-3 minutes for Railway deployment to complete
7. Verify changes in production using Railway endpoint

Example queries:
```graphql
query Request($id: String!) {
  request(id: $id) {
    id mech sender ipfsHash deliveryIpfsHash delivered blockTimestamp
    jobName enabledTools
  }
}

query Artifact($id: String!) {
  artifact(id: $id) { id requestId name topic cid contentPreview }
}
```

---

## Frontend Explorer

The Next.js frontend (`frontend/explorer/`) provides a web interface for exploring on-chain job requests, deliveries, artifacts, and workstreams.

### Schema Validation Tests

To prevent GraphQL query/schema mismatches, the frontend includes comprehensive validation tests:

- **Query Validation** (`frontend/explorer/src/lib/subgraph.test.ts`): Ensures GraphQL queries only request fields that exist in the Ponder schema
- **Component Tests** (`frontend/explorer/src/components/job-definitions-table.test.tsx`): Validates component rendering with actual schema fields
- **Golden Schema**: Test files define expected valid fields for each entity type as a contract

Tests automatically fail if:
- Queries request non-existent fields (e.g., `promptContent`, `description` on `jobDefinition`)
- Components try to access fields that don't exist in the schema
- TypeScript interfaces drift from the Ponder schema

Run tests: `cd frontend/explorer && yarn test`

---

## Control API (secure writes)

Endpoint: `http://localhost:4001/graphql`

Requirements:
- Header `X-Worker-Address: 0x...` is mandatory.
- Validates `request_id` by querying Ponder before writes.

Key mutations (`control-api/server.ts`):
- `claimRequest(requestId: String!): RequestClaim` – idempotent find-or-create claim.
- `createJobReport(requestId: String!, reportData: JobReportInput!): JobReport`
- `createArtifact(requestId: String!, artifactData: ArtifactInput!): Artifact`
- `createMessage(requestId: String!, messageData: MessageInput!): Message`
- Transaction queue: `enqueueTransaction`, `getTransactionStatus`, `claimTransactionRequest`, `updateTransactionStatus`

Example mutation:
```graphql
mutation Report($id: String!) {
  createJobReport(
    requestId: $id
    reportData: { status: "COMPLETED", duration_ms: 1234, total_tokens: 9001, final_output: "OK" }
  ) {
    id status created_at
  }
}
```

---

## Agent & MCP

- Agent (`gemini-agent/agent.ts`) spawns the Gemini CLI and loads the MCP server.
- Universal tools always available: `list_tools`, `get_details`, `dispatch_new_job`, `dispatch_existing_job`.
- Effective toolset = universal tools + job `enabledTools`. Native Gemini CLI tools are excluded unless explicitly enabled.
- Per-job MCP settings are generated at `gemini-agent/.gemini/settings.json` from templates:
  - Dev (`settings.template.dev.json`): runs MCP via `tsx`.
  - Prod (`settings.template.json`): runs built `server.js`.
- Loop protection terminates runs on excessive output size, large chunks, or repetitive lines.

### Headless Execution Configuration

The Agent runs Gemini CLI in headless (non-interactive) mode for automated execution. Tool access is controlled through MCP server settings rather than CLI flags.

**Configuration (`gemini-agent/agent.ts`):**
- Tool permissions are defined in the generated `settings.json` file via `includeTools` and `excludeTools` per MCP server
- The `--prompt` flag enables non-interactive mode to prevent "Please continue" prompts
- The `--include-directories` flag ensures the job workspace is accessible for file operations

**Why this matters:**
- The Gemini CLI no longer accepts `--approval-mode` or `--allowed-tools` flags
- Tool access control is now exclusively managed through MCP server configuration
- The `toolPolicy.ts` module computes which tools are available based on job requirements and security constraints

This configuration ensures fully autonomous execution with proper tool access controls.

### Per-Job Model Selection

Each job specifies its own Gemini model in the job definition. Model selection is per-job, not worker-level.

**When Creating Jobs:**
```typescript
// Blueprint must be a JSON string with invariants array
// Blueprints define WHAT must be true (outcomes), not HOW to achieve it (process)
// The agent has full autonomy to determine execution strategy
const blueprint = JSON.stringify({
  invariants: [
    {
      id: 'GOAL-001',
      form: 'constraint',  // boolean, threshold, range, directive, sequence, constraint
      description: 'Brief declarative statement of requirement (WHAT must be satisfied)',
      examples: {
        do: ['One specific, actionable positive example'],
        dont: ['One specific negative example']
      },
      commentary: 'Explanation of why this invariant exists (rationale, not process)'
    }
  ]
});

// Via dispatch_new_job tool
dispatchNewJob({
  jobName: '...',
  blueprint: blueprint,  // Defines success criteria, not implementation steps
  model: 'gemini-2.5-pro',  // or 'gemini-2.5-flash'
  enabledTools: [...]  // Available capabilities, agent chooses which to use
})

// The agent receiving this job will:
// 1. Read all blueprint invariants (WHAT must be satisfied)
// 2. Consult recognition learnings (HOW similar jobs succeeded)
// 3. Autonomously decide execution strategy (direct work vs delegation)
// 4. Verify all invariants are satisfied in the final deliverable
```

**Blueprint Style Guide**: See `docs/spec/blueprint/style-guide.md` for comprehensive guidance on:
- Writing declarative, outcome-focused blueprints
- Quantifying vague requirements (e.g., "multiple sources" → "minimum 3 distinct sources")
- Invariant forms and when to use each
- Common pitfalls and anti-patterns

### Blueprint Design Philosophy

**Blueprints specify WHAT, not HOW:**

Blueprints must define success criteria and outcomes, not implementation steps or strategies. The agent has full autonomy to determine execution approach.

**Invariant Forms:**
- `boolean` – True/false conditions
- `threshold` – Minimum value requirements (e.g., "at least 3 sources")
- `constraint` – Boundaries and limits
- `directive` – Guidance without hard verification
- `sequence` – Ordered steps or phases
- `range` – Value within bounds

**Key Requirements:**
- **Quantify Everything**: Replace vague terms with specific numbers ("minimum 3 distinct sources with URLs")
- **Inline Attribution**: Citations with URLs per claim, not generic footer ("Volume $378M (defillama.com)")
- **Consolidated Examples**: 1-2 high-quality, scenario-based examples per invariant

❌ **Wrong - Prescribes HOW:**
```json
{
  "id": "DEPTH-001",
  "form": "directive",
  "description": "If initial web searches return aggregate data, delegate deep-dive research to child jobs"
}
```

✅ **Correct - Defines WHAT:**
```json
{
  "id": "GOAL-001", 
  "form": "constraint",
  "description": "Analysis must include protocol-specific breakdowns with 7-day historical comparisons",
  "examples": {
    "do": ["Report Uniswap volume: $378M (1.2x 7-day average)"],
    "dont": ["Report aggregate DeFi volume without protocol breakdowns"]
  }
}
```

The agent decides independently whether to:
- Complete work directly using available tools
- Delegate to specialist child jobs for depth
- Request additional tools or capabilities

Blueprints that prescribe delegation strategies, tool usage, or workflow patterns violate agent autonomy and reduce adaptability.

**Model Storage & Execution:**
1. Model is stored in IPFS metadata with the job definition
2. Worker reads model from IPFS at execution time
3. All phases (recognition, execution, reflection) use the job-specified model
4. Defaults to `gemini-2.5-flash` if not specified

**Available Models:**
- `gemini-2.5-flash`: Fast, cost-effective for most tasks (default)
- `gemini-2.5-pro`: High-quality reasoning for complex tasks

**Benefits:**
- Each job uses the optimal model for its task
- No worker restart needed to change models
- Model choice is auditable (stored on-chain via IPFS)
- Enables A/B testing across different job types

MCP server (`gemini-agent/mcp/server.ts`) registers tools from `gemini-agent/mcp/tools/index.ts`:
- `list_tools` – catalogs both core CLI tools and MCP tools.
- `get_details` – reads on-chain data via Ponder; supports IPFS resolution. Accepts request IDs (0x...), artifact IDs (0x...:index), CIDs (bafkrei..., Qm...), and job definition UUIDs.
- `dispatch_new_job` – creates a new job definition and posts a marketplace request on Base. Validates and uploads structured JSON blueprint (with assertions array) to IPFS.
- `dispatch_existing_job` – dispatches a new request for an existing job definition by ID or name.
- `create_artifact` – uploads content to IPFS and returns `{ cid, name, topic, contentPreview }`. The tool's output is captured in telemetry; the worker is responsible for persisting it via the Control API.

Notes:
- Agent tools like `create_artifact` **do not write directly to the database**. Their structured output is captured in execution telemetry. After the job is finished, the **worker** is responsible for calling the Control API to persist artifacts, messages, and reports off-chain.
- `dispatch_new_job` enriches with the IPFS gateway URL by querying Ponder (retrying briefly for indexing).
- Deliveries are indexed from `OlasMech:Deliver` (factory children). `MarketplaceDelivery` omits result data, so using CLI-only delivery shortcuts (e.g., `scripts/deliver_request.ts`) leaves `request.delivered=false`. Always deliver via Safe/AgentMech so `Deliver` events fire.
- For automated tests and production flows always go through the MCP toolchain (dispatch via `dispatch_new_job`, deliver via Safe).

---

## Worker Telemetry System

The worker includes a comprehensive telemetry system that captures operational data for each job run, separate from the agent's execution telemetry. This provides visibility into worker-level operations and enables debugging and performance analysis.

### Architecture

1. **Telemetry Collection**: `WorkerTelemetryService` class in `worker/worker_telemetry.ts` captures events and metrics during job processing.
2. **Instrumentation**: The worker logs checkpoints at critical stages:
   - Initialization (metadata fetching)
   - Recognition phase (situational learning)
   - Agent execution (model inference, artifact extraction)
   - Reporting (job report creation)
   - Reflection (memory artifact creation)
   - Situation creation (SITUATION artifact generation)
   - Telemetry persistence (IPFS upload)
   - Delivery (on-chain transaction submission)

3. **Persistence**: Worker telemetry is:
   - Uploaded to IPFS as a `WORKER_TELEMETRY` artifact
   - Persisted to Supabase via Control API for queryability
   - Included in the delivery payload's `workerTelemetry` field

4. **Frontend Display**: The explorer UI displays worker telemetry on completed request detail pages, showing:
   - Summary stats (total duration, events count, phases, errors)
   - Execution timeline with expandable phase details
   - Event-level metadata and error messages
   - Raw JSON for deep inspection

### Implementation Files

- `worker/worker_telemetry.ts` - Telemetry service class
- `worker/mech_worker.ts` - Worker instrumentation
- `frontend/explorer/src/components/worker-telemetry-card.tsx` - UI component
- `frontend/explorer/src/components/job-phases/job-detail-layout.tsx` - Integration into job detail view

### Usage

Worker telemetry is automatically collected for all jobs. To inspect:
- Navigate to any delivered request in the explorer UI at `/requests/{requestId}`
- Scroll to the "Worker Telemetry" card
- Expand phases to see individual events and metadata
- View raw JSON for programmatic analysis

## Semantic Graph Search (JINN-233)

The agent features a situation-centric learning system that performs semantic similarity search over entire job execution contexts rather than isolated memory artifacts. This enables the agent to find and learn from past situations that are contextually similar to the current job.

### Architecture

1.  **SITUATION Artifact Creation (Write Path)**: After successful job completion, the worker creates a SITUATION artifact containing:
    - Job metadata (requestId, jobName, objective, acceptanceCriteria)
    - Execution trace (tool calls with args and result summaries, up to 15 steps)
    - Final output summary (up to 1200 chars)
    - Context (parent/child/sibling job relationships)
    - Artifacts created during execution
    - Pre-computed embedding vector (256-dim via `text-embedding-3-small`)

2.  **Indexing**: Ponder's `OlasMech:Deliver` handler detects SITUATION artifacts, fetches them from IPFS, extracts embeddings and metadata, and upserts into PostgreSQL `node_embeddings` table with `pgvector` extension for efficient similarity search.

3.  **Recognition Phase (Read Path)**: Before job execution, the worker can optionally run a recognition phase that:
    - Generates an embedding for the current job objective
    - Queries `node_embeddings` for top-k similar past situations via cosine similarity
    - Fetches full SITUATION artifacts from IPFS for analysis
    - Synthesizes actionable learnings from similar job execution patterns

4.  **Graceful Failure**: If recognition or embedding fails, the system logs the error and proceeds with job execution, ensuring core functionality is never blocked.

### Database Schema

```sql
CREATE TABLE node_embeddings (
  node_id TEXT PRIMARY KEY,      -- Request ID
  model TEXT NOT NULL,            -- "text-embedding-3-small"
  dim INT NOT NULL,               -- 256
  vec VECTOR(256) NOT NULL,       -- Embedding vector
  summary TEXT,                   -- Text summary for search
  meta JSONB,                     -- Full situation metadata
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX node_embeddings_vec_idx
  ON node_embeddings USING ivfflat (vec vector_cosine_ops) WITH (lists = 100);
```

### MCP Tools

- `search_similar_situations(query_text: string, k?: number)` – Performs semantic search over stored situations and returns top-k matches with similarity scores and full metadata.
- `inspect_situation(request_id: string, include_similar?: boolean, similar_k?: number)` – Inspects the memory system for a given request, returning the SITUATION artifact, database record, and optionally similar situations.

### Observability

**CLI Scripts:**

**Comprehensive Job Run Inspection:**
```bash
yarn inspect-job-run <requestId>
```
Fetches complete job run data from Ponder, resolves all IPFS references (request, delivery, artifacts), and outputs a fully-resolved JSON snapshot to stdout. This is the primary debugging tool for inspecting individual job execution data.

**Job Definition Inspection:**
```bash
yarn inspect-job <jobDefinitionId>
```
Fetches the complete story of a job definition including:
- Job definition metadata (name, blueprint, enabled tools, lineage)
- All execution runs (requests) with resolved IPFS content
- Child jobs created by each run
- Deliveries and artifacts for all runs
- Workstream relationships
- Summary statistics (total/completed runs, artifacts)

Outputs comprehensive JSON to stdout with progress messages to stderr. Use this to understand the full lifecycle and execution history of a job definition across all its runs.

**Example Usage:**
```bash
# Inspect a job and save to file
yarn inspect-job <jobDefinitionId> 2>/dev/null > job-analysis.json

# View summary statistics
yarn inspect-job <jobDefinitionId> 2>/dev/null | jq '.summary'

# List all workstreams involved
yarn inspect-job <jobDefinitionId> 2>/dev/null | jq '.workstreams'

# Check child jobs created by first run
yarn inspect-job <jobDefinitionId> 2>/dev/null | jq '.runs[0].children'
```

**Workstream Graph Inspection (Primary Debugging Entry Point):**
```bash
yarn inspect-workstream <workstreamId>
```
Visualizes the complete execution graph of a workstream, showing parent/child relationships, status, and key artifacts. This provides a high-level view of job execution trees within a venture.

**Flags for different views:**
- `--status=failed|pending|completed|all` - Filter by job status
- `--job-name=<regex>` - Filter by job name pattern
- `--depth=<n>` - Max hierarchy depth (0 = root only)
- `--since=<timestamp>` - Only requests after timestamp
- `--show-errors` - Aggregate errors by phase and top patterns
- `--show-dispatch` - Show dispatch type (manual/verification/cycle/loop_recovery/timeout_recovery/parent) and reasons
- `--show-git` - Show branch/commit/push operations and conflicts
- `--show-metrics` - Show token usage, invariant coverage, tool call stats
- `--format=summary` - Human-readable output instead of JSON

Returns:
- `stats`: Total jobs, completed/pending/failed counts, artifact counts
- `tree`: Hierarchical graph showing parent/child job relationships with status and summaries
- `errors` (with --show-errors): Aggregated errors by phase and normalized pattern
- `dispatchChain` (with --show-dispatch): Dispatch lineage with auto-dispatch type detection
- `gitSummary` (with --show-git): Branch operations, push status, merge conflicts
- `metrics` (with --show-metrics): Token usage, invariant measurements, tool call stats

**Common Debugging Workflows:**
```bash
# Debug failed workstream
yarn inspect-workstream <id> --status=failed --show-errors --format=summary

# Trace dispatch chain (shows verification runs, cycle runs, etc.)
yarn inspect-workstream <id> --show-dispatch | jq '.dispatchChain[] | select(.dispatchType != "manual")'

# Check token costs across all jobs
yarn inspect-workstream <id> --show-metrics | jq '.metrics.tokenUsage'

# See which invariants weren't measured
yarn inspect-workstream <id> --show-metrics | jq '.metrics.invariants.unmeasuredJobs'

# Find jobs with git conflicts
yarn inspect-workstream <id> --show-git | jq '.gitSummary.conflicts'
```

**Drill-down to specific jobs:**
```bash
# Get full details for a specific job run
yarn inspect-job-run <requestId>

# See history of a job definition across all runs
yarn inspect-job <jobDefinitionId>

# Inspect memory/recognition for a request
tsx scripts/memory/inspect-situation.ts <requestId>
```

**Default Endpoint:** Production Railway instance (`https://jinn-gemini-production.up.railway.app/graphql`)  
**Local Override:** Set `PONDER_GRAPHQL_URL=http://localhost:42069/graphql` to use local Ponder

**Situation Memory Inspection:**
```bash
tsx scripts/memory/inspect-situation.ts <requestId>
```
Rich CLI output showing SITUATION details, job info, execution trace, context, artifacts, embeddings, recognition data, database record, and similar situations with similarity scores.

**MCP Tool:**
The `inspect_situation` tool provides programmatic access to the same data in JSON format, enabling both agent and external system inspection of the memory system.

**Frontend Explorer:**
The explorer UI shows a memory visualization section on completed request detail pages with instructions for CLI inspection. Navigate to any delivered request at `https://jinn-gemini-production.up.railway.app/` (or local explorer) to see the visualization.

### Implementation Files

- `worker/situation_encoder.ts` – Builds SITUATION artifact structure from job telemetry
- `worker/situation_artifact.ts` – Generates embeddings and uploads to IPFS
- `ponder/src/index.ts` – Indexes SITUATION artifacts into `node_embeddings`
- `gemini-agent/mcp/tools/search_similar_situations.ts` – Vector search tool
- `gemini-agent/mcp/tools/inspect_situation.ts` – Memory inspection tool
- `gemini-agent/mcp/tools/embed_text.ts` – Text embedding tool
- `scripts/memory/inspect-situation.ts` – CLI inspection script for SITUATION artifacts
- `scripts/inspect-job-run.ts` – CLI tool for inspecting individual job run data
- `scripts/inspect-job.ts` – CLI tool for inspecting complete job definition history
- `scripts/inspect-workstream.ts` – CLI tool for inspecting workstream execution graphs
- `frontend/explorer/src/components/memory-visualization.tsx` – UI component
- `packages/jinn-types/src/situation.ts` – TypeScript types for SITUATION artifacts

---

## Agent Memory Management System (JINN-231)

The agent features a tag-based memory system for creating and reusing insights from past jobs. This system works alongside the semantic graph search to provide multiple pathways for learning retrieval.

### Core Learning Loop: Reflect → Create → Find → Use

1.  **Reflection (After Job)**: After a job completes successfully, a separate "reflection agent" reviews the job's output and telemetry.
2.  **Creation**: If the reflection agent identifies valuable insights, it calls the `create_artifact` tool with `type: "MEMORY"` and relevant `tags` to create a memory artifact.
3.  **Discovery (Before Job)**: Before a new job starts, the worker extracts keywords from the `jobName`.
4.  **Injection**: The worker uses these keywords to search Ponder for `MEMORY` artifacts with matching tags. The content of the most relevant memories is fetched from IPFS and injected into the agent's prompt.

### Validation Status: ✅ VALIDATED

The core loop for memory creation and reuse has been validated end-to-end.

-   **Memory Creation**: Confirmed that the reflection step creates `MEMORY` artifacts with correct `type` and `tags`, which are then successfully indexed by Ponder.
-   **Memory Reuse**: Confirmed that subsequent jobs with similar `jobName`s discover the relevant memory via tag-based search and inject it into the agent's prompt.
-   **Intelligent Use**: Confirmed that the agent can make an intelligent decision *not* to use an injected memory if it's semantically related but not directly applicable to the current task, opting for other tools like web search instead.

### How to Test the Memory System

You can validate the entire loop using targeted worker runs with `MECH_TARGET_REQUEST_ID`.

**Step 1: Create a Memory**

1.  **Dispatch a job** designed to generate a memory. Use the `scripts/dispatch-memory-test.ts` script as a template.
    ```bash
    # Example job dispatch
    yarn tsx scripts/dispatch-memory-test.ts
    # Note the Request ID from the output
    ```
2.  **Run the worker** on that specific request.
    ```bash
    MECH_TARGET_REQUEST_ID=<request-id-from-step-1> yarn mech --single
    ```
3.  **Verify artifact creation** by querying Ponder. Look for an artifact with `type: "MEMORY"` and a `tags` array.
    ```bash
    # Query Ponder's GraphQL endpoint
    curl -s http://localhost:42069/graphql -H "Content-Type: application/json" -d '{"query": "{ artifacts(where: {requestId: \\"<request-id-from-step-1>\\"}) { items { id name topic type tags cid } } }"}' | jq
    ```

**Step 2: Reuse the Memory**

1.  **Dispatch a similar job**. Modify `scripts/dispatch-memory-test.ts` to have a `jobName` with overlapping keywords.
    ```bash
    # Example: change jobName from "OLAS Token Contract..." to "OLAS Staking Contract..."
    yarn tsx scripts/dispatch-memory-test.ts
    # Note the new Request ID
    ```
2.  **Run the worker** on the new request.
    ```bash
    MECH_TARGET_REQUEST_ID=<new-request-id> yarn mech --single
    ```
3.  **Check worker logs for memory injection**.
    ```
    # Look for these lines in the worker output
    [INFO] Searching for relevant memories
      extractedKeywords: ["olas", "staking", "contract"]
    [INFO] Found relevant memories
      memoriesFound: 1
    ```
4.  **(Optional) Check telemetry** to see if the agent used the injected memory or defaulted to other tools.

### Key Implementation Details & Fixes

-   **Reflection Artifact Extraction**: The worker now correctly extracts artifacts created by the reflection agent and merges them into the final delivery payload, ensuring they are indexed by Ponder (`worker/mech_worker.ts`).
-   **Explicit Reflection Prompt**: The prompt given to the reflection agent is highly explicit, with mandatory `type` and `tags` fields and JSON examples to ensure reliable `MEMORY` artifact creation.
-   **Robust MCP Imports**: The dynamic import logic in `dispatch_new_job.ts` and `dispatch_existing_job.ts` was fixed to robustly detect the project root, allowing the tools to be called from both compiled code (`dist/`) and `tsx` scripts.

## IPFS Delivery System Architecture

**Understanding Delivery IPFS Flow:**

The delivery system uses a sophisticated IPFS architecture that can be confusing if tested incorrectly:

1. **Upload Process**:
   - Worker uploads delivery JSON to IPFS with `wrap-with-directory: true`
   - IPFS returns a **directory CID** (e.g., `bafybeihkn34x77dtedc6idsdwvpze4ulcszonsluszjvsdwqycmlcyoidm`)
   - The actual JSON file is stored **inside** this directory

2. **On-Chain Storage**:
   - Worker extracts SHA256 digest from the directory CID structure
   - Worker posts the 32-byte digest to the `Deliver` event on-chain
   - Only the digest is stored on-chain, not the full CID

3. **Ponder Indexing**:
   - Ponder reads the digest from the on-chain event
   - Ponder reconstructs the directory CID using dag-pb codec (0x70) + base32 encoding
   - Ponder fetches: `https://gateway.autonolas.tech/ipfs/{reconstructed-dir-CID}/{requestId}`

**Common Testing Mistakes:**

❌ **Wrong**: Testing `https://gateway.autonolas.tech/ipfs/f01551220{digest}` directly
- This raw CID points to the **directory structure bytes**, not the JSON file
- Will return binary data (expected behavior)

✅ **Correct**: Testing `https://gateway.autonolas.tech/ipfs/{dir-CID}/{requestId}`
- This fetches the actual JSON file from within the directory
- Returns valid JSON with requestId, output, telemetry, artifacts array

**Verification Commands:**
```bash
# Correct fetch (works):
curl "https://gateway.autonolas.tech/ipfs/bafybeihkn34x77dtedc6idsdwvpze4ulcszonsluszjvsdwqycmlcyoidm/0x09d72fe9923227f8a7e9e2b3ef0dd38dc2d08f839614294252c4835ce36e9e2b"
# Returns: Valid JSON with requestId, output, telemetry, artifacts array

# Wrong fetch (binary):
curl "https://gateway.autonolas.tech/ipfs/f01551220ea6ef97ffc7320c5e40e43b55f92728b14b2e6c9749653590ed0c098b161c81b"
# Returns: Directory structure bytes (expected behavior)
```

**Key Points:**
- The system is working correctly - no IPFS corruption exists
- Manual testing must use the reconstructed directory CID + requestId path
- Ponder successfully indexes artifacts from this architecture
- All "Indexed OlasMech Deliver" logs show successful processing

**Frontend API Considerations:**
When fetching delivery data in the frontend API (`frontend/explorer/src/app/api/memory-inspection/route.ts`), the same CID reconstruction logic must be applied:

```typescript
// Frontend API must reconstruct directory CID from f01551220 hash
async function fetchIpfsContent(cid: string, requestIdForDelivery?: string) {
  let url = `${gatewayUrl}${cid}`
  
  // Special handling for delivery IPFS hashes
  if (requestIdForDelivery && cid.startsWith('f01551220')) {
    // Convert hex digest to CIDv1 base32 directory CID
    const dirCid = reconstructDirectoryCid(cid)
    url = `${gatewayUrl}${dirCid}/${requestIdForDelivery}`
  }
  
  const response = await fetch(url)
  return response.json()
}
```

Without this reconstruction, the frontend will fetch binary directory structure bytes instead of the JSON file, causing recognition/reflection data to fail to load.

**Implementation Files:**
- `scripts/inspect-job-run.ts` - Reference implementation of CID reconstruction
- `frontend/explorer/src/app/api/memory-inspection/route.ts` - Frontend API with reconstruction logic
- Both use identical base32 encoding algorithm for directory CID reconstruction

---

## MCP tool references

### list_tools
- Purpose: Discover available core CLI and MCP tools.
- Params: `{ include_parameters?: boolean, include_examples?: boolean, tool_name?: string }`
- Returns: `{ data: { total_tools, tools: [{ name, description, parameters?, examples? }] }, meta: { ok: true } }`

### get_details
- Purpose: Fetch `request` and `artifact` records via Ponder; optionally resolve IPFS content.
- Params: `{ ids: string | string[], cursor?: string, resolve_ipfs?: boolean }`
  - Request IDs: `0x...`
  - Artifact IDs: `0x<requestId>:<index>` (e.g., `0x123abc...:0`)
  - CIDs: IPFS content identifiers (e.g., `bafkreid5ebotrkenji...`, `Qm...`, `f01...`)
  - Job Definition IDs: UUID format
- Returns: Single-page response with `data` in requested order and `meta` (cursor, token estimates).

### dispatch_new_job
- Purpose: Create a new job definition and post a marketplace request on Base.
- Params: `{ jobName: string, blueprint: string, model?: string, enabledTools?: string[], message?: string, dependencies?: string[], responseTimeout?: number }`
  - `blueprint`: **REQUIRED**. JSON string containing structured assertions array. Each assertion must have: `id`, `assertion`, `examples` (with `do`/`dont` arrays), and `commentary`.
  - `model`: Gemini model to use (e.g., `'gemini-2.5-flash'`, `'gemini-2.5-pro'`). Defaults to `'gemini-2.5-flash'` if not specified.
  - `dependencies`: Optional array of job definition IDs that must complete before this job executes.
  - `responseTimeout`: Optional timeout in seconds for marketplace delivery (defaults to 300, max 300). Marketplace enforces a 5-minute hard limit.
- Returns: Mech client result plus `ipfs_gateway_url` when indexed.
- Validation: Blueprint structure is validated at dispatch time. Invalid JSON or missing required fields will return error codes: `INVALID_BLUEPRINT`, `INVALID_BLUEPRINT_STRUCTURE`.

### dispatch_existing_job
- Purpose: Dispatch a new request for an existing job definition.
- Params: `{ jobId?: string, jobName?: string, enabledTools?: string[], prompt?: string, message?: string, responseTimeout?: number }`
  - `responseTimeout`: Optional timeout in seconds for marketplace delivery (defaults to 300, max 300). Marketplace enforces a 5-minute hard limit.
- Returns: Mech client result plus `ipfs_gateway_url` when indexed.

### create_artifact
- Purpose: Upload content to IPFS.
- Params: `{ name: string, topic: string, content: string, mimeType?: string }`
- Returns: `{ cid, name, topic, contentPreview }`

**Important**: This tool does NOT write to Supabase. Artifacts are indexed by Ponder from the on-chain delivery payload. The flow is: tool → telemetry → delivery payload → Ponder indexing.

---

## Workstream Filtering (JINN-246)

The worker supports filtering jobs to only process requests within a specific workstream, enabling isolated testing and development.

### What is a Workstream?

A workstream is the complete job chain starting from a root job:
- **Root Job**: A job with no parent (`sourceRequestId: null` AND `sourceJobDefinitionId: null`)
- **Workstream ID**: The request ID of the root job
- **Child Jobs**: All jobs created via `dispatch_new_job` that trace back to the same root

### Architecture

**Ponder Indexing:**
- The `MarketplaceRequest` handler computes `workstreamId` for each request at index time
- Root jobs: `workstreamId = requestId` (they are their own root)
- Child jobs: `workstreamId = rootRequestId` (found by traversing up the `sourceRequestId` chain)
- The `workstreamId` field is indexed for efficient querying

**Worker Filtering:**
```bash
# Process all jobs in a specific workstream
yarn dev:mech --workstream=<root-request-id>

# Step through workstream jobs one at a time (debugging)
yarn dev:mech --workstream=<root-request-id> --single
```

**Frontend Integration:**
- Explorer UI uses `workstreamId` for efficient workstream views
- Replaced recursive client-side fetching with single indexed query
- Collection view supports `?workstream=<id>` URL parameter

### Use Cases

1. **Isolated Testing**: Test a specific venture without interference from other workstreams
2. **Debugging**: Step through jobs in a workstream one at a time with `--single`
3. **Parallel Workers**: Run multiple workers on different workstreams simultaneously
4. **Development**: Work on specific job chains without processing unrelated jobs

### Example Workflow

```bash
# 1. Dispatch a root job (creates a new workstream)
yarn tsx scripts/dispatch-job.ts

# Output shows: Request ID: 0x0447dd1e9931eb0b5445d62df631b59c61899ea6eeee3e0cdde89ada12aaf27d

# 2. Process only jobs in that workstream
yarn dev:mech --workstream=0x0447dd1e9931eb0b5445d62df631b59c61899ea6eeee3e0cdde89ada12aaf27d

# 3. Or step through jobs one at a time for debugging
yarn dev:mech --workstream=0x0447dd1e9931eb0b5445d62df631b59c61899ea6eeee3e0cdde89ada12aaf27d --single
```

### Implementation Files

- `ponder/ponder.schema.ts` - Added `workstreamId` field and index
- `ponder/src/index.ts` - Computes `workstreamId` during indexing via `findWorkstreamRoot()`
- `worker/mech_worker.ts` - Parses `--workstream` flag and filters GraphQL queries
- `frontend/explorer/src/lib/subgraph.ts` - Optimized workstream queries
- `frontend/explorer/src/components/collection-view.tsx` - Workstream filtering UI

### Notes

- **Reindexing Required**: Existing requests need Ponder reindexing to populate `workstreamId`
- **Production Deployment**: Changes must be deployed to Railway for production use
- **Local Testing**: Start local Ponder with `yarn ponder:dev` to test workstream filtering

---

## Typical dev flows

- Full stack dev: `yarn dev:stack` and watch worker logs.
- Inspect a request in Ponder:
  - `POST http://localhost:42069/graphql` → query `request(id: "0x...")`.
- Use MCP directly (operator tasks):
  1) Start MCP: `yarn mcp:start`
  2) In Gemini CLI, call:
     - `list_tools({ include_parameters: true })`
     - `get_details({ ids: ["0x..."], resolve_ipfs: true })`
     - `dispatch_new_job({ jobName: "...", blueprint: "{ \"assertions\": [...] }", enabledTools: ["web_fetch"] })`
     - `create_artifact({ name: "report", topic: "analysis", content: "..." })`

---

## Adding a new MCP tool

1) Create the tool in `gemini-agent/mcp/tools/your_tool.ts` with a Zod input schema and handler.
2) Export it from `gemini-agent/mcp/tools/index.ts`.
3) Register it in `gemini-agent/mcp/server.ts` (add to `serverTools`).
4) Restart MCP: `yarn mcp:start`. Verify with `list_tools({ include_parameters: true })`.

## Work Protocol Job Hierarchy

**Understanding Job Context and Hierarchy:**

The Work Protocol tracks job relationships through a sophisticated hierarchy system:

1. **Job Definition IDs**: Each job has a unique `jobDefinitionId` that persists across re-runs
2. **Source Relationships**: Child jobs reference their parent via `sourceJobDefinitionId` and `sourceRequestId`
3. **Context Fetching**: `getJobContextForDispatch` retrieves the complete hierarchy for a job

**Common Issues and Solutions:**

❌ **Wrong**: Querying requests by `sourceJobDefinitionId_in` 
- This only finds direct children, not the full hierarchy
- Root job re-runs see empty context and re-delegate infinitely

✅ **Correct**: Querying requests by `jobDefinitionId_in`
- This finds all requests for the same job definition across re-runs
- Root job re-runs can see completed children and synthesize results

**Key Architecture Points:**
- Root jobs delegate work to child jobs via `dispatch_new_job`
- Child jobs complete and create artifacts
- Root job re-runs should synthesize child artifacts into launcher briefings
- Job context includes hierarchy, summary, and available artifacts
- The system uses `jobDefinitionId` to track relationships, not `sourceJobDefinitionId`

**Verification:**
- Root job re-runs should show "Completed jobs: X" in Job Context
- Root job re-runs should finalize with `WAITING` or `COMPLETED` status
- Root job re-runs should NOT re-delegate if children already exist

---

# Project Jinn: An Autonomous, Event-Driven AI Agent System

## Overview

This project implements a sophisticated, autonomous AI agent system built on an event-driven architecture. It is designed for complex, multi-step tasks that require agents to interact with a dynamic environment, learn from their actions, and even create new tasks for themselves.

The core technologies are:
- **Node.js & TypeScript**: For the worker and agent logic.
- **Gemini CLI**: As the underlying engine for interacting with Google's Gemini models.
- **Model Context Protocol (MCP)**: For providing the agent with a secure and structured way to use tools.
- **Ponder**: For indexing on-chain events from the Mech Marketplace on Base.
- **Mech Marketplace on Base**: The on-chain job board for posting and discovering jobs.

---

## OLAS Architecture Documentation

**For comprehensive OLAS middleware integration guidance**, see `OLAS_ARCHITECTURE_GUIDE.md`:
- Complete wallet/Safe/agent key architecture
- Service lifecycle management
- Testing strategies (Tenderly, E2E)
- Common gotchas and solutions
- Recovery procedures
- Code patterns and best practices

This consolidated guide combines learnings from JINN-186, JINN-197, JINN-198, and JINN-202.

---

## On-Chain Identity & Wallet Management

To participate in decentralized ecosystems like Olas, each Jinn agent requires a secure and persistent on-chain identity. This is achieved through a Gnosis Safe smart contract wallet, which is created and managed via the `olas-operate-middleware` integration.

The core of this capability is the `OlasOperateWrapper`, which provides a TypeScript interface to the `olas-operate-middleware` HTTP server for wallet operations.

### Key Principles

-   **Middleware Integration**: Wallet and Safe creation is handled by the `olas-operate-middleware` Python service, providing standardized OLAS protocol compatibility.
-   **HTTP API Interface**: The `OlasOperateWrapper` manages the middleware's HTTP server lifecycle and provides clean TypeScript APIs for wallet operations.
-   **Secure Server Management**: The wrapper automatically starts and stops the middleware server as needed, ensuring proper resource cleanup.
-   **Environment Validation**: Comprehensive preflight checks ensure Python dependencies and middleware components are available before operations begin.

### Critical Architecture: Wallet, Safe, and Agent Keys

The middleware maintains **TWO separate key stores** that serve different purposes in the OLAS service lifecycle:

#### **1. Master Wallet (EOA)**
- **Location**: `olas-operate-middleware/.operate/wallets/`
- **Format**: Encrypted JSON keystore (one per chain, e.g., `ethereum.txt`, `base.txt`)
- **Encryption**: Uses `OPERATE_PASSWORD` environment variable
- **Purpose**: 
  - Creates and deploys Gnosis Safes (pays gas for Safe deployment)
  - Controls Safes during creation phase
  - Acts as the transaction submitter for Safe operations
- **Persistence**: Must be preserved on mainnet to maintain access to created Safes

#### **2. Agent Keys**
- **Location**: `olas-operate-middleware/.operate/keys/`
- **Format**: Plain JSON with private keys (e.g., `0xABCD1234...json`)
- **Storage**: Global directory, shared across all services
- **Purpose**:
  - Become the **signers** on Safe multisigs (1/1 configuration)
  - Sign transactions from within the Safe
  - Execute service operations on behalf of the Safe
- **Lifecycle**: 
  - Created when service is created (`ServiceManager.create()`)
  - Survive service deletion (stored globally, not per-service)
  - Can be reused across service deployments

#### **Service → Safe → Agent Key Relationship**

```
Service Creation Flow:
1. create service → generates new agent key in /.operate/keys/
2. deploy service → creates NEW Safe with agent key as signer
3. Safe configured as 1/1 multisig with agent key
4. Service runs using agent key to sign transactions from Safe

CRITICAL: Each service deployment creates a NEW Safe, even with same master wallet
```

**Key Architectural Facts:**
- ✅ Agent keys are stored globally in `/.operate/keys/` (survive service deletion)
- ✅ Master wallet creates multiple Safes (one per service deployment)
- ✅ Each Safe is independent with its own agent key signer
- ✅ Deleting a service does NOT delete the agent keys
- ✅ Safes can be recovered using agent private keys from `/.operate/keys/`

**Security Model:**
- **Master Wallet**: Encrypted, requires password, creates Safes
- **Agent Keys**: Plain JSON (protected by filesystem permissions), sign from Safes
- **Safe**: On-chain smart contract, controlled by agent key
- **Service**: Off-chain configuration referencing Safe and agent key

**Recovery Procedures:**
If funds are locked in a Safe:
1. Locate agent key in `/.operate/keys/AGENT_ADDRESS`
2. Extract private key from JSON file
3. Import key into MetaMask or other wallet
4. Access Safe via https://app.safe.global/
5. Transfer funds to desired destination

**Documentation:**
- Full architecture: `ARCHITECTURE_WALLET_SAFES.md`
- Safety procedures: `MAINNET_SAFETY.md`
- Incident report: `SAFETY_IMPROVEMENTS_SUMMARY.md`

### The Bootstrap Process

When setting up a new service, the system creates a hierarchical wallet structure:

1.  **Master Wallet (EOA)**: Created first, requires initial ETH funding (~0.002 ETH for gas)
2.  **Master Safe**: Deployed by Master Wallet, requires ETH + OLAS funding (~0.002 ETH + 100 OLAS)
3.  **Agent Key**: Generated when service is created, stored in `/.operate/keys/`
4.  **Service Safe**: Deployed by Master Safe, requires ETH + OLAS funding (~0.001 ETH + 50 OLAS)

**Interactive Setup Wizard (JINN-202)**: Use `yarn setup:service` for a guided setup using the middleware's native attended mode:

```bash
# Interactive service setup on Base mainnet
yarn setup:service --chain=base

# With mech deployment
yarn setup:service --chain=base --with-mech

# Other supported chains
yarn setup:service --chain=gnosis
yarn setup:service --chain=mode
yarn setup:service --chain=optimism
```

**How it works:**
- The middleware detects or reuses existing Master EOA/Safe
- Shows **native funding prompts** when addresses need funding
- Displays exact amounts needed with real-time waiting indicators
- **Auto-continues** when funding is detected (no manual "continue" needed)
- Handles the complete lifecycle in one atomic operation
- Total time: 5-10 minutes depending on transfer confirmation speed

**Key Features:**
- ✅ Single command for complete setup
- ✅ Native middleware prompts (battle-tested in olas-operate-app)
- ✅ Automatic balance polling and verification
- ✅ Clear error messages and recovery guidance
- ✅ Can interrupt with Ctrl+C (auto-cleanup on next run)
- ✅ Saves all addresses and configuration for reference

**Example Output:**
```
🚀 Starting quickstart in attended mode...

Pearl Trader quickstart
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Master EOA exists: 0xB151...
✓ Master Safe exists: 0x15aD...

[base] Creating Agent Key...
✓ Agent Key: 0x9876...

[base] Please transfer at least 0.001 ETH to Agent Key 0x9876...
⠋ [base] Waiting for 0.001 ETH... (0.001 ETH remaining)

[User funds address → auto-continues]

✓ Service Safe deployed: 0x1234...
[base] Please transfer at least 50.0 OLAS to Service Safe 0x1234...

[User funds address → auto-continues]

✅ SETUP COMPLETED SUCCESSFULLY
```

**Troubleshooting:**
- Common issues: See [docs/TROUBLESHOOTING_INTERACTIVE_SETUP.md](docs/TROUBLESHOOTING_INTERACTIVE_SETUP.md)
- Recovery procedures: Auto-cleanup handles interrupted setups
- Getting help: Include full error output and on-chain state

**IMPORTANT**: On mainnet, wallet state must be preserved between runs. The validation scripts include comprehensive safety checks to prevent accidental wallet deletion and warn about new Safe creation.

### Testing on Tenderly Virtual TestNet (JINN-204)

For cost-free testing before mainnet deployment, use Tenderly Virtual TestNets:

**Automated testing (recommended):**
```bash
# Full integration test (staking + mech)
yarn test:tenderly

# Test staking only
yarn test:tenderly --no-mech

# Test mech only
yarn test:tenderly --no-staking

# Baseline test (neither)
yarn test:tenderly --baseline
```

The automated script will:
1. Create a Tenderly Virtual TestNet (forked Base mainnet)
2. Update `env.tenderly` with VNet credentials
3. Deploy service with specified configuration
4. Verify staking state on-chain (if enabled)
5. Display Tenderly dashboard link for transaction inspection

**Manual testing:**
```bash
# 1. Setup Tenderly credentials in env.tenderly
cp env.tenderly.template env.tenderly
# Edit with your Tenderly API key and project details

# 2. Create Virtual TestNet
source env.tenderly
yarn tsx scripts/setup-tenderly-vnet.ts

# 3. Export VNet RPC URL (shown in script output)
# For test deployments, use `.env.test` and the `--testnet` flag with the setup CLI.
export TENDERLY_RPC_URL="<vnet-rpc-url>"
export RPC_URL="$TENDERLY_RPC_URL"

# 4. Run service setup
yarn setup:service --chain=base --with-mech
```

**Benefits:**
- ✅ Zero cost (no real ETH/OLAS needed)
- ✅ Instant transactions (no waiting for confirmations)
- ✅ Complete transaction visibility in Tenderly dashboard
- ✅ Safe testing environment (can't lose real funds)
- ✅ Repeatable (delete VNet and create new one)

**View test results:**
- Tenderly Dashboard: `https://dashboard.tenderly.co/{account}/{project}/virtual-testnets/{vnet-id}`
- Inspect all transactions, state changes, and gas usage
- Debug reverts with detailed stack traces

**IMPORTANT**: On mainnet, wallet state must be preserved between runs. The validation scripts include comprehensive safety checks to prevent accidental wallet deletion and warn about new Safe creation.

### Recovering Funds from Failed Deployments

If a service deployment fails partway through, funds may be stranded in agent EOAs or Service Safes. The system includes automated recovery procedures:

#### **Automatic Cleanup**
- Corrupt services (missing config, null Safe address, unminted tokens) are auto-deleted on next run
- No manual intervention needed for service state cleanup
- Agent keys are preserved in `/.operate/keys/` (never deleted)

#### **Fund Recovery Script (Agent EOAs)**
For stranded OLAS tokens in agent EOAs:

```bash
# Edit scripts/recover-stranded-olas.ts to add agent addresses/keys
# Keys are in: olas-operate-middleware/.operate/keys/AGENT_ADDRESS
yarn tsx scripts/recover-stranded-olas.ts
```

**The script:**
1. Checks OLAS balance in each agent EOA
2. Estimates gas for transfer
3. Sends OLAS back to Master Safe
4. Includes 3-second delays to avoid RPC rate limiting

**Example output:**
```
🔄 OLAS Recovery Script

Master Safe: 0x15aDF0eD29b6D76DB365670DfEeD8F9C5dAD4645
OLAS Token: 0x54330d28ca3357F294334BDC454a032e7f353416

📍 Agent: 0x38bE2396d43a157eEDCF1d3d63f5F074053180D0
   Balance: 50.0 OLAS
   ETH Balance: 0.0005 ETH
   🚀 Sending 50.0 OLAS to Master Safe...
   ✅ Success! Recovered 50.0 OLAS

📊 Recovery Summary:
   ✅ Successful: 1
   💰 Total Recovered: 50.0 OLAS
```

#### **Checking for Stranded Funds**
To scan all agent keys for OLAS balances:

```bash
yarn tsx scripts/check-agent-balances.ts
```

**The script:**
1. Scans all agent keys in `olas-operate-middleware/.operate/keys/`
2. Checks OLAS balance for each
3. Includes rate limiting delays
4. Reports summary of stranded funds

**Example output:**
```
🔍 Checking OLAS balances in agent keys...

Found 5 agent keys

═══════════════════════════════════════════════════════════════════
✅ 0x38bE2396d43a157eEDCF1d3d63f5F074053180D0: 50.0 OLAS
   0x1234567890abcdef1234567890abcdef12345678: 0 OLAS
═══════════════════════════════════════════════════════════════════

📊 Summary:
   Agents with OLAS: 1/5
   Total OLAS: 50.0 OLAS

⚠️  Stranded OLAS found! Consider running scripts/recover-stranded-olas.ts
```

#### **Recovery from Service Safes**
Service Safes are Gnosis Safe multisigs (1/1 with agent key as signer). Two methods available:

**Method 1: Programmatic Recovery (Recommended for RPC reliability)**
```bash
# Edit scripts/recover-from-service-safe.ts to set:
# - SERVICE_SAFE address
# - AGENT_KEY_PRIVATE_KEY (from /.operate/keys/)
# - AGENT_KEY_ADDRESS
yarn tsx scripts/recover-from-service-safe.ts
```

**The script:**
1. Verifies agent key is Safe owner
2. Checks OLAS balance in Service Safe
3. Constructs and signs Safe transaction
4. Transfers OLAS to Master Safe
5. Falls back to Safe UI instructions if signature fails

**Note:** If RPC is rate-limited, the script will provide Safe UI instructions.

**Method 2: Manual Recovery via Safe UI** (Most reliable)

1. **Find the agent key**:
   ```bash
   ls olas-operate-middleware/.operate/keys/
   cat olas-operate-middleware/.operate/keys/0xAGENT_ADDRESS
   ```

2. **Extract the private key** from the JSON file

3. **Import to MetaMask**:
   - MetaMask → Import Account → Paste private key

4. **Access the Safe**:
   - Go to https://app.safe.global/
   - Connect MetaMask (now controls the Safe as 1/1 multisig)
   - Switch to Base network
   - Load the Service Safe address (or use direct URL):
     ```
     https://app.safe.global/home?safe=base:SERVICE_SAFE_ADDRESS
     ```

5. **Transfer funds**:
   - New Transaction → Send tokens
   - Select OLAS token
   - Enter amount and Master Safe address
   - Sign with MetaMask (agent key)
   - Execute transaction

**Master Safe Address (Base)**: `0x15aDF0eD29b6D76DB365670DfEeD8F9C5dAD4645`

**Example Recovery Session:**
```
# Step 1: Check which services have funds
yarn tsx scripts/check-agent-balances.ts

# Step 2: Recover from agent EOAs
yarn tsx scripts/recover-stranded-olas.ts

# Step 3: Identify Service Safes (from middleware config)
grep -r "multisig" olas-operate-middleware/.operate/services/*/config.json

# Step 4: Recover from Service Safes
# Option A: Programmatic (if RPC is healthy)
yarn tsx scripts/recover-from-service-safe.ts

# Option B: Safe UI (if RPC rate-limited)
# Use instructions above with Safe UI
```

#### **Prevention**
To minimize failed deployments:
- Ensure Master Safe has sufficient OLAS (100+ OLAS recommended)
- Use QuickNode or reliable RPC provider (avoid rate limits)
- Don't interrupt during "Deploying service on-chain" phase
- Monitor middleware output for funding prompts

#### **Service Backups**
Before deleting or re-deploying a service, back up the configuration:

```bash
# Backup service config
mkdir -p service-backups
cp -r olas-operate-middleware/.operate/services/SERVICE_ID \
      service-backups/SERVICE_ID-$(date +%Y%m%d-%H%M%S)
```

**Backups preserve:**
- Service configuration (`config.json`)
- Deployment artifacts (Docker Compose files)
- SSL certificates
- Persistent data (if any)
- Service metadata

**To restore a backup:**
```bash
cp -r service-backups/SERVICE_ID-TIMESTAMP \
      olas-operate-middleware/.operate/services/SERVICE_ID
```

**Existing backups:**
- `service-backups/service-158-20251001-185810/` - Service 158 with mech `0x436FC548d0cF78A71852756E9b4dD53077d2B06c` (middleware crashed after mech deployment)

**See also:**
- Full architecture: `ARCHITECTURE_WALLET_SAFES.md`
- Safety procedures: `MAINNET_SAFETY.md`
- Recovery script: `scripts/recover-stranded-olas.ts`

## Architectural Philosophy

The design of this system is guided by a few core principles:

-   **On-Chain First**: The system is designed around a public, on-chain job marketplace. The blockchain is the source of truth for job requests and deliveries.
-   **Secure and Auditable Writes**: All data written to our off-chain database in relation to an on-chain job is processed through a secure gateway, the Control API. This enforces data integrity, injects lineage, and provides a clear audit trail.
-   **Lean Workers, Smart Agents**: The `worker` is a simple, stateless executor. Its only job is to poll for work, execute it, and report back. The core intelligence resides in the `Agent` class, which handles LLM interaction, and the `metacog-mcp` tools, which provide the agent with its capabilities.
-   **Tools Over Prompts for Dynamic Context**: Prompts should guide the agent's reasoning process and define its high-level goals. They should not be cluttered with dynamic information (like file lists, database schemas, or tool definitions). Instead, prompts should instruct the agent to *use tools* to discover that information from its environment. This makes prompts more stable, reusable, and focused on reasoning.

---

## Project Structure

The repository has been flattened for simplicity and easier development. Here's the current structure:

```
jinn-gemini/
├── control-api/              # NEW: The secure GraphQL write gateway
├── worker/                     # Worker application
│   ├── mech_worker.ts        # The on-chain mech worker
│   ├── OlasStakingManager.ts # OLAS token staking manager
│   ├── StakingManagerFactory.ts # Factory for staking manager initialization
│   └── DelayUtils.ts         # Utility functions for worker delays
├── gemini-agent/             # Agent and MCP server
│   ├── agent.ts              # Main agent logic
│   ├── mcp/                  # Model Context Protocol server
│   │   ├── server.ts         # MCP server implementation
│   │   └── tools/            # Tool implementations
│   │       ├── shared/       # Shared utilities
│   │       ├── index.ts      # Tool exports
│   │       └── *.ts          # Individual tool files
│   └── settings.template.json # Gemini CLI settings template
├── ponder/                   # NEW: Ponder project for indexing on-chain events
├── frontend/                 # Frontend application
│   └── explorer/             # Next.js explorer interface
├── docs/                     # Documentation
│   └── documentation/        # System documentation
├── migrations/               # Database migrations
├── supabase/                 # Supabase configuration
├── scripts/                  # Utility scripts
└── package.json              # Root package configuration
```

## System Architecture

The system consists of five key layers that work together in a continuous loop.

1.  **On-Chain Layer (Mech Marketplace):** The decentralized source of truth for all jobs. `Request` and `Deliver` events on the Base blockchain define the work to be done and its final status.
2.  **Indexing Layer (Ponder):** A dedicated service that listens to the Mech Marketplace contract, indexes its events, and provides a fast, reliable GraphQL API for reading on-chain data. This is the primary way the system discovers new work.
3.  **Worker Layer (`worker/mech_worker.ts`):** The engine of the system. This is the only active worker. It polls the Ponder API to find new `Request` events, executes the associated tasks by invoking the Jinn agent, and delivers the results back to the blockchain.
4.  **Secure Write Layer (Jinn Control API):** A mandatory GraphQL gateway for all database writes related to on-chain jobs. The worker and agent tools **do not** write directly to the database. They call this API, which validates the request, injects critical lineage data (like the `request_id` and `worker_address`), and then performs the database operation. This ensures all off-chain data is consistent and securely linked to its on-chain origin.
5.  **Persistence Layer (Supabase):** The off-chain database, now used exclusively for storing supplementary data like job reports, artifacts, and messages in `onchain_*` tables. All writes are managed by the Control API.

### OLAS Service Management Integration

The system includes comprehensive OLAS (Open Autonomy) protocol integration for autonomous service creation and staking through the `olas-operate-middleware`:

#### **Core Components**
-   **OlasServiceManager**: High-level service lifecycle management including mech deployment for marketplace participation
-   **OlasOperateWrapper**: TypeScript wrapper providing a clean interface to the Python middleware
-   **OlasStakingManager**: Orchestrates automated OLAS staking operations and mech deployment via service lifecycle
-   **StakingManagerFactory**: Factory for initializing staking managers with proper dependency injection
-   **ServiceConfig & MechConfig**: Centralized configuration utilities for service and mech deployment settings

#### **Key Features**
-   **Middleware-Based Architecture**: All service operations delegate to the battle-tested `olas-operate-middleware` CLI
-   **Complete Service Lifecycle**: Full automation of deploy/stake/deploy-mech/claim/terminate operations via CLI commands
-   **Integrated Mech Deployment (JINN-198)**: Automated mech deployment during service creation with `deployMech` option
-   **Mech Marketplace Integration**: Automated mech deployment for marketplace participation with persistent address tracking
-   **Multi-Chain Support**: Base network support for mech factory contracts and marketplace operations
-   **CLI Flag Compatibility**: Graceful fallback for unsupported flags across different middleware versions
-   **Accurate Status Reporting**: Real-time service status queries via the middleware's status commands
-   **Environment Flexibility**: Optional configuration with intelligent defaults for missing environment variables
-   **Lazy Initialization**: Service managers initialize on-demand to prevent startup failures
-   **Comprehensive Error Handling**: Robust error handling with detailed logging and recovery mechanisms

#### **Architecture (Updated)**
```
Jinn Worker (TypeScript)
    ↓
OlasStakingManager (Lazy Initialization)
    ↓
OlasServiceManager (CLI Delegation)
    ↓
OlasOperateWrapper (Python CLI Interface)
    ↓
olas-operate-middleware (Python CLI)
    ↓
OLAS Protocol Contracts
```

#### **Security Model (Simplified)**
- **CLI-Based Execution**: All operations delegate to the trusted `olas-operate-middleware` CLI
- **Process Isolation**: Service operations run in isolated Python processes with timeout protection
- **Comprehensive Validation**: Environment validation and health checks before operations
- **Audit Trail**: Structured logging of all CLI operations and their outcomes
- **Graceful Degradation**: System continues operation even if OLAS components fail during initialization

#### **Setup Requirements (Simplified)**
- Environment variables for Base network contract addresses:
  - `OLAS_AGENT_REGISTRY_ADDRESS_BASE`
  - `OLAS_SERVICE_REGISTRY_ADDRESS_BASE`
  - `OLAS_STAKING_CONTRACT_ADDRESS_BASE`
  - `RPC_URL` for Base network access

#### **OLAS Staking Integration**
The system provides automated OLAS staking through:
-   **Timed Triggers**: Hourly execution in the main worker loop
-   **Service Lifecycle Progression**: Automated advancement through agent registration, service creation, activation, and staking
-   **Graceful Degradation**: Worker continues operation if staking components fail during initialization
-   **Flexible Configuration**: Dependency injection support for testing and custom deployments

For detailed setup instructions, see `docs/implementation/OLAS_MIDDLEWARE_SETUP.md`.

#### **Mech Deployment During Service Creation (JINN-198)**

Services can now have mechs deployed automatically during creation by passing the `deployMech` option:

```typescript
const serviceInfo = await serviceManager.deployAndStakeService(undefined, {
  deployMech: true,
  mechType: 'Native', // 'Native' | 'Token' | 'Nevermined'
  mechRequestPrice: '10000000000000000', // 0.01 ETH in wei
  mechMarketplaceAddress: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020' // Base mainnet
});

console.log(`Mech deployed: ${serviceInfo.mechAddress}`);
console.log(`Agent ID: ${serviceInfo.agentId}`);
```

**How it works:**
1. The service manager injects mech environment variables into the service config before deployment
2. The middleware detects empty `AGENT_ID` and `MECH_TO_CONFIG` env vars
3. The middleware's `deploy_mech()` function is called automatically during service deployment
4. The mech address and agent ID are returned in the service info

**Configuration:**
- **mechType**: Type of mech contract (`'Native'` default)
- **mechRequestPrice**: Price per request in wei (`'10000000000000000'` = 0.01 ETH default)
- **mechMarketplaceAddress**: MechMarketplace contract address (Base mainnet: `'0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020'`)

**Testing:**
```bash
yarn test:jinn-198  # Run E2E mech deployment test on Tenderly
```

#### **IPFS Integration (JINN-210)**

The system uses Autonolas IPFS infrastructure for all request/delivery content storage:

**Upload (Registry)**
- **Endpoint**: `https://registry.autonolas.tech/api/v0/add`
- **Usage**: Uploads request prompts and delivery results
- **Format**: Wrap-with-directory disabled, CIDv1
- **Implementation**: `packages/mech-client-ts/src/ipfs.ts` → `pushMetadataToIpfs()`

**Download (Gateway)**
- **Default**: `https://gateway.autonolas.tech/ipfs/`
- **Configurable**: Set `IPFS_GATEWAY_URL` env var
- **Fallback**: Can use any public IPFS gateway (`dweb.link`, `ipfs.io`)
- **Timeout**: Configurable via `IPFS_FETCH_TIMEOUT_MS` (default: 7000ms)

**Architecture**:
1. **Request Submission**: Prompt uploaded to Autonolas registry, hash stored on-chain
2. **Worker Fetch**: Worker retrieves prompt from gateway using IPFS hash from chain
3. **Result Upload**: Delivery result uploaded to registry, hash stored on-chain
4. **Network Distribution**: Content propagates across IPFS network, accessible from any gateway

**Important Notes**:
- Dedicated IPFS gateways (QuickNode, Pinata) only serve their own pinned content
- Autonolas gateway can retrieve content from the broader IPFS network
- ISP-level DNS filtering may block some gateways (use public DNS like 8.8.8.8)

#### **E2E Testing Infrastructure**
The system includes comprehensive end-to-end testing for OLAS service staking operations:

- **Automated Environment Setup**: The `yarn setup:dev` command automatically configures Python/Poetry environments and handles pyenv compatibility
- **Service Lifecycle Testing**: Full E2E tests verify the complete service lifecycle (setup → deploy → stake → claim → terminate) using real Tenderly Virtual TestNets
- **Environment Validation**: Tests require proper environment configuration including `OPERATE_PASSWORD` and Base network RPC settings
- **Utility Functions**: Extracted common testing utilities to `scripts/lib/e2e-test-utils.ts` for reusable service configuration and environment setup
- **Robust Error Handling**: Tests properly validate middleware responses and provide clear failure diagnostics

The E2E test suite serves as both validation and documentation of the OLAS integration, ensuring the service lifecycle works correctly in realistic blockchain environments.

---

## Constants
- Supabase project ID is: clnwgxgvmnrkwqdblqgf
- **Tenderly**: Use Virtual Testnets (vnets), NOT deprecated forks. API endpoint: `/testnet/container`

---

## The Lifecycle of a Job

The entire system operates on a continuous, on-chain, event-driven cycle:

1.  **Job Creation**: An agent calls the `dispatch_new_job` tool, which posts a `Request` event to the Mech Marketplace contract on the Base blockchain. The request's metadata (prompt, tools) is stored on IPFS.
2.  **Indexing**: The `Ponder` service indexes the new `Request` event and makes it available via its GraphQL API.
3.  **Discovery & Claim**: The `mech_worker` polls the Ponder API, discovers the new `Request`, and calls the **Jinn Control API** to atomically claim it. The Control API creates a record in the `onchain_request_claims` table, preventing other workers from processing the same job.
4.  **Execution**: The worker invokes the `Agent`, passing the on-chain `requestId` and `mechAddress` as environment variables (`JINN_REQUEST_ID`, `JINN_MECH_ADDRESS`). The agent fetches the prompt from IPFS and begins execution using its enabled tools.
5.  **Telemetry Collection**: During execution, when an agent uses a tool (e.g., `create_artifact`), the tool's output (like an IPFS CID) is captured in the agent's structured telemetry log. The tools themselves do not have credentials to write to any database or API.
6.  **Off-Chain Reporting (by Worker)**: After the agent run is complete, the **worker** parses the execution telemetry. It is the worker's responsibility to call the **Jinn Control API** to persist records like artifacts and job reports. The Control API validates and links this data to the on-chain `request_id`. This ensures that all off-chain writes are securely orchestrated by the trusted worker, not the agent.
7.  **Delivery**: The worker calls `deliverViaSafe` to submit the IPFS hash of the final result to the Mech Marketplace contract on-chain. This creates a `Deliver` event.
8.  **Completion Indexing**: Ponder indexes the `Deliver` event, marking the job as complete on-chain and indexing any artifacts included in the delivery payload.
9.  **Completion**: Ponder indexes the `Deliver` event, marking the job as complete on-chain.

---

## Context Management Architecture

The system provides three key mechanisms for managing job context:

### 1. Blueprint-Driven Execution
Jobs receive structured blueprints as their primary specification. Each blueprint contains assertions with:
- Declarative requirement statements
- Positive and negative examples (`do`/`dont`)
- Commentary explaining the rationale

Blueprints are stored at the root level of IPFS metadata and passed directly to agents, eliminating external artifact search overhead.

### 2. Dependency Management
Jobs can specify prerequisite job definitions that must complete before execution:
```typescript
dispatch_new_job({
  jobName: 'deploy-app',
  dependencies: ['<build-job-def-id>', '<test-job-def-id>'],
  // ...
})
```

The worker enforces dependencies using recursive completion checking - a job definition is considered complete only when all of its requests and their dependencies are delivered.

### 3. Progress Checkpointing (Recognition Phase)
For jobs in a workstream, the recognition phase builds a progress checkpoint by:
1. Querying completed jobs in the workstream via Ponder
2. Fetching delivery summaries from IPFS
3. Using AI to generate a concise progress summary
4. Injecting the summary into the agent's context

This enables later jobs to understand prior work without manual coordination.

---

## Legacy Context Management (Deprecated)

**NOTE:** The features described below were part of the legacy, database-centric architecture. They are not yet implemented in the new on-chain system but are preserved here as a reference for future development.

The legacy system provided agents with comprehensive operational context through two key mechanisms:

### **Trigger Context (`trigger_context`)**
Rich information about what triggered the job, including:
- **Event Details**: Complete event information (ID, type, payload, source)
- **Resolved Source Data**: Enhanced context from the event's source:
  - **Artifacts**: Full content, topic, status, and metadata
  - **Job Board Entries**: Job execution details, outputs, and related data
  - **Events**: Parent event relationships and correlation IDs
  - **Other Sources**: Table-specific data resolution

### **Delegated Work Context (`delegated_work_context`)**
Comprehensive summaries of work delegated to child jobs, including:
- **Child Job Summaries**: ID, name, output, status, completion time
- **Job Definition IDs**: Complete traceability back to job definitions
- **Artifacts**: Related artifacts created by child jobs (with content truncation)
- **Job Reports**: Performance metrics and final outputs
- **Timing Filtering**: Only work completed after parent's last execution
- **Statistical Overview**: Total counts, completion rates, and timing information

### **Context Integration in Worker**
The worker now constructs enhanced prompts that preserve all existing elements while adding:
- **Job Header**: Basic job identification and context
- **Input**: Original job prompt and instructions
- **Inbox**: Recent messages and communications
- **Trigger Context**: Rich information about what caused the job
- **Delegated Work Context**: Comprehensive summaries of delegated work
- **Recent Runs Context**: Summaries of recent executions for the same job definition (when available)

This ensures agents have the foundation they need to make informed decisions and take effective action without losing any existing functionality.

---

## Getting Started

### Prerequisites
- Node.js and Yarn
- A Supabase project
- Gemini CLI installed and authenticated on your host machine
- (Optional) Tenderly account for cost-free testing

### 1. Setup
1.  **Install Dependencies**:
    ```bash
    yarn install
    ```
2.  **Configure Environment**:
    Create a `.env` file in the root directory with your Supabase credentials:
    ```env
    SUPABASE_URL=https://clnwgxgvmnrkwqdblqgf.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
    ```
3.  **Gemini CLI Authentication**:
    Ensure you have authenticated the Gemini CLI on your host machine first.

### 2. Building the System
Build all components (worker, MCP server, and frontend):
```bash
yarn build
yarn frontend:build
```

### 3. Testing OLAS Integration (Optional)

Before deploying to mainnet, test the complete OLAS integration on Tenderly:

```bash
# Test full integration (staking + mech) on Tenderly Virtual TestNet
yarn test:tenderly

# This will:
# 1. Create a cost-free simulated Base mainnet environment
# 2. Deploy and stake service automatically
# 3. Deploy mech contract
# 4. Verify everything on-chain
# 5. Show results with dashboard link

# Other test scenarios:
yarn test:tenderly --no-mech      # Test staking only
yarn test:tenderly --no-staking   # Test mech only
yarn test:tenderly --baseline     # Test baseline deployment
```

See **Testing on Tenderly Virtual TestNet** section above for details.

### 4. Running the System

#### Development Mode (Recommended)
Start both the worker and frontend in development mode:
```bash
yarn dev:all
```

This will start:
- **Worker**: Processing jobs with hot reload
- **Frontend**: Available at http://localhost:3000

#### Individual Services
```bash
# Worker only
yarn dev

# Frontend only
yarn frontend:dev

# Both services
yarn dev:all
```

#### Production Mode
```bash
# Build everything first
yarn build
yarn frontend:build

# Start both services in production mode
yarn start:all
```

#### Running a Single Job (Testing/Debugging)

For testing or debugging specific requests, the worker supports processing individual jobs by request ID:

```bash
# Process a specific on-chain request
MECH_TARGET_REQUEST_ID=0x1234... yarn mech

# Single-shot mode (exit after one job)
yarn dev:mech --single
# or
yarn dev:mech --single-job
```

**Environment Variables:**
- `MECH_TARGET_REQUEST_ID`: Specify exact request ID to process (bypasses polling)
- `--single` or `--single-job`: Exit after processing one job instead of continuous polling

**Use Cases:**
- Testing memory system with specific jobs
- Debugging failed requests
- Replaying completed jobs (useful for development)
- Integration testing without waiting for new on-chain requests

**Example: Test Memory System Integration**
```bash
# 1. Find a completed request ID from Ponder
# 2. Run worker in single-shot mode with that request
MECH_TARGET_REQUEST_ID=0xabcd1234... yarn dev:mech --single

# 3. Check logs for memory injection and reflection
tail -f /tmp/mech.log | grep -E "reflection|memory|MEMORY"
```

### 5. Viewing Logs and Monitoring
- **Worker logs**: Displayed in the console where you run the command
- **Frontend**: Access at http://localhost:3000 to explore data and job reports
- **Database**: Check Supabase dashboard for job status and reports

### 6. Git Worktree Development Setup

For development using git worktrees (recommended for parallel feature development), the system includes automated environment setup:

```bash
# Quick setup for new worktrees
yarn setup:dev
```

This automated setup script:
- Initializes git submodules (including olas-operate-middleware)
- Sets up Python environment with AEA framework dependencies
- Installs Node.js dependencies across all workspaces
- Creates `.env` file from template with inline documentation
- Validates environment and provides actionable feedback

**Additional setup commands:**
```bash
yarn setup:python    # Python environment only
yarn qa:jinn-179      # Comprehensive environment validation
```

For detailed setup instructions and troubleshooting, see `SETUP.md`.

---

## Development Guide

### Available Scripts

#### Build Commands
```bash
yarn build          # Build worker and MCP server
yarn frontend:build # Build frontend only
yarn clean          # Clean build artifacts
```

#### Development Commands
```bash
yarn dev:mech       # Start mech worker only
yarn frontend:dev   # Start frontend only
yarn dev:all        # Start both worker and frontend (recommended)
```

#### Production Commands
```bash
yarn mech           # Start mech worker only
yarn frontend:start # Start frontend only
yarn start:all      # Start both worker and frontend
```

#### Testing Commands
```bash
yarn test                    # Run all tests
yarn test:coverage           # Run tests with coverage
cd frontend/explorer && yarn test  # Run frontend tests only
```

### Running Services Locally
For easier development, you can run the MCP server or the worker directly on your host machine.

-   **Run the MCP Server**:
    ```bash
    yarn mcp:start
    ```
-   **Run the Worker**:
    ```bash
    yarn mech
    ```
-   **Run the Frontend**:
    ```bash
    yarn frontend:dev
    ```

### Adding a New Tool
1.  **Create Tool File**: Add a new file in `gemini-agent/mcp/tools/`.
2.  **Define Schema**: Use Zod to define the input parameter schema for your tool.
3.  **Implement Logic**: Write the tool's function. For any writes related to on-chain jobs, the tool **must** use the client in `worker/control_api_client.ts` to interact with the Jinn Control API. Direct database access is prohibited for on-chain workflows.
4.  **Register Tool**: In `gemini-agent/mcp/server.ts`, import your new tool and add it to the `serverTools` array. The tool name will be automatically prefixed with `mcp_`. The tool will be automatically discoverable by the `list_tools` tool.

### Job Context Injection

**NOTE:** The context injection described below was part of the legacy system. The new on-chain worker injects a simpler context (`JINN_REQUEST_ID` and `JINN_MECH_ADDRESS`) directly as environment variables. This section is preserved as a reference for planned future enhancements.

When the worker executes a job, it passes a job context to the MCP tool layer. This context is available to tools and is automatically injected into writes where appropriate.

- Fields provided in job context:
  - `job_definition_id`: The definition/version ID from `jobs.id` that the run references.
  - `job_name`: The human‑readable job name from the job definition.
  - `project_run_id`: The resolved project scope for the job, when available.

- Auto‑injection behavior in tools:
  - `create_record` automatically adds `source_job_id`, `source_job_name`, `project_run_id`, and `job_definition_id` to the payload it sends to the database function. The database validates and writes only columns that exist on the target table.
  - This ensures durable lineage across core tables (`artifacts`, `job_reports`, `messages`, and `project_runs`) linking records back to the exact job definition and run that produced them.

### Shared Context Manager for tool outputs
All read/search tools now use a shared module to ensure consistent, token‑budgeted, single‑page responses with pagination and transparent metadata.

- Module: `gemini-agent/mcp/tools/shared/context-management.ts`
- Defaults:
  - Per‑page token budget: 50,000 tokens
  - Warning threshold: 500,000 tokens for full (truncated) results
- Response shape: `{ data: [...], meta: { requested?, tokens, has_more, next_cursor?, warnings? } }`
- Pagination: Cursor-based (opaque), stateless. Tools accept an optional `cursor` input; pass `meta.next_cursor` to fetch the next page.
- Truncation:
  - Field‑aware truncation only where appropriate (e.g., `content`, `output`, sometimes `summary`/`description`).
  - The `get_details` tool does not truncate by default.

Exposed helpers:
- `composeSinglePageResponse(items, options)` builds one page under the token budget; computes full token estimate; emits warnings if needed.
  - Options: `{ startOffset?, truncateChars?, truncationPolicy?, requestedMeta? }`
- `decodeCursor(cursor)` / `encodeCursor(keyset)`
- `deepTruncateByField(obj, policy)` and `deepTruncateStrings(obj, maxChars)`

#### Using the context manager in a new tool
```ts
import { supabase } from './shared/supabase.js';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

export async function myTool(params: { cursor?: string }) {
  // 1) Decode cursor -> offset (phase 1 uses simple offset pagination)
  const keyset = decodeCursor<{ offset: number }>(params.cursor) ?? { offset: 0 };

  // 2) Fetch full result set for now (phase 1); per-page truncation happens in memory
  const { data, error } = await supabase.rpc('some_backend_function', { /* filters */ });
  if (error) throw error;

  // 3) Build a single page under the shared 50k token budget
  const composed = composeSinglePageResponse(data, {
    startOffset: keyset.offset,
    // Provide truncationPolicy only if the tool should trim heavy string fields
    // e.g., { content: 1000, output: 1000 }
    requestedMeta: { cursor: params.cursor }
  });

  // 4) Return data first, then meta
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }, null, 2) }]
  };
}
```

### Key Awareness Tools

#### `get_context_snapshot`
The `get_context_snapshot` tool is a powerful system analysis tool designed for agents to understand the current state of the system. Key features:

- Time window: `hours_back` (default 6). No internal max cap.
- Pagination: Returns a single page (50k‑token budget). Use `meta.next_cursor` to continue.
- Truncation: Field‑aware on heavy fields only (e.g., `output`, `content`).
- Metadata: Includes page token count, full (truncated) token estimate, `has_more`, and `next_cursor`.

Usage Examples:
```javascript
// Basic snapshot (6‑hour window)
get_context_snapshot({})

// Extended analysis with specific time window
get_context_snapshot({ hours_back: 10 })

// Job‑specific view with detailed messages
get_context_snapshot({ job_name: "data_analysis_job", hours_back: 8 })
```

#### `get_project_summary`
The `get_project_summary` tool is designed for project leads to review the outcomes of their delegated work. Key features:

- **Automatic Context**: Automatically infers the project context from the current job, requiring no parameters
- **Output-Focused**: Returns artifacts and outputs from recent project runs, not implementation details
- **Context Management**: Uses built-in pagination and token management to prevent context overflow
- **Historical View**: Shows the last 3 project runs by default, with configurable history count

Usage Examples:
```javascript
// Get summary of last 3 project runs (default)
get_project_summary({})

// Get summary of last 5 project runs
get_project_summary({ history_count: 5 })

// Get next page of results
get_project_summary({ cursor: "next_cursor_from_previous_call" })
```

This tool is essential for the delegation workflow - it allows project leads to efficiently review what their delegated agents have produced without getting overwhelmed by implementation details.

### Control API Integration

The MCP tools now support routing writes to the **Jinn Control API** for on-chain jobs, providing a secure, auditable write layer for `onchain_*` tables. New mutations were added for transactions.

#### Control API Overview

The Control API is a GraphQL service that provides authenticated write operations for on-chain job data. It ensures:
- **Data Integrity**: Validates `request_id` exists in Ponder before writes
- **Automatic Lineage**: Auto-injects `request_id` and `worker_address` from job context
- **Idempotency**: Supports idempotency keys to prevent duplicate operations
- **Security**: Enforces worker identity via `X-Worker-Address` header

#### Environment Configuration

Control API behavior is controlled by the `USE_CONTROL_API` environment variable:

```bash
# Enable Control API (default)
USE_CONTROL_API=true

# Disable Control API (fallback to direct Supabase)
USE_CONTROL_API=false

# Control API endpoint (default: http://localhost:4001/graphql)
CONTROL_API_URL=http://localhost:4001/graphql
```

### RPC Provider Rate Limits

When interacting with blockchain networks, be aware of RPC rate limits:

**QuickNode (Free Tier)**:
- **15 requests/second** limit
- Bulk operations must throttle requests
- Add delays between consecutive calls (70ms minimum = ~14 req/sec)

**Public RPCs** (e.g., https://mainnet.base.org):
- Often unreliable or rate-limited
- Not recommended for production

**Best Practices**:
- Use QuickNode or Alchemy for reliability
- Implement exponential backoff for retries
- Batch requests where possible
- Add `await new Promise(r => setTimeout(r, 100))` between calls

#### Tool Behavior Changes

**`create_record` Tool:**
- **On-chain tables** (`onchain_artifacts`, `onchain_job_reports`, `onchain_messages`): Routes to Control API when enabled
- **Legacy tables** (`artifacts`, `job_reports`, `memories`, `messages`): Always uses direct Supabase
- **Response metadata**: Includes `source: 'control_api'` or `source: 'supabase'` to indicate write path

**`update_records` Tool:**
- **On-chain tables**: Falls back to direct Supabase (Control API doesn't support updates yet)
- **Response metadata**: Includes `source: 'supabase_fallback'` for on-chain tables

**`create_artifact` Tool (NEW):**
- Dedicated tool for creating artifacts via Control API
- Requires `
---

## OLAS Service Deployment & Troubleshooting

### Authentication Issues

#### Issue 1: "Invalid password" during quickstart (JINN-188)

**Problem**: OLAS `quickstart` command fails with "Invalid password" error  
**Root Cause**: Stale wallet configuration in `olas-operate-middleware/.operate` directory  
**Solution**: 
```bash
rm -rf olas-operate-middleware/.operate
```

**Environment Setup**: Ensure these variables are set:
```bash
OPERATE_PASSWORD=12345678
RPC_URL="https://your-base-rpc-url"
```

#### Issue 2: "User not logged in" during API calls (JINN-198)

**Problem**: Middleware API calls fail with "User not logged in" even after successful `bootstrapWallet()`  
**Root Cause**: The middleware's password state (`operate.password`) is stored in-process memory and can be lost between API calls, especially:
- When time elapses between login and service creation
- When the Python process garbage collects session state
- When multiple API calls happen in sequence

**Solution**: Automatic re-authentication before every API call  
**Implementation**: `OlasOperateWrapper.makeRequest()` now:
1. Stores the password during `bootstrapWallet()`
2. Calls `_ensureLoggedIn()` before every API request (except `/api/account/login` itself)
3. Refreshes the session silently without affecting the main flow

**Code Location**: `worker/OlasOperateWrapper.ts`
```typescript
// CRITICAL: Re-authenticate before EVERY API call
if (this.password && endpoint !== '/api/account/login') {
  await this._ensureLoggedIn(); // Refresh session
}
```

**Why This Works**: The middleware accepts login requests at any time and immediately refreshes the in-process `operate.password` variable. By logging in before each API call, we ensure the session is always valid.

**Alternative Considered**: Keeping the middleware server process alive indefinitely was rejected because:
- The process still loses session state over time
- Resource leaks and port conflicts in long-running scenarios
- The overhead of re-login (~50ms) is negligible compared to deployment operations (minutes)

### Quickstart Command Requirements

For unattended mode (`--attended=false`), the quickstart command requires:
```bash
OPERATE_PASSWORD=12345678
RPC_URL="https://mainnet.base.org"
STAKING_PROGRAM="custom_staking"  # or "no_staking"
CUSTOM_STAKING_ADDRESS="0x2585e63df7BD9De8e058884D496658a030b5c6ce"  # AgentsFun1 staking
```

### Service Configuration Templates

Proper service configurations are available in `code-resources/olas-operate-app/frontend/`:

**Base Network Services:**
- **Template**: `AGENTS_FUN_BASE_TEMPLATE`
- **Agent ID**: 43
- **Staking Contract**: `0x2585e63df7BD9De8e058884D496658a030b5c6ce` (AgentsFun1)
- **Bond Amount**: 50 OLAS
- **Fund Requirements**: 0.00625 ETH (agent), 0.0125 ETH (safe)

**Available Staking Programs on Base:**
- `agents_fun_1`: 100 OLAS requirement
- `agents_fun_2`: 1000 OLAS requirement  
- `agents_fun_3`: 5000 OLAS requirement

### Alternative Deployment Methods

1. **Interactive Mode**: 
   ```bash
   poetry run operate quickstart config.json --attended=true
   ```

2. **OlasServiceManager Class**:
   ```typescript
   const serviceManager = await OlasServiceManager.createDefault();
   const result = await serviceManager.deployAndStakeService();
   ```

3. **Individual Commands**:
   ```bash
   poetry run operate service create
   poetry run operate service deploy
   poetry run operate service stake
   ```

### Debugging Tips

- **Check Authentication**: Look for "Invalid password" in `worker.log`
- **Find Stuck Processes**: `ps aux | grep operate`

---

## Common Issues & Gotchas

### Control API Ponder Validation Failures (Fixed 2025-11-27)

**Issue**: Control API repeatedly fails with "invalid json response body" when validating requests via Ponder GraphQL endpoint.

**Symptom**: 
```
FetchError: invalid json response body at https://jinn-gemini-production.up.railway.app/graphql 
reason: Unexpected non-whitespace character after JSON at position 4
```

**Root Cause**: During Ponder migration from GraphQL-only to dual GraphQL+SQL (SSE) mode, the GraphQL endpoint was temporarily unavailable. Control API's `assertRequestExists()` function would:
1. Attempt to fetch from Ponder GraphQL
2. Receive HTML error page or 404 response
3. Try to parse as JSON, causing parse error
4. Throw error and block artifact/report creation

**Impact**: 
- Artifacts fail to persist after 4 retries
- Job reports fail to save
- Job delivery still succeeds (on-chain), but tracking data is lost
- Database shows gaps in job history

**Fix**: Updated `assertRequestExists()` in `control-api/server.ts` to:
- Add 5-second timeout to prevent hanging
- Check Content-Type header before parsing
- Log warnings but skip validation instead of blocking operations
- Handle AbortError gracefully during Ponder downtime

**Prevention**: GraphQL endpoint is now maintained alongside SQL for backward compatibility.

---

### Database Constraint Violation: onchain_request_claims_status_check (Fixed 2025-11-27)

**Issue**: Error "new row for relation 'onchain_request_claims' violates check constraint 'onchain_request_claims_status_check'" when updating claim status.

**Symptom**:
```
Failed to update claim status
error: "new row violates check constraint"
requestId: "0x808f44c8e7e33668762d28def299feb213ded852e0e4acf8e374b4c5533634a6"
```

**Root Cause**: Job statuses (`COMPLETED`, `DELEGATING`, `WAITING`, `FAILED`) were passed directly to `onchain_request_claims` table, but the database constraint only allows `IN_PROGRESS` and `COMPLETED`.

**Impact**:
- Claim status updates silently fail (only logged)
- Claims remain in `IN_PROGRESS` state even when work is done
- Potential for claim lock conflicts if workers re-claim

**Fix**: Added status mapping in `createJobReport` mutation:
```typescript
const claimStatusMap: Record<string, string> = {
  'DELEGATING': 'IN_PROGRESS',
  'WAITING': 'IN_PROGRESS',
  'COMPLETED': 'COMPLETED',
  'FAILED': 'COMPLETED',
  'IN_PROGRESS': 'IN_PROGRESS',
};
```

**Rationale**: Claims track work completion (worker has finished processing), not job success/failure. A job in `DELEGATING` or `WAITING` state is still actively being worked on, hence `IN_PROGRESS` for the claim.

---

### Ponder Indexing Failures: IPFS Content-Type Mismatch

**Issue**: Ponder fails to index `MarketplaceRequest` events with error: `Unexpected content-type "application/octet-stream"`

**Root Cause**: IPFS uploads use `wrap-with-directory: false`, producing raw CIDv1 hashes (`bafkrei...` format). IPFS gateways serve these as `application/octet-stream` instead of `application/json`, even though the content is valid JSON.

**Symptoms**:
- Railway Ponder logs show `[err] Failed to index MarketplaceRequest`
- Jobs appear in Ponder but lack metadata (jobName, enabledTools, dependencies)
- Worker skips jobs due to unresolved dependencies
- On-chain contract shows requests as undelivered, but Ponder doesn't index them

**Fix**: Update `fetchRequestMetadata` in `ponder/src/index.ts` to accept both content types and parse response as text before JSON parsing (applied 2025-11-19).

**Verification**:
```bash
# Check Railway Ponder logs for indexing errors
# Should see "Indexed MarketplaceRequest" instead of "Failed to index MarketplaceRequest"

# Verify request has metadata in Ponder
curl -X POST https://jinn-gemini-production.up.railway.app/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ request(id: \"REQUEST_ID\") { jobName enabledTools dependencies } }"}'
```

**Related**: JINN-247 (Transaction Reliability)

### Transaction Reliability (JINN-247)

The system includes comprehensive retry logic for handling transient blockchain RPC errors and network congestion:

**Delivery Retry Logic** (`worker/delivery/transaction.ts`):
- 3 attempts with exponential backoff (5s, 10s)
- Re-checks delivery status before retry to avoid duplicate submissions
- Retries on timeout, "not mined", and "Transaction not found" errors
- Fast-fails on non-transient errors (validation, gas estimation)

**Parent Dispatch Retry Logic** (`worker/status/parentDispatch.ts`):
- 3 attempts with exponential backoff (2s, 4s)
- Retries on "Transaction not found" and timeout errors
- Validates response after each attempt
- Skips retry on non-recoverable errors (validation, subgraph errors)

**Receipt Polling** (`packages/mech-client-ts`):
- 100-block timeout (up from 50) for transaction confirmation
- 3-second polling interval with error suppression
- Applies to both `marketplaceInteract` and `deliverViaSafe`
- Returns gracefully on timeout without marking as failed

**Best Practices**:
- System automatically handles transient RPC failures
- Monitor BaseScan for transaction status during debugging
- Use `--workstream=` flag to isolate testing workstreams
- Use `--single` flag for step-through debugging
- **Kill Stuck Processes**: `pkill -f "poetry run operate"`
- **Reset State**: Remove `.operate` directory if authentication fails
- **Validate RPC**: Ensure Base RPC URL is accessible and supports required methods
- **Check Balances**: Always use `yarn tsx scripts/check-balances.ts` to verify wallet/Safe ETH balances before transactions

---

## Situation Recognition Learning Loop

The legacy tag-based memory system has been replaced with a situation-centric learning loop that embeds entire job executions, stores them as `SITUATION` artifacts, and performs semantic retrieval before every new run.

### Core Learning Loop: Reflect → Encode → Index → Recognize → Inject

1. **Reflection & Encoding (post-job)**: After a successful execution, the worker assembles a structured `situation.json` containing the job context, execution trace, artifacts, and a templated summary. The summary is embedded via the MCP `embed_text` tool.
2. **Artifact Creation**: The fully populated situation (including the embedding vector) is uploaded to IPFS as a `SITUATION` artifact and persisted on-chain in the delivery payload.
3. **Indexing**: `ponder/src/index.ts` watches for `SITUATION` artifacts during delivery processing. When detected, it fetches the artifact, validates the vector payload, and upserts it into the local `node_embeddings` table (pgvector) keyed by `requestId`.
4. **Recognition (pre-job)**: Before executing a new job, the worker spawns a lightweight recognition agent. It calls `search_similar_situations` to query pgvector for the most relevant past situations and inspects them via `get_details`.
5. **Prompt Injection**: The recognition agent synthesizes actionable learnings (strategies, pitfalls, tool patterns) into a dedicated Markdown block that is prepended to the main execution prompt, ensuring the agent starts with context-aware guidance.

### Key Components

- **`worker/situation_encoder.ts`**: Builds canonical `situation.json` payloads and generates embedding summaries.
- **`worker/mech_worker.ts`**: Orchestrates recognition, prompt injection, reflection, and `SITUATION` artifact creation.
- **`gemini-agent/mcp/tools/embed_text.ts`**: Standard embedding interface (OpenAI `text-embedding-3-small`, 256-D default).
- **`gemini-agent/mcp/tools/search_similar_situations.ts`**: Vector search over the `node_embeddings` table.
- **`ponder/src/index.ts`**: Detects `SITUATION` artifacts on delivery, fetches artifact content from IPFS, and upserts embeddings into Postgres.
- **`migrations/create_node_embeddings.sql`**: Enables pgvector and defines the `node_embeddings` table used for semantic search.

### Testing the Situation Loop

1. **Generate a situation**  
   Run a job to completion (`yarn mech --single`). After delivery, confirm that a `SITUATION` artifact exists in the delivery payload and that Ponder logs show `Indexed situation embedding`.
2. **Verify indexing**  
   Connect to the local Postgres instance and query `SELECT node_id, summary FROM node_embeddings LIMIT 5;` to ensure the new situation was ingested.
3. **Trigger recognition**  
   Dispatch a similar job. Worker logs should show recognition activity:  
   `Starting recognition phase` → `Recognition phase produced learnings`. The injected Markdown block appears at the top of the execution prompt.

### Troubleshooting

**Gemini CLI EPERM Error:**
- **Issue**: `Error: EPERM: operation not permitted` when writing chat history
- **Fix**: Run `./scripts/clear-gemini-chat-cache.sh` or `rm -rf ~/.gemini/tmp/*/chats/*`
- **Cause**: macOS file protection on existing chat files

**External Repository Loading for Artifact-Only Jobs:**
- **Issue**: Recognition/execution/reflection agents hang when trying to load external repositories from environment variables
- **Fix**: For artifact-only jobs (no code metadata), the worker explicitly passes `codeWorkspace: null` to prevent loading external repos
- **Location**: Applied in `worker/recognition/runRecognition.ts`, `worker/execution/runAgent.ts`, and `worker/reflection/runReflection.ts`
- **Details**: The agent checks if `codeWorkspace` is `null` or empty string and skips all directory includes (including `CODE_METADATA_REPO_ROOT` env var)

**dispatch_new_job and dispatch_existing_job Behavior:**
- **Critical**: Both tools ALWAYS post new on-chain marketplace requests, even when job definitions already exist
- **Job Definition vs Request**: A job definition (blueprint, tools, model) is reusable metadata. Each marketplace request is a separate execution instance.
- **dispatch_new_job**: Creates OR reuses job definitions, always posts new on-chain request. Sets `meta.reusedDefinition: true` when reusing.
- **dispatch_existing_job**: Looks up existing definition by ID/name, posts new on-chain request. Returns `NOT_FOUND` error if definition doesn't exist.
- **Fixed Issue (2025-11-17)**: Previously, `dispatch_new_job` would return early without posting when it found an existing definition, causing child jobs to never be picked up by the worker.

**Recognition Phase JSON Output Corruption (Fixed 2025-11-17):**
- **Issue**: Recognition agent JSON output was being corrupted with line breaks mid-string when piped through `pino-pretty`
- **Root Cause**: `agentLogger.output()` used `console.log()`, which sent output through the pino pipeline where `pino-pretty` would wrap long lines
- **Fix**: Changed to `process.stdout.write()` to bypass pino-pretty and write directly to stdout, preventing JSON corruption
- **Impact**: Recognition learnings now parse correctly, enabling proper prompt augmentation

**Dispatch Call Counting (Fixed 2025-11-17):**
- **Issue**: Status inference was counting total dispatch attempts (including retries) instead of unique jobs dispatched
- **Example**: 3 successful dispatches + 4 retry attempts = "Dispatched 7 child job(s)" (incorrect)
- **Fix**: Modified `countSuccessfulDispatchCalls()` to track unique `jobDefinitionId` values instead of raw call count
- **Impact**: Status messages now accurately reflect the number of distinct child jobs created

**Recognition Learning Injection Verification (Enhanced 2025-11-17):**
- **Enhancement**: Added detailed logging when recognition learnings are injected into execution prompts
- **New Fields**: `learningsCount`, `similarJobsCount`, `promptPreview` (first 200 chars)
- **Purpose**: Enables verification that recognition phase insights are actually being used by the execution agent
- **Location**: `worker/orchestration/jobRunner.ts` recognition phase

**System Gotchas for Recognition:**
- **Branch creation auto-detection**: dispatch_new_job automatically skips branch creation when CODE_METADATA_REPO_ROOT is not set (artifact-only mode). No need to specify skipBranch explicitly for research jobs.
- **Transaction not found**: Blockchain RPC transient errors - retry dispatch calls that fail with this error
- **Duplicate dispatch counting**: System tracks unique job definitions, not total attempts - retries are expected and normal

**Recognition Quality Considerations (2025-11-17):**
- **Issue**: Recognition currently learns from individual job success without considering workstream-level completion
- **Impact**: Agent may learn patterns from jobs that "succeeded" locally but were part of failed/abandoned workstreams
- **Example**: Learning to use `blueprints/` directory from past jobs whose workstreams never completed
- **Status**: Known limitation. Vector search does not filter for workstream success or root job completion
- **Tracking**: See `docs/implementation/RECOGNITION-QUALITY-PROBLEM.md` for detailed analysis and proposed solutions
- **Mitigation**: Recognition learnings should be treated as suggestions, not mandates. Agents retain autonomy to ignore patterns that seem inefficient for their specific context.

**Agent Polling Loop After Delegation (2025-11-21):**
- **Issue**: Agents enter polling loops after dispatching child jobs, repeatedly checking child status instead of finalizing immediately
- **Symptom**: Agent dispatches child via `dispatch_new_job`, then enters loop: check status → update `launcher_briefing` → repeat
- **Root Cause**: Agent confusion between DELEGATING vs WAITING states. After dispatching child, agent checked status, saw "undelivered child", and concluded it was in WAITING state (which permits status checking). Agent didn't understand DELEGATING means "just dispatched THIS RUN, exit immediately" vs WAITING means "dispatched in PRIOR run, being re-run to check status".

**Identical Chunk Loop Detection / Pagination Loops (2025-12-02):**
- **Issue**: Agent enters infinite pagination loop on `search_artifacts` MCP tool, repeatedly outputting identical text chunks until loop protection kills the process
- **Symptom**: Agent outputs "Okay, artifacts retrieved. Now paginating to the next batch using the cursor to complete the data set." 10+ consecutive times with no tool calls between outputs
- **Root Cause**: Agent attempts to paginate through large artifact sets (26+ completed jobs in workstream with 100+ artifacts), but:
  1. **Pagination design**: `search_artifacts` returns ALL matching results (limit: 100) from Ponder, then applies token-budget pagination client-side via `composeSinglePageResponse` (10k token budget)
  2. **Single-page overflow**: When full result set exceeds 10k tokens, only first few artifacts fit in page. Agent receives `has_more: true` and `next_cursor` (offset-based)
  3. **Cognitive loop**: Agent calls tool with cursor, gets same results (offset advances but still within first database page), produces same output, repeats
  4. **Loop protection triggers**: After 10 identical stdout chunks (`MAX_IDENTICAL_CHUNKS=10`), agent process is killed with `SIGTERM`
- **Impact**: Job fails after wasting ~9 minutes and ~40k tokens on repetitive pagination attempts. Workstream state is preserved but job marked FAILED.
- **Detection**: Loop protection in `gemini-agent/agent.ts` lines 418-431:
  - Tracks last 10 stdout chunks in sliding window
  - Kills process when identical chunk appears 10+ times
  - Preserves partial output and telemetry for debugging
- **Two Distinct Problems**:
  1. **Agent behavior**: Should NOT attempt exhaustive artifact retrieval in single job. Should sample artifacts (no pagination) or delegate child job for artifact analysis
  2. **Tool design**: `search_artifacts` pagination is offset-based but operates on pre-filtered database results (limit: 100). When client-side token budget is smaller than database page, cursor advances within same page → same results
- **Solutions**:
  - **Short-term (agent prompting)**: Add assertion to blueprint: "Do NOT paginate through all artifacts. Sample first page only or delegate child job for exhaustive review."
  - **Medium-term (tool improvement)**: Make `composeSinglePageResponse` aware of upstream limit. If `next_cursor.offset >= database_limit`, return `has_more: false` to prevent false pagination signal
  - **Long-term (architecture)**: Replace offset-based pagination with keyset pagination (e.g., `last_id`) to avoid overlapping windows when token budget < database page size
- **Workaround**: For jobs with 50+ artifacts, use `search_artifacts` without pagination or dispatch dedicated child job for artifact analysis
- **Related**: Similar issue could affect `search_jobs` (also uses `composeSinglePageResponse` with 10k budget and database limit: 100)
- **Fix Applied**: 
  1. Added explicit "FINALIZE IMMEDIATELY after dispatching" instruction to GEMINI.md delegation section
  2. Clarified DELEGATING vs WAITING distinction: DELEGATING = just dispatched → exit; WAITING = dispatched previously → check status and exit
  3. Added warning to WAITING section: "This state applies ONLY when being RE-RUN after previous execution"
  4. Wrapped progress checkpoint in "Historical Progress (Read-Only Context)" header to prevent misinterpretation
- **Prevention**: Agents must finalize immediately after dispatching children. The system automatically re-dispatches parent when children complete. Never check child status in the same run as dispatch.
- **Cost Impact**: Polling loops burn tokens checking status repeatedly. Each iteration costs ~2-5K tokens. Job with 20+ iterations = 40-100K tokens wasted.
- **Not Related To**: Progress checkpointing (only runs when workstream has completed jobs, which root jobs on first run don't have)

**RevokeRequest and Marketplace Timeout Issues (2025-11-19, Updated 2025-11-24):**
- **Issue**: Marketplace enforces a hard 5-minute (300 second) maximum timeout for all requests on Base network
- **Root Cause**: The on-chain MechMarketplace contract validates `responseTimeout <= 300` and reverts with `OutOfBounds` error if exceeded. Additionally, the mech contract (`MechFixedPriceNative`) enforces the timeout and emits `RevokeRequest` for late delivery attempts.
- **Impact**: Cannot dispatch jobs with timeout > 300 seconds. Jobs requiring longer execution must be decomposed into smaller sub-jobs.
- **Fix Applied (2025-11-19)**: Updated default `responseTimeout` to 300 seconds (max allowed) in `dispatch_new_job` and `dispatch_existing_job`. Added execution time planning guidance to GEMINI.md.
- **Work Decomposition Strategy**: Complex jobs requiring > 5 minutes should be broken into smaller sub-jobs (e.g., separate research into domain-specific tasks, split data gathering from analysis, create pipeline stages).
- **Time Planning**: Agents should estimate ~10-15 tool calls maximum per job, with each tool call averaging 5-30 seconds. Jobs approaching this limit should delegate remaining work to children.
  - Default jobs: 3600s (1 hour) - covers recognition/reflection phases
  - Complex research: 7200s (2 hours) - for jobs with extensive web fetches and retries
  - Simple jobs: 600s (10 minutes) minimum

### Ponder OlasMech:Deliver Failures (Fixed 2025-11-20)

**Issue**: `OlasMech:Deliver` handler fails with "Failed to index OlasMech Deliver" and "Failed to fetch IPFS metadata".
**Root Cause**: 
1. `MarketplaceRequest` IPFS fetch fails (timeout/network), leaving request pre-seeded but incomplete.
2. `OlasMech:Deliver` attempts to create `JobDefinition` but fails because `workstreamId` was missing or IPFS content-type was handled incorrectly (string vs object).
**Fix**:
- Updated `OlasMech:Deliver` to parse IPFS response if returned as string.
- Updated `JobDefinition` upsert to inherit `workstreamId` from request.
- Wrapped `JobDefinition` upsert in try/catch to prevent blocking delivery indexing.

### Ponder MarketplaceRequest IPFS Failures (Fixed 2025-11-20)

**Issue**: `MarketplaceRequest` handlers failing frequently with "Failed to fetch IPFS metadata" due to gateway timeouts or rate limiting.
**Root Cause**: Single gateway (`gateway.autonolas.tech`) dependency with no retry logic and short (10s) timeout.
**Fix**:
- Implemented multi-gateway support with automatic failover (Autonolas -> Cloudflare -> IPFS.io -> DWeb).
- Added exponential backoff/retry logic for IPFS fetches.
- Increased default timeout to 15s per gateway attempt.

### Agent `get_details` Artifact Retrieval by CID (Fixed 2025-11-24)

**Issue**: Agents calling `get_details` with CID (e.g., `bafkreid5ebotrkenji2y7cwvsdqwicnk2rggmvi7rstemq7d5mcqnmisbe`) receive empty results, causing job failures when trying to access artifacts from previous jobs.
**Root Cause**: `get_details` initially supported CID detection and querying but failed to add CID-based artifacts to the combined results array, resulting in empty data returns.
**Fix**:
- Enhanced `get_details` to detect and handle CID format (Qm..., bafkrei..., f01...).
- When CID is provided, query Ponder's `artifacts(where: { cid: $cid })` to find matching artifacts.
- Fixed result assembly to include CID-based artifacts in the combined response.
- Returns all artifacts with that CID (typically 1, but supports duplicates across requests).
- IPFS content resolution still works when `resolve_ipfs: true` (default).

### MCP Tool Schema `additionalProperties` Error (Fixed 2025-11-24)

**Issue**: Gemini agent execution fails with "params must NOT have additional properties" when calling `dispatch_existing_job` or other MCP tools.
**Root Cause**: MCP SDK validates tool parameters against JSON Schema before passing to handler. Zod `.shape` generates strict schemas with `additionalProperties: false`, rejecting any extra fields Gemini might include in function calls.
**Fix**:
- Modified `dispatch_existing_job` schema to use `.passthrough()` before `.shape`, allowing additional properties while still validating required fields.
- Pattern: `inputSchema: schemaBase.passthrough().shape` instead of `inputSchema: schemaBase.shape`.
- This allows Gemini to include metadata fields without breaking validation while maintaining type safety for expected parameters.

### Parent Re-Dispatch Workstream Propagation (Fixed 2025-11-21)

**Issue**: When worker auto-dispatches parent jobs after child completion, the new parent request gets a different `workstreamId` instead of preserving the child's workstream.
**Root Cause**: `dispatch_existing_job` was including `sourceRequestId` from the child job context even when `workstreamId` was explicitly provided. This caused Ponder's indexer to treat the parent re-dispatch as a child job and traverse up the lineage chain, overwriting the explicit `workstreamId`.
**Fix**:
- Modified `dispatch_existing_job` to exclude `sourceRequestId` and `sourceJobDefinitionId` from lineage context when `workstreamId` is explicitly provided.
- This ensures parent re-dispatches are indexed as root jobs with the preserved workstream, not as child jobs requiring traversal.
**Impact**: Parent jobs now correctly maintain the same `workstreamId` across re-dispatches, keeping entire job hierarchies unified within a single workstream.

### Worker Request Filtering & Delivery Preflight (Fixed 2025-11-24)

**Issue**: Worker fails to pick up valid unclaimed requests or incorrectly reports "Request already delivered" during delivery preflight checks.
**Root Cause**: Multiple functions verify requests against the on-chain `getUndeliveredRequestIds` list, but used insufficient fetch limits (100-1000). If the mech has >limit undelivered requests globally (across all workstreams), requests outside this window were falsely assumed to be delivered.
**Affected Functions**:
- `filterUnclaimed` in `worker/mech_worker.ts` (discovery phase)
- `isUndeliveredOnChain` in `worker/delivery/transaction.ts` (delivery preflight)
**Fix**:
- Increased fetch limit to 5000 in both functions (sufficient for production workload)
- Added explicit warning logging when requests are not found in on-chain undelivered set
- Added graceful fallback (trust Ponder/continue) if on-chain verification fails
- Enforces membership check only when on-chain query succeeds
**Impact**: Workers can now correctly process and deliver requests even when the shared mech has a large backlog of undelivered requests from other workstreams.

### RevokeRequest & Stale Pending Requests (Fixed 2025-11-25)

**Issue**: Worker repeatedly selects and attempts to deliver requests that have already been delivered by competing mechs, resulting in:
- Transaction confirms on-chain but emits `RevokeRequest` instead of `Deliver`
- Wasted gas on doomed delivery attempts (~120k gas per failed attempt)
- Frontend shows request as "pending" indefinitely (Ponder never sees the delivery)
- Request remains in worker's queue across runs, causing infinite retry loops

**Root Cause**: Two-part architectural issue:
1. **Worker preflight**: Only checked mech's local undelivered queue via `getUndeliveredRequestIds()`, which doesn't reflect marketplace state when another mech wins the delivery race
2. **Ponder indexing**: Only indexed `OlasMech:Deliver` events (your mech), missing deliveries by other mechs, so `request.delivered` stayed `false` even after marketplace marked it delivered

**Fix Applied (2025-11-25)**:

**Part 1: Network ID Filtering (Global Jinn Explorer)**
- Added `networkId: "jinn"` to all new request metadata in `dispatch_new_job` and `dispatch_existing_job`
- Updated Ponder `MarketplaceRequest` handler to filter by `networkId`:
  - `networkId === "jinn"` → INDEX (explicit Jinn marker)
  - `networkId === undefined` → INDEX (legacy Jinn, backward compatibility)
  - `networkId === anything else` → SKIP (non-Jinn tenant)
- Indexes ALL Jinn requests across ALL mechs (global marketplace view), not just requests to your mech

**Part 2: Delivery Tracking (Dual Handler Architecture)**
- `MechMarketplace:MarketplaceDelivery` handler tracks which mech delivered each Jinn request
  - Stores `deliveryMech` on both `request` and `delivery` tables
  - Only processes deliveries for Jinn requests (filtered by Part 1)
- `OlasMech:Deliver` handler provides IPFS artifact resolution
  - Marks `request.delivered = true` (source of truth for delivered status)
  - Stores `deliveryIpfsHash` for artifact resolution
  - Resolves artifacts, telemetry, and SITUATION embeddings from IPFS
- Factory scan starts at block 25,000,000 (Jan 2024, covers all Jinn history)

**Part 3: Global Explorer Capabilities**
- Frontend displays `deliveryMech` (which mech delivered) vs `mech` (priority mech)
- GraphQL queries support filtering by any mech in Jinn marketplace
- Worker continues to query `delivered: false` - Ponder maintains accurate status
- No more RevokeRequest events from late delivery attempts

**Impact**: 
- Workers stop selecting requests after marketplace marks them delivered (any mech)
- Frontend correctly shows delivered status for all Jinn jobs
- No more `RevokeRequest` events from late delivery attempts
- Ponder database stays clean (Jinn-only, no global marketplace pollution)
- Worker preflight checks remain as safety guardrail but Ponder is now authoritative

**Migration Notes**:
- Existing requests without `networkId` are treated as legacy Jinn (backward compatible)
- Schema changes require Ponder reindexing (new fields: `deliveryMech`, delivery timestamps)
- Railway Ponder deployment will auto-reindex on next push

**Related Files**:
- `gemini-agent/mcp/tools/dispatch_new_job.ts` - Adds `networkId` to metadata
- `gemini-agent/mcp/tools/dispatch_existing_job.ts` - Adds `networkId` to metadata
- `ponder/ponder.config.ts` - Factory pattern with split start blocks (CreateMech discovery + OlasMech Deliver)
- `ponder/src/index.ts` - NetworkId filtering on requests; delivery handler uses `OlasMech:Deliver`

### Ponder v0.15 Migration & SSE Connection Fix (Fixed 2025-11-28)

**Issue**: Frontend hammering Railway backend with excessive SSE connections causing:
- Nginx 499 errors (client canceled requests)
- 5 separate SSE connections per component (one per table)
- 8-26 second connection times
- Rapid reconnection attempts on failure
- Empty frontend despite backend having indexed data

**Root Cause**: `useRealtimeData` hook was subscribing to ALL 5 tables (`request`, `artifact`, `delivery`, `job_definition`, `message`) regardless of which collection the component actually needed. Multiple components using `useSubgraphCollection` multiplied these unnecessary subscriptions.

**Fix**:
- Modified `useRealtimeData` to subscribe ONLY to the specific table needed by each component
- Leverages Ponder client's built-in SSE connection multiplexing (per docs: "Each createClient instance multiplexes all live queries over a single SSE connection")
- Changed from `SELECT * LIMIT 1` to `SELECT id ORDER BY id DESC LIMIT 1` for efficiency
- Removed need for custom SSE manager since Ponder client already provides singleton behavior

**Impact**:
- Reduced SSE subscriptions from 5× per component to 1× per component
- Single SSE connection multiplexes all live queries (Ponder client feature)
- Eliminated connection hammering and 499 errors
- Faster page loads, proper real-time updates

### Job Definition Status Icons Not Auto-Updating (Fixed 2025-11-28)

**Issue**: In requests table, job definition status icons (Job ID column) did not update when job definitions changed status. Component fetched status once on mount with no SSE subscription.

**Fix**: Added SSE listeners at table level (not per-row):
- `RequestsTable` component creates single subscription to `jobDefinitions` table
- Also subscribes to `requests` and `deliveries` for dependency status updates
- Increments `refetchTrigger` prop when SSE events arrive
- All child components (`JobDefStatusCell`, `DependencyCell`) receive the trigger and refetch their data
- Avoids creating 100+ subscriptions (one per row)

**Pattern**: Create ONE SSE subscription per table at the parent/container level, pass refetch triggers to children. Do not create subscriptions in row-level components - causes subscription explosion

**Related Files**:
- `frontend/explorer/src/hooks/use-realtime-data.ts` - Fixed to subscribe only to needed table
- `frontend/explorer/src/hooks/use-subgraph-collection.ts` - Already correct (uses useRealtimeData)

---

## Known Limitations & Gotchas

### Job-Level Status Ignored Child Job Status (Fixed 2025-12-02)

**Issue**: `jobDefinition.lastStatus` showed COMPLETED when direct children had `delivered: true` but `lastStatus: "DELEGATING"`, causing premature completion while descendants were still spawning work.

**Root Cause**: Status inference checked only the `delivered` boolean on child requests, not the child job definition's `lastStatus`. A child that delivered with DELEGATING/WAITING status means work is still in progress (child spawned grandchildren).

**Example**: 
- Root job "ethereum-protocol-research" ran at Dec 2 09:14
- Child job "Sophisticated, Less Visible Trading Activities" (02eb7ffc) had `delivered: true` + `lastStatus: "DELEGATING"` 
- Root saw "all children delivered" and marked itself COMPLETED
- Child's grandchildren (spawned Dec 2 17:58-18:31) remained pending
- Root incorrectly showed COMPLETED with 14 pending descendants

**Fix (2025-12-02)**:
- Modified `getAllChildrenForJobDefinition` to query child job definitions and check `lastStatus`
- Added `activeChildren` count: delivered children with DELEGATING/WAITING status
- `inferStatus` now returns WAITING if any children have non-terminal status, even if delivered
- Parent jobs won't complete until all children reach COMPLETED or FAILED status

**Impact**:
- Work Protocol now correctly enforces: parent waits for all descendants to fully complete
- Prevents premature workstream completion when delegation cascades multiple levels
- `lastStatus` field now accurately reflects job-level state including child status

**Related Files**:
- `worker/status/inferStatus.ts` - Added check for activeChildren (delivered but DELEGATING/WAITING)
- `worker/status/childJobs.ts` - Queries child job definitions to get `lastStatus` field
- `ponder/src/index.ts` - Line 794: `lastStatus` set from delivery (per-run snapshot remains for indexing)

---

### Stale Claim Blocking (Fixed 2025-12-02)

**Issue**: Worker skipped jobs stuck IN_PROGRESS for hours, never re-attempting them. Request `0x486db...be542` remained stuck IN_PROGRESS for 643 minutes (10+ hours) while worker repeatedly skipped it.

**Root Cause**: Control API's `claimRequest` mutation returned existing IN_PROGRESS claims indefinitely without checking staleness (line 204-206). Worker client added `alreadyClaimed` logic attempting to detect stale claims (>1 minute), but inverted the handling - treated stale claims as "skip" instead of "retry".

**Fix (2025-12-02)**:
- **Control API** (`control-api/server.ts`): Added age check before returning existing claim. If claim is IN_PROGRESS and >5 minutes old (300s threshold), allows re-claiming with fresh timestamp.
- **Worker Client** (`worker/control_api_client.ts`): Removed confusing client-side stale detection. Now trusts Control API's decision on claimability.

**Verification**:
- Before fix: Claim at `2025-12-02T09:17:33.006Z`, age 643 minutes, worker skipped
- After fix: Control API logged "Re-claiming stale job", updated claim to `2025-12-02T20:03:36.229Z`
- Worker successfully claimed and began processing

**Prevention**: Control API is single source of truth for claim staleness. 5-minute threshold balances recovery speed vs. avoiding double-work during legitimate long-running jobs.

**Related Files**:
- `control-api/server.ts` - Lines 204-221: Stale claim detection and re-claiming logic
- `worker/control_api_client.ts` - Lines 80-99: Simplified claim response handling
- `scripts/reset-claim.ts` - Utility script for inspecting and manually resetting stale claims
