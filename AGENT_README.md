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

-   **Universal Event Bus & Causal Tracing**: The system is built on a simple, powerful idea: every action is triggered by a persisted artifact. The `artifacts` table serves as a universal event bus for the entire system. This ensures that every job has a clear, non-nullable `source_artifact_id`, creating an unbroken, universally traceable causal chain for every operation. This is the foundation of the system's observability and metacognitive capabilities.
-   **Event-Driven & Database-Centric**: The database is the single source of truth. All state changes and actions are modeled as database events. Complex workflows and agent coordination are orchestrated through PostgreSQL triggers and functions, minimizing the need for complex application-level logic. If a task can be automated in the database, it should be.
-   **Lean Workers, Smart Agents**: The `worker` is a simple, stateless executor. Its only job is to poll for work, execute it, and report back. The core intelligence resides in the `Agent` class, which handles LLM interaction, and the `metacog-mcp` tools, which provide the agent with its capabilities.
-   **Tools Over Prompts for Dynamic Context**: Prompts should guide the agent's reasoning process and define its high-level goals. They should not be cluttered with dynamic information (like file lists, database schemas, or tool definitions). Instead, prompts should instruct the agent to *use tools* to discover that information from its environment. This makes prompts more stable, reusable, and focused on reasoning.
-   **Metacognition & Self-Improvement**: The system is designed for agents to reason about their own behavior and the state of the system. By using tools like `get_context_snapshot`, `get_job_graph`, and `trace_lineage`, an agent can analyze operational data, understand system-level causal relationships, and autonomously create new jobs to improve itself.

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

1.  **Database Core (Supabase/Postgres)**: The heart of the system. It uses a set of tables and a sophisticated trigger system built around a universal event bus (`artifacts` table) to manage the entire workflow. Every dispatched job is explicitly linked to its triggering artifact via `source_artifact_id`, ensuring complete traceability. See `docs/documentation/DATABASE_MAP.md` for a detailed schema.
2.  **Worker (`worker/worker.ts`)**: A Node.js application that continuously polls the `job_board` for `PENDING` jobs. It is responsible for claiming a job, invoking the agent, and reporting the outcome.
3.  **Agent (`gemini-agent/agent.ts`)**: The "brain" of the operation. It wraps the Gemini CLI and is responsible for:
    -   Dynamically generating job-specific settings to enable the correct set of tools.
    -   Executing the LLM prompt with integrated telemetry collection.
    -   Parsing detailed telemetry data (token usage, tool calls, performance metrics) directly from Gemini CLI output files.
    -   Capturing both critical errors and warning-level issues for comprehensive job reporting.
4.  **Tools (`gemini-agent/mcp/`)**: A set of capabilities the agent can use. These are exposed via a **Model Context Protocol (MCP)** server, which acts as a secure bridge between the agent and the database. Tools include `get_schema`, `read_records`, and powerful awareness tools like `get_job_graph`, `trace_lineage`, and `get_context_snapshot`.
5.  **Frontend Explorer (`frontend/explorer/`)**: A Next.js web interface for exploring data, viewing job reports, and monitoring system status.

---

## Constants
- Supbase project ID is: clnwgxgvmnrkwqdblqgf
- **Tenderly**: Use Virtual Testnets (vnets), NOT deprecated forks. API endpoint: `/testnet/container`

---

## The Lifecycle of a Job

The entire system operates on a continuous, event-driven cycle:

1.  **Event (Artifact Creation)**: An event occurs in the system, which is always represented by the creation of a new artifact. This could be a system-level event (like `system.cron.tick`), a job status change (`system.job.status_changed`), or a declarative emission from another completed job.
2.  **Dispatch**: The `universal_job_dispatcher` trigger, which listens exclusively for new rows in the `artifacts` table, finds all `jobs` definitions that subscribe to the new artifact's `topic`. It then creates corresponding `PENDING` entries in the `job_board`, critically populating each with the `source_artifact_id` of the artifact that caused it.
3.  **Claim**: A `worker` instance polls the `job_board`, finds the `PENDING` job, and atomically claims it by setting its status to `IN_PROGRESS` and assigning its own `worker_id`.
4.  **Execution**: The worker invokes the `Agent`, passing it the prompt, context, and the list of `enabled_tools` for that specific job.
5.  **Tool Setup**: The agent dynamically creates a `.gemini/settings.json` file that configures the Gemini CLI to use the `gemini-agent/mcp` server and exposes *only* the tools enabled for that job.
6.  **LLM Interaction**: The agent spawns the Gemini CLI process. The LLM uses the provided tools as needed by making calls to the MCP server, which executes the corresponding database functions.
7.  **Reporting**: After execution, the worker collects the final output and detailed telemetry (token counts, tool calls, duration, errors, warnings) from the Agent's integrated telemetry parser and creates a comprehensive record in the `job_reports` table with full visibility into job performance and issues.
8.  **Completion**: The worker updates the job's status in the `job_board` to `COMPLETED` or `FAILED`, making the result available to the rest of the system and potentially triggering the next job in a chain by creating a new artifact.

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
