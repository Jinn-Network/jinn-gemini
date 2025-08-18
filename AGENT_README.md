# Project Jinn: An Autonomous, Event-Driven AI Agent System

## Overview

This project implements a sophisticated, autonomous AI agent system built on an event-driven architecture. It is designed for complex, multi-step tasks that require agents to interact with a dynamic environment, learn from their actions, and even create new tasks for themselves.

The core technologies are:
- **Node.js & TypeScript**: For the worker and agent logic.
- **Supabase (PostgreSQL)**: As the central database for state management, job queuing, and event triggers.
- **Next.js**: For the frontend explorer interface.
- **Gemini CLI**: As the underlying engine for interacting with Google's Gemini models.
- **Model Context Protocol (MCP)**: For providing the agent with a secure and structured way to use tools.

---

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
│   └── worker.ts             # Main worker logic
├── gemini-agent/             # Agent and MCP server
│   ├── agent.ts              # Main agent logic
│   ├── mcp/                  # Model Context Protocol server
│   │   ├── server.ts         # MCP server implementation
│   │   └── tools/            # Tool implementations
│   │       ├── shared/       # Shared utilities
│   │       ├── index.ts      # Tool exports
│   │       └── *.ts          # Individual tool files
│   └── settings.template.json # Gemini CLI settings template
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

1.  **Database Core (Supabase/Postgres)**: The heart of the system. It uses a set of tables and a sophisticated trigger system built around a universal event bus (`events` table) to manage the entire workflow. Every dispatched job is explicitly linked to its triggering event via `source_event_id` and to its project context via `project_run_id`, ensuring complete traceability and organizational structure. The system now includes enhanced context management with `trigger_context` and `delegated_work_context` columns that provide agents with rich operational context. See `docs/documentation/DATABASE_MAP.md` for a detailed schema.
2.  **Worker (`worker/worker.ts`)**: A Node.js application that continuously polls the `job_board` for `PENDING` jobs. It is responsible for claiming a job, invoking the agent, and reporting the outcome. The worker now constructs enhanced prompts that include both trigger context and delegated work context, ensuring agents have comprehensive visibility into their operational environment.
3.  **Agent (`gemini-agent/agent.ts`)**: The "brain" of the operation. It wraps the Gemini CLI and is responsible for:
    -   Dynamically generating job-specific settings to enable the correct set of tools.
    -   Executing the LLM prompt with integrated telemetry collection.
    -   Parsing detailed telemetry data (token usage, tool calls, performance metrics) directly from Gemini CLI output files.
    -   Capturing both critical errors and warning-level issues for comprehensive job reporting.
4.  **Tools (`gemini-agent/mcp/`)**: A set of capabilities the agent can use. These are exposed via a **Model Context Protocol (MCP)** server, which acts as a secure bridge between the agent and the database. Tools include `get_schema`, `read_records`, and powerful awareness tools like `get_job_graph`, `trace_lineage`, and `get_context_snapshot`.
5.  **Frontend Explorer (`frontend/explorer/`)**: A Next.js web interface for exploring data, viewing job reports, and monitoring system status.

---

## Constants
- Supabase project ID is: kmptsnmabdwgjyctowyz

---

## The Lifecycle of a Job

The entire system operates on a continuous, event-driven cycle:

1.  **Event Creation**: An event occurs in the system, which is always represented by the creation of a new record in the `events` table. This could be a system-level event (like `system.cron.tick`), a job status change (`job.completed`), or a declarative emission from another completed job.
2.  **Dispatch**: The `universal_job_dispatcher_v2` trigger, which listens exclusively for new rows in the `events` table, finds all `jobs` definitions that subscribe to the new event's `event_type` and match the event's payload filters. It then creates corresponding `PENDING` entries in the `job_board`, critically populating each with:
    - `source_event_id` of the event that caused it
    - `project_run_id` for organizational context
    - `trigger_context` with rich information about the triggering event and resolved source data
    - `delegated_work_context` with comprehensive summaries of child jobs completed after the parent's last run
3.  **Claim**: A `worker` instance polls the `job_board`, finds the `PENDING` job, and atomically claims it by setting its status to `IN_PROGRESS` and assigning its own `worker_id`.
4.  **Execution**: The worker invokes the `Agent`, passing it an enhanced prompt that includes:
    - The original job prompt and input
    - Rich trigger context about what caused the job
    - Comprehensive delegated work context about child job results
    - Inbox messages and other operational context
5.  **Tool Setup**: The agent dynamically creates a `.gemini/settings.json` file that configures the Gemini CLI to use the `gemini-agent/mcp` server and exposes *only* the tools enabled for that job.
6.  **LLM Interaction**: The agent spawns the Gemini CLI process. The LLM uses the provided tools as needed by making calls to the MCP server, which executes the corresponding database functions.
7.  **Reporting**: After execution, the worker collects the final output and detailed telemetry (token counts, tool calls, duration, errors, warnings) from the Agent's integrated telemetry parser and creates a comprehensive record in the `job_reports` table with full visibility into job performance and issues.
8.  **Completion**: The worker updates the job's status in the `job_board` to `COMPLETED` or `FAILED`, making the result available to the rest of the system and potentially triggering the next job in a chain by creating a new event. The job may also create artifacts in the `artifacts` table for data persistence and lineage tracking.

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
4.  **Register Tool**: In `gemini-agent/mcp/server.ts`, import your new tool and add it to the `serverTools` array. The tool will be automatically registered and discoverable by the `list_tools` tool.

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
   - Main project definition for the Eolas system

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
