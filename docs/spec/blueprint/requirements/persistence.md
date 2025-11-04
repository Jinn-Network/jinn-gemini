# Persistence Requirements

Data persistence and IPFS requirements for the Jinn protocol.

---

## PER-001: Four-Layer Storage Architecture

**Assertion:**  
The protocol must use four distinct storage layers: on-chain (Base), indexed (Ponder PostgreSQL), operational (Supabase PostgreSQL), and content-addressed (IPFS).

**Examples:**

| Do | Don't |
|---|---|
| Store job requests and deliveries on-chain | Store all data in centralized database |
| Index on-chain events in Ponder PostgreSQL | Query blockchain directly for job discovery |
| Store operational data in Supabase via Control API | Mix operational and indexed data in same tables |
| Store content (prompts, artifacts) in IPFS | Store large content in PostgreSQL columns |

**Commentary:**

Each storage layer serves a distinct purpose:

**1. On-Chain (Base Network):**
- **What**: MarketplaceRequest events, Deliver events
- **Why**: Immutable source of truth, public auditability, censorship resistance
- **Access**: Write via Safe transactions, read via Ponder indexing

**2. Indexed (Ponder PostgreSQL):**
- **What**: `request`, `delivery`, `artifact`, `jobDefinition`, `message` tables
- **Why**: Fast queryable interface, IPFS metadata resolved, relationships pre-computed
- **Access**: Read-only from application (Ponder writes)

**3. Operational (Supabase PostgreSQL):**
- **What**: `onchain_request_claims`, `onchain_job_reports`, `onchain_artifacts`, `onchain_messages`
- **Why**: Supplementary data not stored on-chain (too expensive), worker coordination
- **Access**: Write via Control API, read via Supabase client

**4. Content-Addressed (IPFS):**
- **What**: Job prompts, delivery payloads, artifact content, SITUATION/MEMORY
- **Why**: Immutable, distributed, content-addressed, scalable storage
- **Access**: Write to Autonolas registry, read from Autonolas gateway

**5. Vector (PostgreSQL with pgvector):**
- **What**: `node_embeddings` table with VECTOR(256) column
- **Why**: Semantic similarity search for SITUATION artifacts
- **Access**: Written by Ponder during indexing, queried by search tools

This separation prevents overloading any single system and provides fault tolerance—if one layer fails, others remain operational.

---

## PER-002: On-Chain as Source of Truth

**Assertion:**  
On-chain events must be the immutable source of truth for all job requests and deliveries, with off-chain data always linked to on-chain origins.

**Examples:**

| Do | Don't |
|---|---|
| Validate `requestId` exists in Ponder before off-chain writes | Create database records without on-chain validation |
| Use `requestId` from on-chain event as primary key | Generate database IDs independently |
| Query Ponder for job discovery | Poll Supabase for unclaimed work |
| Wait for on-chain delivery before marking job complete | Update database status without on-chain confirmation |

**Commentary:**

On-chain-first architecture ensures:

**Immutability:**
- Once a MarketplaceRequest event is emitted, it cannot be altered
- Blockchain provides permanent record of job history
- No central authority can delete or modify job records

**Auditability:**
- Anyone can verify job was requested and completed
- Complete chain of custody from request to delivery
- Worker addresses are recorded on-chain

**Censorship Resistance:**
- Job marketplace is permissionless
- No gatekeeper can block job posting
- Workers self-select jobs without approval

**Validation Pattern:**
```typescript
// Control API mutation
async claimRequest(requestId: string) {
  // 1. Validate requestId exists in Ponder
  const request = await ponderClient.query({
    request(id: requestId) { id, delivered }
  });
  
  if (!request) {
    throw new Error('Request not found on-chain');
  }
  
  // 2. Create off-chain claim record
  const claim = await supabase
    .from('onchain_request_claims')
    .insert({ request_id: requestId, worker_address: workerAddress })
    .single();
  
  return claim;
}
```

This validation ensures off-chain data is always grounded in on-chain reality.

---

## PER-003: IPFS Content Addressing

**Assertion:**  
All variable-length content (prompts, artifacts, deliveries) must be stored in IPFS and referenced by CID, not stored directly in databases.

**Examples:**

| Do | Don't |
|---|---|
| Upload job prompt to IPFS, store CID in database | Store full prompt text in database |
| Upload artifact content to IPFS, reference by CID | Store artifact content in PostgreSQL |
| Upload delivery JSON to IPFS, post CID digest on-chain | Post full delivery data in transaction calldata |
| Use Autonolas IPFS infrastructure (registry + gateway) | Run custom IPFS node |

**Commentary:**

IPFS provides content-addressed storage with key properties:

**Content Addressing:**
- CID (Content Identifier) is cryptographic hash of content
- Same content always produces same CID
- Tamper-evident—changing content changes CID
- Self-describing—CID encodes hash algorithm and format

**Distribution:**
- Content can be retrieved from any IPFS node that has it
- No central server required
- Peer-to-peer replication
- Geographic redundancy

**Autonolas Infrastructure:**
- **Upload**: `https://registry.autonolas.tech/api/v0/add`
- **Download**: `https://gateway.autonolas.tech/ipfs/{cid}`
- Battle-tested in OLAS ecosystem
- No operational burden on Jinn protocol

**Size Efficiency:**
- Database stores 46-character CID strings
- IPFS stores actual content (megabytes)
- Database queries remain fast
- IPFS fetches are lazy (only when needed)

**Example Flow:**
```typescript
// Upload
const content = { objective: "...", context: "...", ... };
const cid = await pushToIpfs(content);
// → "bafybeiabc123..."

// Store CID in database
await supabase.from('requests').insert({ id: requestId, prompt_cid: cid });

// Later: Fetch content
const url = `https://gateway.autonolas.tech/ipfs/${cid}`;
const content = await fetch(url).then(r => r.json());
```

This pattern separates hot data (database) from cold data (IPFS).

---

## PER-004: Lineage Preservation

**Assertion:**  
All persisted data must maintain lineage fields linking back to originating on-chain request: `requestId`, `sourceRequestId`, `jobDefinitionId`, `sourceJobDefinitionId`.

**Examples:**

| Do | Don't |
|---|---|
| Auto-inject `request_id` via Control API | Manually construct lineage in worker |
| Store both `jobDefinitionId` and `sourceJobDefinitionId` | Store only current job ID |
| Use `requestId` as foreign key to Ponder tables | Use generated UUIDs as primary keys |
| Preserve lineage even on job failure | Omit lineage for failed jobs |

**Commentary:**

Lineage fields enable traceability:

**Request Identity:**
- `requestId`: On-chain request ID (0x...) for this execution
- Links to `request` table in Ponder
- Immutable once set

**Job Container:**
- `jobDefinitionId`: UUID identifying job container
- Persists across multiple execution runs
- Used for context accumulation

**Hierarchy:**
- `sourceRequestId`: Parent request that dispatched this one
- `sourceJobDefinitionId`: Parent job container
- Enables tree traversal

**Control API Injection:**
```typescript
// Worker calls
await controlApiClient.createJobReport({
  requestId,  // Required
  reportData: { status, duration_ms, total_tokens, final_output }
});

// Control API automatically injects
const enriched = {
  request_id: requestId,
  worker_address: headers['x-worker-address'],
  ...reportData,
  created_at: new Date()
};

await supabase.from('onchain_job_reports').insert(enriched);
```

**Query Benefits:**
```sql
-- Find all reports for a request
SELECT * FROM onchain_job_reports WHERE request_id = '0x...';

-- Find all runs of a job definition
SELECT * FROM requests WHERE job_definition_id = 'uuid';

-- Find children of a job
SELECT * FROM requests WHERE source_job_definition_id = 'uuid';

-- Trace full ancestry
WITH RECURSIVE ancestry AS (
  SELECT * FROM requests WHERE id = '0x...'
  UNION
  SELECT r.* FROM requests r
  JOIN ancestry a ON r.id = a.source_request_id
)
SELECT * FROM ancestry;
```

Lineage is the foundation of auditability and hierarchy navigation.

---

## PER-005: IPFS Delivery Architecture

**Assertion:**  
Delivery payloads must be uploaded to IPFS with wrap-with-directory, stored on-chain as SHA256 digest, and reconstructed by Ponder for indexing.

**Examples:**

| Do | Don't |
|---|---|
| Upload with `wrap-with-directory: true` | Upload without directory wrapper |
| Extract SHA256 digest from directory CID | Store full CID on-chain |
| Reconstruct directory CID in Ponder using dag-pb codec | Store full directory CID in event |
| Fetch `{dirCID}/{requestId}` for delivery JSON | Fetch raw digest as IPFS path |

**Commentary:**

The IPFS delivery architecture is optimized for gas efficiency:

**Upload Process:**
1. Assemble delivery JSON:
   ```json
   {
     "requestId": "0x...",
     "output": "Final result",
     "telemetry": {...},
     "artifacts": [{cid, name, topic, type}],
     "workerTelemetry": {...},
     "recognition": {...},
     "reflection": {...}
   }
   ```
2. Upload to IPFS with `wrap-with-directory: true`
3. Receive directory CID (e.g., `bafybeihkn34x...`)
4. Extract SHA256 digest from CID structure (32 bytes)
5. Call `OlasMech.deliver(requestId, digest)` on-chain

**On-Chain Storage:**
- Only 32-byte digest is stored (gas-efficient)
- Digest is inside the CID structure (dag-pb codec 0x70, base32)
- Full CID can be reconstructed from digest

**Ponder Reconstruction:**
1. Read digest from `Deliver` event
2. Reconstruct directory CID: `base32(0x70 + digest)`
3. Fetch: `https://gateway.autonolas.tech/ipfs/{dirCID}/{requestId}`
4. Parse delivery JSON
5. Index artifacts

**Common Mistake:**
```bash
# ❌ Wrong: Fetching digest directly returns binary directory structure
curl https://gateway.autonolas.tech/ipfs/f01551220{digest}

# ✅ Correct: Fetching file within directory returns JSON
curl https://gateway.autonolas.tech/ipfs/{dirCID}/{requestId}
```

This architecture saves gas (only 32 bytes on-chain) while maintaining full content availability via IPFS.

---

## PER-006: Database Schema Separation

**Assertion:**  
On-chain indexed tables (Ponder) and off-chain operational tables (Supabase) must be strictly separated with no overlapping writes.

**Examples:**

| Do | Don't |
|---|---|
| Ponder writes to `request`, `delivery`, `artifact` tables | Worker writes to Ponder tables |
| Control API writes to `onchain_*` tables in Supabase | Ponder writes to Supabase |
| Query Ponder for on-chain data, Supabase for operational data | Mix on-chain and operational data in queries |
| Join across Ponder and Supabase using `requestId` | Duplicate data between Ponder and Supabase |

**Commentary:**

Schema separation provides clear ownership:

**Ponder Schema (Read-Only from Worker):**
```sql
-- On-chain event data
CREATE TABLE request (
  id TEXT PRIMARY KEY,                    -- 0x...
  mech TEXT NOT NULL,
  sender TEXT NOT NULL,
  ipfs_hash TEXT,
  job_name TEXT,
  enabled_tools TEXT[],
  job_definition_id TEXT,
  source_job_definition_id TEXT,
  delivered BOOLEAN DEFAULT false,
  block_number BIGINT,
  block_timestamp BIGINT
);

CREATE TABLE delivery (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  ipfs_hash TEXT,
  transaction_hash TEXT,
  block_number BIGINT,
  block_timestamp BIGINT
);

CREATE TABLE artifact (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  name TEXT,
  topic TEXT,
  type TEXT,
  tags TEXT[],
  cid TEXT,
  content_preview TEXT
);
```

**Supabase Schema (Write via Control API):**
```sql
-- Operational data
CREATE TABLE onchain_request_claims (
  request_id TEXT PRIMARY KEY,            -- Links to Ponder request.id
  worker_address TEXT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE onchain_job_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,               -- Links to Ponder request.id
  worker_address TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  total_tokens INTEGER,
  final_output TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Why Separation?**
- Ponder owns on-chain data (single source of truth)
- Supabase owns operational data (doesn't need to be on-chain)
- No write conflicts or race conditions
- Clear access patterns (read Ponder, write Supabase)

**Join Pattern:**
```typescript
// Get request from Ponder
const request = await ponderClient.query({
  request(id: requestId) { id, jobName, enabledTools }
});

// Get report from Supabase
const report = await supabase
  .from('onchain_job_reports')
  .select('*')
  .eq('request_id', requestId)
  .single();

// Combine in application layer
const combined = { ...request, report };
```

This separation is enforced by access controls—worker has no Ponder write credentials.

---

## PER-007: pgvector for Embeddings

**Assertion:**  
SITUATION embeddings must be stored in PostgreSQL using the pgvector extension with VECTOR(256) type and ivfflat index for cosine similarity search.

**Examples:**

| Do | Don't |
|---|---|
| Use `VECTOR(256)` column type | Store embeddings as JSONB arrays |
| Create ivfflat index on vec column | Use no index or standard B-tree index |
| Query with cosine distance: `ORDER BY vec <=> $1::vector` | Use Euclidean distance for semantic search |
| Store embeddings in dedicated `node_embeddings` table | Mix embeddings with other artifact metadata |

**Commentary:**

pgvector enables efficient similarity search:

**Schema:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE node_embeddings (
  node_id TEXT PRIMARY KEY,
  model TEXT NOT NULL CHECK (model = 'text-embedding-3-small'),
  dim INTEGER NOT NULL CHECK (dim = 256),
  vec VECTOR(256) NOT NULL,
  summary TEXT,
  meta JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX node_embeddings_vec_idx
  ON node_embeddings
  USING ivfflat (vec vector_cosine_ops)
  WITH (lists = 100);
```

**Query:**
```sql
-- Find top-5 similar situations
SELECT 
  node_id,
  1 - (vec <=> $1::vector) as similarity,
  summary,
  meta
FROM node_embeddings
ORDER BY vec <=> $1::vector
LIMIT 5;
```

**Why pgvector?**
- Native PostgreSQL extension (no separate vector database)
- ivfflat index provides approximate nearest neighbor search (fast)
- Cosine similarity is standard for semantic search
- JSONB meta field stores full situation context
- Integrates with existing Ponder infrastructure

**Performance:**
- ivfflat builds 100 clusters (lists = 100)
- Search probes clusters for approximate results
- Trade accuracy for speed (acceptable for this use case)
- Sub-100ms queries on thousands of vectors

**Alternative Considered:**
Separate vector database (Pinecone, Weaviate) rejected because:
- Adds operational complexity
- Requires data synchronization
- pgvector performance is sufficient
- Keep all indexed data in PostgreSQL

This design emerged from JINN-233 semantic graph search implementation.

---

## PER-008: Idempotent Operations

**Assertion:**  
Database operations must be idempotent where appropriate, using ON CONFLICT clauses to prevent duplicates and enable retry safety.

**Examples:**

| Do | Don't |
|---|---|
| Use `ON CONFLICT (request_id) DO NOTHING` for claims | Fail on duplicate claim attempts |
| Use `ON CONFLICT (node_id) DO UPDATE` for embeddings | Insert duplicate embeddings |
| Return existing record on conflict | Throw error forcing manual cleanup |
| Support multiple worker calls with same requestId | Require exactly-once semantics |

**Commentary:**

Idempotency enables safe retries:

**Claim Idempotency:**
```typescript
// Control API claimRequest mutation
const { data, error } = await supabase
  .from('onchain_request_claims')
  .insert({ request_id: requestId, worker_address: workerAddress })
  .select()
  .single();

if (error?.code === '23505') {  // unique_violation
  // Already claimed, fetch existing
  const existing = await supabase
    .from('onchain_request_claims')
    .select('*')
    .eq('request_id', requestId)
    .single();
  
  return existing;
}
```

**Embedding Upsert:**
```sql
INSERT INTO node_embeddings (node_id, model, dim, vec, summary, meta)
VALUES ($1, $2, $3, $4::vector, $5, $6)
ON CONFLICT (node_id) DO UPDATE SET
  model = EXCLUDED.model,
  dim = EXCLUDED.dim,
  vec = EXCLUDED.vec,
  summary = EXCLUDED.summary,
  meta = EXCLUDED.meta,
  updated_at = NOW();
```

**Why Idempotency?**
- Network failures cause retries
- Multiple workers might attempt same claim
- Ponder might re-index same SITUATION
- System is more robust without requiring exactly-once guarantees

**Atomic Operations:**
Each mutation is a single database transaction—either succeeds completely or fails completely, never partial state.

This pattern emerged from early race conditions when multiple workers tried to claim the same request.

---

## PER-009: Content Truncation Strategy

**Assertion:**  
Content stored in databases must be truncated to reasonable limits, with full content available via IPFS CID references.

**Examples:**

| Do | Don't |
|---|---|
| Store 1200-char `finalOutputSummary` in SITUATION | Store unbounded output in database |
| Store full artifact content in IPFS, preview in database | Store full content in database |
| Truncate execution trace to 15 tool calls | Store complete tool call history |
| Store CID and contentPreview, fetch full content on demand | Duplicate content in database and IPFS |

**Commentary:**

Truncation balances queryability with storage efficiency:

**SITUATION Artifact:**
```typescript
const situation = {
  execution: {
    trace: toolCalls.slice(0, 15).map(tc => ({
      tool: tc.tool,
      args: truncate(tc.args, 200),
      result_summary: truncate(tc.result, 500)
    })),
    finalOutputSummary: truncate(finalOutput, 1200)
  }
};
```

**Artifact Records:**
```sql
CREATE TABLE artifact (
  ...
  cid TEXT NOT NULL,                      -- Full content address
  content_preview TEXT,                   -- First 500 chars
  ...
);
```

**Rationale:**
- Database queries stay fast with bounded field sizes
- Full content always available via IPFS
- Previews enable browsing without fetching full content
- Embeddings use truncated summaries (quality maintained)

**Truncation Points:**
- Tool args: 200 chars
- Tool result: 500 chars
- Final output: 1200 chars
- Content preview: 500 chars
- Execution trace: 15 tool calls

These limits were calibrated during JINN-233 to balance embedding quality with storage efficiency.

---

## PER-010: Data Retention and Cleanup

**Assertion:**  
Temporary files (telemetry, settings) must be cleaned up after job execution, but persistent data (IPFS, database) must be retained indefinitely.

**Examples:**

| Do | Don't |
|---|---|
| Delete telemetry file after parsing | Leave telemetry files accumulating |
| Delete settings.json after agent exits | Reuse settings files across jobs |
| Keep IPFS content indefinitely (immutable) | Prune old IPFS content |
| Keep database records indefinitely (audit trail) | Delete old job reports |

**Commentary:**

Cleanup strategy:

**Ephemeral (Delete):**
```typescript
// After job execution
try {
  await fs.unlink(telemetryFile);          // Delete telemetry
  await fs.unlink('.gemini/settings.json'); // Delete settings
} catch (error) {
  // Non-fatal, log warning
  logger.warn('Cleanup failed', { error });
}
```

**Persistent (Retain):**
- On-chain events: Immutable, permanent
- Ponder index: Retains all indexed events
- Supabase records: Audit trail, no deletion
- IPFS content: Content-addressed, immutable
- Embeddings: Used for semantic search

**Why No Deletion?**
- Complete audit trail for debugging
- Historical data for learning system
- On-chain data can't be deleted anyway
- Storage is cheap compared to loss of context

**Disk Management:**
- Ephemeral files in `/tmp` (auto-cleaned by OS)
- Log rotation for worker logs
- IPFS pinning by Autonolas infrastructure

**Future Consideration:**
If storage becomes issue, consider:
- Archiving old telemetry to cold storage
- Pruning database records older than N months
- Keeping only aggregate statistics for old jobs

But default is retention—data is valuable for debugging and learning.
