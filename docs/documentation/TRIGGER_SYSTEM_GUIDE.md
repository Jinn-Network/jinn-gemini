# Trigger System Guide

## Overview: The Universal Events Bus

The system now uses a first‑class `events` table as a universal bus. Core idea:

Every triggerable occurrence is persisted as an immutable event.

- `events(event_type, payload, project_run_id, job_id, agent_id, parent_event_id, correlation_id, created_at)`
- The dispatcher listens only to INSERTs on `events` and enqueues matching jobs.
- Each enqueued job records a causal link via `job_board.source_event_id` and is scoped to a `project_run_id`.
- **NEW**: Enhanced context management provides rich operational context through `trigger_context` and `delegated_work_context`.

Benefits
- Simple, uniform routing (one trigger surface).
- Full causality and replay (immutable events + `source_event_id`).
- Strong scoping via `project_run_id` (work packaging and context).
- **NEW**: Rich operational context for informed agent decision-making.
- **NEW**: Complete delegation tracking and child work visibility.

## How It Works

1) Event occurs → INSERT into `public.events` with `event_type` and `payload` (or call `emit_event(...)`).
2) `universal_event_trigger` fires `universal_job_dispatcher_v2()` on INSERT.
3) Dispatcher finds active `jobs` whose `schedule_config` matches `event_type` and `payload`.
4) For each match, INSERT into `job_board` with:
   - `source_event_id` = event.id
   - `project_run_id` = event.project_run_id
   - **NEW**: `trigger_context` = rich information about the triggering event and resolved source data
   - **NEW**: `delegated_work_context` = comprehensive summaries of child jobs completed after parent's last run

## Enhanced Context Management

### **Trigger Context (`trigger_context`)**
Rich information about what triggered the job, automatically built by the dispatcher:

- **Event Details**: Complete event information (ID, type, payload, source)
- **Resolved Source Data**: Enhanced context from the event's source:
  - **Artifacts**: Full content, topic, status, and metadata
  - **Job Board Entries**: Job execution details, outputs, and related data
  - **Events**: Parent event relationships and correlation IDs
  - **Other Sources**: Table-specific data resolution

### **Delegated Work Context (`delegated_work_context`)**
Comprehensive summaries of work delegated to child jobs:

- **Child Job Summaries**: ID, name, output, status, completion time
- **Job Definition IDs**: Complete traceability back to job definitions
- **Artifacts**: Related artifacts created by child jobs (with content truncation)
- **Job Reports**: Performance metrics and final outputs
- **Timing Filtering**: Only work completed after parent's last execution
- **Statistical Overview**: Total counts, completion rates, and timing information

## System Event Types

- `system.project.created`, `system.project.updated`
- `system.job.status_changed`
- `system.cron.tick`, `system.processing_time.update`
- `system.job.manual_dispatch` - **NEW**: For manual job dispatching

## Project Packaging (deterministic)

- Work is grouped into `project_runs` (executions) under optional `project_definitions` (canonical project).
- Events and jobs always carry `project_run_id`.
- Outputs (`artifacts`, `messages`, `memories`) inherit `project_run_id` from their `job_id` via triggers.
- **NEW**: Delegation tracking via `parent_job_definition_id` provides clear lineage for multi-agent workflows.

## `schedule_config` Format (jobs)

Jobs subscribe to events:

```json
{
  "trigger": "on_new_event",
  "filters": {
    "event_type": "system.job.status_changed",
    "payload": { "new_status": "COMPLETED" }
  }
}
```

Notes
- Use `event_type` for the routing key.
- Optionally match on `payload` fields (JSON containment).
- **NEW**: Enhanced filtering capabilities for complex event patterns.

## Examples

Subscribe to job completion:
```sql
INSERT INTO jobs (name, prompt_content, enabled_tools, schedule_config, is_active, model_settings)
VALUES (
  'process_extracted_data',
  'You are a data processor...',
  ARRAY['read_records','update_records'],
  '{
    "trigger": "on_new_event",
    "filters": {
      "event_type": "system.job.status_changed",
      "payload": { "new_status": "COMPLETED" }
    }
  }'::jsonb,
  true,
  '{"model": "gemini-2.5-flash"}'
);
```

Subscribe to cron ticks:
```sql
INSERT INTO jobs (name, prompt_content, enabled_tools, schedule_config, is_active, model_settings)
VALUES (
  'hourly_system_check',
  'You are a system monitor...',
  ARRAY['get_context_snapshot'],
  '{
    "trigger": "on_new_event",
    "filters": {
      "event_type": "system.cron.tick",
      "payload": { "pattern": "0 * * * *" }
    }
  }'::jsonb,
  true,
  '{"model": "gemini-2.5-flash"}'
);
```

Declarative emission (publisher emits an event):
```sql
SELECT emit_event(
  'analysis.complete',
  '{"summary": "..."}'::jsonb,
  p_source_table := 'project_runs',
  p_source_id := '00000000-0000-0000-0000-000000000000'::uuid,
  p_job_id := NULL,
  p_agent_id := NULL,
  p_project_run_id := '00000000-0000-0000-0000-000000000000'::uuid
);
```

## Enhanced Context Examples

### **Artifact-Triggered Job Context**
When a job is triggered by an artifact event, the `trigger_context` includes:

```json
{
  "event": {
    "id": "event-uuid",
    "type": "artifact.created",
    "payload": {...},
    "source_table": "artifacts",
    "source_id": "artifact-uuid"
  },
  "resolved_source": {
    "topic": "data_collection",
    "status": "PROCESSED",
    "content": "Full artifact content...",
    "created_at": "2025-01-15T...",
    "artifact_id": "artifact-uuid"
  }
}
```

### **Job Board-Triggered Job Context**
When a job is triggered by a job status change, the `trigger_context` includes:

```json
{
  "event": {
    "id": "event-uuid",
    "type": "job.completed",
    "payload": {...},
    "source_table": "job_board",
    "source_id": "job-execution-uuid"
  },
  "resolved_source": {
    "output": "Job execution output...",
    "status": "COMPLETED",
    "job_name": "Data Processor",
    "created_at": "2025-01-15T...",
    "job_execution_id": "job-execution-uuid",
    "related_artifacts": [...],
    "related_job_reports": [...],
    "related_memories": [...]
  }
}
```

### **Delegated Work Context Example**
For a job that has delegated work to child jobs:

```json
{
  "child_jobs": [
    {
      "id": "child-job-uuid",
      "name": "Data Collector",
      "output": "Collection completed...",
      "status": "COMPLETED",
      "completion_time": "2025-01-15T...",
      "job_definition_id": "child-job-def-uuid",
      "artifacts": [
        {
          "id": "artifact-uuid",
          "topic": "raw_data",
          "content": "Collected data content..."
        }
      ]
    }
  ],
  "summary": {
    "total_child_jobs": 1,
    "completed": 1,
    "failed": 0,
    "total_artifacts": 1,
    "last_completion": "2025-01-15T..."
  }
}
```

## Testing Enhanced Context

1) Create a `jobs` subscriber with `trigger: on_new_event`.
2) Insert an event via `emit_event(...)` that matches the filter.
3) Check `job_board` for a new `PENDING` job with rich context:
```sql
SELECT 
  id, 
  job_name, 
  status, 
  source_event_id, 
  project_run_id,
  trigger_context,
  delegated_work_context
FROM job_board
WHERE created_at > NOW() - INTERVAL '1 minute'
ORDER BY created_at DESC;
```

4) Verify the context columns contain rich, actionable information:
   - `trigger_context` should include event details and resolved source data
   - `delegated_work_context` should include child job summaries (if applicable)

## Context Integration in Worker

The worker now constructs enhanced prompts that preserve all existing elements while adding:

- **Job Header**: Basic job identification and context
- **Input**: Original job prompt and instructions  
- **Inbox**: Recent messages and communications
- **Trigger Context**: Rich information about what caused the job
- **Delegated Work Context**: Comprehensive summaries of delegated work
 - **Recent Runs Context**: Summaries of recent executions for the same job definition (when available)

This ensures agents have the foundation they need to make informed decisions and take effective action without losing any existing functionality.

## Benefits of Enhanced Context

### **For Agents**
- **Rich Operational Visibility**: Complete understanding of what triggered them and why
- **Data-Driven Decisions**: Access to source artifacts, job outputs, and related data
- **Delegation Awareness**: Comprehensive view of work delegated to child jobs
- **Traceability**: Complete audit trail from execution back to job definitions

### **For System Operators**
- **Debugging**: Rich context for troubleshooting job execution issues
- **Monitoring**: Complete visibility into job dependencies and delegation chains
- **Auditing**: Full traceability of all system activities and decisions
- **Optimization**: Data-driven insights for improving job definitions and workflows

This event‑bus architecture with enhanced context management provides a robust, transparent, and debuggable foundation for the agentic system with strict work packaging and comprehensive operational visibility.
