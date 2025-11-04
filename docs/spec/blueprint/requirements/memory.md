# Memory Requirements

Learning and memory system requirements for the Jinn protocol.

---

## MEM-001: Dual-Path Learning System

**Assertion:**  
The protocol must provide two complementary learning pathways: semantic similarity search (SITUATION artifacts) and tag-based discovery (MEMORY artifacts).

**Examples:**

| Do | Don't |
|---|---|
| Use SITUATION for automatic semantic context matching | Use only tag-based memory |
| Use MEMORY for curated topical knowledge | Use only semantic search |
| Create SITUATION for all terminal states (COMPLETED, FAILED) | Create SITUATION only for successful jobs |
| Create MEMORY selectively during reflection when valuable | Create MEMORY for every job execution |

**Commentary:**

The dual-path system provides complementary retrieval mechanisms:

**SITUATION Artifacts (Semantic, Automatic):**
- Created automatically for all completions
- Full execution context with embeddings
- Discovered via vector similarity search
- Provides "similar past jobs" at recognition time

**MEMORY Artifacts (Tagged, Curated):**
- Created selectively during reflection
- Curated insights and learnings
- Discovered via tag matching
- Provides "relevant knowledge" at execution time

**Why both?**
- Semantic search finds similar contexts even without exact tag matches
- Tag search finds specific knowledge even if execution contexts differ
- SITUATION captures "what happened", MEMORY captures "what we learned"
- Automatic + selective creation balances coverage with signal quality

Example: A job about "OLAS staking optimization" would:
1. Find similar jobs via SITUATION embedding (jobs with similar objectives/tools)
2. Find relevant knowledge via MEMORY tags (memories tagged "staking", "optimization")

This emerged from JINN-231 (MEMORY) and JINN-233 (SITUATION) as we recognized that semantic similarity alone misses explicitly tagged domain knowledge.

---

## MEM-002: SITUATION Artifact Structure

**Assertion:**  
SITUATION artifacts must contain job metadata, execution trace, final output, context relationships, artifacts, and 256-dimensional embedding vector.

**Examples:**

| Do | Don't |
|---|---|
| Include complete job hierarchy (parent, siblings, children) | Store only current job in isolation |
| Include execution trace with up to 15 tool calls | Include full tool call history |
| Truncate final output to 1200 characters | Include unbounded output text |
| Embed summary text using `text-embedding-3-small` | Use different embedding models per job |

**Commentary:**

SITUATION artifact schema (version `sit-enc-v1.1`):

```json
{
  "version": "sit-enc-v1.1",
  "job": {
    "requestId": "0x...",
    "jobName": "...",
    "jobDefinitionId": "uuid",
    "model": "gemini-2.5-flash",
    "objective": "...",
    "acceptanceCriteria": "...",
    "enabledTools": ["web_fetch", ...]
  },
  "context": {
    "parent": { "requestId": "...", "jobDefinitionId": "..." },
    "siblings": [...],
    "children": [...]
  },
  "execution": {
    "status": "COMPLETED",
    "trace": [
      {
        "tool": "web_fetch",
        "args": "...",
        "result_summary": "..."
      }
    ],
    "finalOutputSummary": "..."
  },
  "artifacts": [
    {
      "topic": "research",
      "name": "...",
      "contentPreview": "..."
    }
  ],
  "embedding": {
    "model": "text-embedding-3-small",
    "dim": 256,
    "vector": [0.123, ...]
  },
  "meta": {
    "summaryText": "...",
    "recognition": { "similarJobs": [...] },
    "generatedAt": "2024-..."
  }
}
```

**Design Rationale:**
- **Bounded Trace**: 15 tool calls prevents bloat while capturing patterns
- **Truncated Output**: 1200 chars balances context with embedding quality
- **256-dim Embeddings**: Matches pgvector VECTOR(256) for optimal search performance
- **Hierarchy Context**: Enables understanding job relationships
- **Recognition Meta**: Links back to similar jobs that informed this execution

The summary text (used for embedding) combines: job name, objective, acceptance criteria, execution status, tool calls, and final output. This comprehensive summary enables semantic matching across jobs with different specific details but similar overall patterns.

---

## MEM-003: Situation Encoding Lifecycle

**Assertion:**  
SITUATION artifacts must be created after execution, enriched with telemetry data, embedded, uploaded to IPFS, and included in delivery payload.

**Examples:**

| Do | Don't |
|---|---|
| Enrich initial situation from recognition with execution data | Create two separate situations |
| Generate embedding after execution completes | Embed initial situation before execution |
| Upload complete SITUATION to IPFS as artifact | Store situation only in database |
| Add SITUATION to delivery payload artifacts array | Upload situation after delivery |

**Commentary:**

The SITUATION lifecycle spans the entire job:

**Recognition Phase (Pre-Execution):**
1. Create initial situation with job metadata only
2. Generate embedding for initial summary
3. Use for vector search to find similar past jobs
4. Keep initial situation in memory

**Execution Phase:**
- Agent runs with learnings from similar situations

**Situation Creation Phase (Post-Execution):**
1. Check if initial situation exists from recognition
2. If yes: Enrich with execution data (status, trace, output, artifacts)
3. If no: Encode full situation from scratch
4. Generate final embedding (may differ from initial if enriched)
5. Call `create_artifact` MCP tool with topic "SITUATION", type "SITUATION"
6. Tool uploads to IPFS, returns CID
7. Worker adds to delivery payload

**Why enrich instead of recreate?**
- Preserves recognition metadata (which similar jobs were found)
- Avoids duplicate embedding generation
- Links pre-execution context to post-execution results
- Enables future analysis of recognition effectiveness

The situation is uploaded as a standard artifact, ensuring it's indexed by Ponder along with other job outputs.

---

## MEM-004: Embedding Consistency

**Assertion:**  
All SITUATION embeddings must use the same model (`text-embedding-3-small`) and dimensionality (256) to ensure comparable similarity search.

**Examples:**

| Do | Don't |
|---|---|
| Use `text-embedding-3-small` for all embeddings | Mix different embedding models |
| Use 256 dimensions for all vectors | Use variable dimensions per job |
| Store model name and dim in situation metadata | Assume embedding format |
| Validate vector length before database insert | Allow mismatched vector dimensions |

**Commentary:**

Embedding consistency is critical for similarity search:

**Database Schema:**
```sql
CREATE TABLE node_embeddings (
  node_id TEXT PRIMARY KEY,
  model TEXT NOT NULL CHECK (model = 'text-embedding-3-small'),
  dim INTEGER NOT NULL CHECK (dim = 256),
  vec VECTOR(256) NOT NULL,
  summary TEXT,
  meta JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX node_embeddings_vec_idx
  ON node_embeddings USING ivfflat (vec vector_cosine_ops)
  WITH (lists = 100);
```

**Why these constraints?**
- **Same Model**: Different models produce incomparable embeddings
- **Same Dimensions**: pgvector requires fixed dimensionality for index
- **ivfflat Index**: Approximate nearest neighbor search for performance
- **Cosine Similarity**: Standard metric for semantic similarity

**Model Choice Rationale:**
- `text-embedding-3-small` balances quality and cost
- 256 dimensions reduce storage while maintaining discriminative power
- OpenAI model provides stable API with consistent behavior

If we ever change embedding strategy, we must:
1. Create new table with new vector dimensions
2. Re-embed all existing situations
3. Update search queries to use new table
4. Maintain old table for backward compatibility

Embedding consistency is a protocol invariant—changing it requires coordinated migration.

---

## MEM-005: Recognition Phase Execution

**Assertion:**  
The recognition phase must run before agent execution, search for similar situations, inject learnings into prompt, and degrade gracefully on failure.

**Examples:**

| Do | Don't |
|---|---|
| Run `runRecognitionPhase()` before `agent.run()` | Run recognition in parallel with execution |
| Continue execution if recognition fails | Block execution on recognition failure |
| Prepend learnings as markdown to job prompt | Replace original prompt with learnings |
| Search for top-5 similar situations | Search for all situations |

**Commentary:**

Recognition phase flow:

1. **Initial Situation Creation**: Encode job metadata without execution data
2. **Summary Generation**: Create searchable text from objective, criteria, context
3. **Embedding**: Generate 256-dim vector from summary
4. **Vector Search**: Query `node_embeddings` for top-5 by cosine similarity
5. **Artifact Fetching**: Retrieve full SITUATION JSON from IPFS for matches
6. **Learning Extraction**: Identify patterns from successful executions:
   - Tool sequences that worked
   - Common failure modes
   - Optimal strategies
7. **Prompt Enhancement**: Format learnings as markdown, prepend to original prompt
8. **Graceful Failure**: If any step fails, log warning and proceed without learnings

**Enhanced Prompt Structure:**
```markdown
# Learnings from Similar Past Jobs

## Job: [Similar Job Name]
- Similarity: 0.87
- Strategy: [What worked]
- Pitfalls: [What to avoid]
- Tools: [Effective tool patterns]

## Job: [Another Similar Job]
...

---

# Your Assignment

[Original prompt]
```

**Why graceful degradation?**
- Recognition is an optimization, not a requirement
- IPFS fetches may timeout
- Embeddings API may be unavailable
- Core execution should never be blocked by learning system

The recognition phase validates the semantic graph search system (JINN-233).

---

## MEM-006: Reflection Phase Execution

**Assertion:**  
The reflection phase must run after successful completion, use lightweight agent to review telemetry, and extract MEMORY artifacts when valuable.

**Examples:**

| Do | Don't |
|---|---|
| Run reflection only on COMPLETED status | Run reflection on all jobs |
| Use separate lightweight agent for reflection | Extend main execution for reflection |
| Extract MEMORY artifacts from reflection telemetry | Manually create MEMORY in worker |
| Merge reflection artifacts into delivery payload | Store reflection artifacts separately |

**Commentary:**

Reflection phase flow:

1. **Trigger Check**: Only run if job status is COMPLETED
2. **Reflection Agent**: Spawn lightweight Gemini run with:
   - Original job prompt and acceptance criteria
   - Execution telemetry (tools, outputs, duration)
   - Final job output
   - Explicit prompt to identify valuable insights
3. **MEMORY Creation**: Agent calls `create_artifact` with:
   - `type: "MEMORY"`
   - `tags: ["keyword1", "keyword2", ...]`
   - `name`: Descriptive name
   - `topic`: "learnings"
   - `content`: Markdown-formatted insights
4. **Artifact Extraction**: Worker parses reflection telemetry for MEMORY artifacts
5. **Delivery Merge**: MEMORY artifacts included in delivery payload

**Reflection Prompt Template:**
```markdown
Review this job execution and identify valuable learnings.

Job: [name]
Objective: [objective]
Acceptance Criteria: [criteria]

Execution:
- Status: COMPLETED
- Tools Used: [tools]
- Duration: [duration]ms
- Outputs: [outputs]

If you identify valuable insights, create a MEMORY artifact:
- type: "MEMORY" (required)
- tags: ["keyword1", "keyword2"] (required)
- name: descriptive-name
- topic: "learnings"
- content: Markdown-formatted insights

Only create MEMORY if the insights are:
1. Reusable across similar jobs
2. Not obvious from objective alone
3. Actionable for future agents
```

The reflection phase validates the tag-based memory system (JINN-231).

---

## MEM-007: MEMORY Artifact Structure

**Assertion:**  
MEMORY artifacts must include `type: "MEMORY"`, relevant `tags` array, and markdown-formatted content with actionable insights.

**Examples:**

| Do | Don't |
|---|---|
| Include `type: "MEMORY"` field for Ponder indexing | Omit type field |
| Use `tags: ["staking", "contract-analysis"]` for discovery | Use unstructured tags |
| Format content as markdown with headers | Use plain text without structure |
| Make insights actionable and specific | Include vague or obvious observations |

**Commentary:**

MEMORY artifact schema:

```json
{
  "name": "staking_contract_analysis_learnings",
  "topic": "learnings",
  "type": "MEMORY",
  "tags": ["staking", "contract-analysis", "olas"],
  "content": "# Staking Contract Analysis\n\n## Key Insights\n...",
  "cid": "bafybeiabc123...",
  "requestId": "0x...",
  "contentPreview": "# Staking Contract Analysis..."
}
```

**Tag Guidelines:**
- Use lowercase kebab-case
- Include domain terms (e.g., "staking", "optimization")
- Include operation types (e.g., "analysis", "deployment")
- Include technology names (e.g., "solidity", "olas")
- Keep tags specific but reusable

**Content Guidelines:**
- Use markdown headers for structure
- Include concrete examples
- Explain *why*, not just *what*
- Link to relevant documentation when appropriate
- Keep focused (1-2 pages max)

**Ponder Indexing:**
When MEMORY artifacts are indexed, Ponder stores:
- `type` field for filtering
- `tags` array for tag-based search
- `requestId` for lineage
- Full metadata in artifact table

The `search_artifacts` tool can then query: `type = "MEMORY" AND tags @> ["staking"]` to find relevant memories.

This structure emerged from validation testing (JINN-231) after confirming reflection agents successfully create and use MEMORY artifacts.

---

## MEM-008: Memory Discovery via Tags

**Assertion:**  
Before job execution, the worker must extract keywords from `jobName`, search for MEMORY artifacts with matching tags, and inject content into prompt.

**Examples:**

| Do | Don't |
|---|---|
| Extract keywords: "OLAS Token Contract" → ["olas", "token", "contract"] | Use full jobName as single search term |
| Query artifacts: `type = "MEMORY" AND tags && ["olas", "token"]` | Query all artifacts regardless of type |
| Inject matching MEMORY content into prompt | Reference MEMORYs by ID only |
| Limit to top 3 most relevant memories | Inject all matching memories |

**Commentary:**

Memory discovery flow:

1. **Keyword Extraction**: Parse jobName, split on spaces/punctuation, lowercase, filter stop words
2. **Tag Search**: Query Ponder for artifacts where `type = "MEMORY"` and `tags` array overlaps with keywords
3. **Relevance Ranking**: Order by tag overlap count (more matches = more relevant)
4. **IPFS Fetch**: Retrieve full MEMORY content from IPFS for top 3 matches
5. **Prompt Injection**: Prepend MEMORY content as "Relevant Knowledge" section
6. **Graceful Failure**: If search or fetch fails, proceed without memories

**Injected Prompt Structure:**
```markdown
# Relevant Knowledge from Past Jobs

## Memory: [Name]
Tags: [tags]

[Content]

---

## Memory: [Name]
Tags: [tags]

[Content]

---

# Your Assignment

[Original prompt]
```

**Why tag-based instead of semantic?**
- Tag search is deterministic and explainable
- Keywords capture explicit domain terminology
- Complements semantic search (different signal)
- Fast query without vector operations

**Validated Behavior:**
Testing confirmed agents intelligently use injected memories:
- Apply memory when directly applicable
- Ignore memory when semantically related but not applicable
- Prefer other tools (web search) when memory is insufficient

This validates the intelligent memory reuse requirement from JINN-231.

---

## MEM-009: Situation Indexing by Ponder

**Assertion:**  
Ponder must detect SITUATION artifacts in delivery payloads, fetch from IPFS, validate embeddings, and upsert into `node_embeddings` table.

**Examples:**

| Do | Don't |
|---|---|
| Check `artifact.type === "SITUATION"` in delivery handler | Index all artifacts as situations |
| Fetch artifact content from IPFS using CID | Assume artifact content is in delivery payload |
| Validate embedding has correct model and dimensions | Trust embedding without validation |
| Upsert into node_embeddings with ON CONFLICT update | Insert only (fail on duplicates) |

**Commentary:**

Ponder SITUATION indexing flow (`ponder/src/index.ts`):

1. **Deliver Event Detection**: `OlasMech:Deliver` event handler triggered
2. **Delivery Fetch**: Reconstruct IPFS CID, fetch delivery JSON
3. **Artifact Iteration**: Loop through `artifacts` array in delivery
4. **Type Check**: If `artifact.type === "SITUATION"`, process for indexing
5. **IPFS Fetch**: GET `${IPFS_GATEWAY}${artifact.cid}`
6. **Content Unwrap**: Handle both raw JSON and wrapped `{content: "..."}` formats
7. **Validation**:
   - Embedding exists and has `model`, `dim`, `vector` fields
   - Model is "text-embedding-3-small"
   - Dim is 256
   - Vector length matches dim
8. **Database Upsert**:
   ```sql
   INSERT INTO node_embedings (node_id, model, dim, vec, summary, meta)
   VALUES ($1, $2, $3, $4::vector, $5, $6)
   ON CONFLICT (node_id) DO UPDATE SET ...
   ```

**Error Handling:**
- IPFS timeout: Log error, skip indexing, continue processing other artifacts
- Invalid embedding: Log warning, skip indexing
- Database error: Log error, continue (don't fail entire delivery indexing)

**Why Ponder, not Worker?**
- Ponder owns on-chain data index
- Consistent indexing of all SITUATION artifacts
- Enables querying situations via Ponder GraphQL
- Worker focuses on execution, Ponder on indexing

The `ivfflat` index on `vec` column enables fast approximate nearest neighbor search via cosine similarity.

---

## MEM-010: Observability Tools

**Assertion:**  
The protocol must provide three levels of memory system observability: human (frontend), programmatic (CLI), and agentic (MCP tools).

**Examples:**

| Do | Don't |
|---|---|
| Provide `inspect-situation.ts` CLI script for developers | Require direct database queries |
| Provide `inspect_situation` MCP tool for agents | Hide memory internals from agents |
| Show memory visualization in frontend explorer | Only show memory in logs |
| Include similarity scores in search results | Hide relevance metrics |

**Commentary:**

Three levels of observability:

**1. Human (Frontend Explorer):**
- Memory visualization on delivered request detail pages
- Shows SITUATION details: job info, execution trace, artifacts
- Displays similar jobs with similarity scores
- Enables browsing entire situation graph
- URL: `https://jinn-gemini-production.up.railway.app/requests/{requestId}`

**2. Programmatic (CLI Scripts):**
```bash
# Inspect specific situation
yarn tsx scripts/memory/inspect-situation.ts <requestId>

# Output: Rich CLI display with:
# - SITUATION details
# - Job information
# - Execution trace
# - Context (parent/siblings/children)
# - Artifacts created
# - Embeddings
# - Recognition data
# - Database record
# - Similar situations with scores

# Complete job snapshot
yarn inspect-job-run <requestId>

# Output: Full JSON with resolved IPFS:
# - Request metadata
# - Delivery payload
# - All artifacts (including SITUATION)
```

**3. Agentic (MCP Tools):**
```javascript
// Search for similar situations
search_similar_situations({
  query_text: "Analyze OLAS staking contract",
  k: 5
})

// Inspect specific situation
inspect_situation({
  request_id: "0x...",
  include_similar: true,
  similar_k: 3
})

// Embed text for custom similarity
embed_text({
  text: "...",
  model: "text-embedding-3-small",
  dimensions: 256
})
```

**Why three levels?**
- Humans need visual interfaces for exploration
- Developers need CLI for debugging and scripting
- Agents need programmatic access for autonomous learning

This multi-level observability ensures the memory system is transparent and debuggable at all points in the protocol.
