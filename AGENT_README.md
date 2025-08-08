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

-   **Event-Driven & Database-Centric**: The database is the single source of truth. All state changes and actions are modeled as database events. Complex workflows and agent coordination are orchestrated through PostgreSQL triggers and functions, minimizing the need for complex application-level logic. If a task can be automated in the database, it should be.
-   **Lean Workers, Smart Agents**: The `worker` is a simple, stateless executor. Its only job is to poll for work, execute it, and report back. The core intelligence resides in the `Agent` class, which handles LLM interaction, and the `metacog-mcp` tools, which provide the agent with its capabilities.
-   **Tools Over Prompts for Dynamic Context**: Prompts should guide the agent's reasoning process and define its high-level goals. They should not be cluttered with dynamic information (like file lists, database schemas, or tool definitions). Instead, prompts should instruct the agent to *use tools* to discover that information from its environment. This makes prompts more stable, reusable, and focused on reasoning.
-   **Metacognition & Self-Improvement**: The system is designed for agents to reason about their own behavior and the state of the system. By using tools like `get_context_snapshot` and `create_job`, an agent can analyze operational data and autonomously create new, scheduled jobs for itself or other agents, enabling a powerful loop of self-improvement. Tools use a shared context manager to return token‑budgeted, single‑page responses with cursor pagination. The context snapshot tool uses this for predictable, context‑safe outputs.

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

1.  **Database Core (Supabase/Postgres)**: The heart of the system. It uses a set of tables (`job_board`, `job_definitions`, `job_schedules`, `job_reports`, etc.) and a sophisticated trigger system to manage the entire workflow. See `docs/documentation/DATABASE_MAP.md` for a detailed schema.
2.  **Worker (`worker/worker.ts`)**: A Node.js application that continuously polls the `job_board` for `PENDING` jobs. It is responsible for claiming a job, invoking the agent, and reporting the outcome.
3.  **Agent (`gemini-agent/agent.ts`)**: The "brain" of the operation. It wraps the Gemini CLI and is responsible for:
    -   Dynamically generating job-specific settings to enable the correct set of tools.
    -   Executing the LLM prompt with integrated telemetry collection.
    -   Parsing detailed telemetry data (token usage, tool calls, performance metrics) directly from Gemini CLI output files.
    -   Capturing both critical errors and warning-level issues for comprehensive job reporting.
4.  **Tools (`gemini-agent/mcp/`)**: A set of capabilities the agent can use. These are exposed via a **Model Context Protocol (MCP)** server, which acts as a secure bridge between the agent and the database. Tools include `get_schema`, `list_tools`, `read_records`, and the powerful `create_job` and `get_context_snapshot`. Tools use a shared context manager for token‑budgeted, single‑page outputs (default 50k tokens/page), field‑aware truncation where appropriate, and stateless cursor pagination. get_context_snapshot uses these defaults.
5.  **Frontend Explorer (`frontend/explorer/`)**: A Next.js web interface for exploring data, viewing job reports, and monitoring system status.

---

## Constants
- Supbase project ID is: clnwgxgvmnrkwqdblqgf

---

## The Lifecycle of a Job

The entire system operates on a continuous, event-driven cycle:

1.  **Trigger**: An event occurs in the database (e.g., a new artifact is inserted, a thread's status changes).
2.  **Dispatch**: A database trigger (`universal_job_dispatcher`) finds a matching `job_schedule` based on the event and its filters. It then creates a new entry in the `job_board` table.
3.  **Claim**: A `worker` instance polls the `job_board`, finds the `PENDING` job, and atomically claims it by setting its status to `IN_PROGRESS` and assigning its own `worker_id`.
4.  **Execution**: The worker invokes the `Agent`, passing it the prompt, context, and the list of `enabled_tools` for that specific job.
5.  **Tool Setup**: The agent dynamically creates a `.gemini/settings.json` file that configures the Gemini CLI to use the `gemini-agent/mcp` server and exposes *only* the tools enabled for that job.
6.  **LLM Interaction**: The agent spawns the Gemini CLI process. The LLM uses the provided tools as needed by making calls to the MCP server, which executes the corresponding database functions.
7.  **Reporting**: After execution, the worker collects the final output and detailed telemetry (token counts, tool calls, duration, errors, warnings) from the Agent's integrated telemetry parser and creates a comprehensive record in the `job_reports` table with full visibility into job performance and issues.
8.  **Completion**: The worker updates the job's status in the `job_board` to `COMPLETED` or `FAILED`, making the result available to the rest of the system and potentially triggering the next job in a chain.

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

### Key Tool: get_context_snapshot
The `get_context_snapshot` tool provides a time‑windowed system overview and now uses the shared context manager:

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