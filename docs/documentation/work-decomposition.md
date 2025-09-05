# Work Decomposition Architecture

## Purpose and Philosophy

Work decomposition is the system’s strategy for turning a high‑level goal into a sequence of concrete, reliable actions. At runtime, the agent decides whether to:
- Execute the goal directly in a single job
- Decompose the goal into smaller jobs (parallel or serial) that are easier to execute, monitor, and evolve

The core idea is a **decomposition and recomposition** process with full context continuity:
- **Decomposition**: An agent breaks a large task into smaller, manageable jobs. It has context from its parent job (via `trigger_context`) to inform this breakdown.
- **Recomposition**: After its child jobs complete, the agent can review their collective outputs (via `delegated_work_context`) to synthesize a final result, assess success, and decide on next steps.

This creates a continuous flow of information, allowing for complex, multi-step workflows with full traceability.

Guiding principles:
- Prefer small, decoupled jobs with durable names
- Equip each job with the minimum, sufficient toolset
- Pass context explicitly and persist outcomes for traceability
- Evolve job definitions via versioned updates rather than one‑off edits

## Core Components

- Tools (MCP):
  - create_job: Create a single job definition (or a new version of an existing job) with a schedule
  - create_job_batch: Create multiple jobs at once, sequenced parallel or serial
  - update_job: Create a new version of an existing job with updated prompt/tools/schedule
  - send_message: Send structured messages between agents/jobs to pass critical IDs/data

- Database (Supabase/Postgres):
  - events: Universal event bus (immutable). Triggers dispatch
  - jobs: Versioned job definitions (name, prompt, tools, schedule)
  - job_board: Runtime queue (per‑execution). Holds rich context for the worker
  - job_reports: Telemetry and final output per run
  - artifacts, messages, memories: Persist outputs, comms, strategic learnings

- Dispatcher (DB function):
  - universal_job_dispatcher_v2 (AFTER INSERT on events)
  - Builds per‑job rich context and inserts PENDING rows into job_board

- Worker and Agent:
  - Worker claims jobs, composes prompts with rich context, invokes Agent
  - Agent generates per‑job Gemini settings, executes with tools, parses telemetry

## End‑to‑End Flow

1) Job(s) are defined
- Via create_job or create_job_batch (or plan_project in some flows)
- Each job has schedule_config:
  - manual (dispatch immediately once), or
  - on_new_event + filters (e.g., event_type: job.completed)

2) Events drive dispatch
- Any event INSERT triggers universal_job_dispatcher_v2
- For each matching active job definition, the dispatcher inserts a `PENDING` row into `job_board` and populates rich context

3) Rich context on `job_board`
- `trigger_context`: **Parent Context**. Event details plus resolved source data (artifacts, job executions, or event hierarchy) provide continuity from the parent job.
- `delegated_work_context`: **Child Context**. Summaries of child jobs completed since the parent’s last run (outputs + artifacts + job_report links, token‑budgeted truncation) allow for review and recomposition of delegated work.
- `recent_runs_context`: Recent executions for the same job definition (IDs, outputs, timing summary)
- Always set: `source_event_id` and `project_run_id` for causal tracing and packaging

4) Worker composes the prompt
- The worker merges input + context into the final prompt. When a context section is null/empty it is omitted.

```673:679:worker/worker.ts
const triggerContextSection = composeTriggerContextSection(truncateContext(job.trigger_context, TOKEN_CONFIG.TRIGGER_CONTEXT_MAX_TOKENS, false));
const delegatedWorkContextSection = composeDelegatedWorkContextSection(truncateContext(job.delegated_work_context, TOKEN_CONFIG.DELEGATED_WORK_CONTEXT_MAX_TOKENS, true));
const recentRunsContextSection = composeRecentRunsContextSection(job.recent_runs_context);
const rawPrompt = `${jobHeader}${job.input || ''}${inboxSection}${triggerContextSection}${delegatedWorkContextSection}${recentRunsContextSection}`.trim();
```

5) Agent executes with tools
- Generates .gemini/settings.json to include the exact toolset allowed for the job
- Propagates job context via env vars (e.g., JINN_JOB_ID, JINN_PROJECT_RUN_ID) so MCP tools can inject lineage automatically
- Parses telemetry (token counts, tool calls, request/response excerpts)

6) Reporting and completion
- Worker writes a job_reports row with final output and full telemetry
- Job status transitions to COMPLETED or FAILED, emitting follow‑up events as needed

## Dispatcher: Context Construction (DB‑level)

- The dispatcher constructs trigger_context by resolving the event’s source table (artifacts, job_board, or events) and embedding relevant fields.
- delegated_work_context is assembled by querying child job runs tied to the parent job definition since its last run, including trimmed output and artifacts.content for token safety.
- recent_runs_context summarizes the last few runs for the same job definition (IDs, output snippets, timestamps) to give agents quick historical grounding.

Live schema excerpt (selected columns):
- job_board: id, status, job_name, source_event_id, project_run_id, trigger_context, delegated_work_context, recent_runs_context, parent_job_definition_id, job_definition_id
- jobs: id, job_id, version, name, prompt_content, enabled_tools, schedule_config, is_active, parent_job_definition_id

## Tools for Decomposition

### create_job
- Creates a single job or a new version of an existing job
- Schedules:
  - manual: Dispatch immediately once; requires a current job context (inherits the project run)
  - after_this_job: Alias that binds to the current job’s job.completed event when possible
  - job.completed (explicit): With payload discrimination (e.g., { payload: { job_definition_id: <id> } })
  - Any other event type (e.g., artifact.created)
- Prevents duplicate active jobs with the same name
- Auto‑dispatches manual jobs by emitting system.job.manual_dispatch and inserting into job_board

### create_job_batch
- Creates multiple jobs with a specified sequence:
  - parallel: All jobs listen to the current (orchestrator) job’s job.completed event
  - serial: Chains jobs by setting each child to listen for the prior job’s completion
- Validates tool names against the live registry used by the MCP server
- Returns identifiers and metadata for all created jobs

### update_job
- Creates a new version of an existing job
- Deactivates previous version; the new one becomes the active version
- Supports updating prompt, tools, schedule (manual / after_this_job / job.completed / event), and project link

### send_message
- Persists a message targeted to a specific job definition
- Injects lineage from the current job context (job_id, parent_job_definition_id, project_run_id, source_event_id, project_definition_id when available)
- Use to pass critical IDs (artifact_id, model URNs, image URLs) to child jobs

## Database Contract and Lineage

- Writes are routed through DB RPC functions (e.g., create_record, update_records), which enforce allowed tables and column validation
- MCP tools read the job context from environment variables set by the Agent to inject lineage on writes
- Core tables (job_board, artifacts, job_reports, memories, messages) all carry causal columns enabling universal tracing

## Prompt Context: What Agents See

The worker’s prompt includes:
- Job Header (name, IDs)
- Input (job prompt)
- Inbox (recent messages)
- Trigger Context (event + resolved source)
- Delegated Work Context (child job summaries, outputs, artifacts)
- Recent Runs Context (latest runs for the same job definition)

Sections are included only when data exists; token‑aware truncation protects budget.

## Patterns for Decomposition

- Serial pipeline example: Data collection → Analysis → Report
  - create_job_batch with sequence: 'serial' chains jobs via job.completed payloads
  - Parent sends a send_message with the produced artifact_id to the next job

- Parallel fan‑out example: Explore multiple strategies at once
  - create_job_batch with sequence: 'parallel' so all children trigger on the parent’s completion
  - The parent’s subsequent run will see completed child summaries in delegated_work_context

- Evolution: Use update_job to iterate on prompts/tools/schedules after reviewing job_reports telemetry

## Minimal Examples

- Batch creation (serial):
```json
{
  "jobs": [
    { "name": "collect_data", "prompt_content": "Collect X", "enabled_tools": ["read_records"] },
    { "name": "analyze_data", "prompt_content": "Analyze X", "enabled_tools": ["manage_artifact"] },
    { "name": "write_report", "prompt_content": "Report X", "enabled_tools": ["manage_artifact"] }
  ],
  "sequence": "serial"
}
```

- Single job after current job completes:
```json
{
  "name": "follow_up",
  "prompt_content": "Do Y",
  "enabled_tools": ["manage_artifact"],
  "schedule_on": "after_this_job"
}
```

## What Changed in the Refactor

- Unified event‑bus dispatch (events → universal_job_dispatcher_v2)
- Context‑rich job_board rows (trigger_context, delegated_work_context, recent_runs_context)
- Deterministic project packaging on all jobs and outputs (project_run_id everywhere)
- First‑class decomposition tools (create_job, create_job_batch, update_job, send_message)
- Worker prompt assembly upgraded to include all context sections

This architecture enables agents to decide at runtime whether to execute directly or decompose into smaller jobs, while preserving traceability, context, and evolvability across the entire workflow.
