# Memory Architecture

**Deep technical reference for the memory and learning systems**

This document contains detailed information about the agent's memory systems. For operational guidance, see `AGENT_README_TEST.md`.

---

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

**Workstream Graph Inspection:**
```bash
yarn inspect-workstream <workstreamId>
```
Visualizes the complete execution graph of a workstream, showing parent/child relationships, status, and key artifacts. This provides a high-level view of job execution trees within a venture.

Returns:
- `stats`: Total jobs, completed/pending counts, artifact counts
- `tree`: Hierarchical graph showing parent/child job relationships with status and summaries

The script resolves delivery content selectively to extract job status (COMPLETED/PENDING/FAILED), summaries, and errors while keeping output manageable through truncation.

**Example Usage:**
```bash
# Inspect workstream and save to file
yarn inspect-workstream <workstreamId> 2>/dev/null > workstream-graph.json

# View workstream stats
yarn inspect-workstream <workstreamId> 2>/dev/null | jq '.stats'

# See all job names in tree
yarn inspect-workstream <workstreamId> 2>/dev/null | jq '.. | .jobName? | select(. != null)'

# Find failed jobs
yarn inspect-workstream <workstreamId> 2>/dev/null | jq '.. | select(.status? == "FAILED") | {jobName, error}'
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
- **Prevention**: Agents must finalize immediately after dispatching children. The system automatically re-dispatches parent when children complete. Never check child status in the same run as dispatch.
- **Cost Impact**: Polling loops burn tokens checking status repeatedly. Each iteration costs ~2-5K tokens. Job with 20+ iterations = 40-100K tokens wasted.

---

**End of Memory Architecture Reference**









