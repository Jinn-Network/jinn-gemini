# Oak's Context Management Work Plan
**Date:** November 7, 2025  
**Author:** Based on Daily standup and job run analysis

---

## Executive Summary

This document provides a sequenced implementation plan for Oak's context management framework addressing the two critical problems identified in the November 7 Daily standup:

1. **Blueprint Management Confusion** - Multiple blueprints with identical names causing agent delays
2. **Job Progress and State Management** - Jobs executing without awareness of venture progress

The plan synthesizes insights from the Daily conversation with empirical observations from four recent job runs on the `olas-website-1` venture.

---

## Problem Analysis from Job Runs

### Job Run Observations

**Request 0x830510... (CON-001):**
- Status: WAITING (delegated to child)
- Agent lacked file-writing tools, spent time searching for unavailable capabilities
- Delegated work but had insufficient context about sibling progress
- Recognition phase provided learnings but no progress checkpoint

**Request 0xaaabdc... (CON-002):**
- Status: COMPLETED (but with process error)
- Gemini CLI crashed with "approval-mode" argument error
- Empty output but marked completed - graceful error handling worked
- No recognition learnings pulled (recognition phase succeeded but returned null)

**Request 0xfd68ad... (CON-003):**
- Status: COMPLETED with PR created
- Successfully added LICENSE file
- Recognition phase injected 2 learnings (1730 bytes prefix)
- Agent completed work but final output summary truncated in telemetry
- Created MEMORY artifact during reflection

**Request 0xb43ace... (CON-004):**
- Status: WAITING (delegated to 2 children)
- Attempted blueprint fetch from IPFS but failed
- Proceeded with general best practices instead of blueprint-specific requirements
- Delegated CI/CD and performance monitoring as separate jobs
- Recognition phase provided 2 learnings about blueprint-driven execution

### Key Failure Patterns

1. **Blueprint Access Failures:**
   - CON-004 couldn't fetch blueprint from IPFS, proceeded blindly
   - Agents waste cycles searching/managing blueprints that don't exist or aren't accessible

2. **Tool Availability Mismatches:**
   - CON-001 spent time attempting write operations without write_file tool
   - stderr shows: "Tool 'write_file' not found in registry"

3. **Progress Invisibility:**
   - Jobs have 19+ siblings but zero awareness of sibling completion status
   - No mechanism to understand what work has been done
   - Sibling context shows IDs only, no status or summary

4. **Recognition Phase Limitations:**
   - Recognition works for similar historical jobs (semantic search)
   - Does NOT provide current venture state or sibling progress
   - Learnings about patterns, not about "where are we now?"

---

## Sequenced Implementation Plan

### **Phase 1: Blueprint-Per-Job Infrastructure** ✅ COMPLETE
**Duration:** 3-5 days  
**Priority:** CRITICAL  
**Status:** COMPLETED

This must come first as it eliminates the most visible pain point and creates the structural foundation for progress tracking.

#### 1.1 Dispatch Tool Enhancement
**File:** `gemini-agent/mcp/tools/dispatch.ts`

**Changes:**
```typescript
// Add blueprint parameter to dispatch_new_job schema
export const dispatchNewJobSchema = {
  // ... existing params ...
  blueprint: {
    type: "array",
    items: {
      type: "object",
      properties: {
        assertion: { type: "string" },
        examples: {
          type: "object",
          properties: {
            do: { type: "array", items: { type: "string" } },
            dont: { type: "array", items: { type: "string" } }
          }
        },
        commentary: { type: "string" }
      }
    },
    description: "Structured blueprint as array of assertion objects following style-guide.md format"
  }
}
```

**Implementation:**
- Modify `dispatch_new_job` to accept blueprint as input parameter
- Store blueprint in job's IPFS metadata under `blueprint` field
- Validate blueprint structure matches style-guide.md assertion format
- Blueprint is injected into `additionalContext` field of request

#### 1.2 IPFS Metadata Schema Update
**File:** `worker/types.ts`

**Changes:**
```typescript
export interface JobRequestMetadata {
  prompt: string;  // Will be deprecated in favor of blueprint-only execution
  jobName: string;
  model: string;
  jobDefinitionId: string;
  // NEW: Blueprint embedded directly in additionalContext
  blueprint?: BlueprintAssertion[];
  // ... existing fields ...
}

export interface BlueprintAssertion {
  assertion: string;
  examples: {
    do: string[];
    dont: string[];
  };
  commentary: string;
}
```

#### 1.3 Agent Execution Without Prompt
**File:** `gemini-agent/GEMINI.md`

**Changes:**
The agent no longer receives a traditional "prompt" field. Instead, the blueprint array is the work specification. The agent processes the blueprint directly:

**Agent instruction update:**
```markdown
## Blueprint-Driven Execution

You receive work specifications as a structured blueprint array. Each blueprint item is an assertion that must not be violated.

**Assertion Format:**
- `assertion`: The declarative requirement
- `examples.do`: Positive examples showing correct application
- `examples.dont`: Negative examples showing violations
- `commentary`: Rationale and context

**Your Task:**
1. Read all assertions in the blueprint
2. Plan work that satisfies all assertions
3. Execute work using available tools
4. Verify no assertions were violated
5. Report which assertions were addressed

**DO NOT:**
- Violate any assertion
- Search for external blueprint artifacts
- Create blueprint artifacts during execution
```

**Worker changes:**
```typescript
// Worker passes blueprint directly to agent context, no prompt field needed
if (metadata.blueprint) {
  contextForAgent.blueprint = metadata.blueprint;
  workerLogger.info({
    phase: "initialization",
    blueprintItems: metadata.blueprint.length
  }, "Blueprint provided to agent");
}
```

**Expected Outcome:** Agents receive blueprint as structured data, process assertions directly without searching, ensure no violations occur during execution.

---

### **Phase 2: Dependency Metadata and Worker Logic** ✅ COMPLETE
**Duration:** 2-3 days (Actual: 2 days)  
**Priority:** HIGH  
**Status:** COMPLETED November 13, 2025

Implements sibling job sequencing to prevent out-of-order execution.

#### 2.1 Dependency Parameter in Dispatch
**File:** `gemini-agent/mcp/tools/dispatch.ts`

**Changes:**
```typescript
export const dispatchNewJobSchema = {
  // ... existing params ...
  dependencies: {
    type: "array",
    items: { type: "string" },
    description: "Array of request IDs that must be completed before this job can run",
    optional: true
  }
}
```

**Tool description update:**
```markdown
### Dependencies

Specify prerequisite jobs that must complete before this job runs:

```
await dispatch_new_job({
  jobName: "deploy-frontend",
  dependencies: ["0xabc123...", "0xdef456..."], // Build and test jobs
  // ... other params
});
```

Worker enforces: job eligible for pickup only when all dependencies delivered.
```

#### 2.2 IPFS Metadata Storage
**File:** `worker/types.ts`

**Changes:**
```typescript
export interface JobRequestMetadata {
  // ... existing fields ...
  dependencies?: string[]; // Array of request IDs
}
```

Store in IPFS metadata uploaded during dispatch.

#### 2.3 Ponder Schema Update for Dependencies
**File:** `ponder/ponder.schema.ts`

**Changes:**
```typescript
request: p.createTable(
  {
    // ... existing fields ...
    dependencies: p.string().list().optional(), // NEW: array of request IDs
  },
  {
    // ... existing indexes ...
  }
)
```

**File:** `ponder/src/index.ts`

**Changes in MarketplaceRequest handler:**
```typescript
// After parsing IPFS metadata
const dependencies = metadata.dependencies || [];

await repo.upsert({
  id,
  create: {
    // ... existing fields ...
    dependencies,
  },
  update: {
    // ... existing fields ...
    dependencies,
  }
});
```

#### 2.4 Ponder Query for Available Jobs
**File:** New custom Ponder query or worker implementation

**Ponder provides filtering at query time:**
```graphql
query GetAvailableRequests($mechAddress: String!) {
  requests(
    where: {
      mech: $mechAddress,
      delivered: false,
      # Ponder will need custom logic to filter by dependencies
      # This might require a custom resolver or worker-side filtering
    }
    orderBy: blockTimestamp
    orderDirection: asc
  ) {
    id
    ipfsHash
    dependencies
    blockTimestamp
  }
}
```

**Alternative: Worker-side filtering (simpler initial implementation):**
```typescript
// Worker fetches candidates and filters
async function selectEligibleRequest(mechAddress: string): Promise<Request | null> {
  const query = `
    query GetCandidateRequests($mechAddress: String!) {
      requests(
        where: {
          mech: $mechAddress,
          delivered: false
        }
        orderBy: blockTimestamp
        orderDirection: asc
        limit: 20
      ) {
        id
        ipfsHash
        dependencies
        blockTimestamp
      }
    }
  `;
  
  const { requests } = await ponderClient.request(query, { mechAddress });
  
  // Filter to find first eligible job
  for (const request of requests) {
    if (!request.dependencies || request.dependencies.length === 0) {
      return request; // No dependencies, eligible
    }
    
    // Check if all dependencies delivered
    const depsQuery = `
      query CheckDeps($ids: [String!]!) {
        requests(where: { id_in: $ids }) {
          id
          delivered
        }
      }
    `;
    const { requests: deps } = await ponderClient.request(depsQuery, { 
      ids: request.dependencies 
    });
    
    if (deps.length === request.dependencies.length && 
        deps.every(d => d.delivered)) {
      return request;
    }
  }
  
  return null;
}
```

**Future optimization:** Implement custom Ponder resolver that evaluates dependencies server-side.

**Expected Outcome:** Jobs with dependencies wait for prerequisites automatically, eliminating premature execution failures.

#### 2.5 Implementation Summary

**Actual Implementation (November 13, 2025):**

**Dispatcher Tool (`gemini-agent/mcp/tools/dispatch_new_job.ts`):**
- Modified to accept `dependencies` parameter (array of job definition IDs)
- Changed from request IDs to **job definition IDs** for recursive completion semantics
- Dependencies stored at root level of IPFS metadata
- Updated tool description to document job definition completion requirement

**Worker Logic (`worker/mech_worker.ts`):**
- Implemented `checkDependenciesMet()` function with recursive job definition completion check
- Added `isJobDefinitionComplete()` helper that verifies ALL requests for a job definition are delivered
- Worker filters job candidates by dependency satisfaction before claiming
- Added explicit dependency checking for `MECH_TARGET_REQUEST_ID` targeted execution
- Fixed missing `dependencies` field in `fetchSpecificRequest()` GraphQL query

**Ponder Schema (`ponder/ponder.schema.ts`):**
- Added `dependencies` field to `request` table (string list, optional)
- Added `dependents` field for reverse lookup
- Both fields indexed for efficient querying

**Ponder Indexer (`ponder/src/index.ts`):**
- Reads `dependencies` from IPFS metadata root level
- Stores in both `dependencies` and `dependents` fields
- Handles backward compatibility with empty/null dependencies

**Frontend Integration:**
- `frontend/explorer/src/lib/subgraph.ts`:
  - Added `getDependencyInfo()` function to query job definitions and resolve names
  - Updated `Request` interface with `dependencies` field
  - Created `DependencyInfo` interface for status tracking
- `frontend/explorer/src/components/requests-table.tsx`:
  - Added `DependencyCell` component with count badge and tooltip
  - Tooltip shows up to 5 job names with status indicators (✓ Completed, ⏳ In Progress, ⬜ Pending)
  - Links to job definition pages
- `frontend/explorer/src/components/dependencies-section.tsx`:
  - New component for job detail page right panel
  - Displays both "Depends On" and "Depended On By" sections
  - Shows full dependency graph with job names and status
  - Links to job definition pages for navigation

**Key Design Decision - Job Definition Completion:**
Dependencies reference **job definition IDs**, not request IDs. A dependency is satisfied when the job definition is complete, meaning:
1. The job definition has at least one delivered request
2. All requests for that job definition are delivered (recursive check)
3. All dependencies of those requests are also satisfied (recursive)

This ensures proper work stream sequencing where Job B depending on Job Definition A will wait until ALL instances of A and ALL of A's dependencies are complete.

**Validation Results:**
- ✅ Automated test script created (`scripts/validation/test-phase2-dependencies.ts`)
- ✅ TEST 1: Job B correctly skipped when Job A incomplete
- ✅ TEST 2: Job B executed successfully after Job A delivered
- ✅ Worker logs show proper dependency checking at `operation: "isJobDefinitionComplete"`
- ✅ Frontend displays dependency counts, tooltips, and full dependency sections
- ✅ Links navigate to job definition pages (not request pages)
- ✅ Status indicators work correctly (pending → in progress → completed)

**Bug Fixes During Implementation:**
1. **Worker targeting bug**: Test script set `MECH_TARGET_REQUEST` but config reads `MECH_TARGET_REQUEST_ID` - fixed env var name mismatch
2. **Missing dependencies field**: `fetchSpecificRequest()` didn't query `dependencies` from Ponder - added to GraphQL query
3. **Bypassed dependency check**: Targeted requests weren't checked for dependencies - added explicit `checkDependenciesMet()` call
4. **Empty popover**: Tooltip appeared even with no dependencies - added conditional rendering
5. **Wrong link target**: Dependencies linked to request pages instead of job definition pages - changed to `/job-definitions/${id}`

---

### **Phase 3: Progress Checkpointing in Recognition** 📊 STATE AWARENESS
**Duration:** 4-6 days  
**Priority:** HIGH

Provides jobs with current venture state before execution.

#### 3.1 Recognition Phase Architecture

**File:** `worker/recognition/index.ts`

**New function:**
```typescript
export async function buildProgressCheckpoint(
  requestId: string,
  jobDefinitionId: string,
  sourceJobDefinitionId: string | null
): Promise<ProgressCheckpoint> {
  // Determine work stream root
  const rootJobDefId = sourceJobDefinitionId || jobDefinitionId;
  
  // Query all requests in this work stream
  // WorkstreamId is automatically computed: root jobs have their own ID as workstreamId,
  // child jobs inherit the root's ID through the findWorkstreamRoot function in Ponder
  const query = `
    query GetWorkStreamProgress($workstreamId: String!) {
      requests(
        where: {
          workstreamId: $workstreamId
          delivered: true
        }
        orderBy: blockTimestamp
        orderDirection: asc
      ) {
        id
        jobName
        ipfsHash
        blockTimestamp
      }
    }
  `;
  
  const { requests } = await ponderClient.request(query, { workstreamId: rootJobDefId });
  
  // Fetch final output summaries from each delivery
  const completedWork = await Promise.all(
    requests.map(async (req) => {
      const delivery = await fetchDeliveryData(req.id);
      return {
        requestId: req.id,
        jobName: req.jobName,
        timestamp: req.blockTimestamp,
        summary: delivery.output.slice(0, 500) // Truncate to first 500 chars
      };
    })
  );
  
  return {
    workStreamRoot: rootJobDefId,
    totalCompleted: completedWork.length,
    recentWork: completedWork.slice(-10), // Last 10 completed jobs
    summaryText: generateProgressSummary(completedWork)
  };
}

function generateProgressSummary(work: CompletedWork[]): string {
  return `Work Stream Progress (${work.length} jobs completed):\n\n` +
    work.map(w => `- ${w.jobName} (${w.timestamp}): ${w.summary}`).join('\n\n');
}
```

#### 3.2 Integration into Recognition Flow

**File:** `worker/recognition_helpers.ts`

**Update `runRecognitionPhase`:**
```typescript
export async function runRecognitionPhase(context: JobContext): Promise<RecognitionResult> {
  workerLogger.info({ phase: "recognition" }, "Starting recognition phase");
  
  // STEP 1: Create initial situation (existing)
  const initialSituation = await createInitialSituation(context);
  
  // STEP 2: NEW - Build progress checkpoint
  const progressCheckpoint = await buildProgressCheckpoint(
    context.requestId,
    context.jobDefinitionId,
    context.sourceJobDefinitionId
  );
  
  // STEP 3: Semantic search for similar jobs (enhanced to include progress context)
  const searchContext = `${initialSituation.summaryText}\n\n${progressCheckpoint.summaryText}`;
  const similarJobs = await searchSimilarSituations(searchContext);
  
  // STEP 4: Extract learnings from similar jobs (existing)
  const learnings = await extractLearnings(similarJobs);
  
  // STEP 5: NEW - Combine progress + learnings into prompt prefix
  const promptPrefix = buildEnhancedPromptPrefix(progressCheckpoint, learnings);
  
  return {
    initialSituation,
    similarJobs,
    learnings,
    progressCheckpoint, // NEW
    promptPrefix
  };
}
```

#### 3.3 Prompt Enhancement

**File:** `worker/recognition_helpers.ts`

**New function:**
```typescript
function buildEnhancedPromptPrefix(
  progress: ProgressCheckpoint,
  learnings: Learning[]
): string {
  return `
---
## Work Stream Context

${progress.summaryText}

---
## Recognition Learnings

${formatLearnings(learnings)}

---

# Your Task

`;
}
```

#### 3.4 Semantic Search Optimization (Optional Enhancement)

Instead of dumping all progress, use semantic similarity to filter relevant progress:

```typescript
async function buildProgressCheckpoint(
  currentJobSummary: string, // From initial situation
  rootJobDefId: string
): Promise<ProgressCheckpoint> {
  // Fetch all completed work summaries
  const allWork = await fetchCompletedWorkSummaries(rootJobDefId);
  
  // Generate embeddings for current job and all past work
  const currentEmbedding = await embed_text(currentJobSummary);
  const pastEmbeddings = await Promise.all(
    allWork.map(w => embed_text(w.summary))
  );
  
  // Calculate cosine similarity
  const scoredWork = allWork.map((work, idx) => ({
    ...work,
    relevanceScore: cosineSimilarity(currentEmbedding, pastEmbeddings[idx])
  }));
  
  // Return top-10 most relevant completed jobs
  const relevantWork = scoredWork
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 10);
  
  return {
    workStreamRoot: rootJobDefId,
    totalCompleted: allWork.length,
    recentWork: relevantWork,
    summaryText: generateProgressSummary(relevantWork)
  };
}
```

**Expected Outcome:** Jobs understand venture state before acting, reducing redundant/premature work.

---

### **Phase 4: Final Output Summary & Frontend Integration** 📝 QUALITY & UI
**Duration:** 3-4 days  
**Priority:** MEDIUM

Enhances the quality of final output summaries used in progress checkpoints and ensures all new data surfaces in the explorer UI.

#### 4.1 Gemini CLI Output Format

**Current Problem:** Final output is chain-of-thought style, not clean summaries.

**Observation from CON-003:**
```
"I will start by assessing... I'll check README.md... Blueprint verified... 
Okay, LICENSE added... I've added and committed..."
```

**Desired Format:**
```
**Work Completed:**
- Assessed repository state (README.md, GEMINI.md present)
- Fetched and verified blueprint from IPFS
- Added MIT LICENSE file
- Committed changes to branch

**Key Decisions:**
- Selected MIT license based on "Open and Transparent" principle

**Next Steps:**
- Repository owner must make repo public via GitHub settings
```

#### 4.2 GEMINI.md Protocol Update

**File:** `gemini-agent/GEMINI.md`

**Add to work protocol:**
```markdown
## Execution Summary Format

Your final output should follow this structure:

### Work Completed
Bullet list of concrete actions taken (files created/modified, jobs dispatched, etc.)

### Key Decisions
Important choices made and reasoning (e.g., technology selection, delegation strategy)

### Blockers (if any)
Issues encountered that prevented full completion

### Next Steps (if applicable)
Actions remaining or recommendations for follow-up work

Keep summaries factual and concise. Avoid stream-of-consciousness narration.
```

#### 4.3 Agent Class Telemetry Enhancement

**File:** `gemini-agent/agent.ts`

**Current:** Telemetry captures full stdout.

**Enhancement:** Post-process output to extract structured summary.

```typescript
async function run(prompt: string, settings: Settings): Promise<AgentResult> {
  // ... existing execution ...
  
  const output = capturedStdout.join('\n');
  
  // Attempt to extract structured summary
  const structuredSummary = extractStructuredSummary(output);
  
  return {
    output,
    structuredSummary, // NEW field
    telemetry
  };
}

function extractStructuredSummary(output: string): string | null {
  // Look for markdown headings indicating structured format
  const summaryMarkers = [
    /### Work Completed/i,
    /## Execution Summary/i,
    /\*\*Work Completed:\*\*/i
  ];
  
  for (const marker of summaryMarkers) {
    if (marker.test(output)) {
      // Extract from marker to end
      const match = output.match(marker);
      if (match) {
        return output.slice(match.index).trim();
      }
    }
  }
  
  // Fallback: Last 1200 chars (current behavior)
  return output.slice(-1200);
}
```

#### 4.4 Delivery JSON Update

**File:** `worker/mech_worker.ts`

**Store structured summary in delivery:**
```typescript
const deliveryPayload = {
  requestId,
  output: agentResult.output,
  structuredSummary: agentResult.structuredSummary || agentResult.output.slice(-1200),
  telemetry: agentResult.telemetry,
  // ... rest
};
```

**Expected Outcome:** Progress checkpoints use cleaner, more informative summaries instead of raw chain-of-thought output.

#### 4.5 Frontend Explorer Integration

**Files:** `frontend/explorer/src/pages/RequestPage.tsx`, `frontend/explorer/src/components/RequestDetails.tsx`

**New Data to Surface:**

1. **Blueprint Display (Pretty Tab):**
   - Add "Blueprint" section showing assertion array
   - Format each assertion with do/dont examples and commentary
   - Highlight which assertions were addressed (from execution summary)

2. **Dependencies Display (Pretty Tab):**
   - Show list of prerequisite request IDs
   - Link to each dependency's page
   - Show status (delivered/pending) for each

3. **Progress Checkpoint (Pretty Tab):**
   - Add "Work Stream Progress" section
   - Show completed job count
   - Display recent relevant work summaries
   - Link to related jobs in work stream

4. **Raw Tab Updates:**
   - Add `blueprint` field to raw JSON display
   - Add `dependencies` field to raw JSON display
   - Add `progressCheckpoint` to situation JSON view (if available)

**Implementation:**
```typescript
// frontend/explorer/src/components/BlueprintSection.tsx
export function BlueprintSection({ blueprint }: { blueprint?: BlueprintAssertion[] }) {
  if (!blueprint) return null;
  
  return (
    <div className="blueprint-section">
      <h3>Blueprint</h3>
      {blueprint.map((item, idx) => (
        <div key={idx} className="assertion-card">
          <h4>{item.assertion}</h4>
          <div className="examples">
            <div className="do-column">
              <strong>✓ Do:</strong>
              <ul>{item.examples.do.map(ex => <li>{ex}</li>)}</ul>
            </div>
            <div className="dont-column">
              <strong>✗ Don't:</strong>
              <ul>{item.examples.dont.map(ex => <li>{ex}</li>)}</ul>
            </div>
          </div>
          <p className="commentary">{item.commentary}</p>
        </div>
      ))}
    </div>
  );
}

// frontend/explorer/src/components/DependenciesSection.tsx
export function DependenciesSection({ dependencies }: { dependencies?: string[] }) {
  if (!dependencies || dependencies.length === 0) return null;
  
  const { data } = useQuery(GET_DEPENDENCY_STATUS, {
    variables: { ids: dependencies }
  });
  
  return (
    <div className="dependencies-section">
      <h3>Dependencies</h3>
      <ul>
        {data?.requests.map(req => (
          <li key={req.id}>
            <Link to={`/request/${req.id}`}>{req.jobName || req.id}</Link>
            <span className={req.delivered ? 'status-delivered' : 'status-pending'}>
              {req.delivered ? '✓ Delivered' : '⏳ Pending'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**Expected Outcome:** All new context management data is visible in the explorer UI, enabling human oversight and debugging.

---

### **Phase 5: Situation JSON Enhancement** 🗂️ CONTEXT ACCUMULATION
**Duration:** 2-3 days  
**Priority:** LOW

Enriches situation JSON with blueprint and progress references for better context accumulation.

#### 5.1 Situation Encoder Update

**File:** `worker/situation_encoder.ts`

**Add to situation structure:**
```typescript
export interface EnrichedSituation extends Situation {
  blueprint?: Blueprint[];
  blueprintSource?: string;
  progressCheckpoint?: {
    workStreamRoot: string;
    completedJobsCount: number;
    recentWorkSummary: string; // Condensed, not full list
  };
}
```

**Update encoding logic:**
```typescript
export async function enrichSituationWithExecution(
  initialSituation: InitialSituation,
  executionData: ExecutionData,
  recognitionData: RecognitionData
): Promise<EnrichedSituation> {
  return {
    ...initialSituation,
    
    // Add blueprint reference
    blueprint: executionData.metadata.blueprint?.slice(0, 5), // First 5 items
    
    // Add progress checkpoint summary
    progressCheckpoint: recognitionData.progressCheckpoint ? {
      workStreamRoot: recognitionData.progressCheckpoint.workStreamRoot,
      completedJobsCount: recognitionData.progressCheckpoint.totalCompleted,
      recentWorkSummary: recognitionData.progressCheckpoint.recentWork
        .map(w => w.jobName)
        .join(', ')
    } : undefined,
    
    // Existing execution data
    execution: {
      status: executionData.status,
      trace: executionData.trace,
      finalOutputSummary: executionData.structuredSummary || executionData.output
    }
  };
}
```

**Expected Outcome:** SITUATION artifacts become richer historical records, improving future recognition phase quality.

---

## Validation Strategy

### Phase 1 Validation (Blueprint-Per-Job) ✅ PASSED
1. ✅ Dispatched test jobs with embedded blueprint (3 assertions)
2. ✅ Verified blueprint appears in Ponder-indexed metadata
3. ✅ Confirmed agent execution uses blueprint from IPFS metadata
4. ✅ Confirmed no external blueprint search attempts

**Success Criteria:**
- ✅ Blueprint appears in IPFS metadata (verified in job definition record)
- ✅ Agent prompt uses blueprint as primary specification (worker implementation complete)
- ✅ stderr has zero "blueprint not found" warnings (no search attempts in logs)
- ✅ Frontend displays blueprint with structured assertion rendering

**Implementation Summary:**
- Dispatcher: Blueprint moved from additionalContext to root level, stored in IPFS metadata
- Worker: Reads blueprint from IPFS metadata root (with backward compatibility)
- Ponder: Indexes blueprint field in jobDefinition table
- Frontend: Queries and renders blueprint with assertion structure (do/don't examples, commentary)
- GEMINI.md: Updated to document blueprint-driven execution model

---

## Ongoing Automated Verification

### Phase 1 - Blueprint-Per-Job Infrastructure

**Test Coverage:**

- **Unit Tests:**
  - `tests-next/unit/gemini-agent/mcp/tools/dispatch_new_job_blueprint.test.ts` - Blueprint schema validation
  - `tests-next/unit/worker/metadata/blueprint.test.ts` - Metadata parsing and prompt building

- **Integration Tests:**
  - `tests-next/integration/blueprint/dispatch-to-ipfs.integration.test.ts` - Dispatch to IPFS flow
  - `tests-next/integration/blueprint/worker-blueprint-flow.integration.test.ts` - Worker blueprint processing

- **System Tests:**
  - `tests-next/system/memory-system.system.test.ts` (Section 2A) - End-to-end blueprint lifecycle
  - Validates: Ponder indexing, IPFS metadata structure, no external blueprint search

**Run Locally:**
```bash
yarn test:unit:next && yarn test:integration:next && yarn test:system:next
```

**Behavioral Guarantees:**
1. Blueprint must be valid JSON with assertions array
2. Each assertion requires: `id`, `assertion`, `examples` (do/dont arrays), `commentary`
3. Blueprint stored at IPFS metadata root level (not in `additionalContext`)
4. Worker reads blueprint from metadata (no external search)
5. Ponder indexes blueprint in `jobDefinition` table
6. Agent receives blueprint as primary specification
7. No `search_artifacts` calls for blueprint in execution telemetry

**Test Data Builders:**
- `tests-next/fixtures/blueprint-builder.ts` - Reusable test data builders for all test layers

**Verification Points:**
- ✅ Schema validation prevents malformed blueprints at dispatch time
- ✅ IPFS metadata structure verified via integration tests
- ✅ Worker prompt building verified via unit tests
- ✅ End-to-end lifecycle verified via system test (Section 2A)
- ✅ No external blueprint search verified via telemetry inspection

---

### Phase 2 Validation (Dependencies) ✅ PASSED
1. ✅ Dispatched Job A (no dependencies) - Request ID: `0x93de67ca...`, Job Def: `e033a927-031d-4e8e-a26c-d40dbcfdcce9`
2. ✅ Dispatched Job B with dependency on Job A - Request ID: `0x2ab7e259...`, Job Def: `2dfabd57-f691-4392-a4a9-01c869e7ee49`
3. ✅ Automated test verified worker skips Job B initially (dependencies not met)
4. ✅ Test executed Job A to completion
5. ✅ Test verified worker picks up Job B after Job A delivers

**Success Criteria:**
- ✅ Worker logs show Job B skipped (dependencies not met) - Confirmed in test output
- ✅ Worker picks up Job B after Job A delivers - TEST 2 passed
- ✅ No worker errors during dependency checking - Clean execution

**Validation Implementation:**
- Created automated test script: `scripts/validation/test-phase2-dependencies.ts`
- Test spawns worker with `MECH_TARGET_REQUEST_ID` env var for deterministic execution
- Queries Ponder to verify delivery status after each test phase
- Exit code 0 indicates full test suite passed
- Can be integrated into CI pipeline for regression testing

### Phase 3 Validation (Progress Checkpointing)
1. Create work stream with 3 completed jobs
2. Dispatch 4th job in same stream
3. Check recognition phase output for progress checkpoint
4. Verify prompt includes summaries of jobs 1-3
5. Compare recognition prompt size (should be larger but bounded)

**Success Criteria:**
- ✅ Progress checkpoint appears in worker telemetry
- ✅ Prompt prefix includes completed job summaries
- ✅ Total prompt size < 8000 chars (manageable)
- ✅ Agent acknowledges prior work in output

### Phase 4 Validation (Output Quality)
1. Run job with existing chain-of-thought output style
2. Check for structured summary extraction
3. Manually review delivery.structuredSummary field
4. Assess readability vs. raw output

**Success Criteria:**
- ✅ Structured summary exists in delivery
- ✅ Summary is < 500 words
- ✅ Summary has clear sections (work completed, decisions, etc.)

### Integration Test (All Phases)
**Scenario:** Olas Website venture re-run

1. Create new root job with embedded blueprint (6 constitutional principles)
2. Dispatch 6 child jobs with dependencies:
   - CON-002 depends on CON-001
   - CON-003 depends on CON-001, CON-002
   - CON-004 depends on CON-003
   - CON-005 depends on CON-003
   - CON-006 depends on all others

3. Observe execution:
   - Jobs execute in correct order
   - Later jobs reference completed work
   - No blueprint search failures
   - Clean summaries in delivery payloads

**Success Criteria:**
- ✅ All 6 jobs complete without errors
- ✅ Execution order respects dependencies
- ✅ CON-006 summary references all prior work
- ✅ Worker logs show progress checkpoints working

---

## Rollback Plan

Each phase is independent enough to rollback:

### Phase 1 Rollback
- Revert dispatch tool schema changes
- Remove blueprint from IPFS metadata type
- Remove blueprint injection from worker
- Agents revert to external blueprint search (current behavior)

### Phase 2 Rollback
- Remove dependencies from dispatch schema
- Remove dependency filtering from worker
- Workers resume picking oldest unclaimed job (current behavior)

### Phase 3 Rollback
- Remove progress checkpoint function
- Remove checkpoint from recognition flow
- Recognition phase returns only learnings (current behavior)

### Phase 4 Rollback
- Remove structured summary extraction
- Use raw output in deliveries (current behavior)

### Phase 5 Rollback
- Revert situation encoder to v1.1
- Remove blueprint/progress fields from situations

---

## Dependencies and Blockers

### External Dependencies
1. **Ponder Stability:** Progress checkpointing relies on Ponder GraphQL uptime
2. **IPFS Gateway:** Blueprint storage/retrieval requires reliable IPFS access
3. **Gemini CLI Behavior:** Output format improvements depend on model cooperation

### Internal Dependencies
1. Phase 2 should complete before Phase 3 (progress depends on proper sequencing)
2. Phase 4 can run parallel to Phase 2/3
3. Phase 5 depends on Phase 3 completion

### Known Blockers
1. **IPFS Reliability:** CON-004 showed blueprint fetch failures - need retry logic
2. **Gemini CLI Crashes:** CON-002 showed process errors - need better error recovery
3. **Token Telemetry:** All jobs show totalTokens: 0 - telemetry parsing broken

**Mitigation:**
- Add IPFS retry logic with exponential backoff (3 attempts)
- Enhance Gemini CLI error detection (catch --approval-mode failures)
- Fix token counting in agent telemetry parser

---

## Timeline Summary

| Phase | Duration | Dependencies | Risk Level |
|-------|----------|--------------|------------|
| 1. Blueprint-Per-Job | 3-5 days | None | Low |
| 2. Dependencies | 2-3 days | None | Low |
| 3. Progress Checkpointing | 4-6 days | Phase 2 | Medium |
| 4. Output Quality | 2-3 days | None | Medium |
| 5. Situation Enhancement | 2-3 days | Phase 3 | Low |

**Total Estimated Duration:** 13-20 days (2.5-4 weeks)

**Recommended Sequence:**
1. Start with Phase 1 (highest impact, foundation for rest)
2. Run Phase 2 and Phase 4 in parallel
3. Complete Phase 3 after Phase 2
4. Finish with Phase 5

---

## Success Metrics

**Quantitative:**
- Agent time on blueprint management: Reduce from ~30% to <5% of execution time
- Out-of-order execution failures: Reduce from ~40% to 0%
- Jobs referencing prior work: Increase from 0% to >80%
- Recognition phase context quality: Increase prompt relevance score by 40%

**Qualitative:**
- Agents stop "searching for blueprints" in stderr logs
- Agents reference sibling/parent work in execution summaries
- Launcher briefings show coherent narrative across job runs
- Final summaries read like professional reports vs. stream-of-consciousness

---

## Open Questions

1. **Blueprint Size Limits:** What if blueprint is 50+ items? Do we paginate?
2. **Cross-Work-Stream Dependencies:** Should dependencies work across different work streams?
3. **Progress Checkpoint Frequency:** Should we checkpoint every N jobs or always include all?
4. **Semantic vs. Chronological:** For progress summaries, prioritize recency or relevance?
5. **Blueprint Mutations:** Can child jobs propose amendments to parent blueprint?

**Recommendation:** Defer these to post-Phase 3 based on observed usage patterns.

---

## Notes for Implementation

### Code Style
- Follow existing TypeScript patterns in codebase
- Use Pino logger with structured logging (include phase, duration_ms, etc.)
- Prefer explicit types over `any`
- Add JSDoc comments for new public functions

### Testing Approach
- Unit tests for pure functions (formatBlueprintForPrompt, generateProgressSummary)
- Integration tests using Tenderly testnet for end-to-end flows
- Manual validation on mainnet with real venture before merge

### Documentation Updates Required
- `gemini-agent/GEMINI.md`: Work protocol sections
- `docs/spec/protocol-model.md`: Update Section 2.2 (processOnce flow)
- `README.md`: Update job dispatch examples
- `docs/spec/documentation/`: Add context-management-architecture.md

---

**Document Version:** 1.0  
**Last Updated:** November 7, 2025  
**Review Status:** Draft for Oak's review

