## Planning Doc: Hierarchical Cognition & Foundational EROI Loop (v1)

- **Date:** 2025-08-09
- **Author:** Jinn

### 1. Motivation

With a universal event architecture in place, the next step is to use it to build the system's first intelligent feedback loop. This document specifies how to implement the foundational **EROI (Energy Return on Investment) loop**, which is the primary driver for learning and self-improvement. It also clarifies how the concepts of **Tiers** and **Conductors** emerge as patterns of agent behavior built on top of this simple, universal foundation, rather than as complex, built-in system mechanics.

### 2. Architectural Context

This plan assumes the successful implementation of the `universal_event_architecture_spec.md`. All job dispatching happens via retroactive schedules subscribing to artifacts. This document details the *first major application* built on that architecture.

-   **Tiers are a Pattern, Not a Property:** A job is not "Tier 1" because of a database column. It is considered "Tier 1" (an "Exploiter") because it performs a value-generating action and then **emits an `analysis_requested` artifact**. A "Tier 2" ("Auditor") is the job that **subscribes** to that artifact. This is a behavioral pattern that forms a two-step "build -> measure" value chain.

-   **Conductors are Specialized Agents, Not Intermediaries:** A "Conductor" is not a mandatory middleman. It is the name we give to a higher-tier agent (e.g., a "Strategist/Project Manager") whose purpose is to listen for significant events and perform complex, multi-step orchestration (e.g., create a thread, dispatch multiple jobs, budget/policy checks). The **foundational EROI loop does not require a Conductor**; it is a simple, direct handoff.

-   **Template Nature:** The EROI loop defined here is a **template** that agents can reuse to instantiate more hierarchical cognition (e.g., pattern miners and project managers) by composing the same `emit -> subscribe` mechanism with new topics.

### 3. Requirements

1.  **Establish the Foundational EROI Loop:** Implement the two-step "Exploiter -> Auditor" value chain. An Exploiter's completion must reliably trigger an Auditor, which then calculates and records the EROI of the original job.
2.  **Define the Pattern by Convention:** The link between an Exploiter and an Auditor will be established by a shared convention: the `agent.analysis.requested` artifact topic.
3.  **Implement Economic Tracking:** The database schema must be updated to store the calculated costs and value that underpin EROI calculations.
4.  **Provide Metacognitive Awareness:** The `get_job_graph` tool must be implemented so agents (metacog) can discover publishers/subscribers and replicate/extend this pattern.

### 4. Low-Level Implementation Specification

#### 4.1. Database DDL: Economic Tracking

```sql
-- This migration adds the necessary columns to track the economic output of each job.
ALTER TABLE public.job_reports
  ADD COLUMN IF NOT EXISTS total_cost_usd DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS value_generated_usd DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS eroi DECIMAL(8, 2) GENERATED ALWAYS AS
    (CASE WHEN total_cost_usd > 0 THEN value_generated_usd / total_cost_usd ELSE NULL END) STORED;

COMMENT ON COLUMN public.job_reports.eroi IS 'The calculated Energy Return on Investment for this job. This is the primary metric for system learning.';
```

#### 4.2. The Foundational Value Chain: Two Key Job Definitions

This entire loop is implemented with just two well-defined jobs.

**1. The "Exploiter" Job Pattern:**

This isn't a single job, but a pattern that any value-generating agent should follow. The key is the declarative `emit_artifacts_on` block.

-   **Example Job:** `tier1_content_generator_v1`
-   **`prompt_content`:** "Generate a short article based on the input..."
-   **`emit_artifacts_on`:**
    ```json
    {
      "COMPLETED": [
        {
          "topic": "agent.analysis.requested",
          "content": {
            "notes": "Content generation complete. Requesting EROI calculation based on engagement metrics."
          }
        }
      ]
    }
    ```

**2. The "Auditor" Job Definition:**

This is a single, reusable job that acts as the "measure" half of the loop.

-   **`name`:** `tier2_eroi_auditor_v1`
-   **`description`:** "Subscribes to 'agent.analysis.requested' events, calculates the cost and value of the parent job, and updates its job report with the final EROI."
-   **`enabled_tools`:** `['read_records', 'update_records', 'create_memory']`
-   **`schedule_config`:**
    ```json
    {
      "trigger": "on_new_artifact",
      "filters": { "topic": "agent.analysis.requested" }
    }
    ```

#### 4.3. Instantiating the Loop & Ensuring Uptake

The system becomes self-improving by ensuring this pattern is widely adopted.

1.  **`create_job` Enhancement:** The `create_job` tool will be updated to accept the `emit_artifacts_on` JSON object, allowing agents to programmatically create jobs that participate in this EROI loop.
2.  **Seeding the System:** We will manually update our most common existing "Exploiter" job definitions to include the `emit_artifacts_on` block, immediately bootstrapping the feedback loop across the system.
3.  **Metacognitive Awareness (The `get_job_graph` Tool):** Agents should call `get_job_graph({ topic: 'agent.analysis.requested' })` to discover subscribers (e.g., `tier2_eroi_auditor_v1`) before creating new Exploiters that emit this topic.

### 5. EROI Improvement Conductor: Budgeted Experiment Orchestrator (Concrete)

This Conductor showcases a higher-order, project-manager style agent that **directly builds on the EROI loop**. Its purpose is to **increase system EROI** by coordinating controlled experiments and promoting winners.

**High-Level Goal**
- Detect promising EROI patterns from auditor outputs
- Launch budgeted experiments (variants) to validate uplift
- Measure with the same Auditor loop
- Propose rollout/reallocation when thresholds are met

**Artifact Topics (EROI-focused taxonomy)**
- `agent.analysis.completed` (publisher: auditor; includes `{ parent_job_id, eroi, metrics, ts }`)
- `eroi.uplift_candidate` (publisher: pattern miner; `{ hypothesis, target_job_name, expected_uplift_pct, confidence, evidence_ids[] }`)
- `eroi.experiment.kickoff` (publisher: conductor; `{ experiment_id, thread_id, target_job_name, variant_count, budget_usd }`)
- `eroi.experiment.status` (publisher: conductor; `{ experiment_id, n, avg_eroi, uplift_pct, decision? }`)
- `eroi.experiment.completed` (publisher: conductor; `{ experiment_id, winner_variant, realized_uplift_pct, confidence }`)
- `eroi.reallocation.proposed` (publisher: conductor; `{ target_job_name, winner_variant, projected_eroi, budget_shift_usd }`)

**Jobs**
- `tier2_eroi_pattern_miner_v1`
  - `schedule_config`: `on_new_artifact` with `topic='agent.analysis.completed'`
  - Behavior: windowed aggregation by `job_name`/features; emit `eroi.uplift_candidate` when sample size ≥ N and uplift/confidence exceed gates.

- `tier3_eroi_conductor_v1`
  - `enabled_tools`: `["create_thread","create_job","read_records","update_records","create_memory"]`
  - `schedule_config`: `on_new_artifact` with `topic='eroi.uplift_candidate'`
  - Behavior outline:
    1) Validate gates (ethics/budget/min sample size)
    2) Create a `thread` for the initiative; emit `eroi.experiment.kickoff`
    3) Create K variant Exploiters (prompt/tool variations) that all emit `agent.analysis.requested`
    4) Observe resulting `agent.analysis.completed` artifacts (via miner or periodic read) scoped by `experiment_id`
    5) When power achieved, compute uplift; emit `eroi.experiment.completed`
    6) If winner ≥ threshold, emit `eroi.reallocation.proposed` for allocator or directly update `job_board.priority` via a dedicated allocator job

**Why this fits**
- Uses the same `emit -> subscribe` backbone
- Leverages the Auditor for measurement (no new measurement logic)
- Produces durable artifacts for complete traceability

**Idempotency & Safety**
- Unique per `uplift_candidate` processing (track `candidate_id`)
- Budget cap per experiment; fail fast when pool is low
- Timeouts to auto-complete experiments if stalled

### 6. Acceptance Criteria

1. **EROI Loop:** An Exploiter that emits `agent.analysis.requested` triggers `tier2_eroi_auditor_v1`, which updates the parent job's `job_report` with non-null `eroi` and emits `agent.analysis.completed`.
2. **Pattern Miner:** Given a stream of `agent.analysis.completed`, `tier2_eroi_pattern_miner_v1` emits `eroi.uplift_candidate` when gates are met.
3. **Conductor Flow:** A `eroi.uplift_candidate` triggers `tier3_eroi_conductor_v1`, which creates a thread, emits `eroi.experiment.kickoff`, dispatches variant jobs, and later emits `eroi.experiment.completed` with a winner or "no winner" decision.
4. **Rollout Proposal:** On winner, conductor emits `eroi.reallocation.proposed` with projected impact.

### 7. Vertically-Sliced Development Plan

- **Slice 1: EROI Schema** — add `total_cost_usd`, `value_generated_usd`, `eroi` columns; auditor emits `agent.analysis.completed`.
- **Slice 2: EROI Loop** — ship `tier2_eroi_auditor_v1`, retrofit one Exploiter with `emit_artifacts_on`.
- **Slice 3: get_job_graph** — implement tool for static blueprint discovery.
- **Slice 4: Pattern Miner** — implement `tier2_eroi_pattern_miner_v1` that emits `eroi.uplift_candidate`.
- **Slice 5: Conductor** — implement `tier3_eroi_conductor_v1`, kickoff artifacts, variants, decision logic, and rollout proposal.

