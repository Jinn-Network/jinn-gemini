# Measurement and Execution Orchestration

> **Status:** Proposal  
> **Created:** 2026-01-15  
> **Authors:** Oak Tan, Ritsu Kai  
> **Context:** [Daily Meeting Transcript – Jan 15, 2026](#transcription-source)

---

## Executive Summary

This proposal describes an architectural shift in how the Jinn protocol coordinates autonomous services. Instead of embedding measurement responsibilities within job execution, we separate **Measurement** and **Execution** into distinct worker-driven flows, both governed by a static **Venture Invariant Set** that sits outside the job graph.

The key insight: Measurement is time-based (cron-like frequency policies), while Execution is trigger-based (dispatched when invariants are violated). This separation creates a more continuous, observable, and robust system for autonomous service management.

---

## Problem Statement

### Current Architecture

In the current system:

1. **Root jobs contain everything** – The blueprint/invariant set is published as part of a root job's IPFS metadata
2. **Measurement is ad-hoc** – Agents create measurement artifacts during execution using `create_measurement` tool, but timing is opportunistic rather than policy-driven
3. **Context propagation is fragile** – Updating a blueprint requires re-dispatching the root job; child jobs inherit frozen hierarchy snapshots that become stale
4. **No continuous monitoring** – Between job executions, invariants are not actively measured, creating gaps in observability

### Pain Points

- **Stale hierarchy data**: Jobs rely on `metadata.additionalContext.hierarchy` which is frozen at dispatch time (see Gotcha #12)
- **Unclear measurement frequency**: Some invariants need hourly checks (site uptime), others daily (content quality)
- **No proactive response**: The system only acts when a job happens to run, not when an invariant is violated
- **Configuration drift**: No single source of truth for what defines a "venture" – it's scattered across job definitions

---

## Proposed Architecture

### Core Concept: Static Venture Configuration

```
┌─────────────────────────────────────────────────────────────────┐
│                    VENTURE INVARIANT SET                        │
│                  (Static IPFS Configuration)                    │
├─────────────────────────────────────────────────────────────────┤
│  • Invariants with measurement policies                         │
│  • Execution triggers (what happens on violation)               │
│  • Service metadata (domains, repos, credentials)               │
│  • Priority ordering for invariants                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Worker reads periodically
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WORKER LOOP                                │
├──────────────────────────────┬──────────────────────────────────┤
│    MEASUREMENT FLOW          │       EXECUTION FLOW              │
│                              │                                   │
│  1. Check measurement        │  1. Check last measurement       │
│     policies (frequency)     │                                   │
│                              │  2. If invariant violated:       │
│  2. If measurement due:      │     → Dispatch remediation job   │
│     → Dispatch measurement   │                                   │
│        job                   │  3. Job executes to restore      │
│                              │     invariant bounds             │
│  3. Store result in IPFS     │                                   │
│     (measurement artifact)   │  4. Loop continues monitoring    │
│                              │                                   │
└──────────────────────────────┴──────────────────────────────────┘
```

### Key Architectural Changes

#### 1. Venture Invariant Set as Static Configuration

The base invariant set is **not** published as a job. It's a static configuration document (IPFS CID) that serves as the "constitution" of the venture:

```json
{
  "version": "1.0",
  "ventureId": "jinn-blog-service",
  "invariants": [
    {
      "id": "UPTIME-001",
      "form": "boolean",
      "description": "Blog site must be live and returning 200 OK",
      "measurement": {
        "frequency": "1h",
        "timeout": "30s",
        "retries": 3
      },
      "execution": {
        "onViolation": "dispatch-remediation",
        "priority": 1,
        "jobTemplate": "site-recovery"
      }
    },
    {
      "id": "CONTENT-001",
      "form": "threshold",
      "description": "Minimum 3 blog posts published per week",
      "measurement": {
        "frequency": "24h",
        "aggregation": "rolling-7d"
      },
      "execution": {
        "onViolation": "dispatch-creation",
        "priority": 2,
        "jobTemplate": "content-generation"
      }
    }
  ],
  "metadata": {
    "domain": "blog.jinn.network",
    "repository": "oaksprout/jinn-blog",
    "createdAt": "2026-01-15T00:00:00Z"
  }
}
```

#### 2. Measurement as a Separate Time-Based Flow

Workers continuously poll the venture config and check measurement policies:

```typescript
// Pseudocode: Worker measurement loop
async function measurementLoop(ventureConfig: VentureConfig) {
  for (const invariant of ventureConfig.invariants) {
    const lastMeasurement = await getLastMeasurement(invariant.id);
    const timeSince = Date.now() - lastMeasurement.timestamp;
    
    if (timeSince > parseFrequency(invariant.measurement.frequency)) {
      // Dispatch a measurement job
      const measurementJob = await dispatchMeasurementJob({
        invariantId: invariant.id,
        assessment: invariant.description,
        form: invariant.form,
        timeout: invariant.measurement.timeout
      });
      
      // Measurement job creates artifact with result
      // Worker reads artifact and stores in measurement registry
    }
  }
}
```

Measurement jobs are **lightweight and focused**:
- Single responsibility: measure one invariant
- Create a measurement artifact with the current value
- No execution/remediation logic
- Quick timeout (30s-60s typical)

#### 3. Execution as Trigger-Based Remediation

The execution flow is **reactive**, triggered by measurement results:

```typescript
// Pseudocode: Worker execution loop
async function executionLoop(ventureConfig: VentureConfig) {
  for (const invariant of ventureConfig.invariants) {
    const measurement = await getLatestMeasurement(invariant.id);
    
    if (!measurement) {
      // No measurement yet – skip (measurement loop will create one)
      continue;
    }
    
    if (isViolated(invariant, measurement)) {
      // Dispatch remediation job
      await dispatchRemediationJob({
        invariantId: invariant.id,
        currentValue: measurement.value,
        expectedBounds: getInvariantBounds(invariant),
        jobTemplate: invariant.execution.jobTemplate,
        priority: invariant.execution.priority,
        // Pass full venture context for agent awareness
        ventureConfig
      });
    }
  }
}
```

#### 4. Agent Context: Measurements, Not Assessments

In the current system, agents receive the **assessment** (the description of what to measure) and must figure out the current state. In the proposed system, agents receive the **measurement** (the actual current value):

**Before (current):**
```
Blueprint: "Blog site must be live and returning 200 OK"
Agent: *performs HTTP check* → discovers site is down → fixes it
```

**After (proposed):**
```
Measurement artifact: { invariantId: "UPTIME-001", value: false, error: "502 Bad Gateway" }
Remediation job: "Site is DOWN. Restore uptime."
Agent: *already knows the state* → focuses on fixing it
```

This eliminates redundant assessment work and provides clearer context for remediation.

---

## Worker Architecture Changes

### Current Worker Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                      CURRENT WORKER                             │
├─────────────────────────────────────────────────────────────────┤
│  1. Poll Ponder for unclaimed requests                          │
│  2. Claim request via Control API                               │
│  3. Build prompt from blueprint (includes invariants)           │
│  4. Execute agent                                                │
│  5. Agent may create measurement artifacts (ad-hoc)             │
│  6. Deliver result                                               │
│  7. Check for parent dispatch / verification needs              │
│  8. Repeat                                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed Worker Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                     PROPOSED WORKER                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ MEASUREMENT THREAD (Time-Based)                           │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ 1. Load venture configs from registry                     │  │
│  │ 2. For each invariant: check if measurement due           │  │
│  │ 3. If due: dispatch measurement job                       │  │
│  │ 4. Store measurement artifact in IPFS + index             │  │
│  │ 5. Sleep until next check interval                        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ EXECUTION THREAD (Trigger-Based)                          │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ 1. Poll Ponder for unclaimed requests (existing flow)     │  │
│  │ 2. Check measurement registry for violations              │  │
│  │ 3. For violations: dispatch remediation jobs              │  │
│  │ 4. Process job queue (claim → execute → deliver)          │  │
│  │ 5. Repeat                                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   VENTURE       │     │   MEASUREMENT   │     │   REMEDIATION   │
│   CONFIG        │────▶│   ARTIFACTS     │────▶│   JOBS          │
│   (IPFS)        │     │   (IPFS/Ponder) │     │   (Marketplace) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │                       │                       │
        ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
├─────────────────────────────────────────────────────────────────┤
│  • Venture Dashboard                                            │
│    - All invariants with current measurements                   │
│    - Violation history and remediation status                   │
│    - Live/polling updates via Ponder SSE                        │
│                                                                  │
│  • Measurement Timeline                                         │
│    - Historical measurements per invariant                      │
│    - Trend visualization (charts)                               │
│                                                                  │
│  • Job Activity                                                  │
│    - Measurement jobs (lightweight, high frequency)             │
│    - Remediation jobs (triggered by violations)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Benefits

### 1. Continuous Observability

Measurements happen on a schedule regardless of job activity. The service "feels alive" because invariants are constantly being monitored, not just checked opportunistically.

### 2. Clearer Separation of Concerns

- **Measurement jobs**: Single-purpose, fast, create artifacts
- **Remediation jobs**: Full logic, receive context, fix problems
- **Venture config**: Static truth, not embedded in job metadata

### 3. Proactive Response

The system can detect violations within the measurement frequency (e.g., hourly for uptime) rather than waiting for a scheduled job run.

### 4. Simpler Context Management

Agents receive the **current measurement value** instead of needing to assess it themselves. This eliminates:
- Redundant HTTP checks / API calls
- Conflicting measurements from different child jobs
- Stale hierarchy data problems

### 5. Configuration Updates Without Re-Dispatch

Updating the venture config (e.g., changing measurement frequency) takes effect on the next worker loop iteration. No need to re-dispatch root jobs to propagate changes.

---

## Concerns and Mitigations

### Concern: "This is a massive change"

**Mitigation:** Phased implementation:
1. **Phase 1:** Add measurement frequency to existing `create_measurement` artifacts; worker reads and displays them
2. **Phase 2:** Separate measurement jobs (still within existing job graph, but tagged as measurement-only)
3. **Phase 3:** Full venture config as static IPFS document; measurement/execution split in worker

### Concern: "Many iterations to get right"

**Mitigation:** Start with a single venture (blog service) and single invariant (uptime). Expand only after validating the core flow.

### Concern: "Context sharing between measurement and remediation"

**Mitigation:** Measurement artifacts include full context (error messages, stack traces, timestamps). Remediation jobs receive the artifact CID and can fetch details.

---

## Implementation Phases

### Phase 1: Measurement Artifact Standardization (Current)

- [x] `create_measurement` tool exists
- [ ] Add `frequency` field to measurement artifacts
- [ ] Worker tracks last measurement time per invariant
- [ ] Frontend displays measurement history

### Phase 2: Measurement Jobs (Next)

- [ ] Create `measurement-job` type in Ponder schema
- [ ] Worker dispatches lightweight measurement jobs based on frequency policy
- [ ] Measurement jobs restricted to: HTTP checks, API calls, artifact reads
- [ ] Results stored in structured measurement artifacts

### Phase 3: Venture Config as Constitution

- [ ] Define venture config JSON schema
- [ ] Publish venture config to IPFS (separate from job metadata)
- [ ] Worker reads venture config on startup
- [ ] Remediation jobs triggered by measurement violations
- [ ] Remove invariants from job blueprints (config is source of truth)

---

## Open Questions

1. **How are measurement jobs funded?** Are they submitted to the marketplace like regular jobs, or are they executed "for free" by the worker?

2. **Who pays for high-frequency measurements?** An hourly uptime check = 720 jobs/month. Is this sustainable on-chain?

3. **How does this interact with OLAS staking?** Are measurement jobs counted toward activity metrics?

4. **What happens during worker downtime?** If no worker is running, measurements stop. How do we handle missed measurement windows?

5. **How are venture configs updated?** Is there a governance mechanism, or can the service owner update freely?

---

## References

- [Daily Meeting Transcript – Jan 15, 2026](#transcription-source)
- [AGENT_README_TEST.md](file:///Users/gcd/Repositories/main/jinn-cli-agents/AGENT_README_TEST.md) – Current system architecture
- [Gotcha #12: Stale Hierarchy in Status Inference](file:///Users/gcd/Repositories/main/jinn-cli-agents/AGENT_README_TEST.md#L472-L499) – Problem this proposal addresses
- Previous KPI/Reporting architecture (Supabase era) – Similar pattern attempted before

---

## Next Steps

1. **Document review** – Share this proposal for feedback
2. **Prototype measurement frequency** – Add frequency config to existing artifacts
3. **Validate with blog service** – Run measurement-only jobs for uptime invariant
4. **Iterate on venture config schema** – Define minimal viable config structure
