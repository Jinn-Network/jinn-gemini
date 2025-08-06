# Feature Spec: Universal Context Injection (Version 4 - Final)

- **Date:** 2025-08-06
- **Status:** Proposed
- **ID:** `feat-universal-context-injection`

### 1. Goal

To standardize data provenance and operational context across the system by automatically embedding the identity of both the **source job** and the **active thread** into all key records. This will be achieved by making the system's tools smarter, creating a rich data graph, and removing the burden of context-passing from the agent.

### 2. Implementation Plan

#### 2.1. Database Schema Enhancement

A unified set of context columns will be added to all tables representing the output of an agent's work.

*   **Affected Tables:**
    *   `artifacts` (will be renamed to `posts` later)
    *   `threads`
    *   `messages` (will be deprecated later)
    *   `memories`
    *   `job_definitions`
    *   `job_schedules`
    *   `prompt_library`

*   **Columns to be Added/Ensured:**
    *   `source_job_id UUID`: Foreign key to `job_board.id`.
    *   `source_job_name TEXT`: Indexed for fast lookups.
    *   `thread_id UUID`: Foreign key to `threads.id`.

*   **Detailed Schema Actions:**
    *   A migration script will add these three columns to any of the affected tables that are missing them.
    *   The `artifacts.source` and `messages.from_agent` columns will be dropped and replaced by this new standardized trio of context columns.
    *   **Note on Nullability:** All new context columns (`source_job_id`, `source_job_name`, `thread_id`) will be nullable. This ensures that actions performed outside the standard job lifecycle (e.g., manual database inserts or the creation of root-level threads) do not fail. A `NULL` value in these fields is considered valid data, indicating a root or external action.

#### 2.2. The Context Injection Pipeline

The system will be enhanced to automatically resolve and provide the full operational context (`jobId`, `jobName`, `threadId`) to all tools.

1.  **`worker/worker.ts` (The Origin & Resolver):**
    *   The worker's logic will be enhanced. Upon fetching a job, it will now be responsible for **resolving the `thread_id`** based on the job's `triggering_context`. (e.g., by looking up the `thread_id` of the post that triggered the job).
    *   It will create a comprehensive `jobContext` object containing `jobId`, `jobName`, and the now-resolved `threadId`.
    *   This complete context object will be passed to the `Agent` class constructor.

2.  **`gemini-agent/agent.ts` (The Conduit):**
    *   The `Agent` constructor and the `setJobContext` function call will be updated to handle the full context object, including `thread_id`.

3.  **`packages/metacog-mcp/src/tools/shared/supabase.ts` (The Hub):**
    *   The context hub will be updated to store and provide the `thread_id` alongside the job information via `getCurrentJobContext()`.

#### 2.3. Tooling Enhancement Details

Tools will be refactored to remove context parameters from their public schemas and rely entirely on the injected context.

1.  **Generic Tools (`create_record`, `update_records`):**
    *   The internal implementation will be modified to automatically inject all three context fields (`source_job_id`, `source_job_name`, `thread_id`) into every `INSERT` and `UPDATE` payload.

2.  **Specialized Tools (`manage_artifact`, `manage_thread`, etc.):**
    *   Their public-facing Zod schemas will be simplified by **removing** any manual context parameters like `source` and `thread_id`. The agent will no longer be able to pass these.
    *   Their internal logic will be updated to fetch the full context from `getCurrentJobContext()`.

*   **Example: `manage_artifact` Refactoring**

    *   **Before (Current Schema):**
        ```typescript
        export const manageArtifactParams = z.object({
            thread_id: z.string().optional(), // Will be removed
            source: z.string().optional(),     // Will be removed
            // ... other params
        });
        ```

    *   **After (New Schema):**
        ```typescript
        export const manageArtifactParams = z.object({
            // 'thread_id' and 'source' parameters are REMOVED.
            // ... other params
        });
        ```

#### 2.4. Prompt Library Review

*   A review of all prompts will be conducted to remove any instructions that tell the agent to provide `job_name`, `source`, or `thread_id`, as the system now handles this automatically.

### 3. Test Plan

*   Integration tests for all modified tools will be updated to reflect the new, simpler schemas.
*   Assertions will be added to every `CREATE` and `UPDATE` test to verify that `source_job_id`, `source_job_name`, and `thread_id` are all populated correctly and automatically by the tools.

### 4. Approval

No implementation will begin until this detailed plan is approved.
