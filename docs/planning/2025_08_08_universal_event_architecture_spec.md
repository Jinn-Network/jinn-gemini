## Planning Doc: Universal Event Architecture & Agent Awareness (v1)

- **Date:** 2025-08-08
- **Author:** Jinn

### 1. Motivation

To achieve true hierarchical cognition, the agentic system requires two things: a simple, universal event model and a powerful set of tools to observe it. Previous designs were too complex, relying on multiple event types and leaving the agent to infer critical context. This specification details a fundamental architectural simplification: **all events that trigger jobs will be persisted as artifacts.** This "universal event bus" model, combined with enhanced awareness tools, will provide the foundation for a robust, observable, and scalable metacognitive system.

### 2. The Universal Event Architecture

The core principle is that there is only one way a job is ever dispatched: in response to a new artifact. This radically simplifies the system.

1.  **The Event Bus:** The `artifacts` table becomes the single, universal event bus for the entire system.
2.  **Event Sources:** All event sources—job status changes, cron ticks, or declarative emissions from other jobs—do not call the dispatcher directly. Instead, their sole function is to `INSERT` a structured artifact into the event bus.
3.  **The Dispatcher:** The `universal_job_dispatcher` is now triggered **only and always** by `on_new_artifact`. Its logic is simplified, as it no longer needs to handle different event source types.
4.  **Causal Tracing:** Because every dispatched job is triggered by a persisted artifact, we can create a perfect, unbroken, and universally traceable causal chain for every action the system takes.

### 3. Requirements

1.  **Universal Event Model:** All trigger sources (`cron`, `on_job_status_change`, etc.) must be refactored to create artifacts instead of calling the dispatcher.
2.  **Explicit Causal Linkage:** Every job on the `job_board` must have a non-nullable `source_artifact_id` that links it to the specific event that caused its creation.
3.  **Complete Static Awareness:** The agent needs a tool (`get_job_graph`) to inspect the system's "blueprint"—understanding which job definitions subscribe to which artifact topics.
4.  **Universal Lineage Tracing:** The agent needs a tool (`trace_lineage`) to follow the causal chain of execution, forwards and backwards from any event.

### 4. Low-Level Implementation Specification

#### 4.1. Database Schema Changes

```sql
-- In a new migration file

-- 1. Add a non-nullable, explicit link from a job to its cause.
ALTER TABLE public.job_board
  ADD COLUMN IF NOT EXISTS source_artifact_id UUID REFERENCES public.artifacts(id);

-- This column should be NOT NULL after backfilling, but we'll make it nullable for the migration.
-- A constraint will be added later to enforce this for all new jobs.
COMMENT ON COLUMN public.job_board.source_artifact_id IS 'The artifact that triggered this job. This is the bedrock of our universal tracing.';

-- 2. Add declarative event emission config to the jobs table. (Unchanged from previous spec)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS emit_artifacts_on JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.jobs.emit_artifacts_on IS 'Declarative map of job status to a list of artifacts to emit. e.g., {"COMPLETED": [{"topic": "analysis_requested"}]}';
```

#### 4.2. Refactoring Triggers to Emit Artifacts

This is the core implementation task. The logic inside existing triggers will be replaced with a simple `INSERT INTO artifacts`.

1.  **`handle_job_status_emissions` (from `emit_artifacts_on`):** This trigger remains, and its logic is correct. It reads `emit_artifacts_on` and inserts artifacts.

2.  **`handle_job_status_change` (System-level):** The existing trigger that handles `on_job_status_change` schedules will be refactored. Instead of calling the dispatcher, it will now create a system-level artifact.
    *   **Logic:** `INSERT INTO artifacts (topic, content) VALUES ('system.job.status_changed', '{"job_id": "...", "from_status": "...", "to_status": "..."}');`

3.  **`handle_cron_tick` (System-level):** A new database function, executed by `pg_cron`, will no longer call the dispatcher. It will create a system artifact.
    *   **Logic:** `INSERT INTO artifacts (topic, content) VALUES ('system.cron.tick', '{"pattern": "...", "fired_at": "..."}');`

4.  **`universal_job_dispatcher` Refactor:** This function is now dramatically simpler. It is only ever triggered by `on_new_artifact`. It takes the new artifact's data, finds all matching `jobs` whose `schedule_config` subscribes to that topic, and inserts them into the `job_board`, populating the `source_artifact_id` with the ID of the artifact that triggered it.

#### 4.3. New & Enhanced Agent Tools

1.  **`get_job_graph({topic?: string})`:**
    *   **Purpose:** To understand the static "blueprint" of the system's capabilities.
    *   **Function:** Queries the `jobs` table to find which job definitions `emit_artifacts_on` a given topic, and which `schedule_config`s subscribe to it.
    *   **Returns:** A structured object `{ "topic": "...", "publishers": [...], "subscribers": [...] }`.

2.  **`trace_lineage({artifact_id?: string, job_id?: string})`:**
    *   **Purpose:** The universal tool for causal tracing.
    *   **Function:** Starts from a given artifact or job and uses the `source_artifact_id` links to recursively walk the execution graph up and down.
    *   **Returns:** A structured, nested view of the causal chain.

    Implementation note: Back `trace_lineage` with a small SQL view (or CTE) that joins `job_board` and `artifacts` via `source_artifact_id` for fast lookups. Optionally materialize this view if volume grows (e.g., `v_job_lineage`).

### 5. Vertically-Sliced Development Plan

#### Slice 1: Foundational Schema & Linkage ✅ COMPLETED
-   **Goal:** Establish the data model for universal tracing.
-   **Tasks:**
    1.  Write and apply the migration to add `source_artifact_id` to `job_board`.
    2.  Update the `universal_job_dispatcher` to populate this field when it creates a job. This is the most critical connection.

    -   Status: Implemented and verified in production database via `supabase execute_sql`.
    -   Notes:
        -   Added `source_artifact_id UUID REFERENCES artifacts(id)` to `job_board` with index `idx_job_board_source_artifact_id`.
        -   Added `emit_artifacts_on JSONB DEFAULT '{}'::jsonb` to `jobs` for declarative emissions (used in later slices).
        -   Updated `create_job_from_unified_definition(...)` to set `source_artifact_id` from `event_data` for `on_new_artifact` and compatible events.
        -   Verified by inserting a test artifact and confirming dispatched job carries the correct `source_artifact_id` linkage.

#### Slice 2: Migrate Triggers to the Universal Event Bus ✅ COMPLETED
-   **Goal:** Unify all job triggers to use the artifact-based event model.
-   **Tasks:**
    1.  Refactor the `handle_job_status_change` trigger to create a `system.job.status_changed` artifact.
    2.  Refactor the `pg_cron` setup to create a `system.cron.tick` artifact.
    3.  Ensure existing job schedules that listened for these old trigger types are updated to subscribe to the new artifact topics.

-   **Status:** Implemented and verified. The universal event bus is now fully operational.
-   **Notes:**
    -   **Job Status Changes:** Created `handle_job_status_change_via_artifacts()` that emits `system.job.status_changed` artifacts instead of calling dispatcher directly.
    -   **Thread Events:** Created `handle_new_thread_via_artifacts()` and `handle_thread_update_via_artifacts()` that emit `system.thread.created` and `system.thread.updated` artifacts.
    -   **Time-based Events:** Created `emit_processing_time_artifacts()` that emits both `system.processing_time.update` and `system.cron.tick` artifacts.
    -   **Schedule Migration:** Updated 4 jobs using `on_job_status_change`, 17 jobs using `on_processing_time_update`, and 3 jobs using `cron` to subscribe to the new artifact topics.
    -   **Dispatcher Simplification:** `universal_job_dispatcher()` now only handles artifact events (`INSERT`/`UPDATE` on `artifacts` table).
    -   **Verification:** Successfully tested complete event chain: time event → artifact → job dispatch with perfect `source_artifact_id` linkage. Tested job failure → artifact → error monitoring job dispatch. All causal chains are preserved and traceable.

#### Slice 3: Implement Agent Awareness Tools ✅ COMPLETED
-   **Goal:** Equip the agent with the tools to see and understand the new architecture.
-   **Tasks:**
    1.  Implement the new `get_job_graph` tool.
    2.  Implement the new `trace_lineage` tool (backed by the lineage view/CTE).

-   **Status:** Implemented and verified. Agents now have powerful tools to understand and navigate the universal event architecture.
-   **Notes:**
    -   **Database Functions:** Created `get_job_graph_data()` and `trace_lineage_data()` with optimized SQL for fast querying.
    -   **Lineage View:** Created `v_job_lineage` view joining `job_board`, `artifacts`, and `threads` for efficient causal tracing.
    -   **MCP Tools:** Implemented `get_job_graph` and `trace_lineage` tools with full TypeScript types and Zod validation.
    -   **Tool Registration:** Added tools to MCP server exports and registration in `server.ts`.
    -   **Testing:** Verified `get_job_graph` returns 13 topics with correct publisher/subscriber counts. Verified `trace_lineage` correctly traces causal chains backwards (job that created artifact) and forwards (jobs triggered by artifact).
    -   **Agent Capabilities:** Agents can now inspect the system's static blueprint (`get_job_graph`) and trace any event's complete causal history (`trace_lineage`).

#### Slice 4: Frontend Support for Universal Tracing
-   **Goal:** Visualize and navigate the new universal event architecture in the explorer UI. Use playwright mcp.
-   **Tasks:**
    1.  Update job detail views to display and link `source_artifact_id` (e.g., in `frontend/explorer/src/components/job-report-detail-view.tsx` and related pages).
    2.  Add artifact detail views showing which jobs were triggered by each artifact (reverse linkage: artifact → jobs).
    3.  Implement visual lineage tracing (job → artifact → thread and forward/backward traversal) in `threads/[id]/timeline` and job impact views.
    4.  Enhance the job impact view to show causal relationships and downstream effects.
    5.  Add filtering for jobs by triggering artifact properties (e.g., `topic`).

#### Slice 5: Documentation Updates
-   **Goal:** Update system documentation to reflect the universal event model and tracing capabilities.
-   **Tasks:**
    1.  Update `AGENT_README.md` to document the universal artifact event bus and `source_artifact_id`-based tracing.
    2.  Update `system_state.system_architecture` value to describe the new event model and lineage tracing guarantees.
    3.  Update `docs/documentation/TRIGGER_SYSTEM_GUIDE.md` to align with artifact-only dispatch and future trigger refactors.
    5.  Update database schema docs to include `job_board.source_artifact_id` and related indexes/constraints.

This plan establishes a simple, powerful, and consistent architecture. It provides the agent with a complete and coherent set of tools to understand not just what is happening in the system, but *why*, forming the true foundation for hierarchical cognition.

