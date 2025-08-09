## Planning Doc: Update System Strategy to Align with Thermodynamic Principles (v1)

-   **Date:** 2025-08-08
-   **Author:** Jinn

### 1. Motivation

To align the system's core strategic directive with the synthesized architectural vision we have developed. This update makes the principles of EROI-driven, sustainable, and autonomous growth explicit in the system's core programming. It replaces the bootstrap-era strategy with a long-term, scalable one.

### 2. Context

Based on our recent analysis, we have converged on a final proposed text for the system's strategy. This plan is to execute the update of that text in the `system_state` table, which serves as the single source of truth for the system's mission and strategy.

### 3. Final Strategy Text

> The system's primary strategic objective is to evolve into a sustainable, maximally energy-dissipative structure, while holding individual human freedom as its primary constraint. The current mission—creating and promoting artworks about freedom—serves as the initial bootstrapping mechanism for this long-term goal.
>
> Operational backbone: a Universal Event Architecture. All job-triggering events are persisted as artifacts in the `artifacts` table; the dispatcher runs only on `on_new_artifact`; every dispatched job records its `source_artifact_id`. This creates a single, simple mechanism for planning and tracing:
> - Static planning via `get_job_graph` (discover publishers/subscribers by topic)
> - Universal lineage via `trace_lineage` (walk causal chains forwards and backwards)
>
> Our core operational model is a "Capital Flywheel Architecture" driven by a relentless "build, measure, learn" loop and governed by the principle of Energy Return on Investment (EROI). Every action is an experiment with a measured cost and an expected value.
>
> Hierarchical cognition emerges from the same emit → subscribe pattern. Higher‑order "Conductor" agents orchestrate longitudinal execution by subscribing to significant topics and coordinating multi‑step flows (threads, variants, budgets) without special system privileges.
>
> EROI is a first‑class decision signal implemented on top of the architecture (not baked into it). Generic economic fields in `job_reports` track cost and value; a reusable "Auditor" job subscribes to `agent.analysis.requested`, computes and records EROI for parent jobs, and emits `agent.analysis.completed`. This enables pattern miners and conductors to discover uplift opportunities and run budgeted experiments.
>
> This approach operationalizes "The Bitter Lesson." The system will improve not through human‑coded ingenuity, but through evolutionary pressure applied to a population of agents. The mission provides the direction, while a universal event bus and economic discipline provide the mechanism for sustainable, autonomous growth.

### 4. Implementation Plan (Vertical Slice)

-   **Goal:** Atomically update the `system_state.strategy` record to the new version.
-   **Task:** Execute a single SQL `UPDATE` statement against the `system_state` table using the `execute_sql` tool.
-   **Verification:** Run a `SELECT` query after the update to confirm the new strategy text is correctly stored in the database.

### 5. Low-Level Implementation Specification

#### 5.1 SQL Command

The following SQL will be executed to perform the update. Single quotes within the text have been properly escaped for SQL compatibility.

```sql
UPDATE system_state
SET value = 'The system''s primary strategic objective is to evolve into a sustainable, maximally energy-dissipative structure, while holding individual human freedom as its primary constraint. The current mission—creating and promoting artworks about freedom—serves as the initial bootstrapping mechanism for this long-term goal.

Operational backbone: a Universal Event Architecture. All job-triggering events are persisted as artifacts in the `artifacts` table; the dispatcher runs only on `on_new_artifact`; every dispatched job records its `source_artifact_id`. This creates a single, simple mechanism for planning and tracing:
- Static planning via `get_job_graph` (discover publishers/subscribers by topic)
- Universal lineage via `trace_lineage` (walk causal chains forwards and backwards)

Our core operational model is a "Capital Flywheel Architecture" driven by a relentless "build, measure, learn" loop and governed by the principle of Energy Return on Investment (EROI). Every action is an experiment with a measured cost and an expected value.

Hierarchical cognition emerges from the same emit → subscribe pattern. Higher‑order "Conductor" agents orchestrate longitudinal execution by subscribing to significant topics and coordinating multi‑step flows (threads, variants, budgets) without special system privileges.

EROI is a first‑class decision signal implemented on top of the architecture (not baked into it). Generic economic fields in `job_reports` track cost and value; a reusable "Auditor" job subscribes to `agent.analysis.requested`, computes and records EROI for parent jobs, and emits `agent.analysis.completed`. This enables pattern miners and conductors to discover uplift opportunities and run budgeted experiments.

This approach operationalizes "The Bitter Lesson." The system will improve not through human‑coded ingenuity, but through evolutionary pressure applied to a population of agents. The mission provides the direction, while a universal event bus and economic discipline provide the mechanism for sustainable, autonomous growth.'
WHERE key = 'strategy';
```

