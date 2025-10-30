w# Vector Search Over Graph Nodes

**Concept Origin**: Daily meeting discussion, October 16, 2025  
**Contributors**: Oak Tan, Ritsu Kai

## Core Concept

Instead of embedding individual memories in isolation, embed entire **job execution nodes** along with their relationships and context. This creates a hybrid graph-vector database approach where semantic search operates over the execution graph structure.

## The Problem

Current memory systems face a fundamental limitation: a memory's usefulness isn't an intrinsic property—it's **contextual** and depends heavily on:
- The specific job being executed
- The similarity to situations where the memory was previously used
- The relationships between the current job and past executions

Assigning a utility score to a memory in isolation (e.g., "this memory has a score of 5") misses the critical dimension of **situational similarity**.

## The Solution: Graph Node Embeddings

### What Gets Embedded

Each node in the job execution graph represents a complete job execution context:

1. **Core Job Data**
   - Request details (job name, objective, acceptance criteria)
   - Delivery output
   - Execution summary

2. **Relationships & Context**
   - Parent job (lineage)
   - Child jobs spawned
   - Sibling relationships

3. **Associated Artifacts**
   - Memories created during reflection
   - Memories used during execution
   - Other artifacts produced

4. **Execution Metadata**
   - Telemetry data
   - Tool usage patterns
   - Success/failure indicators

### Embedding Strategy

Rather than storing full content in the vector space:

1. **Generate a summary** of the entire node (job + edges + artifacts)
2. **Embed the summary** into vector space
3. **Store a reference** to the full content (IPFS hash, DB ID, etc.)

This approach balances:
- **Cost**: Embedding summaries is cheaper than full content
- **Performance**: Smaller embeddings are faster to search
- **Relevance**: Summaries capture essential semantic meaning

## The Recognition Phase

Memory retrieval becomes a **recognition phase** that happens before job execution:

### Step 1: Embed Current Context
Create a summary embedding of:
- The current job's context (parent lineage, objective)
- The task at hand
- Situational factors

### Step 2: Semantic Search Over Graph Nodes
Query the vector database to find the most **semantically similar past execution nodes**:
```
"What previous situations looked most like this one?"
```

This returns nodes based on:
- Task similarity
- Contextual similarity  
- Relationship patterns

### Step 3: Depth-Configurable Traversal
From the matched nodes, traverse the graph at configurable depth:
- **Depth 0**: Just the matched node
- **Depth 1**: Node + immediate edges + directly connected nodes
- **Depth 2**: Extend to second-degree connections
- **Depth N**: Controlled expansion based on relevance

### Step 4: Extract Relevant Content
Once similar nodes are identified, drill down to extract specific content:
- **Memories** associated with those nodes
- **Telemetry patterns** from similar executions
- **Tool usage** that worked in similar contexts
- **Failure patterns** to avoid

### Step 5: Secondary Semantic Search (Optional)
Perform a second-level semantic search **within** the matched subgraph:
- Search memories for specific relevant details
- Find particular telemetry events
- Extract specific learnings

### Step 6: Feed to Execution Agent
The final prompt includes:
- **Concrete content** extracted from recognition phase
- **High-level references** to the matched nodes (for potential follow-up lookups)
- **Minimal tool access** to the full graph (in case agent needs to double-check)

## Technical Architecture

### Database Layer
```
PostgreSQL (Ponder)
├── Standard relational queries (job lineage, artifacts)
├── pgvector extension for semantic search
└── JSON fields for flexible metadata
```

### Embedding Pipeline
1. **On Job Completion**: Generate node summary
2. **Embed Summary**: Use embedding model (e.g., text-embedding-3-small)
3. **Store Vector**: Insert into pgvector-enabled table
4. **Index**: Maintain vector indexes for fast similarity search

### Query Flow
```
Current Job Context
    ↓
Generate Query Embedding
    ↓
Vector Similarity Search (pgvector)
    ↓
Retrieve Top-K Similar Nodes
    ↓
Graph Traversal (SQL joins)
    ↓
Content Extraction
    ↓
(Optional) Secondary Semantic Search
    ↓
Inject into Prompt
```

## Key Advantages

### 1. Contextual Relevance
Memories are retrieved based on **situational similarity** rather than isolated keyword matching or memory properties alone.

### 2. Relationship-Aware
The system understands that execution contexts include:
- How a job fits into a larger workflow
- What came before (parent context)
- What typically follows (child patterns)

### 3. Pattern Recognition Over Reasoning
The recognition phase doesn't require a powerful LLM—it's primarily **pattern matching**:
- Vector similarity (mathematical)
- Graph traversal (structural)
- Simple extraction (rule-based)

A smaller, cheaper model can handle this phase effectively.

### 4. Scalable & Cost-Effective
- Embedding summaries (not full content) reduces storage and compute
- Vector search is highly optimized
- PostgreSQL handles both relational and vector operations

### 5. Flexible Granularity
The depth parameter allows tuning:
- **Shallow search**: Fast, focused on immediate similarities
- **Deep search**: Comprehensive, exploring broader patterns

## Implementation Considerations

### Embedding Model Selection
- **Text-Embedding-3-Small** (OpenAI): Good balance of cost/quality
- **Other options**: Cohere, Voyage, local models (Sentence Transformers)

### Summary Generation
Options for creating node summaries:
1. **Template-based**: Fixed structure, cheap, fast
2. **LLM-generated**: Flexible, higher quality, more expensive
3. **Hybrid**: Templates for structure, LLM for key insights

### Cold Start Problem
- Initially, no graph nodes exist for comparison
- System gradually builds semantic knowledge
- Early retrievals may be less relevant (acceptable tradeoff)

### Vector Dimension Tuning
- Higher dimensions: More nuanced similarity, more storage/compute
- Lower dimensions: Faster, less precise
- Start with model defaults (1536 for text-embedding-3-small), tune as needed

## Future Enhancements

### Multi-Modal Embeddings
Embed different aspects separately:
- Task objective
- Code artifacts
- Execution patterns

Combine vectors for more nuanced similarity.

### Temporal Weighting
Recent executions may be more relevant:
- Decay older embeddings
- Boost recent successful patterns
- Account for system evolution

### User/Agent Preferences
Different agents might value different aspects:
- Personalized similarity metrics
- Agent-specific memory preferences

### Automated Graph Pruning
Over time, consolidate redundant nodes:
- Merge similar low-utility executions
- Preserve high-value, unique patterns

## Connection to Utility Scores

Utility scores still have value but serve a **different purpose**:

- **Vector search** answers: "What situations were similar to this one?"
- **Utility scores** answer: "In those similar situations, which memories were helpful?"

The two mechanisms work together:
1. Vector search finds contextually similar past executions
2. Utility scores rank memories within those similar contexts
3. Final selection balances similarity + utility

## Next Steps

1. **Add vector column** to Ponder schema (pgvector type)
2. **Implement summary generation** after job completion
3. **Integrate embedding pipeline** (post-reflection step)
4. **Build recognition phase** into worker job startup
5. **Benchmark** improvement over keyword-only matching

## Open Questions

1. **What fields should be included in the node summary?**
   - Need to balance completeness vs. brevity
   
2. **Should embeddings be generated during reflection or as a separate post-processing step?**
   - Reflection: Immediate, but adds latency
   - Post-processing: Async, but delays availability

3. **How to handle graph evolution?**
   - Re-embed nodes when related nodes are added?
   - Or rely on initial embedding only?

4. **Cost implications at scale?**
   - Estimate: 100 jobs/day × 500 tokens/summary × $0.00002/token = $0.20/day
   - Acceptable, but worth monitoring

---

**Status**: Planning/Research  
**Next Action**: Prototype with small dataset to validate approach  
**Owner**: Oak Tan


