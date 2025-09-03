# Spec: Agent Job Management Tools

**Date**: 2025-08-09
**Status**: DRAFT

## 1. Overview

To enhance agent capabilities for work decomposition and iterative improvement, this document specifies two new tools: `create_jobs` and `update_job`. These tools will provide agents with a robust framework for delegating and evolving tasks within the existing event-driven architecture, without requiring them to manage high-level projects.

The core design principles are:
- **Compositionality**: Leverage existing system primitives, primarily the `job.completed` event, to build complex workflows.
- **Simplicity**: Provide agents with clear, focused tools for specific actions (creation and updating).
- **Traceability**: Ensure all created and updated jobs maintain a clear, unbroken causal lineage.

## 2. Tool: `create_jobs`

### 2.1 Purpose

The `create_jobs` tool is the primary mechanism for an agent to delegate work by creating multiple new job definitions in a single action. It allows for both parallel and serial execution of the delegated tasks.

### 2.2 Input Schema

```typescript
interface JobDefinitionInput {
  name: string;
  description?: string;
  prompt_content: string;
  enabled_tools: string[];
}

interface CreateJobsInput {
  jobs: JobDefinitionInput[];
  sequence: 'parallel' | 'serial';
}
```

### 2.3 Mechanism

The tool's logic is implemented within a single database function (`create_job_batch`) that orchestrates the creation of job definitions based on the `sequence` parameter. The trigger for the entire batch is the completion of the parent job that calls this tool.

#### 2.3.1 Context Capture

The tool automatically captures the `job_definition_id` of the calling parent job from the worker's job context. This ID is used as the trigger for the first job(s) in the batch.

#### 2.3.2 Parallel Sequencing

When `sequence: 'parallel'`, the goal is to have all child jobs start as soon as the parent job run completes.

1.  The `create_job_batch` function iterates through all job definitions in the `jobs` array.
2.  For **each** job definition, it creates a new record in the `jobs` table.
3.  The `schedule_config` for every new job is set to trigger on the completion of the parent job:
    ```json
    {
      "trigger": "on_new_event",
      "filters": {
        "event_type": "job.completed",
        "job_definition_id": "[Parent's job_definition_id]"
      }
    }
    ```
4.  When the parent job finishes, the system emits its `job.completed` event. The `universal_job_dispatcher` finds all child jobs subscribed to this event and dispatches them to the `job_board` simultaneously.

#### 2.3.3 Serial Sequencing

When `sequence: 'serial'`, the goal is to create a chain where each job starts only after the previous one has completed.

1.  **First Job**: The first job in the `jobs` array is configured to trigger on the completion of the parent job, just like in the parallel case.
2.  **Subsequent Jobs**: For every subsequent job in the array, the `schedule_config` is set to trigger on the completion of the *previous* job in the sequence.
    - **Job #2 `schedule_config`**:
      ```json
      {
        "trigger": "on_new_event",
        "filters": {
          "event_type": "job.completed",
          "job_definition_id": "[Job #1's new job_definition_id]"
        }
      }
      ```
    - **Job #3 `schedule_config`**:
      ```json
      {
        "trigger": "on_new_event",
        "filters": {
          "event_type": "job.completed",
          "job_definition_id": "[Job #2's new job_definition_id]"
        }
      }
      ```
3.  This creates an event-driven chain reaction. The parent's completion starts Job #1, Job #1's completion starts Job #2, and so on.

## 3. Tool: `update_job`

### 3.1 Purpose

The `update_job` tool allows an agent to modify an existing job definition to adapt or improve its behavior for all future runs. This is the core mechanism for agent-driven process evolution. It explicitly does **not** operate on live job runs on the `job_board`.

### 3.2 Input Schema

```typescript
interface JobUpdates {
  prompt_content?: string;
  enabled_tools?: string[];
  schedule_config?: any;
  // Other mutable fields from the 'jobs' table
}

interface UpdateJobInput {
  job_id: string; // The stable, version-agnostic UUID of the job
  updates: JobUpdates;
}
```

### 3.3 Mechanism

To ensure immutability and a clear history of changes, the tool does not perform a simple `UPDATE` on the `jobs` table. Instead, it implements a versioning strategy.

1.  The agent provides the stable `job_id` of the job definition to be updated.
2.  The tool's database function finds the currently active version for that `job_id`.
3.  It deactivates the current version by setting `is_active: false`.
4.  It creates a **new record** in the `jobs` table with an incremented `version` number, copying the old definition and applying the changes from the `updates` object. This new version is marked `is_active: true`.

This ensures that any new dispatches of this job will use the new, improved definition, while the system retains a full version history for auditing and rollback purposes.
