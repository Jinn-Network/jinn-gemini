## PRD: Artifact-first Delivery and Indexing

### Summary
Adopt an artifact-first pipeline: artifacts created during job execution are uploaded to IPFS and referenced in the delivery payload. The subgraph (Ponder) indexes these artifact references into a lightweight `artifact` table for fast discovery. Full artifact content stays off-chain and off-index; only previews and metadata are indexed.

### Objectives
- Provide a minimal, reliable path to publish and discover artifacts created by jobs.
- Keep the subgraph lean by indexing only metadata and a short preview.
- Maintain backward compatibility with the current delivery flow (no contract changes).

### Non-Objectives
- Binary streaming or large-file optimization.
- Conversation message indexing (messages table deferred/omitted for now).
- On-chain storage of artifacts.

### Architecture Overview
- MCP tool `create_artifact` uploads content to IPFS and returns `{ cid, name, topic, contentPreview }`.
- The worker aggregates artifacts produced during a job and embeds them into `resultContent.artifacts`.
- Delivery flow uploads `resultContent` to IPFS and submits its digest via the existing on-chain delivery.
- Ponder resolves the delivery IPFS JSON, extracts `artifacts[]`, and upserts rows in the `artifact` table.

### Data Contracts
- MCP create_artifact tool (text-first; binary later via base64):
  - Input: `{ name: string, topic: string, content: string, mimeType?: string }`
  - Output: `{ cid: string, name: string, topic: string, contentPreview: string }`
  - contentPreview: first 100 UTF-8 characters of `content`.

- Delivery resultContent JSON (uploaded to IPFS by deliver):
```json
{
  "requestId": "0x...",
  "output": "Final answer...",
  "telemetry": { /* existing fields */ },
  "artifacts": [
    { "name": "summary.txt", "topic": "result.output", "cid": "bafy...", "contentPreview": "First 100 chars..." }
  ]
}
```

### MCP Tool: create_artifact
- Name: `create_artifact`
- Input schema (JSON Schema):
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["name", "topic", "content"],
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "topic": { "type": "string", "minLength": 1 },
    "content": { "type": "string", "minLength": 1 },
    "mimeType": { "type": "string" }
  }
}
```
- Output (structured): `{ cid: string, name: string, topic: string, contentPreview: string }`

### Worker Behavior
- During agent execution, whenever a tool returns an artifact `{ cid, name, topic, contentPreview }`, append it to an in-memory list for the current request.
- Before delivery, include the collected list under `resultContent.artifacts`.
- No changes to transaction submission; delivery already uploads `resultContent` to IPFS and delivers its digest.

### Ponder Indexing
- Event: `MechMarketplace:Deliver` (or `MarketplaceDelivery`).
- Steps:
  1) Resolve delivery IPFS hash → fetch JSON (with retry/backoff).
  2) If `artifacts` present, upsert each into `artifact` table using:
     - `id`: `${requestId}:${cid}` (deterministic)
     - `requestId`, `name`, `topic`, `cid`, `contentPreview`.

### Subgraph Schema (implemented)
- Table: `artifact`
  - Fields:
    - `id: string`
    - `requestId: string`
    - `name: string`
    - `cid: string`
    - `topic: string`
    - `contentPreview?: string`
  - Indexes: `requestIdIdx`, `topicIdx`.
  - Messages table removed (deferred).

### IPFS Conventions
- `create_artifact` uploads content as a single JSON or file; returns the CID.
- `contentPreview` is computed client-side (tool) to avoid fetching content during indexing.
- Full content is retrieved directly from IPFS by consumers when needed.

### Testing Plan
1) Post a marketplace request and run a job that calls `create_artifact` at least twice.
2) Confirm worker includes `artifacts[]` in `resultContent` and delivery succeeds.
3) Verify Ponder upserts `artifact` rows with expected fields and previews.
4) Validate GraphQL queries for recent artifacts by `requestId` and `topic`.

### Rollout
- Phase 1: Ship tool + worker aggregation + indexer read of delivery JSON.
- Phase 2: Add binary/base64 support and size-aware previews.
- Phase 3: Optional: add artifact download helper tool (resource_link responses).

### Risks & Mitigations
- Large content: keep previews small; full content stays on IPFS.
- Schema drift: data contracts are explicit; add version field later if needed.
- Indexer fetch latency: tolerate transient IPFS failures; retry with backoff.

### Open Questions
- Do we need per-artifact metadata (checksum, size, mimeType) indexed now or later?
- Should we group artifacts by logical phase (e.g., planning vs. execution) in `topic` taxonomy?


