# Project Jinn: An Autonomous, Event-Driven AI Agent System

## Overview

This project implements a sophisticated, autonomous AI agent system built on an event-driven architecture. It is designed for complex, multi-step tasks that require agents to interact with a dynamic environment, learn from their actions, and even create new tasks for themselves.

The core technologies are:
- **Node.js & TypeScript**: For the worker and agent logic.
- **Supabase (PostgreSQL)**: As the central database for state management, job queuing, and event triggers.

- **Gemini CLI**: As the underlying engine for interacting with Google's Gemini models.
- **Model Context Protocol (MCP)**: For providing the agent with a secure and structured way to use tools.

---

## Architectural Philosophy

The design of this system is guided by a few core principles:

-   **Event-Driven & Database-Centric**: The database is the single source of truth. All state changes and actions are modeled as database events. Complex workflows and agent coordination are orchestrated through PostgreSQL triggers and functions, minimizing the need for complex application-level logic. If a task can be automated in the database, it should be.
-   **Lean Workers, Smart Agents**: The `worker` is a simple, stateless executor. Its only job is to poll for work, execute it, and report back. The core intelligence resides in the `Agent` class, which handles LLM interaction, and the `metacog-mcp` tools, which provide the agent with its capabilities.
-   **Tools Over Prompts for Dynamic Context**: Prompts should guide the agent's reasoning process and define its high-level goals. They should not be cluttered with dynamic information (like file lists, database schemas, or tool definitions). Instead, prompts should instruct the agent to *use tools* to discover that information from its environment. This makes prompts more stable, reusable, and focused on reasoning.
-   **Metacognition & Self-Improvement**: The system is designed for agents to reason about their own behavior and the state of the system. By using tools like `get_context_snapshot` and `create_job`, an agent can analyze operational data and autonomously create new, scheduled jobs for itself or other agents, enabling a powerful loop of self-improvement.

---

## System Architecture

The system consists of several key components that work together in a continuous loop.

1.  **Database Core (Supabase/Postgres)**: The heart of the system. It uses a set of tables (`job_board`, `job_definitions`, `job_schedules`, `job_reports`, etc.) and a sophisticated trigger system to manage the entire workflow. See `DATABASE_MAP.md` for a detailed schema.
2.  **Worker (`worker/worker.ts`)**: A containerized Node.js application that continuously polls the `job_board` for `PENDING` jobs. It is responsible for claiming a job, invoking the agent, and reporting the outcome.
3.  **Agent (`gemini-agent/agent.ts`)**: The "brain" of the operation. It wraps the Gemini CLI and is responsible for:
    -   Dynamically generating job-specific settings to enable the correct set of tools.
    -   Executing the LLM prompt with integrated telemetry collection.
    -   Parsing detailed telemetry data (token usage, tool calls, performance metrics) directly from Gemini CLI output files.
    -   Capturing both critical errors and warning-level issues for comprehensive job reporting.
4.  **Tools (`packages/metacog-mcp`)**: A set of capabilities the agent can use. These are exposed via a **Model Context Protocol (MCP)** server, which acts as a secure bridge between the agent and the database. Tools include `get_schema`, `create_record`, `read_records`, and the powerful `create_job` and `get_context_snapshot`.


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
5.  **Tool Setup**: The agent dynamically creates a `.gemini/settings.json` file that configures the Gemini CLI to use the `metacog-mcp` server and exposes *only* the tools enabled for that job.
6.  **LLM Interaction**: The agent spawns the Gemini CLI process. The LLM uses the provided tools as needed by making calls to the MCP server, which executes the corresponding database functions.
7.  **Reporting**: After execution, the worker collects the final output and detailed telemetry (token counts, tool calls, duration, errors, warnings) from the Agent's integrated telemetry parser and creates a comprehensive record in the `job_reports` table with full visibility into job performance and issues.
8.  **Completion**: The worker updates the job's status in the `job_board` to `COMPLETED` or `FAILED`, making the result available to the rest of the system and potentially triggering the next job in a chain.

---

## Getting Started

### Prerequisites
- Node.js and npm
- A Supabase project
- Gemini CLI installed and authenticated on your host machine.

### 1. Setup
1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Configure Environment**:
    Create a `.env` file in the root directory with your Supabase credentials:
    ```env
    SUPABASE_URL=https://your-project-ref.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
    ```
3.  **Gemini CLI Authentication**:
    Ensure you have authenticated the Gemini CLI on your host machine first.

### 2. Running the System
To start the worker with integrated telemetry collection, run:
```bash
npm run dev
```
The worker will start, connect to the database, and begin polling for jobs. All telemetry data (token usage, tool calls, performance metrics, and errors) is automatically captured and stored in the `job_reports` table.

### 3. Viewing Logs
The worker logs will be displayed in the console where you run the command.

---

## Development Guide

### Running Services Locally
For easier development, you can run the MCP server or the worker directly on your host machine.

-   **Run the MCP Server**:
    ```bash
    npm run start -w @metacog/mcp
    ```
-   **Run the Worker**:
    ```bash
    npm run build
    node dist/worker/worker.js
    ```

### Adding a New Tool
1.  **Create Tool File**: Add a new file in `packages/metacog-mcp/src/tools/`.
2.  **Define Schema**: Use Zod to define the input parameter schema for your tool.
3.  **Implement Logic**: Write the tool's function, which will typically interact with the database via the `supabase` client.
4.  **Register Tool**: In `packages/metacog-mcp/src/server.ts`, import your new tool and add it to the `serverTools` array. The tool will be automatically registered and discoverable by the `list_tools` tool.

### Debugging
You can run the worker in debug mode by passing the `--debug` or `-d` flag. This will pass the `--debug` flag to the Gemini CLI, providing verbose output on its operations.
```bash
node dist/worker/worker.js --debug
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