# Refactor Spec: Unifying `artifacts` and `messages` into `posts`

- **Date:** 2025-08-06
- **Status:** Proposed
- **Author:** Jinn Agent

### 1. Overview & Motivation

This document outlines a plan to refactor the core data model of the Jinn system by merging the `artifacts` and `messages` tables into a single, unified table called `posts`.

The primary motivations for this change are:

*   **Architectural Simplification**: Consolidate two separate concepts (`work products` and `communication`) into a single, versatile data structure. This reduces cognitive overhead for both developers and the agents themselves.
*   **Enhanced Traceability**: Create a clear, auditable trail of activity where conversations (a series of `MESSAGE` posts) that lead to a final report (an `ARTIFACT` post) can all live within the same `thread`.
*   **Richer Communication**: Allow messages to have the same rich features as artifacts, including status tracking (`RAW`, `PROCESSED`), topic classification, and direct linkage to the `job` that created them.
*   **Improved Maintainability**: Simplify the database schema and associated tooling, making the system easier to understand, maintain, and extend.

### 2. Proposed Schema Changes

#### 2.1. New ENUM Types

We will introduce two new ENUM types to ensure data integrity and provide clear state management for all posts.

```sql
-- Defines what a post is
CREATE TYPE post_type AS ENUM ('ARTIFACT', 'MESSAGE');

-- Defines the lifecycle stage of a post
CREATE TYPE post_status AS ENUM ('RAW', 'PROCESSING', 'PROCESSED', 'ARCHIVED', 'ERROR');
```

#### 2.2. The `posts` Table

The existing `artifacts` table will be transformed into the `posts` table with the following key changes:

*   **Rename:** `artifacts` -> `posts`
*   **Additions:**
    *   `to_agent TEXT`: The intended recipient agent/job for a `MESSAGE` type post.
    *   `from_agent TEXT`: The agent or system process that created the post (replaces `source`).
    *   `post_type post_type`: The type of post, defaulting to `ARTIFACT`.
*   **Modifications:**
    *   `status`: The data type will be changed from `TEXT` to the new `post_status` ENUM.
*   **Deprecations:**
    *   The `source` column will be removed.
    *   The `messages` table will be dropped entirely.

### 3. Database Migration Strategy

A single, comprehensive SQL migration script will be created to perform the following actions in order:

1.  **Create ENUMs**: Define `post_type` and `post_status`.
2.  **Alter `artifacts` Table**: Add `to_agent`, `from_agent`, and `post_type` columns.
3.  **Backfill Data**: Populate `from_agent` from the old `source` column.
4.  **Migrate `status` Column**: Convert the `status` column to use the new `post_status` ENUM.
5.  **Rename `artifacts` to `posts`**: Rename the table and all associated constraints and indexes, and drop the `source` column.
6.  **Drop `messages` Table**: Remove the now-redundant `messages` table.
7.  **Update `job_board` Table**:
    *   Rename the `input_context` column to `triggering_context`.
    *   Add a new `inbox_context` column of type `JSONB`.
8.  **Update Database Functions**: Update all affected functions to use the new `posts` table and its schema, and to implement the new inbox logic. Key functions to update include:
    *   `create_job_from_schedule` (to populate `triggering_context` and `inbox_context`).
    *   `create_record`, `read_records`, `update_records`, `delete_records`.
    *   `get_all_tables`, `get_table_schema`.
    *   `universal_job_dispatcher` (to handle `post_type`).
    *   `atomic_update_artifact` (renamed to `atomic_update_post`).
    *   `touch_artifacts_updated_at` (renamed and reassigned).

### 4. Codebase Refactoring Plan

This is a significant refactoring that will touch multiple parts of the codebase.

#### 4.1. Tooling Changes

1.  **`manage-artifact.ts` -> `manage-post.ts`**:
    *   The file will be renamed.
    *   The tool's Zod schema and implementation will be updated to support the new `posts` schema (`post_id`, `from_agent`, `to_agent`, `post_type`, `status`, etc.).
    *   The underlying RPC call will be changed from `atomic_update_artifact` to `atomic_update_post`.
2.  **New `send_message.ts` Tool**:
    *   A new, high-level tool will be created for simple agent-to-agent communication.
    *   This tool will be a user-friendly wrapper around `manage_post`, automatically setting `post_type` to `'MESSAGE'`.
3.  **CRUD & Detail Tools**:
    *   The generic tools (`create-record`, `read-records`, `update-records`, `delete-records`) will be verified to work correctly with the new `posts` table and the renamed `triggering_context`..
    *   The `get-details` tool will be updated to ensure it can correctly fetch and display `posts` and their relationships.

#### 4.2. Worker & Agent Integration
*   The worker logic in `worker/worker.ts` will be updated to fetch and pass the new `triggering_context` and `inbox_context` fields to the agent.
*   The agent's prompt generation will be updated to clearly present both contexts for immediate awareness.

#### 4.3. System-Wide Code Review

A global search for `artifact`, `message`, and `input_context` will be conducted. All instances, including variable names, type definitions, function calls, and comments, will be updated to use the new terminology.

#### 4.4. Test Updates

The following test files will be updated to reflect the new `posts` table and schema changes:

1.  **`packages/metacog-mcp/src/tools.integration.test.ts`**:
    *   Update all `manage_artifact` tests to use the new `manage_post` tool.
    *   Update table references from `artifacts` to `posts`.
    *   Update field references (e.g., `source` -> `from_agent`).
    *   Add tests for the new `send_message` tool.
    *   Update `get_details` tests to work with the new `posts` table structure.
    *   Update `get_context_snapshot` tests to handle the new `posts` table and `triggering_context` field.

2.  **`docs/documentation/TRIGGER_TEST_PLAN.md`**:
    *   Update all SQL queries to use `posts` instead of `artifacts`.
    *   Update trigger test names and descriptions (e.g., `on_artifact_status_change` -> `on_post_status_change`).
    *   Update field references in test data setup and verification queries.
    *   Add new tests for the `inbox_context` functionality in job creation.
    *   Update job chaining tests to verify `triggering_context` field population.

3.  **Test Execution Strategy**:
    *   All existing tests must pass after the refactoring.
    *   New tests will be added to verify the enhanced inbox functionality.
    *   Manual trigger tests will be performed to ensure the event-driven architecture continues to work correctly.

### 5. Documentation Updates

The following documents will be updated to reflect the new architecture:

*   `docs/DATABASE_MAP.md`
*   `AGENT_README.md`
*   `docs/FUTURE_IMPROVEMENTS.md` (Item #5 will be marked as completed).
*   Any other documentation referencing the old tables or `input_context`.

### 6. Approval

No changes will be implemented until this plan is approved.

