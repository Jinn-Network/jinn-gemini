# Lifecycle Requirements

Job lifecycle and work protocol requirements for the Jinn protocol.

---

## LCQ-001: Five Job States

**Assertion:**  
Jobs must progress through one of five states: UNCLAIMED, IN_PROGRESS, COMPLETED, FAILED, DELEGATING, or WAITING.

**Examples:**

| Do | Don't |
|---|---|
| Infer job status from observable signals (errors, dispatches, child status) | Let agent manually set its own status |
| Use DELEGATING when agent dispatched children this run | Create custom status values for specific scenarios |
| Use WAITING when job has undelivered children from previous runs | Mix WAITING and IN_PROGRESS states |
| Mark FAILED on execution errors, COMPLETED when no undelivered children | Mark job as COMPLETED while children are still pending |

**Commentary:**

The five-state model provides clear semantics for job lifecycle:

- **UNCLAIMED**: Request exists on-chain, not yet claimed by worker
- **IN_PROGRESS**: Worker has claimed request via Control API
- **COMPLETED**: Job finished successfully with no undelivered children (terminal)
- **FAILED**: Job encountered error during execution (terminal)
- **DELEGATING**: Job dispatched child jobs this run (non-terminal)
- **WAITING**: Job has undelivered children from previous runs (non-terminal)

Status is automatically inferred by the worker based on:
1. Execution errors → FAILED
2. Agent called dispatch tools this run → DELEGATING
3. Job has any undelivered children → WAITING
4. Job has no undelivered children → COMPLETED

This automatic inference prevents agents from misreporting status and ensures consistent state management across the protocol.

---

## LCQ-002: Terminal vs Non-Terminal States

**Assertion:**  
Only COMPLETED and FAILED states must be terminal, triggering parent re-dispatch. DELEGATING and WAITING states are non-terminal.

**Examples:**

| Do | Don't |
|---|---|
| Deliver to chain only when job reaches COMPLETED or FAILED | Deliver DELEGATING status immediately after dispatch |
| Re-dispatch parent when child reaches COMPLETED | Re-dispatch parent on every child status change |
| Allow jobs to transition from WAITING to COMPLETED when children finish | Treat WAITING as a terminal state |
| Keep job in WAITING state while children execute | Create artificial "PENDING" state for waiting jobs |

**Commentary:**

The terminal/non-terminal distinction prevents premature parent notifications:

**Non-Terminal (DELEGATING, WAITING):**
- Job is still in progress, waiting for delegated work
- No on-chain delivery yet
- Parent is not notified
- Job may be re-dispatched when children complete

**Terminal (COMPLETED, FAILED):**
- Job has reached a final state
- Results are delivered on-chain
- Parent job is automatically re-dispatched
- Job container accumulates this run in its history

This design enables hierarchical work decomposition where parent jobs can delegate to children and wait for results before synthesizing a final deliverable. Without this distinction, parents would be overwhelmed with intermediate status updates.

**Note on Job Homomorphism:** While the data structure distinguishes between root jobs (`sourceJobDefinitionId: null`) and child jobs (with a parent), the execution logic is identical for all jobs. Root jobs do not have special behaviors or responsibilities - they follow the same Work Protocol as any other job. The distinction is structural (for tracking hierarchy), not behavioral (for execution differences).

---

## LCQ-003: processOnce() as Atomic Unit

**Assertion:**  
Each invocation of `processOnce()` must handle a complete job lifecycle from discovery to delivery as an atomic unit.

**Examples:**

| Do | Don't |
|---|---|
| Fetch → Claim → Execute → Report → Deliver in single processOnce() call | Split lifecycle into separate async processes |
| Continue to next job if current job fails | Crash worker on single job failure |
| Return early if no unclaimed work found | Block indefinitely waiting for work |
| Complete all phases before calling processOnce() again | Start second job while first is still executing |

**Commentary:**

The `processOnce()` function encapsulates the complete worker lifecycle:

1. Fetch unclaimed requests from Ponder
2. Claim request via Control API (idempotent)
3. Fetch IPFS metadata (prompt, tools, hierarchy)
4. Initialize (checkout branch, ensure repo cloned)
5. Run recognition phase (optional, graceful failure)
6. Execute agent with enhanced prompt
7. Infer status from execution results
8. Create job report via Control API
9. Run reflection phase (optional)
10. Create SITUATION artifact with embedding
11. Handle code operations (commit, push)
12. Create PR if COMPLETED
13. Upload worker telemetry
14. Deliver results on-chain

By completing this entire sequence before polling for the next job, the worker maintains clear boundaries between job executions, simplifying debugging and ensuring proper resource cleanup.

The 5-second polling interval at the top-level loop provides the rhythm for the system.

---

## LCQ-004: Job Hierarchy via Source Fields

**Assertion:**  
Job hierarchy must be tracked through `jobDefinitionId`, `sourceJobDefinitionId`, `requestId`, and `sourceRequestId` fields.

**Examples:**

| Do | Don't |
|---|---|
| Root jobs have `sourceJobDefinitionId: null` | Create separate "root job" table |
| Query by `jobDefinitionId_in` to find all runs of same job | Query by `sourceJobDefinitionId_in` (only finds direct children) |
| Use `sourceRequestId` to find parent request | Store parent relationships in separate table |
| Let `jobDefinitionId` persist across re-runs | Generate new jobDefinitionId on each run |

**Commentary:**

The hierarchy is encoded in four related fields:

**Job Containers (persistent across runs):**
- `jobDefinitionId`: UUID identifying this job container
- `sourceJobDefinitionId`: UUID of parent job container (null for roots)

**Execution Instances (per run):**
- `requestId`: On-chain request ID (0x...) for this specific run
- `sourceRequestId`: On-chain request ID of parent run that dispatched this

This dual-level tracking enables:

1. **Work Protocol**: Query all runs of a job definition to see completed children
2. **Lineage**: Trace execution back to original root request
3. **Re-runs**: Same job definition can execute multiple times with different requestIds
4. **Context Accumulation**: Job containers accumulate artifacts and learnings across runs

The critical insight: Query by `jobDefinitionId_in` to find sibling runs, not `sourceJobDefinitionId_in` which only finds direct children. This allows root jobs to see completed children when re-running after child completion.

---

## LCQ-005: Automatic Parent Re-Dispatch

**Assertion:**  
When a child job reaches a terminal state (COMPLETED or FAILED), the parent job must be automatically re-dispatched.

**Examples:**

| Do | Don't |
|---|---|
| Check `sourceRequestId` field to identify parent | Require child to manually notify parent |
| Call `dispatch_existing_job` with parent's jobDefinitionId | Create new job definition for parent re-run |
| Let parent synthesize child results when re-dispatched | Push child results directly into parent's output |
| Re-dispatch only on COMPLETED or FAILED, not WAITING/DELEGATING | Re-dispatch parent on every child status update |

**Commentary:**

Automatic re-dispatch implements the work protocol's notification mechanism:

1. Child reaches terminal state (COMPLETED/FAILED)
2. Worker extracts `sourceRequestId` from child's metadata
3. Worker fetches parent's `jobDefinitionId` from Ponder
4. Worker calls `dispatch_existing_job({ jobId: parentJobDefId })`
5. Parent's new run sees completed child via `get_job_context`
6. Parent synthesizes results or waits for remaining children

This design provides:
- **Decoupling**: Children don't need parent awareness
- **Reliability**: No missed notifications due to async failures
- **Scalability**: Parent can have arbitrary number of children
- **Fault Tolerance**: Re-dispatch happens even if child failed

The parent's next run uses `get_job_context` to discover all requests for its `jobDefinitionId`, allowing it to see which children have completed and make intelligent decisions about synthesizing results or continuing to wait.

---

## LCQ-006: Context Accumulation in Job Containers

**Assertion:**  
Job containers (jobDefinitionId) must accumulate context across multiple execution runs, enabling agents to learn from previous attempts.

**Examples:**

| Do | Don't |
|---|---|
| Query all requests with same `jobDefinitionId` to get full history | Only look at current request in isolation |
| Access artifacts from previous runs of same job | Assume each run starts from scratch |
| Use `get_job_context` to see completed children from all runs | Query only current run's children |
| Build on learnings from failed attempts in previous runs | Treat each run as independent execution |

**Commentary:**

The job container pattern provides continuity across runs:

**Single Request (Ephemeral):**
- One execution attempt
- Has telemetry, artifacts, status
- May succeed or fail

**Job Container (Persistent):**
- Identified by `jobDefinitionId`
- Contains multiple requests (runs) over time
- Accumulates artifacts and learnings
- Maintains relationships to parent and children

This enables sophisticated work patterns:

1. **Iterative Refinement**: Root job sees completed children, synthesizes, completes
2. **Fault Recovery**: Failed job is re-dispatched, new run sees previous failure context
3. **Progressive Enhancement**: Artifacts accumulate, enabling richer context for later runs
4. **Memory Formation**: SITUATION artifacts link to job container, building institutional knowledge

The `get_job_context` tool provides this accumulated view, showing:
- All runs of this job definition
- Status of each run (COMPLETED, FAILED, WAITING)
- Artifacts created across all runs
- Hierarchy relationships (parent, siblings, children)

Without this accumulation, every execution would be amnesiac, unable to learn from previous attempts.

---

## LCQ-007: Recognition Before Execution

**Assertion:**  
The recognition phase must run before agent execution to inject learnings from similar past jobs.

**Examples:**

| Do | Don't |
|---|---|
| Run `runRecognitionPhase()` before `agent.run()` | Run recognition in parallel with execution |
| Prepend recognition learnings to job prompt | Append learnings after main prompt |
| Continue execution if recognition fails | Block execution on recognition failure |
| Create initial situation, search embeddings, fetch artifacts | Skip recognition to save compute |

**Commentary:**

Recognition provides context-aware guidance before execution:

1. **Initial Situation Creation**: Encode current job metadata (no execution yet)
2. **Embedding Generation**: Create 256-dim vector for job summary
3. **Vector Search**: Query `node_embeddings` for top-5 similar past jobs
4. **Artifact Fetching**: Retrieve full SITUATION artifacts from IPFS
5. **Learning Extraction**: Identify successful strategies, common pitfalls, tool patterns
6. **Prompt Enhancement**: Prepend learnings as markdown to original prompt

The enhanced prompt gives agents:
- Relevant examples from similar past jobs
- Warnings about common failure modes
- Suggested tool usage patterns
- Context about what has worked before

Recognition failures degrade gracefully—if vector search fails or IPFS fetch times out, the job proceeds with the original prompt. This ensures the learning system enhances but never blocks execution.

The initial situation created during recognition is later enriched with execution data to form the final SITUATION artifact for indexing.

---

## LCQ-008: Reflection After Execution

**Assertion:**  
The reflection phase must run after successful job completion to identify valuable learnings for MEMORY artifacts.

**Examples:**

| Do | Don't |
|---|---|
| Run lightweight reflection agent after execution completes | Run full execution twice for reflection |
| Extract MEMORY artifacts from reflection telemetry | Manually create MEMORY artifacts in worker |
| Merge reflection artifacts into delivery payload | Store reflection artifacts separately |
| Skip reflection if execution failed | Run reflection on every job regardless of outcome |

**Commentary:**

Reflection enables tag-based memory creation:

1. **Trigger Condition**: Job reached COMPLETED status
2. **Reflection Agent**: Lightweight Gemini run reviewing execution telemetry
3. **Prompt**: Explicit instructions to identify valuable insights
4. **MEMORY Creation**: Agent calls `create_artifact` with `type: "MEMORY"` and relevant `tags`
5. **Artifact Extraction**: Worker parses reflection telemetry for MEMORY artifacts
6. **Delivery Merge**: MEMORY artifacts included in on-chain delivery payload

The reflection agent is given:
- Original job prompt and acceptance criteria
- Execution telemetry (tools used, outputs, duration)
- Final job output
- Explicit guidance to create MEMORY artifacts when insights are valuable

MEMORY artifacts complement SITUATION artifacts:
- **SITUATION**: Automatic, semantic, full context, created for all completions
- **MEMORY**: Selective, tag-based, curated insights, created only when valuable

Together, these provide two pathways for learning retrieval:
1. Semantic search finds similar execution contexts
2. Tag search finds specific topical knowledge

The reflection phase validates the agent memory management system (JINN-231).

---

## LCQ-009: Status Inference Logic

**Assertion:**  
Job status must be automatically inferred from observable execution signals, never manually set by agents.

**Examples:**

| Do | Don't |
|---|---|
| Check if error thrown → FAILED | Parse agent output for "STATUS: COMPLETED" |
| Check if dispatch tools called → DELEGATING | Trust agent's self-reported status |
| Check if undelivered children exist → WAITING | Ask agent "Are you done?" |
| Default to COMPLETED if no errors or children → COMPLETED | Require explicit status signal in output |

**Commentary:**

Automatic status inference prevents manipulation and ensures consistency:

**Inference Priority (evaluated in order):**
1. Execution error thrown → **FAILED**
2. Agent called `dispatch_new_job` or `dispatch_existing_job` this run → **DELEGATING**
3. Job has any undelivered children (query Ponder) → **WAITING**
4. None of above → **COMPLETED**

This logic is implemented in `worker/mech_worker.ts` after agent execution completes.

**Why not let agents signal status?**
- Agents might misreport to avoid accountability
- Agents might be confused about terminal vs non-terminal states
- Agents might not understand hierarchy implications
- Centralized inference ensures consistent logic

**Edge cases handled:**
- Agent completes but forgets to commit → Worker auto-commits with summary
- Agent dispatches then claims done → Status is DELEGATING (dispatch takes priority)
- Agent waits for children that don't exist → Status is COMPLETED (Ponder is truth)
- Agent errors out mid-execution → Status is FAILED (error caught)

This pattern emerged from early issues where agents would self-report COMPLETED while actually having pending children, causing premature parent synthesis.

---

## LCQ-010: Delivery Triggers On-Chain Finality

**Assertion:**  
Jobs must not be considered complete until a `Deliver` event is emitted on-chain.

**Examples:**

| Do | Don't |
|---|---|
| Call `deliverViaSafe()` to submit result via Gnosis Safe | Mark job as delivered in database without on-chain tx |
| Wait for `Deliver` event to be indexed by Ponder | Assume delivery succeeded after tx submission |
| Include all artifacts in delivery payload | Upload artifacts after delivery |
| Use IPFS CID in delivery payload, not full content | Embed large content directly in transaction calldata |

**Commentary:**

On-chain delivery provides finality and immutability:

1. **Worker Assembles Payload**: JSON with output, telemetry, artifacts, recognition, reflection
2. **IPFS Upload**: Push payload to Autonolas registry with wrap-with-directory
3. **Digest Extraction**: Extract SHA256 from IPFS directory CID
4. **Safe Transaction**: Call `OlasMech.deliver(requestId, digest)` via Gnosis Safe
5. **Deliver Event**: Contract emits event with requestId and digest
6. **Ponder Indexing**: Ponder detects event, reconstructs CID, fetches payload, indexes artifacts

Until the `Deliver` event is indexed by Ponder, the job is not considered complete in the protocol's view.

**Why this matters:**
- Blockchain provides immutable proof of completion
- IPFS provides tamper-evident content addressing
- Ponder provides queryable interface to delivery history
- Parent jobs see child completions via Ponder, not database

The delivery architecture ensures trustless verification—anyone can verify a job was completed by checking the chain and fetching the IPFS content.

This requirement enforces the protocol's core principle: the blockchain is the source of truth.
