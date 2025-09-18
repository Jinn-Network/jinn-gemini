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
│   └── mech_worker.ts        # The on-chain mech worker
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

---

## Constants
- Supabase project ID is: kmptsnmabdwgjyctowyz
- **Tenderly**: Use Virtual Testnets (vnets), NOT deprecated forks. API endpoint: `/testnet/container`

---

## The Lifecycle of a Job

The entire system operates on a continuous, on-chain, event-driven cycle:

1.  **Job Creation**: An agent calls the `post_marketplace_job` tool, which posts a `Request` event to the Mech Marketplace contract on the Base blockchain. The request's metadata (prompt, tools) is stored on IPFS.
2.  **Indexing**: The `Ponder` service indexes the new `Request` event and makes it available via its GraphQL API.
3.  **Discovery & Claim**: The `mech_worker` polls the Ponder API, discovers the new `Request`, and calls the **Jinn Control API** to atomically claim it. The Control API creates a record in the `onchain_request_claims` table, preventing other workers from processing the same job.
4.  **Execution**: The worker invokes the `Agent`, passing the on-chain `requestId` and `mechAddress` as environment variables (`JINN_REQUEST_ID`, `JINN_MECH_ADDRESS`). The agent fetches the prompt from IPFS and begins execution using its enabled tools.
5.  **Reporting**: During execution, the agent's tools (like `create_artifact`) call the **Jinn Control API** to write their outputs (reports, artifacts, messages) to the `onchain_*` tables in Supabase. The Control API ensures all data is correctly linked to the `request_id`.
8.  **Delivery**: The worker calls `deliverViaSafe` to submit the IPFS hash of the result to the Mech Marketplace contract on-chain. This creates a `Deliver` event.
9.  **Completion**: Ponder indexes the `Deliver` event, marking the job as complete on-chain.

---

## Enhanced Context Management

**NOTE:** The features described below were part of the legacy, database-centric architecture. They are not yet implemented in the new on-chain system but are preserved here as a reference for future development.

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