# Architecture Requirements

Core architecture and data flow requirements for the Jinn protocol.

---

## ARQ-001: Event-Driven On-Chain Loop

**Assertion:**  
The protocol must operate as an event-driven system where all jobs originate from on-chain events and all completions are recorded on-chain.

**Examples:**

| Do | Don't |
|---|---|
| Poll Ponder for `MarketplaceRequest` events to discover new work | Create jobs directly in the database without on-chain events |
| Submit results via `OlasMech.deliver()` to emit `Deliver` events | Mark jobs as complete in database without on-chain delivery |
| Use Ponder as the source of truth for job discovery | Query Supabase directly for unclaimed work |

**Commentary:**

The on-chain-first architecture ensures the blockchain is the immutable source of truth for all job requests and deliveries. This provides:
- Public auditability of all work requested and completed
- Censorship resistance (anyone can post jobs to the marketplace)
- Decentralized coordination between multiple workers
- Permanent record of job history independent of off-chain infrastructure

This design emerged from the requirement for a trustless, decentralized AI agent marketplace where job creators and workers don't need to trust a central coordinator.

---

## ARQ-002: Six-Layer System Architecture

**Assertion:**  
The protocol must consist of six distinct layers: On-Chain, Indexing, Worker, Agent Execution, Control API, and Data Persistence.

**Examples:**

| Do | Don't |
|---|---|
| Use MechMarketplace/OlasMech contracts for on-chain state | Implement custom smart contracts for job posting |
| Use Ponder to index on-chain events into queryable GraphQL API | Poll blockchain directly from worker for new events |
| Route all off-chain writes through Control API gateway | Allow worker to write directly to Supabase |
| Use Gnosis Safe for worker identity and transaction signing | Use raw EOA private keys for worker operations |

**Commentary:**

The six-layer architecture provides clear separation of concerns:

1. **On-Chain Layer**: Immutable source of truth (Base network)
2. **Indexing Layer**: Fast queryable interface to on-chain data (Ponder)
3. **Worker Layer**: Autonomous execution orchestration
4. **Agent Execution Layer**: LLM-powered task completion (Gemini + MCP)
5. **Control API Layer**: Secure, validated off-chain writes
6. **Data Persistence Layer**: Multi-modal storage (PostgreSQL, IPFS, pgvector)

This layering ensures scalability, security, and maintainability. Each layer has a single responsibility and well-defined interfaces with adjacent layers.

---

## ARQ-003: Single Active Worker Process

**Assertion:**  
The worker layer must consist of a single active mech worker process that polls, claims, executes, and delivers jobs in sequence.

**Examples:**

| Do | Don't |
|---|---|
| Run `processOnce()` loop with 5-second intervals | Spawn multiple parallel worker processes for same mech |
| Process one job completely before polling for next | Start multiple jobs concurrently in same worker |
| Exit cleanly on single job failure, continue loop | Crash entire worker on job execution error |

**Commentary:**

The single-worker design simplifies the system by eliminating concurrency challenges:
- No race conditions between workers claiming same job
- Sequential execution ensures proper state management
- Easier debugging and telemetry collection
- Resource usage is bounded and predictable

The `processOnce()` function encapsulates the complete lifecycle of a single job from discovery to delivery. The 5-second polling interval balances responsiveness with RPC request efficiency.

Future scaling can be achieved by deploying multiple mech addresses, each with its own worker, rather than parallelizing within a single worker.

---

## ARQ-004: Ponder as Primary Data Interface

**Assertion:**  
The Ponder GraphQL API must be the primary interface for reading on-chain job data, not direct blockchain queries.

**Examples:**

| Do | Don't |
|---|---|
| `await ponderClient.query({ requests(where: {...}) })` | `await ethersProvider.getLogs({ address: mechAddress })` |
| Query request metadata from Ponder's indexed tables | Parse transaction calldata directly from blockchain |
| Use Ponder's IPFS-resolved fields (`jobName`, `enabledTools`) | Fetch and parse IPFS content manually in worker |

**Commentary:**

Ponder provides critical advantages over direct blockchain queries:

1. **Performance**: Pre-indexed data is orders of magnitude faster than log filtering
2. **Enrichment**: IPFS content is automatically resolved and stored
3. **Relationships**: Job hierarchies and artifact linkages are pre-computed
4. **Type Safety**: GraphQL schema provides compile-time validation
5. **Reliability**: Handles blockchain reorganizations automatically

The Ponder endpoint is hosted on Railway in production (`https://jinn-gemini-production.up.railway.app/graphql`) with local development at `http://localhost:42069/graphql`.

Workers should never bypass Ponder to query the blockchain directly. This ensures consistent data access patterns across the system.

---

## ARQ-005: Control API as Write Gateway

**Assertion:**  
All off-chain database writes related to on-chain jobs must be routed through the Control API, never directly to Supabase.

**Examples:**

| Do | Don't |
|---|---|
| `await controlApiClient.claimRequest({ requestId })` | `await supabase.from('onchain_request_claims').insert({...})` |
| `await controlApiClient.createJobReport({ requestId, reportData })` | `await supabase.rpc('create_job_report', {...})` |
| Let Control API validate requestId against Ponder | Skip validation and write directly to database |
| Let Control API inject worker_address header automatically | Manually construct lineage fields in worker code |

**Commentary:**

The Control API serves as a mandatory security and integrity layer enforcing:

1. **Validation**: Every requestId is verified to exist in Ponder before writes
2. **Authentication**: Worker identity is extracted from `X-Worker-Address` header
3. **Lineage Injection**: `request_id` and `worker_address` are auto-injected into writes
4. **Idempotency**: Operations like `claimRequest` use database constraints to prevent duplicates
5. **Audit Trail**: All writes are traceable to a specific worker and on-chain request

This pattern emerged from JINN-195 after observing inconsistent lineage data when tools wrote directly to Supabase. The Control API centralizes validation logic, reducing attack surface and preventing malformed writes.

The Control API runs at `http://localhost:4001/graphql` locally and requires `USE_CONTROL_API=true` in environment.

---

## ARQ-006: Multi-Modal Data Persistence

**Assertion:**  
The protocol must use specialized storage for different data types: PostgreSQL for structured data, IPFS for content, and pgvector for embeddings.

**Examples:**

| Do | Don't |
|---|---|
| Store job prompts and artifacts in IPFS, reference by CID | Store large text content directly in PostgreSQL columns |
| Store embeddings in `node_embeddings` table with VECTOR(256) type | Store embedding arrays as JSON in regular columns |
| Store on-chain event data in Ponder's PostgreSQL tables | Store on-chain data in separate database from index |
| Store operational data in Supabase `onchain_*` tables | Mix operational data with indexed on-chain data |

**Commentary:**

Each storage layer is optimized for its use case:

**PostgreSQL (Ponder):**
- On-chain event index: `request`, `delivery`, `artifact`, `jobDefinition`, `message`
- Read-only from application perspective (Ponder owns writes)
- Source of truth for job discovery and hierarchy

**PostgreSQL (Supabase):**
- Off-chain operational data: `onchain_request_claims`, `onchain_job_reports`, `onchain_artifacts`, `onchain_messages`
- Written via Control API only
- Supplementary data not stored on-chain due to gas costs

**PostgreSQL with pgvector:**
- `node_embeddings` table for SITUATION artifact embeddings
- Enables cosine similarity search for semantic job matching
- 256-dimensional vectors from `text-embedding-3-small` model

**IPFS:**
- Content-addressed storage for job prompts, delivery payloads, artifacts
- Immutable, distributed, censorship-resistant
- Autonolas infrastructure: registry for upload, gateway for download

This separation prevents any single storage system from becoming a bottleneck or single point of failure.

---

## ARQ-007: Per-Job Agent Isolation

**Assertion:**  
Each job execution must run in an isolated agent context with fresh settings, enabled tools, and job-specific environment variables.

**Examples:**

| Do | Don't |
|---|---|
| Generate new `.gemini/settings.json` per job with only allowed tools | Reuse global Gemini settings across all jobs |
| Pass `JINN_REQUEST_ID` and `JINN_MECH_ADDRESS` as env vars | Use global state to share request context |
| Delete settings file after job completion | Leave settings files accumulating on disk |
| Spawn fresh Gemini CLI subprocess per job | Keep long-running Gemini process handling multiple jobs |

**Commentary:**

Per-job isolation ensures:

1. **Security**: Jobs can only use tools specified in their `enabledTools` list
2. **Reproducibility**: Each execution starts from a clean state
3. **Debugging**: Telemetry and logs are clearly bounded to a single job
4. **Resource Management**: Process exit releases all resources

The Agent class (`gemini-agent/agent.ts`) generates settings from templates:
- Dev mode (`USE_TSX_MCP=1`): Runs MCP server via `tsx` for hot reload
- Prod mode: Runs compiled `dist/gemini-agent/mcp/server.js`

Settings include only universal tools (always available) plus the job's specific `enabledTools`. Native Gemini CLI tools (file operations, web search) are excluded by default unless explicitly enabled.

This architecture prevents privilege escalation where a job might access tools it shouldn't have.

---

## ARQ-008: Data Flow Linearity

**Assertion:**  
Data must flow linearly through the system: On-Chain → Ponder → Worker → Agent → Control API → Supabase, with no backward writes.

**Examples:**

| Do | Don't |
|---|---|
| Worker reads from Ponder, writes to Control API | Agent writes directly to Ponder database |
| Control API validates against Ponder before writing to Supabase | Supabase triggers update Ponder tables |
| Agent tools output structured data captured in telemetry | Agent tools have database credentials |
| Worker parses telemetry and persists via Control API | Agent persists its own outputs directly |

**Commentary:**

Linear data flow ensures:

1. **Security**: Agents are untrusted and isolated from persistence layers
2. **Auditability**: All data transformations happen in worker, which is trusted
3. **Simplicity**: No circular dependencies or feedback loops
4. **Testability**: Each layer can be tested independently with mocked inputs

The separation between agent execution and persistence is critical. Agents use tools that return structured JSON, but have no database or API credentials. The worker is responsible for:
- Collecting agent telemetry (tool outputs)
- Extracting artifacts and reports from telemetry
- Persisting data via Control API

This prevents compromised or misbehaving agents from corrupting system state.

---

## ARQ-009: Component File Location

**Assertion:**  
System components must reside in their designated directories as specified in the architecture map.

**Examples:**

| Do | Don't |
|---|---|
| Worker logic in `worker/mech_worker.ts` | Worker logic scattered across multiple directories |
| MCP tools in `gemini-agent/mcp/tools/` | Tools defined directly in agent.ts |
| Control API in `control-api/server.ts` | API endpoints mixed with worker code |
| Ponder handlers in `ponder/src/index.ts` | Event handlers in separate microservices |

**Commentary:**

The file structure mirrors the architectural layers:

```
worker/                     # Worker Layer
  ├── mech_worker.ts       # Main loop
  ├── situation_*.ts       # Memory system
  └── Olas*.ts             # OLAS integration

gemini-agent/              # Agent Execution Layer
  ├── agent.ts             # Gemini CLI wrapper
  ├── GEMINI.md            # Agent OS spec
  └── mcp/                 # Model Context Protocol
      ├── server.ts        # Tool server
      └── tools/           # Individual tools

control-api/               # Control API Layer
  └── server.ts            # GraphQL gateway

ponder/                    # Indexing Layer
  ├── src/index.ts         # Event handlers
  └── ponder.schema.ts     # Schema definition
```

This organization:
- Makes the architecture immediately visible from file structure
- Simplifies import paths and dependency management
- Enables layer-specific testing strategies
- Prevents mixing of concerns across components

See `docs/spec/documentation/protocol-model.md` Appendix for complete component reference map.
