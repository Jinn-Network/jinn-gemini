# Trigger System Guide

## Overview: The Universal Artifact Event Bus

The Jinn system operates on a **universal event bus** architecture. This is a significant simplification from past designs. The core principle is:

**Every event that can trigger a job is first persisted as an artifact.**

This means the `artifacts` table is the single, central event bus for the entire system. Whether an event originates from a cron schedule, a change in a job's status, or is declaratively emitted by another job, it is first recorded as a new row in the `artifacts` table.

This design provides two major benefits:
1.  **Simplicity**: The `universal_job_dispatcher` is now radically simpler. It only needs to listen for `INSERT` operations on the `artifacts` table. It no longer needs to know about different event sources or table types.
2.  **Universal Traceability**: Because every job is triggered by a persisted artifact, every action in the system has a clear, explicit cause. Each job on the `job_board` is linked to its trigger via `source_artifact_id`, creating an unbroken, universally traceable causal chain.

## How It Works

1.  **Event Occurs**: An event source (e.g., `pg_cron`, a job status change) fires.
2.  **Artifact is Created**: Instead of calling the dispatcher, the event source's *only* job is to `INSERT` a structured artifact into the `artifacts` table. This artifact's `topic` and `content` describe the event that occurred.
3.  **Dispatcher Triggers**: The `universal_job_dispatcher` function, attached as a trigger to the `artifacts` table, fires in response to the new artifact.
4.  **Jobs are Matched & Dispatched**: The dispatcher finds all `jobs` whose `schedule_config` subscribes to the new artifact's `topic`.
5.  **Job is Created with Causal Link**: For each matching job, a new row is inserted into the `job_board`, with its `source_artifact_id` column pointing directly to the ID of the artifact that just triggered it.

## System-Level Artifact Topics

To make this system work, internal system events are now published under standardized topics:

| Event Source | Artifact Topic | Example `content` |
| :--- | :--- | :--- |
| Job Status Change | `system.job.status_changed` | `{"job_id": "...", "from_status": "...", "to_status": "..."}` |
| Cron Schedule | `system.cron.tick` | `{"pattern": "...", "fired_at": "..."}` |
| Thread Created | `system.thread.created` | `{"thread_id": "...", "title": "..."}` |
| Thread Updated | `system.thread.updated` | `{"thread_id": "...", "status": "..."}` |

Jobs that previously listened to triggers like `on_job_status_change` or `cron` must now be updated to subscribe to these new artifact topics.

## `schedule_config` Format

Job subscriptions are defined in the `schedule_config` column of the `jobs` table. The format is simple:

```json
{
  "trigger": "on_new_artifact",
  "filters": {
    "topic": "the_topic_to_subscribe_to"
  }
}
```

The `trigger` is **always** `on_new_artifact`. The `filters` object specifies the conditions the artifact must meet, with `topic` being the most common filter.

## Examples

### Subscribing to a Job Completion
This job will run whenever another job named `data_extractor` completes successfully.

```sql
INSERT INTO jobs (name, description, prompt_content, enabled_tools, schedule_config)
VALUES (
    'process_extracted_data',
    'Processes data after extraction is complete.',
    'You are a data processor...',
    ARRAY['read_records', 'update_records'],
    '{
      "trigger": "on_new_artifact", 
      "filters": {
        "topic": "system.job.status_changed",
        "content": {
          "job_name": "data_extractor",
          "to_status": "COMPLETED"
        }
      }
    }'::jsonb
);
```

### Subscribing to a Cron Tick
This job will run every hour.

```sql
INSERT INTO jobs (name, description, prompt_content, enabled_tools, schedule_config)
VALUES (
    'hourly_system_check',
    'Performs a system health check every hour.',
    'You are a system monitor...',
    ARRAY['get_context_snapshot'],
    '{
      "trigger": "on_new_artifact",
      "filters": {
        "topic": "system.cron.tick",
        "content": {
          "pattern": "0 * * * *"
        }
      }
    }'::jsonb
);
```

### Subscribing to a Declarative Artifact
This is the most common pattern, where one job declaratively triggers another.

**Publisher Job (`analyst`):**
The `analyst` job has `emit_artifacts_on` configured to create an artifact when it completes.

```json
// emit_artifacts_on configuration for the 'analyst' job
{
  "COMPLETED": [{
    "topic": "analysis_complete",
    "content": { "summary": "..." }
  }]
}
```

**Subscriber Job (`synthesizer`):**
The `synthesizer` job subscribes to the `analysis_complete` topic.

```sql
INSERT INTO jobs (name, description, prompt_content, enabled_tools, schedule_config)
VALUES (
    'synthesizer',
    'Synthesizes completed analysis.',
    'You are a synthesizer...',
    ARRAY['read_records', 'create_record'],
    '{
      "trigger": "on_new_artifact",
      "filters": {
        "topic": "analysis_complete"
      }
    }'::jsonb
);
```

## Testing Your Triggers

1.  **Create the subscriber job** with the correct `schedule_config`.
2.  **Manually insert an artifact** that matches the filter conditions.
    ```sql
    -- Example for testing the 'synthesizer'
    INSERT INTO artifacts (topic, content) 
    VALUES ('analysis_complete', '{"some_data": "value"}');
    ```
3.  **Check the `job_board`** for a new `PENDING` job.
4.  **Verify the `source_artifact_id`** on the new job record matches the ID of the artifact you inserted.

```sql
-- Check for the newly dispatched job
SELECT id, job_name, status, source_artifact_id
FROM job_board 
WHERE created_at > NOW() - INTERVAL '1 minute'
ORDER BY created_at DESC;
```

This new architecture provides a robust, transparent, and debuggable foundation for the entire agentic system.
