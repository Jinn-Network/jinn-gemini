# Worker Internals

**Deep technical reference for worker architecture and implementation**

This document contains detailed information about the worker's internal systems. For operational guidance, see `AGENT_README_TEST.md`.

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

## Control API Integration

The MCP tools now support routing writes to the **Jinn Control API** for on-chain jobs, providing a secure, auditable write layer for `onchain_*` tables. New mutations were added for transactions.

### Control API Overview

The Control API is a GraphQL service that provides authenticated write operations for on-chain job data. It ensures:
- **Data Integrity**: Validates `request_id` exists in Ponder before writes
- **Automatic Lineage**: Auto-injects `request_id` and `worker_address` from job context
- **Idempotency**: Supports idempotency keys to prevent duplicate operations
- **Security**: Enforces worker identity via `X-Worker-Address` header

### Environment Configuration

Control API behavior is controlled by the `USE_CONTROL_API` environment variable:

```bash
# Enable Control API (default)
USE_CONTROL_API=true

# Disable Control API (fallback to direct Supabase)
USE_CONTROL_API=false

# Control API endpoint (default: http://localhost:4001/graphql)
CONTROL_API_URL=http://localhost:4001/graphql
```

### Tool Behavior Changes

**`create_record` Tool:**
- **On-chain tables** (`onchain_artifacts`, `onchain_job_reports`, `onchain_messages`): Routes to Control API when enabled
- **Legacy tables** (`artifacts`, `job_reports`, `memories`, `messages`): Always uses direct Supabase
- **Response metadata**: Includes `source: 'control_api'` or `source: 'supabase'` to indicate write path

**`update_records` Tool:**
- **On-chain tables**: Falls back to direct Supabase (Control API doesn't support updates yet)
- **Response metadata**: Includes `source: 'supabase_fallback'` for on-chain tables

**`create_artifact` Tool:**
- Dedicated tool for creating artifacts via Control API
- Requires valid `request_id` from on-chain context

---

## Shared Context Manager for Tool Outputs

All read/search tools now use a shared module to ensure consistent, token‑budgeted, single‑page responses with pagination and transparent metadata.

- **Module**: `gemini-agent/mcp/tools/shared/context-management.ts`
- **Defaults**:
  - Per‑page token budget: 50,000 tokens
  - Warning threshold: 500,000 tokens for full (truncated) results
- **Response shape**: `{ data: [...], meta: { requested?, tokens, has_more, next_cursor?, warnings? } }`
- **Pagination**: Cursor-based (opaque), stateless. Tools accept an optional `cursor` input; pass `meta.next_cursor` to fetch the next page.
- **Truncation**:
  - Field‑aware truncation only where appropriate (e.g., `content`, `output`, sometimes `summary`/`description`).
  - The `get_details` tool does not truncate by default.

### Exposed Helpers

- `composeSinglePageResponse(items, options)` builds one page under the token budget; computes full token estimate; emits warnings if needed.
  - Options: `{ startOffset?, truncateChars?, truncationPolicy?, requestedMeta? }`
- `decodeCursor(cursor)` / `encodeCursor(keyset)`
- `deepTruncateByField(obj, policy)` and `deepTruncateStrings(obj, maxChars)`

### Using the Context Manager in a New Tool

```typescript
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

---

## Key Awareness Tools

### `get_context_snapshot`
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

### `get_project_summary`
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

---

**End of Worker Internals Reference**









