# Observability Requirements

System observability requirements for the Jinn protocol.

---

## OBS-001: Three Levels of Observability

**Assertion:**  
The protocol must provide observability at three levels: human (frontend UIs), programmatic (CLI scripts), and agentic (MCP tools).

**Examples:**

| Do | Don't |
|---|---|
| Provide explorer UI for human browsing | Require SQL queries for exploration |
| Provide CLI scripts for debugging and automation | Only provide web interfaces |
| Provide MCP tools for agent self-inspection | Hide system state from agents |
| Ensure data is accessible at all three levels | Provide data at only one level |

**Commentary:**

Three-level observability serves different users:

**1. Human (Frontends):**
- **Explorer UI**: `https://jinn-gemini-production.up.railway.app/`
- **Features**:
  - Request detail pages with full job history
  - Artifact browser with IPFS content display
  - Worker telemetry visualization with timeline
  - Memory visualization showing SITUATION details
  - Job hierarchy graphs (parent/child/sibling)
- **Purpose**: Browse, investigate, understand system behavior

**2. Programmatic (Scripts):**
- **inspect-job-run**: Complete job snapshot with resolved IPFS
- **inspect-situation**: Situation memory inspection
- **check-agent-balances**: Scan agent keys for OLAS balances
- **validate-mainnet-safety**: Pre-deployment validation
- **Purpose**: Debug, automate, integrate with external systems

**3. Agentic (MCP Tools):**
- **get_details**: Retrieve on-chain records by ID
- **get_job_context**: Retrieve hierarchy context
- **inspect_situation**: Inspect memory system
- **search_similar_situations**: Vector search over situations
- **search_artifacts**: Search artifacts by criteria
- **search_jobs**: Search job definitions
- **Purpose**: Self-inspection, learning, context gathering

**Why Three Levels?**
- Humans need visual interfaces for comprehension
- Developers need scriptable interfaces for automation
- Agents need programmatic interfaces for autonomy

This ensures the system is transparent and debuggable at all points in the architecture.

---

## OBS-002: Structured Telemetry

**Assertion:**  
All agent executions must produce structured telemetry in JSON format including tool calls, token usage, duration, errors, and raw data.

**Examples:**

| Do | Don't |
|---|---|
| Capture telemetry via `--telemetry-outfile` flag | Parse stdout for tool calls |
| Store telemetry as JSON in job report | Store unstructured log text |
| Include tool args, results, and success status | Only log tool names |
| Preserve telemetry even on execution failure | Discard telemetry on error |

**Commentary:**

Agent telemetry structure:

```json
{
  "totalTokens": 12345,
  "toolCalls": [
    {
      "tool": "web_fetch",
      "args": {"url": "https://..."},
      "duration_ms": 1234,
      "success": true,
      "result": {"status": 200, "content": "..."}
    }
  ],
  "duration": 5678,
  "errorMessage": "Process exited with code 1",
  "errorType": "PROCESS_ERROR",
  "raw": {
    "lastApiRequest": {...},
    "stderrWarnings": "...",
    "partialOutput": "..."
  }
}
```

**Collection Process:**
1. Spawn Gemini with `--telemetry true --telemetry-target local --telemetry-outfile /tmp/telemetry-{unique}.json`
2. Wait for process exit
3. Read and parse telemetry JSON
4. Extract structured data
5. Store in job report
6. Delete telemetry file

**Telemetry Uses:**
- **Debugging**: Tool sequences reveal execution logic
- **Artifact Extraction**: Worker parses tool outputs (e.g., `create_artifact` CIDs)
- **Cost Tracking**: Token counts enable billing analysis
- **Reflection**: Telemetry feeds into reflection phase
- **Performance Analysis**: Duration metrics identify bottlenecks

**Preservation on Error:**
Even when execution fails, telemetry is preserved with:
- Partial tool call history
- Error message and type
- stderr warnings
- Partial agent output

This enables post-mortem analysis of failures.

---

## OBS-003: Worker Telemetry

**Assertion:**  
Worker operations must be instrumented with telemetry capturing phases, events, durations, and metadata, separate from agent telemetry.

**Examples:**

| Do | Don't |
|---|---|
| Create `WorkerTelemetryService` instance per job | Use global telemetry instance |
| Log checkpoints: initialization, recognition, execution, delivery | Only log errors |
| Record event metadata (IPFS CIDs, addresses, status) | Only log event names |
| Upload worker telemetry as WORKER_TELEMETRY artifact | Mix worker and agent telemetry |

**Commentary:**

Worker telemetry structure:

```json
{
  "startTime": "2024-01-01T00:00:00Z",
  "endTime": "2024-01-01T00:05:00Z",
  "totalDuration_ms": 300000,
  "phases": [
    {
      "name": "initialization",
      "startTime": "...",
      "endTime": "...",
      "duration_ms": 5000,
      "events": [
        {
          "type": "checkpoint",
          "name": "metadata_fetched",
          "timestamp": "...",
          "metadata": {
            "ipfsHash": "bafybei...",
            "jobName": "...",
            "enabledTools": [...]
          }
        }
      ]
    },
    {
      "name": "recognition",
      "startTime": "...",
      "endTime": "...",
      "duration_ms": 15000,
      "events": [...]
    },
    {
      "name": "execution",
      "startTime": "...",
      "endTime": "...",
      "duration_ms": 120000,
      "events": [...]
    }
  ]
}
```

**Instrumentation Points:**
1. Initialization (metadata fetching, repo checkout)
2. Recognition (vector search, IPFS fetches, prompt enhancement)
3. Execution (agent spawn, telemetry collection)
4. Reporting (job report creation)
5. Reflection (reflection agent run, artifact extraction)
6. Situation (SITUATION artifact creation, embedding)
7. Code Operations (commits, pushes)
8. PR Creation (GitHub PR creation)
9. Telemetry Persistence (IPFS upload)
10. Delivery (on-chain transaction submission)

**Storage:**
- Uploaded to IPFS as `WORKER_TELEMETRY` artifact
- Persisted to Supabase via Control API (in job report)
- Included in delivery payload's `workerTelemetry` field

**Frontend Display:**
Explorer UI shows worker telemetry on request detail pages:
- Summary stats (duration, events, phases, errors)
- Execution timeline with expandable phases
- Event metadata and error messages
- Raw JSON for deep inspection

This separation between agent and worker telemetry enables debugging at both execution and orchestration levels.

---

## OBS-004: IPFS Content Resolution

**Assertion:**  
All IPFS references in the system must be resolvable via Autonolas gateway with appropriate timeout handling and error logging.

**Examples:**

| Do | Don't |
|---|---|
| Use `https://gateway.autonolas.tech/ipfs/{cid}` | Use unreliable public gateways |
| Set timeout via `IPFS_FETCH_TIMEOUT_MS` (default 7000ms) | Wait indefinitely for IPFS fetch |
| Log IPFS fetch failures with CID and URL | Silently swallow fetch errors |
| Reconstruct directory CIDs for delivery payloads | Fetch raw digest as IPFS path |

**Commentary:**

IPFS resolution patterns:

**Standard Artifacts:**
```typescript
const url = `https://gateway.autonolas.tech/ipfs/${cid}`;
const response = await fetch(url, { 
  signal: AbortSignal.timeout(7000) 
});
const content = await response.json();
```

**Delivery Payloads (Directory CID):**
```typescript
// Reconstruct directory CID from digest
const dirCid = reconstructDirectoryCid(digestHash);
const url = `https://gateway.autonolas.tech/ipfs/${dirCid}/${requestId}`;
const response = await fetch(url, { 
  signal: AbortSignal.timeout(7000) 
});
const delivery = await response.json();
```

**Error Handling:**
```typescript
try {
  const content = await fetchFromIpfs(cid);
  return content;
} catch (error) {
  logger.error('IPFS fetch failed', {
    cid,
    url: `https://gateway.autonolas.tech/ipfs/${cid}`,
    error: error.message,
    timeout: 7000
  });
  throw error;
}
```

**Timeout Configuration:**
- Default: 7000ms (7 seconds)
- Configurable: Set `IPFS_FETCH_TIMEOUT_MS` env var
- Rationale: Balance between network latency and responsiveness

**Gateway Selection:**
- Primary: `https://gateway.autonolas.tech/ipfs/`
- Fallback: Can use any public gateway (`dweb.link`, `ipfs.io`)
- Configurable: Set `IPFS_GATEWAY_URL` env var

This resolution strategy ensures IPFS content is accessible while handling network failures gracefully.

---

## OBS-005: Request Detail Pages

**Assertion:**  
The explorer frontend must provide comprehensive request detail pages showing job metadata, artifacts, telemetry, hierarchy, and memory visualization.

**Examples:**

| Do | Don't |
|---|---|
| Show complete job history (all runs of job definition) | Show only single request in isolation |
| Display artifacts with content preview and IPFS links | Only show artifact names |
| Visualize worker telemetry as interactive timeline | Display raw JSON only |
| Show parent/child/sibling relationships | Hide hierarchy information |

**Commentary:**

Request detail page sections:

**1. Job Overview:**
- Request ID, status, timestamps
- Job name, model, objective, acceptance criteria
- Enabled tools list
- Source job relationships

**2. Artifacts:**
- Table with name, topic, type, tags, CID
- Content preview (truncated)
- Click to expand full content
- IPFS gateway link
- Type-specific formatting (SITUATION, MEMORY, WORKER_TELEMETRY)

**3. Worker Telemetry:**
- Summary stats (duration, phases, events, errors)
- Interactive timeline showing phases
- Expandable phase details with events
- Event metadata inspection
- Raw JSON viewer

**4. Agent Telemetry:**
- Tool calls with args and results
- Token usage and cost estimates
- Execution duration
- Error messages (if failed)
- Raw telemetry JSON

**5. Memory Visualization:**
- SITUATION details (if created)
- Similar jobs with similarity scores
- Recognition data (learnings injected)
- Embedding vector visualization
- CLI inspection instructions

**6. Job Hierarchy:**
- Parent job (if child)
- Sibling jobs (same parent)
- Child jobs (if delegated)
- Graph visualization
- Navigation links

**7. GitHub Integration:**
- PR link (if created)
- Branch information
- Commit history
- Code diff preview

This comprehensive view enables understanding of job execution without requiring database access.

---

## OBS-006: CLI Inspection Scripts

**Assertion:**  
The protocol must provide CLI scripts for developers to inspect job runs, situations, balances, and system state.

**Examples:**

| Do | Don't |
|---|---|
| Provide `inspect-job-run` for complete job snapshots | Require GraphQL knowledge to inspect |
| Provide `inspect-situation` for memory system debugging | Hide memory internals |
| Provide `check-agent-balances` for fund recovery | Require manual balance queries |
| Output rich formatted CLI text and raw JSON | Only output JSON |

**Commentary:**

Key CLI scripts:

**1. inspect-job-run:**
```bash
yarn inspect-job-run <requestId>
```
- Fetches complete job from Ponder
- Resolves all IPFS references (request, delivery, artifacts)
- Outputs fully-resolved JSON snapshot
- Primary debugging tool for job execution data

**2. inspect-situation:**
```bash
yarn tsx scripts/memory/inspect-situation.ts <requestId>
```
- Shows SITUATION details with job info
- Displays execution trace with tool calls
- Shows context (parent/siblings/children)
- Lists artifacts created
- Shows embeddings and recognition data
- Displays database record
- Lists similar situations with scores

**3. check-agent-balances:**
```bash
yarn tsx scripts/check-agent-balances.ts
```
- Scans all agent keys in `/.operate/keys/`
- Checks OLAS balance for each
- Reports summary of stranded funds
- Includes rate limiting delays

**4. validate-mainnet-safety:**
```bash
yarn tsx scripts/validate-mainnet-safety.ts
```
- Checks `.operate` directory existence
- Validates Master Safe existence
- Checks ETH and OLAS balances
- Displays current addresses
- Warns about new Safe creation

**Output Formats:**
- Rich CLI formatting for human readability
- Raw JSON for scripting and automation
- Colored output for errors/warnings
- Progress indicators for long operations

**Endpoint Configuration:**
- Default: Production Railway instance
- Override: Set `PONDER_GRAPHQL_URL` env var
- Local: `PONDER_GRAPHQL_URL=http://localhost:42069/graphql`

These scripts provide developer-friendly interfaces to protocol internals.

---

## OBS-007: MCP Introspection Tools

**Assertion:**  
Agents must have access to MCP tools for self-inspection and learning: `get_details`, `get_job_context`, `inspect_situation`, `search_similar_situations`, `search_artifacts`, `search_jobs`.

**Examples:**

| Do | Don't |
|---|---|
| Provide `get_job_context` to understand hierarchy | Hide hierarchy from agents |
| Provide `search_similar_situations` for learning | Require manual memory injection |
| Provide `inspect_situation` for memory debugging | Make memory system opaque |
| Return structured JSON from all tools | Return unstructured text |

**Commentary:**

MCP introspection tools:

**1. get_details:**
```javascript
get_details({
  ids: ["0x...", "0x...:<index>"],
  resolve_ipfs: true
})
```
- Fetches request and artifact records from Ponder
- Resolves IPFS content if requested
- Returns data in requested order
- Includes metadata and token estimates

**2. get_job_context:**
```javascript
get_job_context({
  jobDefinitionId: "uuid",
  includeArtifacts: true
})
```
- Returns all runs of job definition
- Shows status of each run
- Lists artifacts across runs
- Shows hierarchy relationships
- Provides work protocol context

**3. inspect_situation:**
```javascript
inspect_situation({
  request_id: "0x...",
  include_similar: true,
  similar_k: 3
})
```
- Returns SITUATION artifact details
- Shows database record
- Optionally includes similar situations
- Provides memory system transparency

**4. search_similar_situations:**
```javascript
search_similar_situations({
  query_text: "Analyze OLAS staking contract",
  k: 5
})
```
- Performs vector search over embeddings
- Returns top-k matches with scores
- Includes full SITUATION metadata
- Enables semantic job discovery

**5. search_artifacts:**
```javascript
search_artifacts({
  type: "MEMORY",
  tags: ["staking"],
  limit: 10
})
```
- Searches artifacts by type, tags, name, topic
- Returns matching artifacts
- Resolves IPFS content
- Enables knowledge discovery

**6. search_jobs:**
```javascript
search_jobs({
  name: "staking",
  limit: 10
})
```
- Searches job definitions
- Returns matching jobs with metadata
- Enables job discovery

These tools enable agents to understand their context, learn from past executions, and make informed decisions about work delegation.

---

## OBS-008: Logging Strategy

**Assertion:**  
The protocol must use structured logging with appropriate log levels (debug, info, warn, error) and include context (requestId, jobName, phase) in all log entries.

**Examples:**

| Do | Don't |
|---|---|
| Use Pino for structured JSON logging | Use `console.log` with unstructured text |
| Include `requestId` in all job-related logs | Omit context from log entries |
| Use appropriate log levels (info for normal flow) | Log everything at error level |
| Log to files for persistence, stdout for dev | Only log to stdout |

**Commentary:**

Logging configuration:

**Logger Setup:**
```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard'
    }
  }
});
```

**Contextual Logging:**
```typescript
const jobLogger = logger.child({
  requestId,
  jobName,
  mechAddress
});

jobLogger.info('Starting recognition phase');
jobLogger.warn('IPFS fetch timeout', { cid, timeout: 7000 });
jobLogger.error('Execution failed', { error: error.message });
```

**Log Levels:**
- **debug**: Detailed internal state (tool args, intermediate results)
- **info**: Normal operation flow (phase starts, completions)
- **warn**: Recoverable issues (IPFS timeouts, recognition failures)
- **error**: Failures requiring attention (execution errors, delivery failures)

**Log Destinations:**
- **Development**: Stdout with pretty formatting
- **Production**: JSON logs to file (`/var/log/worker.log`)
- **Monitoring**: Structured logs enable alerting and dashboards

**Log Rotation:**
```bash
# logrotate configuration
/var/log/worker.log {
  daily
  rotate 7
  compress
  delaycompress
  missingok
  notifempty
}
```

**Key Logging Points:**
1. Worker startup (configuration, addresses)
2. Job claim (requestId, worker address)
3. Phase transitions (recognition, execution, reflection)
4. Tool calls (name, args, success)
5. IPFS operations (upload, fetch, timeout)
6. Control API calls (mutations, responses)
7. On-chain transactions (hash, gas, status)
8. Errors (type, message, stack trace)

Structured logging enables debugging, monitoring, and operational visibility.

---

## OBS-009: Performance Metrics

**Assertion:**  
The protocol must track and expose performance metrics including job duration, token usage, IPFS fetch times, and phase durations.

**Examples:**

| Do | Don't |
|---|---|
| Record duration_ms for each worker phase | Only track total job duration |
| Record token counts from agent telemetry | Ignore cost metrics |
| Record IPFS fetch times and timeouts | Ignore IPFS performance |
| Expose metrics via telemetry and job reports | Keep metrics internal only |

**Commentary:**

Performance metrics collection:

**Worker Phases:**
```typescript
const phases = {
  initialization: { duration_ms: 5000 },
  recognition: { duration_ms: 15000 },
  execution: { duration_ms: 120000 },
  reflection: { duration_ms: 10000 },
  situation: { duration_ms: 8000 },
  delivery: { duration_ms: 5000 }
};
```

**Agent Metrics:**
```typescript
const agentMetrics = {
  totalTokens: 12345,
  duration: 120000,
  toolCalls: 15,
  successfulTools: 14,
  failedTools: 1
};
```

**IPFS Metrics:**
```typescript
const ipfsMetrics = {
  uploads: {
    count: 5,
    totalSize: 1024000,
    avgDuration_ms: 2000
  },
  fetches: {
    count: 3,
    successCount: 2,
    timeoutCount: 1,
    avgDuration_ms: 1500
  }
};
```

**Storage:**
- Worker telemetry: All phase durations
- Job report: Agent token usage and duration
- Logs: Individual operation timings

**Analysis Uses:**
- Identify bottlenecks (which phases take longest)
- Cost tracking (token usage → billing)
- Performance regression detection
- SLA monitoring (job completion times)

**Future Enhancements:**
- Prometheus metrics export
- Grafana dashboards
- Alerting on performance degradation
- Cost optimization recommendations

These metrics enable continuous performance improvement.

---

## OBS-010: Error Reporting

**Assertion:**  
All errors must be captured with type, message, stack trace, and context, preserved in telemetry, and displayed in frontend with actionable information.

**Examples:**

| Do | Don't |
|---|---|
| Capture error type (PROCESS_ERROR, IPFS_TIMEOUT) | Only capture generic "Error" |
| Include stack trace in error telemetry | Discard stack trace |
| Show error context in frontend (phase, operation) | Show raw error message only |
| Provide recovery suggestions in error messages | Leave users without guidance |

**Commentary:**

Error capture patterns:

**Agent Errors:**
```typescript
try {
  const result = await agent.run(prompt, model, enabledTools);
} catch (error) {
  const errorTelemetry = {
    errorType: error.type || 'PROCESS_ERROR',
    errorMessage: error.message,
    errorStack: error.stack,
    phase: 'execution',
    requestId,
    jobName,
    raw: error.raw  // Partial output, stderr, etc.
  };
  
  await reportJobError(requestId, errorTelemetry);
  throw error;
}
```

**IPFS Errors:**
```typescript
try {
  const content = await fetchFromIpfs(cid);
} catch (error) {
  logger.error('IPFS fetch failed', {
    errorType: 'IPFS_TIMEOUT',
    cid,
    url: `https://gateway.autonolas.tech/ipfs/${cid}`,
    timeout: 7000,
    suggestion: 'Check IPFS gateway availability or increase timeout'
  });
  throw error;
}
```

**Error Types:**
- `PROCESS_ERROR`: Agent process crashed
- `LOOP_DETECTED`: Runaway output detected
- `IPFS_TIMEOUT`: IPFS fetch timeout
- `VALIDATION_ERROR`: Control API validation failed
- `TRANSACTION_ERROR`: On-chain transaction failed
- `AUTHENTICATION_ERROR`: Middleware auth failed

**Frontend Display:**
```typescript
<ErrorCard error={error}>
  <ErrorType>{error.type}</ErrorType>
  <ErrorMessage>{error.message}</ErrorMessage>
  <ErrorContext>
    Phase: {error.phase}
    Request: {error.requestId}
    Job: {error.jobName}
  </ErrorContext>
  <ErrorSuggestion>{getRecoverySuggestion(error.type)}</ErrorSuggestion>
  <StackTrace collapsed>{error.stack}</StackTrace>
</ErrorCard>
```

**Recovery Suggestions:**
- `IPFS_TIMEOUT`: "Check network connectivity or increase IPFS_FETCH_TIMEOUT_MS"
- `LOOP_DETECTED`: "Review agent prompt for infinite loops or increase thresholds"
- `VALIDATION_ERROR`: "Verify requestId exists in Ponder before retrying"
- `AUTHENTICATION_ERROR`: "Check OPERATE_PASSWORD and restart middleware"

Comprehensive error reporting accelerates debugging and reduces downtime.
