# Trigger System Guide

## Overview

The marketplace intelligence system uses an event-driven architecture where database changes automatically trigger job creation through the `universal_job_dispatcher` function. The system has been unified to use the new `jobs` table for all job definitions.

## How It Works

### Core Components

1. **Database Triggers**: Listen for INSERT/UPDATE events on `artifacts`, `threads`, `job_board`, and `system_state` tables
2. **universal_job_dispatcher**: Matches events to both the unified `jobs` table and legacy `job_schedules` for backward compatibility
3. **jobs**: Unified table containing job definitions with embedded schedule configuration
4. **job_schedules**: Legacy table maintained for backward compatibility
5. **jsonb_matches_conditions**: Handles direct field matching for trigger filters

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
{"source_job_name": "analyst"}  
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

1. **Analyst** (manual start) → creates artifact with `source_job_name: "analyst"`
2. **Synthesizer** → triggered by `{"source_job_name": "analyst"}` → creates artifact with `topic: "strategic_hypothesis_generation"`
3. **Proposer** → triggered by `{"topic": "strategic_hypothesis_generation"}` → creates artifact with `topic: "strategic_action_proposal"`
4. **Decider** → triggered by `{"topic": "strategic_action_proposal"}` → creates decision artifact

### Processing Time Triggers

When `system_state.cumulative_job_processing_seconds` is updated, jobs can be triggered based on time thresholds:

```json
{"processing_seconds_threshold": 300}
```

## Examples

### Basic Artifact Topic Filter (Unified Jobs Table)
```sql
-- Using the new unified jobs table
INSERT INTO jobs (job_id, version, name, description, prompt_content, enabled_tools, schedule_config, is_active)
VALUES (
    gen_random_uuid(),
    1,
    'market_research_processor',
    'Processes completed market research',
    'You are a market research processor...',
    ARRAY['read_records', 'create_record'],
    '{"trigger": "on_new_artifact", "filters": {"topic": "market_research_complete"}}',
    true
);
```

### Status Change Filter (Unified Jobs Table)
```sql
INSERT INTO jobs (job_id, version, name, description, prompt_content, enabled_tools, schedule_config, is_active)
VALUES (
    gen_random_uuid(),
    1,
    'artifact_processor',
    'Processes artifacts when they become ready',
    'You are an artifact processor...',
    ARRAY['read_records', 'update_records'],
    '{"trigger": "on_artifact_status_change", "filters": {"old_status": "RAW", "new_status": "PROCESSED"}}',
    true
);
```

### Legacy Examples (Deprecated - Use Jobs Table Instead)

#### Basic Artifact Topic Filter (Legacy)
```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)
VALUES (
    'uuid-of-job-definition',
    'on_new_artifact',
    '{"topic": "market_research_complete"}'
);
```

#### Status Change Filter (Legacy)
```sql
INSERT INTO job_schedules (job_definition_id, dispatch_trigger, trigger_filter)  
VALUES (
    'uuid-of-job-definition',
    'on_artifact_status_change',
    '{"old_status": "RAW", "new_status": "PROCESSED"}'
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
- `source_job_id` (uuid)
- `source_job_name` (text)
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

### Jobs Table (Unified)
- `id` (uuid)
- `job_id` (uuid)
- `version` (int)
- `name` (text)
- `description` (text)
- `prompt_content` (text)
- `enabled_tools` (text[])
- `model_settings` (jsonb)
- `schedule_config` (jsonb)
- `is_active` (boolean)
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

### Job Unification (2025-01-07)
The system has been unified to use the new `jobs` table instead of the fragmented `job_definitions` + `job_schedules` + `prompt_library` architecture.

**Key Changes Made**:
- New unified `jobs` table with embedded `schedule_config`
- Legacy tables maintained for backward compatibility
- `universal_job_dispatcher` queries both new and legacy systems
- Schedule configuration now embedded in `jobs.schedule_config` JSONB field

### Direct Field Matching (Previous Migration)
The system was updated to use direct field matching instead of the `match_conditions` wrapper.

**Key Changes Made**:
- `universal_job_dispatcher` now uses `trigger_filter` directly instead of `trigger_filter->match_conditions`
- Field names updated: `artifact_topic` → `topic`, `source` → `source_job_name`
- Filter structure simplified: removed nested JSON wrappers

### Recommended Migration Path
1. **New Jobs**: Use the unified `jobs` table with embedded schedule configuration
2. **Existing Jobs**: Legacy tables continue to work but are deprecated
3. **Mixed Environment**: Both systems operate in parallel during transition
