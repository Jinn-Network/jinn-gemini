# Planning Doc: Unify Job Definitions (v2)

**Date:** 2025-08-08
**Author:** Jinn

## 1. Motivation

The primary motivation for this project is to address recurring system failures and reduce development friction caused by the fragmentation of our job definition architecture. Currently, defining a single job requires creating and coordinating records across three separate tables: `job_definitions`, `job_schedules`, and `prompt_library`. This leads to complexity, error-prone updates, awkward versioning, and reduced reliability. By unifying these components into a single, cohesive table, we aim to significantly improve the system's reliability, maintainability, and developer experience.

## 2. Context & Current Architecture

The current system defines a job through a combination of `prompt_library`, `job_definitions`, and `job_schedules`. The `create_job` tool writes to all three, and the `universal_job_dispatcher` function reads from all three to assemble and dispatch a job to the `job_board`. This distributed architecture is the root cause of the issues.

## 3. Requirements

1.  **Single Source of Truth**: All data required to define a job must be stored in a single database table.
2.  **Atomic Operations**: Creating, updating, and deleting a job definition must be an atomic transaction.
3.  **Clear Versioning**: The system must support robust versioning, making it easy to view history and manage active versions.
4.  **No Loss of Functionality**: All existing capabilities (event triggers, scheduling) must be preserved.
5.  **Seamless Migration**: A reliable migration path must exist to transition existing jobs without data loss.

## 4. Resources

This section lists the key files and directories relevant to this project.

-   **Tool to be Modified**: `gemini-agent/mcp/tools/create-job.ts`
-   **Worker to be Analyzed**: `worker/worker.ts`
-   **Shared Types**: `gemini-agent/mcp/tools/shared/types.ts`
-   **Database Migrations**: `supabase/migrations/`
-   **Frontend Components (for post-migration update)**: `frontend/explorer/src/components/detail-view.tsx`
-   **Documentation (for post-migration update)**:
    -   `docs/documentation/DATABASE_MAP.md`
    -   `docs/documentation/TRIGGER_SYSTEM_GUIDE.md`

## 5. Acceptance Criteria

This project will be considered successful if the following core scenarios function correctly. These criteria are designed to provide ~80% confidence in the system's correctness with ~20% of the testing effort.

1.  **End-to-End Manual Job Lifecycle**:
    -   A new job with a `manual` trigger can be successfully created using the updated `create_job` tool.
    -   The new job appears correctly in the `jobs` table as `version: 1` and `is_active: true`.
    -   The job can be successfully dispatched to the `job_board` via a manual trigger call.

2.  **End-to-End Automated Job Lifecycle (`on_new_artifact`)**:
    -   A new job can be created with an `on_new_artifact` trigger and a specific filter (e.g., `{"topic": "metacog"}`).
    -   When an artifact matching the filter is created, the job is correctly dispatched to the `job_board`.
    -   When an artifact that does *not* match the filter is created, the job is *not* dispatched.

3.  **Core Versioning Logic**:
    -   Creating a new version of an existing job (by supplying an `existing_job_id`) correctly results in a new row with an incremented `version` number.
    -   The new version becomes the *only* active version for that `job_id` (i.e., `is_active` is set to `true` for the new version and `false` for all previous versions).

4.  **Migration Integrity for Critical Jobs**:
    -   After the migration script is run, all jobs with "metacog" in their name exist in the new `jobs` table.
    -   A spot check of a critical `metacog` job confirms that its `prompt_content` and `schedule_config` have been migrated correctly from the old tables.

## 6. Low-Level Implementation Specification

This section provides the detailed technical specification for the project.

### 6.1. Unified Table Schema (DDL)

The following SQL will create `jobs_v2`, the new temporary table that will ultimately be renamed to `jobs`.

```sql
-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the new unified table for jobs
CREATE TABLE public.jobs_v2 (
    -- Core Identifiers
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- The unique ID for this specific version of the job.
    job_id UUID NOT NULL, -- The identifier shared across all versions of the same job.
    version INT NOT NULL,

    -- Descriptive Metadata
    name TEXT NOT NULL,
    description TEXT,

    -- Core Job Logic and Configuration
    prompt_content TEXT NOT NULL,
    enabled_tools TEXT[] DEFAULT '{}',
    model_settings JSONB NOT NULL DEFAULT '{}', -- Added to store model settings
    schedule_config JSONB NOT NULL,

    -- State and Timestamps
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT uq_job_version UNIQUE (job_id, version),
    CONSTRAINT chk_schedule_config_shape CHECK (
        (schedule_config ? 'trigger') AND
        (schedule_config ? 'filters') AND
        (jsonb_typeof(schedule_config -> 'filters') = 'object') AND
        (schedule_config ->> 'trigger' IN ('on_new_artifact', 'on_job_status_change', 'on_new_thread', 'cron', 'manual'))
    )
);

-- Comments for clarity
COMMENT ON COLUMN public.jobs_v2.id IS 'Unique identifier for this specific version of a job.';
COMMENT ON COLUMN public.jobs_v2.job_id IS 'Identifier shared across all versions of a single job.';
COMMENT ON COLUMN public.jobs_v2.version IS 'Monotonically increasing version number for a given job_id.';
COMMENT ON COLUMN public.jobs_v2.schedule_config IS 'JSONB object with trigger type and filter conditions. e.g., {"trigger": "on_new_artifact", "filters": {"topic": "analysis"}}';
COMMENT ON COLUMN public.jobs_v2.is_active IS 'If true, this is the version the dispatcher will use for a given job.';

-- Create the trigger to auto-update the updated_at column
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON public.jobs_v2
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Indexes for performance
CREATE UNIQUE INDEX idx_jobs_v2_active_version ON public.jobs_v2 (job_id) WHERE is_active = true;
CREATE INDEX idx_jobs_v2_schedule_config_gin ON public.jobs_v2 USING GIN (schedule_config);
```

### 6.2. TypeScript Type Definition

The `Job` interface represents a record from the new `jobs` table. It also includes `model_settings`, which will be denormalized onto the `job_board` at dispatch time.

```typescript
// In gemini-agent/mcp/tools/shared/types.ts
export interface ScheduleFilters {
  [key: string]: string | number | boolean | string[];
}
export interface ScheduleConfig {
  trigger: 'on_new_artifact' | 'on_job_status_change' | 'on_new_thread' | 'cron' | 'manual';
  filters: ScheduleFilters;
  cron_pattern?: string;
}
export interface Job {
  id: string; // UUID of this specific version
  job_id: string; // Shared UUID across all versions
  version: number;
  name: string;
  description?: string;
  prompt_content: string;
  enabled_tools: string[];
  model_settings: Record<string, any>; // <-- Added this
  schedule_config: ScheduleConfig;
  is_active: boolean;
  created_at: string; // ISO 8601 Date
  updated_at: string; // ISO 8601 Date
}
```

### 6.3. Downstream Impact Analysis: The Worker

A critical part of this migration is ensuring the `worker` process, which executes jobs from the `job_board`, receives all the data it needs. The original implementation implicitly relied on `job_definitions` to provide context like `job_name` and `model_settings`.

The new, unified approach requires that we **denormalize** this data onto the `job_board` at the moment of dispatch. If we fail to do this, the worker will be unable to correctly construct its prompt or configure the AI model, leading to execution failures.

**Identified Gaps:**

1.  **Missing `job_name`:** The worker uses `job_name` to construct the initial prompt context (`You are executing as job "..."`). Without it, the prompt is malformed.
2.  **Missing `model_settings`:** The worker uses `model_settings` to select the correct AI model (e.g., `gemini-2.5-flash`). Without this, the `Agent` cannot be initialized correctly.

**Solution:**

The `job_board` table must be updated to include these fields, and the `create_job_from_unified_definition` function must be responsible for populating them. This ensures the `job_board` is a self-contained record with all information needed for execution.

### 6.4. Data Migration Plan
The migration script will use deterministic UUIDs for `job_id`.

```sql
-- In a Supabase migration file
CREATE TEMP TABLE job_id_mapping AS
SELECT
    name,
    uuid_generate_v5(uuid_ns_dns(), name) AS job_id
FROM public.job_definitions
GROUP BY name;

INSERT INTO public.jobs_v2 (job_id, version, name, description, prompt_content, enabled_tools, schedule_config, is_active, created_at)
WITH ranked_versions AS (
    SELECT
        jd.name, jd.description, jd.enabled_tools, js.dispatch_trigger, js.trigger_filter_conditions,
        pl.content AS prompt_content,
        (regexp_matches(jd.prompt_ref, '@(\d+)$'))[1]::INT AS version,
        jd.created_at,
        ROW_NUMBER() OVER(PARTITION BY jd.name ORDER BY (regexp_matches(jd.prompt_ref, '@(\d+)$'))[1]::INT DESC, jd.created_at DESC) as rn
    FROM public.job_definitions jd
    JOIN public.job_schedules js ON jd.id = js.job_definition_id
    JOIN public.prompt_library pl ON jd.prompt_ref = pl.name || '@' || pl.version::TEXT
)
SELECT
    map.job_id, rv.version, rv.name, rv.description, rv.prompt_content,
    COALESCE(rv.enabled_tools, '{}'),
    jsonb_build_object('trigger', rv.dispatch_trigger, 'filters', COALESCE(rv.trigger_filter_conditions, '{}'::jsonb)),
    (rv.rn = 1) AS is_active,
    rv.created_at
FROM ranked_versions rv
JOIN job_id_mapping map ON rv.name = map.name;
```

### 6.5. System Component Modifications

#### `create_job` Tool (`gemini-agent/mcp/tools/create-job.ts`)
The tool will be updated to use a Zod schema for input validation and to handle creating both new jobs and new versions of existing jobs.

**Example Zod Schema for `create_job` input:**
```typescript
import { z } from 'zod';
const ScheduleConfigSchema = z.object({ /* ... as defined in spec ... */ });
export const CreateJobInputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  prompt_content: z.string(),
  enabled_tools: z.array(z.string()),
  schedule_config: ScheduleConfigSchema,
  existing_job_id: z.string().uuid().optional(),
});
```

#### `universal_job_dispatcher` Function (SQL)
The dispatcher logic is simplified to query the single `jobs_v2` table.

```sql
CREATE OR REPLACE FUNCTION create_job_from_unified_definition(event_data JSONB, trigger_type TEXT)
RETURNS VOID AS $$
DECLARE
    job_to_dispatch public.jobs_v2;
BEGIN
    FOR job_to_dispatch IN
        SELECT * FROM public.jobs_v2
        WHERE is_active = true
          AND schedule_config->>'trigger' = trigger_type
          AND jsonb_matches_conditions(event_data, schedule_config->'filters')
    LOOP
        INSERT INTO public.job_board (job_definition_id, input_prompt, enabled_tools, model_settings, job_name, input_context, priority)
        VALUES (job_to_dispatch.id, job_to_dispatch.prompt_content, job_to_dispatch.enabled_tools, job_to_dispatch.model_settings, job_to_dispatch.name, jsonb_build_object('trigger_event', event_data), 5);
    END LOOP;
END;
$$ LANGUAGE plpgsql;
```

## 7. Vertically-Sliced Development Plan

This plan breaks down the work into testable, end-to-end user stories.

### ✅ Slice 0: Foundational Schema (COMPLETED)
- **Goal:** Create the database schema and helpers.
- **Tasks:** Write a migration for `jobs_v2` table, `trigger_set_timestamp()` function, and `jsonb_matches_conditions()` helper.
- **Status:** Complete. The `jobs` table exists with proper schema, constraints, and helper functions.

### ✅ Slice 1: Create and View a Manual Job (COMPLETED)
- **Goal:** Test the core write path.
- **Tasks:** Modify `create_job` tool for manual triggers; add TS types; write unit test to verify record creation.
- **Status:** Complete. The `create_job` tool works with the unified `jobs` table and proper TypeScript types are defined.

### ✅ Slice 2: Dispatch a Manual Job & Handle Worker Dependencies (COMPLETED)
- **Goal:** Test the core dispatch path and ensure the `worker` receives all necessary data.
- **Tasks:**
  - ✅ Implement `create_job_from_unified_definition`.
  - ✅ **Add `job_name` and `model_settings` columns to the `job_board` table schema.**
  - ✅ **Update the dispatcher to copy `name` and `model_settings` from `jobs` to `job_board` on dispatch.**
  - ✅ Create a manual trigger RPC for testing.
  - ✅ Write a test to verify that a dispatched job on the `job_board` is self-contained and has all required fields for worker execution.
- **Status:** Complete. Jobs can be successfully dispatched with all required fields (`job_name`, `model_settings`, `enabled_tools`, `input_prompt`) for worker execution.

### ✅ Slice 3: Support Event-Driven Jobs (`on_new_artifact`) (COMPLETED)
- **Goal:** Support the primary automated trigger.
- **Tasks:** 
  - ✅ Enhance `create_job` tool for this trigger type
  - ✅ Update `handle_new_artifact` trigger to call new dispatcher
  - ✅ Write tests for matching and non-matching events
  - ✅ Add support for `on_artifact_status_change` triggers
  - ✅ Update schema constraints to support all trigger types
- **Status:** Complete. Event-driven jobs now work with the unified system. Both `on_new_artifact` and `on_artifact_status_change` triggers are functional with proper filtering. The `universal_job_dispatcher` calls both old and new systems for backward compatibility.

### Slice 4: Data Migration and Final Cutover
- **Goal:** Migrate existing data and perform the switch.
- **Tasks:** Write and test the migration scrcleaript; include `RENAME TABLE` statements for atomic cutover; create a separate cleanup script to drop old tables later.

### Slice 5: Front-End and Reporting Updates (Optional, Parallel)
- **Goal:** Update UI and docs.
- **Tasks:** Update Explorer components to query the new `jobs` table; update `DATABASE_MAP.md` and `TRIGGER_SYSTEM_GUIDE.md`.
