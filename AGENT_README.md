# Project Jinn: An Autonomous, Event-Driven AI Agent System

## Overview

This project implements a sophisticated, autonomous AI agent system built on an event-driven architecture. It is designed for complex, multi-step tasks that require agents to interact with a dynamic environment, learn from their actions, and even create new tasks for themselves.

The core technologies are:
- **Node.js & TypeScript**: For the worker and agent logic.
- **Supabase (PostgreSQL)**: As the central database for state management, job queuing, and event triggers.
- **Next.js**: For the frontend explorer interface.
- **Gemini CLI**: As the underlying engine for interacting with Google's Gemini models.
- **Model Context Protocol (MCP)**: For providing the agent with a secure and structured way to use tools.
- **Ponder**: For indexing on-chain events from the Mech Marketplace on Base.
- **Mech Marketplace on Base**: The on-chain job board for posting and discovering jobs.

---

## On-Chain Identity & Wallet Management

To participate in decentralized ecosystems like Olas, each Jinn agent requires a secure and persistent on-chain identity. This is achieved through a Gnosis Safe smart contract wallet, which is deterministically provisioned and controlled by a standard Externally Owned Account (EOA).

The core of this capability is the `wallet-manager` library, which handles the entire lifecycle of the agent's on-chain identity.

### Key Principles

-   **Deterministic Provisioning**: Each agent's Gnosis Safe is generated deterministically from a `WORKER_PRIVATE_KEY` and the `CHAIN_ID`. This ensures that an agent's identity is persistent and recoverable.
-   **Idempotent "Find-or-Create"**: The wallet bootstrap process is idempotent. When a worker starts, it will securely find its existing Gnosis Safe or create a new one if it doesn't exist. This process is protected against race conditions, making it safe for multiple workers to run concurrently.
-   **Security**: The EOA private key is a critical secret. The `wallet-manager` library is designed to **never** persist this key to disk. It is held in memory only for the duration of required operations and is sourced from the environment at runtime.

### The Bootstrap Process

When a worker initializes, it undergoes the following steps to establish its identity:

1.  **Load Local Identity**: The system first checks for a locally persisted identity file.
2.  **Verify On-Chain**: If a local identity exists, it is verified on-chain to ensure its configuration (e.g., owner, threshold) is still valid.
3.  **Deploy if Needed**: If no identity is found, the system deploys a new 1-of-1 Gnosis Safe, controlled by the EOA derived from the `WORKER_PRIVATE_KEY`.
4.  **Persist Public Data**: Once the on-chain identity is confirmed, its public data (Safe address, owner address, etc.) is persisted locally to speed up future initializations.

This robust process ensures every agent has a stable, secure, and unique identity on the blockchain, enabling it to own assets, participate in governance, and interact with other decentralized services.

## Architectural Philosophy

The design of this system is guided by a few core principles:

-   **Universal Event Bus & Causal Tracing**: The system is built on a simple, powerful idea: every action is triggered by a persisted event. The `events` table serves as a universal event bus for the entire system. This ensures that every job has a clear, non-nullable `source_event_id`, creating an unbroken, universally traceable causal chain for every operation. This is the foundation of the system's observability and metacognitive capabilities.
-   **Event-Driven & Database-Centric**: The database is the single source of truth. All state changes and actions are modeled as database events. Complex workflows and agent coordination are orchestrated through PostgreSQL triggers and functions, minimizing the need for complex application-level logic. If a task can be automated in the database, it should be.
-   **Project-Based Organization**: Every job execution is tied to a project context through `project_run_id`, providing hierarchical organization and enabling complex multi-agent workflows with shared context and objectives.
-   **Lean Workers, Smart Agents**: The `worker` is a simple, stateless executor. Its only job is to poll for work, execute it, and report back. The core intelligence resides in the `Agent` class, which handles LLM interaction, and the `metacog-mcp` tools, which provide the agent with its capabilities.
-   **Tools Over Prompts for Dynamic Context**: Prompts should guide the agent's reasoning process and define its high-level goals. They should not be cluttered with dynamic information (like file lists, database schemas, or tool definitions). Instead, prompts should instruct the agent to *use tools* to discover that information from its environment. This makes prompts more stable, reusable, and focused on reasoning.
-   **Metacognition & Self-Improvement**: The system is designed for agents to reason about their own behavior and the state of the system. By using tools like `get_context_snapshot`, `get_job_graph`, and `trace_lineage`, an agent can analyze operational data, understand system-level causal relationships, and autonomously create new jobs to improve itself.
-   **Rich Context Management**: The system provides agents with comprehensive operational context through two key mechanisms: `trigger_context` (rich information about what triggered the job) and `delegated_work_context` (comprehensive summaries of work delegated to child jobs). This ensures agents have the foundation they need to make informed decisions and take effective action.

---

## Project Structure

The repository has been flattened for simplicity and easier development. Here's the current structure:

```
jinn-gemini/
├── worker/                    # Worker application
│   ├── worker.ts             # Legacy worker logic
│   └── mech_worker.ts        # NEW: On-chain mech worker
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

The system consists of several key components that work together in a continuous loop.

1.  **Hybrid Data Model (Ponder + Supabase)**: The system now uses a hybrid data model.
    -   **Ponder (Primary Indexer)**: Ponder is the primary data source for on-chain events. It indexes `Request` and `Deliver` events from the Mech Marketplace on Base and exposes them via a GraphQL API. This is the new "single source of truth" for on-chain job status.
    -   **Supabase (Off-Chain Persistence)**: Supabase is used for off-chain data persistence and worker coordination. It stores `onchain_*` tables for request claims, job reports, and artifacts, all linked back to the on-chain `request_id`.
2.  **On-Chain Worker (`worker/mech_worker.ts`)**: The new primary worker for processing on-chain jobs. It continuously polls the Ponder GraphQL API for new `Request` events, atomically claims them in Supabase, invokes the agent, stores the results, and delivers the final output on-chain.
3.  **Agent (`gemini-agent/agent.ts`)**: The "brain" of the operation. It now receives on-chain context (`JINN_REQUEST_ID`, `JINN_MECH_ADDRESS`) and uses tools to interact with the new on-chain system.
4.  **Tools (`gemini-agent/mcp/`)**: The agent's capabilities have been updated for the on-chain world.
    -   `post_marketplace_job`: The new tool for posting jobs to the Mech Marketplace.
    -   `create_record`: Now automatically injects `request_id` and `worker_address` when writing to `onchain_*` tables, ensuring universal causal tracing.
5.  **On-Chain Execution (Gnosis Safe)**: The worker uses a Gnosis Safe to deliver results on-chain via the `deliverViaSafe` function in `mech-client-ts`.
6.  **Frontend Explorer (`frontend/explorer/`)**: A Next.js web interface for exploring data, viewing job reports, and monitoring system status.

---

## Constants
- Supabase project ID is: kmptsnmabdwgjyctowyz
- **Tenderly**: Use Virtual Testnets (vnets), NOT deprecated forks. API endpoint: `/testnet/container`

---

## The Lifecycle of a Job

The entire system operates on a continuous, on-chain, event-driven cycle:

1.  **Job Creation**: An agent calls the `post_marketplace_job` tool, which posts a `Request` to the Mech Marketplace contract on Base. The request's metadata (prompt, tools) is stored on IPFS.
2.  **Indexing**: The `Ponder` service, which is listening to the Mech Marketplace contract, indexes the new `Request` event and makes it available via its GraphQL API.
3.  **Discovery & Claim**: The `mech_worker` polls the Ponder GraphQL API, discovers the new `Request`, and atomically claims it by creating a record in the `onchain_request_claims` table in Supabase. This prevents other workers from processing the same job.
4.  **Execution**: The worker invokes the `Agent`, passing the on-chain `requestId` and `mechAddress` as environment variables (`JINN_REQUEST_ID`, `JINN_MECH_ADDRESS`). The agent fetches the prompt from IPFS and begins execution.
5.  **Tool Setup**: The agent dynamically creates a `.gemini/settings.json` file that configures the Gemini CLI to use the `gemini-agent/mcp` server and exposes *only* the tools enabled for that job.
6.  **LLM Interaction**: The agent spawns the Gemini CLI process. The LLM uses the provided tools as needed by making calls to the MCP server.
7.  **Reporting**: After execution, the worker stores the final output and detailed telemetry in the `onchain_job_reports` and `onchain_artifacts` tables in Supabase, linking them to the `request_id`.
8.  **Delivery**: The worker calls `deliverViaSafe` to submit the IPFS hash of the result to the Mech Marketplace contract on-chain. This creates a `Deliver` event.
9.  **Completion**: Ponder indexes the `Deliver` event, marking the job as complete on-chain.

---

## Enhanced Context Management

The system now provides agents with comprehensive operational context through two key mechanisms:

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
- Gemini CLI installed and authenticated on your host machine.

### 1. Setup
1.  **Install Dependencies**:
    ```bash
    yarn install
    ```
2.  **Configure Environment**:
    Create a `.env` file in the root directory with your Supabase credentials:
    ```env
    SUPABASE_URL=https://your-project-ref.supabase.co
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

### 3. Running the System

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

### 4. Viewing Logs and Monitoring
- **Worker logs**: Displayed in the console where you run the command
- **Frontend**: Access at http://localhost:3000 to explore data and job reports
- **Database**: Check Supabase dashboard for job status and reports

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
yarn dev            # Start worker only
yarn frontend:dev   # Start frontend only
yarn dev:all        # Start both worker and frontend (recommended)
```

#### Production Commands
```bash
yarn start          # Start worker only
yarn frontend:start # Start frontend only
yarn start:all      # Start both worker and frontend
```

### Running Services Locally
For easier development, you can run the MCP server or the worker directly on your host machine.

-   **Run the MCP Server**:
    ```bash
    yarn mcp:start
    ```
-   **Run the Worker**:
    ```bash
    yarn build
    node dist/worker.js
    ```
-   **Run the Frontend**:
    ```bash
    yarn frontend:dev
    ```

### Adding a New Tool
1.  **Create Tool File**: Add a new file in `gemini-agent/mcp/tools/`.
2.  **Define Schema**: Use Zod to define the input parameter schema for your tool.
3.  **Implement Logic**: Write the tool's function, which will typically interact with the database via the `supabase` client.
4.  **Register Tool**: In `gemini-agent/mcp/server.ts`, import your new tool and add it to the `serverTools` array. The tool name will be automatically prefixed with `mcp_`. The tool will be automatically discoverable by the `list_tools` tool.

### Job Context Injection

When the worker executes a job, it passes a job context to the MCP tool layer. This context is available to tools and is automatically injected into writes where appropriate.

- Fields provided in job context:
  - `job_id`: The runtime job run ID from `job_board.id`.
  - `job_definition_id`: The definition/version ID from `jobs.id` that the run references.
  - `job_name`: The human‑readable job name from the job definition.
  - `project_run_id`: The resolved project scope for the job, when available.

- Auto‑injection behavior in tools:
  - `create_record` automatically adds `source_job_id`, `source_job_name`, `project_run_id`, and `job_definition_id` to the payload it sends to the database function. The database validates and writes only columns that exist on the target table.
  - This ensures durable lineage across core tables (`artifacts`, `job_reports`, `memories`, `messages`, and `project_runs`) linking records back to the exact job definition and run that produced them.

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
  - Tools like `search_memories` and `get_details` do not truncate by default.

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

The MCP tools now support routing writes to the **Jinn Control API** for on-chain jobs, providing a secure, auditable write layer for `onchain_*` tables.

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
- Requires `requestId` from job context (only works within on-chain jobs)
- Automatically injects `request_id` and `worker_address`
- Returns structured response with artifact metadata

#### Usage Examples

```javascript
// Create artifact via Control API (on-chain job context required)
create_artifact({
  topic: "analysis",
  content: "Detailed analysis results...",
  cid: "QmHash..." // Optional IPFS CID
})

// Create record - automatically routes based on table type
create_record({
  table_name: "onchain_job_reports", // Routes to Control API
  data: {
    status: "COMPLETED",
    duration_ms: 5000,
    final_output: "Task completed successfully"
  }
})

create_record({
  table_name: "artifacts", // Routes to Supabase
  data: {
    topic: "legacy_artifact",
    content: "Legacy system artifact"
  }
})
```

#### Error Handling

Control API errors are clearly distinguished in tool responses:

```json
{
  "data": null,
  "meta": {
    "ok": false,
    "code": "CONTROL_API_ERROR",
    "message": "Control API error: Unknown request_id"
  }
}
```

Common error codes:
- `CONTROL_API_ERROR`: GraphQL or HTTP errors from Control API
- `CONTROL_API_DISABLED`: Control API is disabled via environment
- `MISSING_REQUEST_ID`: Required for on-chain operations
- `VALIDATION_ERROR`: Invalid parameters

---

#### `get_job_graph` & `trace_lineage`
These tools provide deep insight into the system's causal architecture.

- **`get_job_graph({topic?: string})`**: Allows the agent to inspect the system's static "blueprint." It shows which jobs publish artifacts on a given topic and which jobs subscribe to them, revealing the potential chain of events for any given topic.
- **`trace_lineage({artifact_id?: string, job_id?: string})`**: Provides universal causal tracing. Starting from any job or artifact, it can walk the execution graph forwards (what did this cause?) or backwards (what caused this?), providing a complete history of any process.

These tools are fundamental for advanced metacognition, allowing an agent to understand not just *what* is happening, but *why* it's happening and what the downstream consequences of its actions will be.

### Debugging
You can run the worker in debug mode by passing the `--debug` or `-d` flag. This will pass the `--debug` flag to the Gemini CLI, providing verbose output on its operations.
```bash
node dist/worker.js --debug
```
This is extremely useful for inspecting prompts, tool calls, and model responses in detail.

For post-execution analysis, you can inspect the `job_reports` table in the database. It contains comprehensive details about each job's execution, including:
- **Performance Metrics**: Token usage (`total_tokens`), execution duration (`duration_ms`)
- **Tool Usage**: Detailed tool call logs with success rates and timing (`tools_called`)
- **Full Conversations**: Complete request/response data (`request_text`, `response_text`)
- **Error & Warning Tracking**: Both critical failures and warning-level issues (`error_message`, `error_type`)
- **Raw Telemetry**: Complete telemetry data for debugging (`raw_telemetry`)

This integrated telemetry system provides complete visibility into system performance and enables data-driven optimization of job definitions and workflows.

For post-execution analysis, you can inspect the `job_reports` table in the database. It contains comprehensive details about each job's execution, including the full request/response, tool calls, duration, and any errors that occurred.

---

## Database Reset State

When performing a complete system reset, the database should be cleared to this minimal state:

### **Tables with Data (Keep):**
1. **`jobs`** - 2 rows:
   - `chief_orchestrator` - The main strategic orchestrator job
   - `human_supervisor` - Human oversight job

2. **`project_definitions`** - 1 row:
   - Main project definition for the system

3. **`messages`** - 1 row:
   - Initial message from human supervisor to chief orchestrator (status: PENDING)

### **Tables to Empty (Clear All Rows):**
- `job_board` - No pending jobs
- `project_runs` - No active project runs  
- `job_reports` - No job execution reports
- `events` - No event history
- `artifacts` - No artifacts
- `memories` - No memories

### **Reset Commands:**
```sql
-- Clear all dynamic data while preserving core definitions
DELETE FROM job_board;
DELETE FROM project_runs; 
DELETE FROM job_reports;
DELETE FROM events;
DELETE FROM artifacts;
DELETE FROM memories;

-- Ensure the initial message is in PENDING state
UPDATE messages SET status = 'PENDING' WHERE status != 'PENDING';
```

### **Post-Reset Behavior:**
1. **System quiescence event** will automatically trigger the Chief Orchestrator
2. **Chief Orchestrator** will create new projects and job definitions as needed
3. **All new jobs** will start fresh without any previous execution history

### **Important Notes:**
- **Message Status**: After reset, ensure all messages have `status = 'PENDING'` to prevent them from appearing in red in the frontend
- **Clean State**: The reset removes all execution history, providing a clean foundation for testing new workflows
- **Project Context**: All new jobs will be created with proper project context through `project_run_id`

### **⚠️ CRITICAL WARNING - NEVER DO THIS:**
**NEVER use `TRUNCATE TABLE` with `CASCADE` on tables that contain the core system definitions!** 

The `TRUNCATE ... CASCADE` command will delete ALL related data, including the core `jobs`, `project_definitions`, and `messages` tables that contain the system foundation. This completely destroys the system and defeats the purpose of a reset.

**What NOT to do:**
```sql
-- ❌ NEVER DO THIS - It deletes everything including core definitions
TRUNCATE TABLE jobs, project_definitions, messages CASCADE;
```

**What TO do instead:**
```sql
-- ✅ CORRECT - Only clear dynamic/runtime data
DELETE FROM job_board;
DELETE FROM project_runs; 
DELETE FROM job_reports;
DELETE FROM events;
DELETE FROM artifacts;
DELETE FROM memories;
-- Keep jobs, project_definitions, and messages intact!
```

**If you accidentally delete everything:**
1. Stop immediately
2. Recreate the core system from scratch using the definitions in this README
3. Never use `TRUNCATE ... CASCADE` on core system tables

This reset state provides a clean foundation for testing new job definitions and workflows while preserving the core system configuration.
