---
title: "Specification"
---

# Specification
This is how the implementation SHOULD work.

### Jobs

#### Runs

##### Worker Loop

The worker loop is designed to be a robust, continuous process that efficiently processes jobs from the decentralized marketplace. It should operate as follows:

**Main Loop Design**

The worker operates in a continuous loop, repeatedly calling `processOnce()` to handle one job at a time. This design ensures:
- Clear separation between job executions
- Predictable resource cleanup between jobs
- Easy error recovery (failed jobs don't crash the worker)

**Job Processing Flow**

1.  **Fetch Unclaimed Requests**: The worker queries the Ponder indexer for available jobs. The indexer provides a curated view of on-chain job requests from the `MechMarketplace` and `OlasMech` contracts, filtering for jobs that are:
    - Recent (within the worker's time window)
    - Unclaimed (not yet assigned to a worker)
    - Undelivered (not yet completed)

2.  **Claim Request**: The worker uses the Control API to atomically claim a job. This prevents race conditions where multiple workers attempt to process the same job. The Control API should:
    - Provide idempotent claiming (safe to retry)
    - Return immediate feedback on claim success/failure
    - Track which worker claimed which job for auditability

3.  **Fetch IPFS Metadata**: After successfully claiming a job, the worker retrieves the full job specification from IPFS. The IPFS metadata contains:
    - The job prompt (instructions for the agent)
    - The model to use (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`)
    - The list of enabled tools (restricting agent capabilities for this job)
    - Job lineage information (parent/source job references)

4.  **Recognition Phase**: Before executing the job, the worker performs situational learning to benefit from past experiences. This phase:
    - Creates a situation representation of the current job
    - Performs vector similarity search against past job situations
    - Retrieves learnings from similar successful (and failed) jobs
    - Enhances the job prompt with relevant context and patterns
    - Should gracefully degrade if recognition fails (job proceeds without enhancements)

5.  **Run Agent**: The worker instantiates an `Agent` and executes the job. The agent:
    - Runs the Gemini CLI in a separate process for isolation
    - Has access only to the enabled tools specified in the job metadata
    - Operates with loop protection to prevent runaway execution
    - Produces structured output including artifacts and telemetry

6.  **Store Report**: After agent completion, the worker persists a job report via the Control API. The report captures:
    - Final status (`COMPLETED`, `FAILED`, or other terminal states)
    - Agent output (the result of the job)
    - Telemetry data (tokens used, duration, tool calls, etc.)
    - Error information (if the job failed)

7.  **Reflection Phase**: For jobs that complete (successfully or not), the worker triggers a reflection step. The reflection agent:
    - Reviews the job execution and outcome
    - Identifies valuable learnings or patterns
    - Creates `MEMORY` artifacts if insights are worth preserving
    - Should be lightweight (failures here don't block delivery)

8.  **Create Situation Artifact**: The worker assembles a comprehensive situation artifact that encapsulates:
    - Job metadata (requestId, jobName, prompt, model, tools)
    - Execution trace (summary of key actions and tool calls)
    - Final output and status
    - Context (parent/child job relationships)
    - Pre-computed embedding vector for future similarity search

9.  **Deliver Result**: Finally, the worker submits the result on-chain via the Safe multisig wallet. The delivery:
    - Includes the agent's output
    - References all created artifacts (via IPFS CIDs)
    - Includes worker telemetry
    - Is atomic (succeeds or fails as a unit)
    - Triggers on-chain events that Ponder indexes for the next cycle

**Design Principles**

- **Idempotency**: Each step should be safe to retry if interrupted
- **Observability**: Each phase emits telemetry for monitoring and debugging
- **Separation of Concerns**: The worker orchestrates; the agent executes; the Control API manages state
- **Graceful Degradation**: Optional enhancements (like recognition) don't block core functionality
- **Data Lineage**: All artifacts are linked back to their originating job request