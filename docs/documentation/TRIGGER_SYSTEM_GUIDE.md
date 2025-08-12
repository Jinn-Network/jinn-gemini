# Trigger System Guide

## Overview: The Universal Events Bus

The system now uses a first‑class `events` table as a universal bus. Core idea:

Every triggerable occurrence is persisted as an immutable event.

- `events(event_type, payload, project_run_id, job_id, agent_id, parent_event_id, correlation_id, created_at)`
- The dispatcher listens only to INSERTs on `events` and enqueues matching jobs.
- Each enqueued job records a causal link via `job_board.source_event_id` and is scoped to a `project_run_id`.

Benefits
- Simple, uniform routing (one trigger surface).
- Full causality and replay (immutable events + `source_event_id`).
- Strong scoping via `project_run_id` (work packaging and context).

## How It Works

1) Event occurs → INSERT into `public.events` with `event_type` and `payload` (or call `emit_event(...)`).
2) `universal_event_trigger` fires `universal_job_dispatcher()` on INSERT.
3) Dispatcher finds active `agents` whose `schedule_config` matches `event_type` and `payload`.
4) For each match, INSERT into `job_board` with:
   - `source_event_id` = event.id
   - `project_run_id` = event.project_run_id
   - prepacked `input_context` (brief for the run).

## System Event Types

- `system.project.created`, `system.project.updated`
- `system.job.status_changed`
- `system.cron.tick`, `system.processing_time.update`

## Project Packaging (deterministic)

- Work is grouped into `project_runs` (executions) under optional `project_definitions` (canonical project).
- Events and jobs always carry `project_run_id`.
- Outputs (`artifacts`, `messages`, `memories`) inherit `project_run_id` from their `job_id` via triggers.

## `schedule_config` Format (agents)

Agents subscribe to events:

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

## Examples

Subscribe to job completion:
```sql
INSERT INTO agents (name, prompt_content, enabled_tools, schedule_config, is_active)
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
  true
);
```

Subscribe to cron ticks:
```sql
INSERT INTO agents (name, prompt_content, enabled_tools, schedule_config, is_active)
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
  true
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

## Testing

1) Create an `agents` subscriber with `trigger: on_new_event`.
2) Insert an event via `emit_event(...)` that matches the filter.
3) Check `job_board` for a new `PENDING` job:
```sql
SELECT id, job_name, status, source_event_id, project_run_id
FROM job_board
WHERE created_at > NOW() - INTERVAL '1 minute'
ORDER BY created_at DESC;
```

This event‑bus architecture provides a robust, transparent, and debuggable foundation for the agentic system with strict work packaging.
