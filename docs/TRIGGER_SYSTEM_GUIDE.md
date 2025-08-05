# Trigger System Guide

## Overview

The marketplace intelligence system uses an event-driven architecture where database changes automatically trigger job creation through the `universal_job_dispatcher` function.

## How It Works

### Core Components

1. **Database Triggers**: Listen for INSERT/UPDATE events on `artifacts`, `threads`, `job_board`, and `system_state` tables
2. **universal_job_dispatcher**: Matches events to job schedules and creates appropriate jobs
3. **job_schedules**: Define which events trigger which jobs and under what conditions
4. **jsonb_matches_conditions**: Handles direct field matching for trigger filters

### Trigger Types

| Trigger Type | Table | Operation | Purpose |
|---|---|---|---|
| `on_new_artifact` | artifacts | INSERT | New artifact created |
| `on_artifact_status_change` | artifacts | UPDATE | Artifact status modified |
| `on_new_research_thread` | threads | INSERT | New thread created |
| `on_research_thread_update` | threads | UPDATE | Thread updated |
| `on_processing_time_update` | system_state | UPDATE | Processing time thresholds reached |
| `on_job_status_change` | job_board | UPDATE | Job status changed (handled by separate function) |
| `one-off` | N/A | Manual | Single execution jobs (not event-driven) |

## Filter Format

**IMPORTANT**: Filters use **direct field matching** - no wrappers needed.

### Correct Format ✅
```json
{"topic": "strategic_hypothesis_generation"}
{"source": "analyst"}  
{"status": "PROCESSED"}
{"old_status": "PENDING", "new_status": "COMPLETED"}
```

### Incorrect Format ❌ 
```json
{"match_conditions": {"topic": "strategic_hypothesis_generation"}}
{"artifact_topic": "strategic_hypothesis_generation"}
```

## Current Job Chain Configuration

### Metacognitive Analysis Chain

1. **Analyst** (manual start) → creates artifact with `source: "analyst"`
2. **Synthesizer** → triggered by `{"source": "analyst"}` → creates artifact with `topic: "strategic_hypothesis_generation"`
3. **Proposer** → triggered by `{"topic": "strategic_hypothesis_generation"}` → creates artifact with `topic: "strategic_action_proposal"`
4. **Decider** → triggered by `{"topic": "strategic_action_proposal"}` → creates decision artifact

### Processing Time Triggers

When `system_state.cumulative_job_processing_seconds` is updated, jobs can be triggered based on time thresholds:

```json
{"processing_seconds_threshold": 300}
```

## Examples

### Basic Artifact Topic Filter
```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)
VALUES (
    'uuid-of-job-definition',
    'on_new_artifact',
    '{"topic": "market_research_complete"}'
);
```

### Status Change Filter
```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)  
VALUES (
    'uuid-of-job-definition',
    'on_artifact_status_change',
    '{"old_status": "RAW", "new_status": "PROCESSED"}'
);
```

### Source-based Filter
```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)
VALUES (
    'uuid-of-job-definition', 
    'on_new_artifact',
    '{"source": "market_analyzer"}'
);
```

### Multiple Conditions
```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)
VALUES (
    'uuid-of-job-definition',
    'on_new_artifact', 
    '{"topic": "analysis_complete", "source": "researcher"}'
);
```

### Processing Time Trigger
The processing time trigger uses a special format with `threshold_seconds` and tracks `last_run_at_processing_seconds`:

```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)
VALUES (
    'uuid-of-job-definition',
    'on_processing_time_update',
    '{"threshold_seconds": 600}'
);
```

This will trigger every time the cumulative processing seconds increases by 600 seconds from the last run.

### Job Status Change Trigger
```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)
VALUES (
    'uuid-of-job-definition',
    'on_job_status_change',
    '{"old_status": "IN_PROGRESS", "new_status": "COMPLETED"}'
);
```

### One-off Trigger (Manual execution)
```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)
VALUES (
    'uuid-of-job-definition',
    'one-off',
    '{}'
);
```

## Available Fields for Filtering

### Artifacts Table
- `id` (uuid)
- `thread_id` (uuid) 
- `content` (text)
- `status` (text)
- `topic` (text)
- `source` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### Threads Table
- `id` (uuid)
- `title` (text)
- `objective` (text) 
- `status` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### System State Table
- `key` (text)
- `value` (jsonb)
- `updated_at` (timestamp)

### Job Board Table
- `id` (uuid)
- `job_name` (text)
- `status` (enum: PENDING, IN_PROGRESS, COMPLETED, FAILED)
- `worker_id` (text)
- `output` (jsonb)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## Testing Your Triggers

1. **Create the job definition and schedule**
2. **Insert/update a record that should match your filter**
3. **Check job_board for new PENDING jobs**
4. **Verify the job has correct context from trigger_context_key**

### Test Query
```sql
-- Check if your trigger created a job
SELECT id, job_name, status, created_at, input_context
FROM job_board 
WHERE created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC;
```

## Troubleshooting

### Job Not Triggering
1. Check `job_definitions.is_active = true`
2. Verify trigger_filter JSON syntax is valid
3. Ensure field names match actual table columns
4. Check dispatch_trigger matches the table/operation combination

### Wrong Jobs Triggering  
1. Verify filter conditions are specific enough
2. Check for NULL values in filter fields
3. Ensure no overlapping trigger_filter conditions

### Context Not Passed
1. Set `trigger_context_key` to the field you want passed as context
2. Verify the field exists on the triggering record
3. Check `input_context` field in created job_board records

## Best Practices

1. **Be specific**: Use multiple filter conditions to avoid false triggers
2. **Test thoroughly**: Always test new triggers in a safe environment  
3. **Monitor performance**: Too many triggers can impact database performance
4. **Use meaningful names**: Job names should clearly indicate their trigger source
5. **Document dependencies**: Complex chains should be well-documented
6. **Handle failures**: Jobs should be designed to handle missing or invalid context gracefully

## Migration Notes

The system was updated to use direct field matching instead of the `match_conditions` wrapper. Old schedules using the wrapper format have been automatically migrated.

**Key Changes Made**:
- `universal_job_dispatcher` now uses `trigger_filter` directly instead of `trigger_filter->match_conditions`
- Field names updated: `artifact_topic` → `topic`
- Filter structure simplified: removed nested JSON wrappers