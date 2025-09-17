## PRD: Jinn On-Chain Job System Migration

### 1. Overview & Background

**Project:** Jinn On-Chain Migration  
**Date:** September 14, 2025  
**Author:** Gemini Assistant

The Jinn agent system currently relies on a centralized Supabase backend for its job management, event bus, and data persistence. While powerful, this architecture limits our ability to integrate with on-chain incentive mechanisms and decentralized ecosystems.

This project will migrate the core job management and data layers of the Jinn system to a fully on-chain architecture. We will move from a proprietary job board to the open **Mech Marketplace on Base**, and from Supabase to a custom **Ponder Subgraph** for data indexing and querying. This is a forward-looking, breaking change designed to optimize for a decentralized, incentive-aligned future.

### 2. Goals & Objectives

- **Decentralize Job Management:** Replace the Supabase `job_board` with on-chain Mech Marketplace requests.
- **Establish On-Chain Provenance:** Ensure every job, artifact, and message has a clear, unbreakable, and publicly verifiable causal link back to the on-chain request and the Mech that executed it.
- **Preserve Rich Context:** Replicate the powerful `triggerContext` and `delegatedWorkContext` capabilities of the old system using a combination of on-chain data, IPFS, and GraphQL resolvers.
- **Streamline Architecture:** Create a clean, maintainable, and scalable architecture optimized for an on-chain environment, removing legacy dependencies.
- **Enhance Accountability:** Directly tie a worker's identity to the on-chain Mech address it operates, enabling transparent tracking of performance and attribution.

### 3. Core Architecture

The new system is composed of three primary components that interact through a shared, on-chain–aware data layer.

1. **Ponder Subgraph (The New Backend):** A custom Ponder instance that serves as the single source of truth. It indexes Mech Marketplace events from the **Base** blockchain and exposes a GraphQL API for reading system state.
2. **Jinn Control API (The Write Layer):** A minimal, authenticated API service that provides a secure write path to the Ponder database. This allows workers and agents to create records for custom entities like artifacts, reports, and job claims.
3. **The Worker (The Executor):** A stateless process that polls the Ponder subgraph for new jobs, claims them via the Control API, executes them using the Gemini Agent, and delivers the results on-chain via a **Gnosis Safe**.
4. **MCP Tools (The Agent's Capabilities):** A streamlined set of tools that enable agents to interact with the new on-chain system.

### 4. Technical Specifications

#### 4.1. Ponder Subgraph

- **Foundation:** The subgraph will be a fork of the official Mech Marketplace subgraph for the Base network.
- **Custom Schema:** The schema will be extended with custom entities to manage the full job lifecycle. The on-chain `Request` entity is the central anchor for all related data.

```graphql
# --- Entities Indexed from the Forked Marketplace Subgraph ---
# Field names are derived from the official subgraph for compatibility.
type Request @entity {
  id: ID! # On-chain requestId
  requester: Bytes!
  mech: Bytes! # The on-chain address of the mech (and thus, the worker)
  ipfsHash: Bytes!
  blockTimestamp: BigInt!
  transactionHash: Bytes!

  # --- Relationships to Custom Jinn Entities ---
  claim: RequestClaim @hasOne(field: "request")
  jobReport: JobReport @hasOne(field: "request")
  artifacts: [Artifact!]! @hasMany(field: "request")
  messagesSent: [Message!]! @hasMany(field: "request")
  parent: Request @belongsTo
  children: [Request!]! @hasMany(field: "parent")
}

type Deliver @entity {
  id: ID! # Transaction hash of the delivery
  request: Request! @belongsTo
  ipfsHash: Bytes!
  blockTimestamp: BigInt!
}

# --- Custom Jinn Entities (Written via Control API) ---
type Worker @entity {
  id: ID! # The Mech's on-chain address
  requests: [Request!]! @hasMany(field: "mech")
  claims: [RequestClaim!]! @hasMany(field: "worker")
  jobReports: [JobReport!]! @hasMany(field: "worker")
  artifacts: [Artifact!]! @hasMany(field: "worker")
}

type RequestClaim @entity {
  id: ID! # Equal to requestId for a unique 1-to-1 link
  request: Request! @belongsTo
  worker: Worker! @belongsTo # Linked via request.mech
  status: String! # IN_PROGRESS, COMPLETED
  claimedAt: BigInt!
  completedAt: BigInt
}

type JobReport @entity {
  id: ID!
  request: Request! @belongsTo
  worker: Worker! @belongsTo
  totalTokens: Int!
  durationMs: Int!
  toolsCalled: JSONObject!
  errorMessage: String
  errorType: String
}

type Artifact @entity {
  id: ID!
  request: Request! @belongsTo
  worker: Worker! @belongsTo
  cid: String!
  topic: String!
}
```

#### 4.2. Jinn Control API

A minimal service with the following GraphQL mutations. The API will derive the `workerAddress` from the `request.mech` field to ensure correct attribution.

- `claimRequest(requestId: ID!): RequestClaim!`
- `createJobReport(requestId: ID!, reportData: JobReportInput!): JobReport!`
- `createArtifact(requestId: ID!, artifactData: ArtifactInput!): Artifact!`

#### 4.3. Worker Workflow

1. **Poll:** Query Ponder for `Requests` where `claim` is null.
2. **Claim:** Call `claimRequest(requestId: ...)` on the Control API. The API will enforce a unique constraint on `requestId` to prevent race conditions.
3. **Fetch & Execute:** Fetch full job context from Ponder's GraphQL API, including dynamically resolved parent/child job data. Execute the agent.
4. **Report:** Upload large outputs (artifacts) to IPFS. Call `createJobReport` and `createArtifact` mutations on the Control API to store metadata and CIDs.
5. **Deliver:** Call `deliverViaSafe` from `mech-client-ts` to submit the final result digest on-chain.

#### 4.4. MCP Tools

- `post_marketplace_job(prompt: String!, priorityMech: String!, tools: [String!]!, parentRequestId: ID)`: Posts a new job to the marketplace. Embeds the full job definition (prompt, tools) and the `parentRequestId` into the IPFS metadata.
- `get_job_context(requestId: ID!)`: Queries the Ponder GraphQL API for the full context of a job, including its request, report, artifacts, and parent/child relationships.
- `create_artifact(topic: String!, content: String!)`: Uploads content to IPFS, then calls the `createArtifact` mutation on the Control API.

### 5. Non-Goals

- **Backwards Compatibility:** This is a breaking change. The legacy Supabase-based system will be deprecated.
- **Cross-Chain Support:** This initial implementation will focus exclusively on the **Base** network.
- **Complex Wallet Management:** The worker will use a pre-configured Gnosis Safe for on-chain deliveries. Dynamic wallet provisioning is out of scope for this phase.

### 6. Success Metrics

- The system can successfully discover, claim, execute, and deliver results for jobs posted on the Mech Marketplace.
- All job data, including requests, reports, and artifacts, is queryable via the Ponder subgraph.
- The causal link between parent jobs, child jobs, and their artifacts is maintained and verifiable through the subgraph.
- The performance (job throughput, execution latency) of the new system is on par with or better than the legacy system.

---

## Implementation Plan: Jinn On-Chain Migration (v3 - Final)

### Phase 0: Prerequisites & Scaffolding

**Goal:** Prepare the foundational infrastructure for the new on-chain system.

1) Set up Ponder Project
- Create `jinn-gemini/ponder`
- Initialize: `pnpm create ponder`
- Configure `ponder.config.ts` with Base Mech Marketplace ABI/address (from `mech-client-ts/src/config.ts`)
- Implement basic handlers logging `Request` and `Deliver` events

2) Supabase Schema Changes
- Add `request_id TEXT` to `job_reports`, `artifacts`, `messages` (+ indexes)
- Create `request_claims(request_id PRIMARY KEY, worker_address TEXT, status TEXT, claimed_at, completed_at)`
- Apply migration and RLS/ACL for secure writes

### Phase 1: Worker – On-Chain Job Processing

**Goal:** Poll, claim, execute, report, and deliver jobs from the Mech marketplace.

1) New MECH worker entrypoint
- Create `worker/mech_worker.ts`; add script: `dev:mech`

2) Poller & robust claiming
- `getUnclaimedRequests()`:
  - Query Ponder GraphQL for latest `Request`s
  - Cross-check `request_claims` in Supabase
  - Reclaim policy: treat `IN_PROGRESS` older than N minutes as stale
- `claimRequest(request)`:
  - Insert into `request_claims` (PK enforces atomic single-claim)
  - On constraint error, skip

3) Context assembly & agent run
- `assembleContext(request)`:
  - Fetch IPFS metadata for `prompt`, `enabledTools`, `parentRequestId`
  - If `parentRequestId`: read Supabase `artifacts`/`job_reports` where `request_id = parent`
  - Build baseline prompt sections (trigger/delegated context)
- Run `Agent` with env: `JINN_REQUEST_ID=request.id`, `JINN_MECH_ADDRESS=request.mech`

4) Reporting & delivery
- `storeMechJobReport`: insert into `job_reports` with `request_id` and `worker_address`
- Deliver: use `deliverViaSafe` (from `mech-client-ts`) with result CID
- Mark claim `status=COMPLETED`, set `completed_at`

### Phase 2: MCP Tools – On-Chain Capabilities

**Goal:** Enable agents to create and inspect on-chain jobs.

1) `post_marketplace_job`
- New tool at `gemini-agent/mcp/tools/post_marketplace_job.ts`
- Read `JINN_REQUEST_ID` → set as `parentRequestId` in IPFS metadata
- Call `marketplaceInteract({ chainConfig: 'base', postOnly: true, extraAttributes })`
- Return tx hash and new request ids

2) Supabase write tools lineage
- Extend `shared/context.ts` to include `JINN_REQUEST_ID`, `JINN_MECH_ADDRESS`
- In `create-record.ts`, auto-inject `request_id` (and `worker/mech` if applicable) when table ∈ {artifacts, messages, job_reports}

### Phase 2.5: Jinn Control API — Write Layer

**Goal:** Provide an authenticated, auditable write path for on-chain jobs; move all writes off MCP direct-to-DB into a stable API.

- Surface: GraphQL with mutations:
  - `claimRequest(requestId: ID!): RequestClaim!`
  - `createJobReport(requestId: ID!, reportData: JobReportInput!): JobReport!`
  - `createArtifact(requestId: ID!, artifactData: ArtifactInput!): Artifact!`
- AuthZ & Identity:
  - Service-to-service key or signed JWT; enforce RLS-compatible claims
  - Derive/validate `worker_address` server-side (e.g., from header), ensure it matches `request.mech`
- Integrity & Idempotency:
  - Idempotency-Key header for all mutations
  - Uniqueness on `request_id` for claims (conflicts return existing claim)
  - Validate `request_id` exists in Ponder before writes (cache allowed)
- Lineage (server-enforced):
  - Auto-inject `request_id` and `worker_address`; ignore client-provided values
- Observability & Limits:
  - Structured logs with correlation IDs; basic rate limiting per `worker_address`

### Phase 3: Activation & Transition

**Goal:** Switch to new flow and deprecate legacy job tools.

- Register `post_marketplace_job` in `mcp/server.ts`
- Remove legacy job tools (`create_job`, `create_job_batch`) from `Agent` `universalTools`
- Route writes through Control API (feature-flagged; default ON):
  - mech_worker uses Control API for `claimRequest`, `createJobReport`, `createArtifact`
  - MCP write tools prefer Control API; fallback to direct DB path only behind a flag
- Security & RLS hardening:
  - Tighten onchain_* table policies to service-role only for writes; all app writes go via Control API
- Docs: update `AGENT_README.md`, `docs/documentation/DATABASE_MAP.md`, `SETUP.md` with Control API usage

### Phase 4: Testing & Validation

**Goal:** E2E validation in a controlled environment.

- Configure Base test RPC / local Anvil; prepare Safe and Mech fixtures
- E2E script `scripts/test_onchain_e2e.ts`:
  - Post job via `post_marketplace_job`
  - Worker claims via Control API → runs → stores `job_report`/`artifact` via Control API (with `request_id`)
  - Deliver via Safe
  - Verify Ponder indexed `Deliver` and links to `Request`
- Control API test cases:
  - Claim idempotency under concurrency: exactly one claim row created; others receive existing
  - Unknown `request_id` rejected (Ponder-backed validation)
  - Server-side lineage: `request_id`/`worker_address` enforced; client-supplied ignored
  - Rate limit and retry/backoff behavior on 429/5xx with Idempotency-Key respected

### Additional Refinements

- Schema/source alignment: keep marketplace subgraph `Request`/`Deliver` fields verbatim
- Claiming robustness: reclaim stale `IN_PROGRESS` by `claimed_at` age
- Baseline prompt: always include `get_job_context` results + Supabase rows by `request_id`
- Security: validate `request_id` exists in subgraph before claim; restrict `request_claims` writes
- Rate limits/backoff: reuse worker’s retry scaffolding




