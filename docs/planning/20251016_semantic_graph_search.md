# Planning: Semantic Graph Search Over Job Execution Nodes

**Date:** 16 October 2025  
**JINN Ticket:** JINN-223  
**Status:** Planning

## 1. Motivation

The agent's current memory system relies on a simple, tag-based search over individual memory artifacts. This has a fundamental limitation: a memory's usefulness is not an intrinsic property but is highly contextual. The value of a past learning is deeply tied to the similarity between the situation in which it was created and the current situation the agent faces.

Our key insight is that **we should perform semantic search over entire job execution contexts ("situations" or "nodes") rather than isolated memories.** This allows the agent to move from simple keyword matching to sophisticated pattern recognition, answering the question: "What previous situations look and feel the most like the one I'm in now, and what can I learn from them?"

This document outlines the plan to implement this hybrid graph-vector search capability, leveraging our existing infrastructure (Ponder, IPFS, local Postgres) to create a powerful, scalable, and cost-effective learning loop.

## 2. Requirements

-   **Node-Level Embeddings:** The system must embed the entire context of a job execution—not just individual artifacts—into a vector representation.
-   **Decentralized & Shared Embeddings:** To avoid redundant computation across the network, the computed embedding vector must be stored on IPFS as part of a "situation artifact."
-   **Local Vector Search:** Each worker node must maintain a local, lightweight Postgres instance with the `pgvector` extension enabled. This instance will be used to store and index the embeddings for fast semantic search without relying on external services.
-   **Two-Phase Execution Model:** The agent's job processing loop will be split into two distinct phases:
    1.  **Recognition:** A cheap, fast agent run (e.g., Gemini 2.5 Flash) that analyzes the current job, searches for similar past situations, and synthesizes actionable learnings.
    2.  **Execution:** The main agent run, which receives the learnings from the recognition phase as part of its initial prompt, giving it a significant head-start.
-   **Actionable Output:** The recognition phase must produce more than a list of similar jobs. It must deliver concrete, actionable insights, strategies, warnings, or hypotheses derived from analyzing past situations.
-   **Structured Data Models:** The "situation" artifact and the agent's execution history must be stored in a structured JSON format to enable reliable machine analysis.

## 3. Acceptance Criteria

-   **AC-1 (Write Path):** After a job completes successfully, a `SITUATION` artifact is created and stored on IPFS. This artifact must be a valid JSON object containing a structured execution trace and a pre-computed vector embedding.
-   **AC-2 (Indexing):** The Ponder indexing service successfully identifies new `SITUATION` artifacts, fetches them from IPFS, extracts their embeddings, and correctly upserts them into a dedicated `node_embeddings` table in the local Postgres database.
-   **AC-3 (Recognition):** Before a new job is executed, a "recognition agent" can be spawned. This agent must be able to use a new MCP tool to perform a vector similarity search against the local `node_embeddings` table.
-   **AC-4 (Synthesis):** The recognition agent can use existing tools (`get_details`) to fetch the full `situation.json` of top-ranked similar jobs and successfully synthesize a list of concrete, actionable learnings.
-   **AC-5 (Injection):** The learnings synthesized by the recognition agent are correctly formatted and injected into the main execution agent's prompt.
-   **AC-6 (Graceful Failure):** If any part of the recognition or embedding process fails, the system must log the error but proceed with the job execution without the enhanced context, ensuring the core functionality is not blocked.

## 4. High-Level Specification

The system operates in two distinct flows: the "write path" (how learnings are stored) and the "read path" (how learnings are retrieved and used).

### 4.1. The Write Path (Reflection & Indexing)

1.  **Job Completion:** A standard job is executed by the main agent.
2.  **Reflection:** After successful completion, a "reflection agent" is spawned. Its task is to analyze the telemetry of the completed job.
3.  **Trace & Summary Generation:** The reflection agent produces a structured `execution.trace`. A text summary is then generated from the job's goals, the trace, and the final output.
4.  **Embedding:** The worker calls an `embed_text` tool, which converts the text summary into a 256-dimensional vector.
5.  **Artifact Creation:** The worker assembles the final `situation.json` artifact, which includes the job details, the structured trace, and the newly created embedding. This artifact is uploaded to IPFS via the `create_artifact` tool with `type: "SITUATION"`.
6.  **Indexing:** The Ponder service, listening to `Deliver` events, detects the new `SITUATION` artifact. Its event handler fetches the `situation.json` from IPFS, extracts the embedding and metadata, and uses a direct SQL query to `UPSERT` the data into the local `node_embeddings` Postgres table.

### 4.2. The Read Path (Recognition & Synthesis)

1.  **New Job Discovery:** The worker discovers a new job request.
2.  **Recognition Phase:** Before starting the main execution, the worker spawns a lightweight "recognition agent."
3.  **Semantic Search:** The recognition agent is prompted to first understand the new job's objective and then use a `search_similar_situations` tool. This tool embeds the current job's objective and queries the local `node_embeddings` table to find the top-K most similar past situations.
4.  **Analysis & Synthesis:** The recognition agent's prompt then instructs it to take the top 2-3 results, use the `get_details` tool to fetch their full `situation.json` artifacts from IPFS, and analyze their execution traces. From this analysis, it must synthesize a set of concrete learnings.
5.  **Context Injection:** The worker parses the structured output (the learnings) from the recognition agent and formats it into a dedicated section in the main execution agent's prompt.
6.  **Execution Phase:** The main agent starts its work, now equipped with highly relevant, context-aware insights from similar past jobs.

## 5. Low-Level Specification (Detailed)

### 5.0. Design Principles (The Zen of Jinn)

The implementation of this system will adhere to core software design principles, as articulated in the Zen of Python. This means we will favor:
-   **Explicit over implicit:** The `situation.json` artifact makes the full context of a job run explicit and portable.
-   **Simple over complex:** We use a decoupled, dedicated table for embeddings rather than complicating the Ponder schema. The retrieval mechanism is a simple vector search, with complex reasoning handled by the agent.
-   **Readability:** The structured `execution.trace` and clear JSON schemas are designed to be easily understood by both developers and other agents.
-   **One obvious way:** The recognition phase will become the single, clear pathway for the agent to incorporate learnings from past executions, replacing older, less effective methods.

### 5.1. Database Schema

A new migration will be created to add the following table to the local Postgres instance. This table is intentionally managed outside of Ponder's direct schema management to ensure stability and control.

-   **File:** Use the Supabase MCP server to execute migrations
-   **Schema:**
    ```sql
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS node_embeddings (
      node_id TEXT PRIMARY KEY, -- Corresponds to the request_id of the job
      model TEXT NOT NULL,
      dim INT NOT NULL,
      vec VECTOR(256) NOT NULL,
      summary TEXT,              -- The text summary that was embedded
      meta JSONB,                -- For versioning, features, etc.
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- IVF Flat index for efficient Approximate Nearest Neighbor search
    CREATE INDEX IF NOT EXISTS node_embeddings_vec_idx
    ON node_embeddings USING ivfflat (vec vector_cosine_ops) WITH (lists = 100);
    ```

### 5.2. `situation.json` Artifact

This is the canonical, on-chain-linked record of a job's context, stored on IPFS. The structure is designed to be comprehensive, capturing not just the job's direct execution but its place within the wider work graph.

-   **Version:** `sit-enc-v1.1`
-   **Structure:**
    ```json
    {
      "version": "sit-enc-v1.1",
      "job": {
        "requestId": "0x...",
        "jobDefinitionId": "...",
        "jobName": "Analyze staking contract performance",
        "objective": "Identify performance bottlenecks in the OLAS staking contract.",
        "acceptanceCriteria": "A report detailing gas usage for key functions and recommendations for optimization."
      },
      "execution": {
        "status": "COMPLETED" | "FAILED",
        "trace": [
          {
            "tool": "get_details",
            "args": "...",
            "result_summary": "..."
          }
        ],
        "finalOutputSummary": "The contract's `stake` function has a high gas cost due to a loop. Recommendations include batching operations."
      },
      "context": {
        "parentRequestId": "0x...",
        "childRequestIds": ["0x...", "0x..."],
        "siblingRequestIds": ["0x..."]
      },
      "artifacts": [
        {
          "topic": "MEMORY",
          "name": "Gas Optimization Patterns",
          "contentPreview": "Common gas optimization patterns for Solidity include..."
        },
        {
          "topic": "PERFORMANCE_REPORT",
          "name": "Staking Contract Gas Analysis",
          "contentPreview": "Gas usage for `stake`: 120,000; `unstake`: 80,000..."
        }
      ],
      "embedding": {
        "model": "text-embedding-3-small",
        "dim": 256,
        "vector": [0.012, -0.034, ...]
      }
    }
    ```

### 5.3. MCP Tools

#### 5.3.1. `embed_text.ts`

-   **Purpose:** Provides a standard interface for creating text embeddings.
-   **Location:** `gemini-agent/mcp/tools/embed_text.ts`
-   **Input Schema (`EmbedTextParams`):**
    -   `text: string`
    -   `model: string (optional, default: 'text-embedding-3-small')`
    -   `dim: number (optional, default: 256)`
-   **Output:** `{ model: string, dim: number, vector: number[] }`

#### 5.3.2. `search_similar_situations.ts`

-   **Purpose:** Enables the recognition agent to perform semantic search.
-   **Location:** `gemini-agent/mcp/tools/search_similar_situations.ts`
-   **Input Schema:**
    -   `query_text: string`
    -   `k: number (optional, default: 5)`
-   **Logic:**
    1.  Calls `embed_text` internally on the `query_text` to get a query vector.
    2.  Connects to the local Postgres instance.
    3.  Executes a parameterized SQL query to perform a cosine similarity search against the `node_embeddings` table.
    4.  Returns the top `k` results.
-   **Output:** `[{ nodeId: string, score: number, summary: string }]`

### 5.4. Ponder Indexing Logic

-   **File:** `ponder/src/index.ts`
-   **Handler:** `OlasMech:Deliver`
-   **Logic:**
    1.  Inside the loop that processes `res.data.artifacts`.
    2.  Check if `artifact.type === 'SITUATION'`.
    3.  If so, fetch the full `situation.json` from IPFS via the artifact's `cid`.
    4.  Parse the JSON and validate its structure.
    5.  Extract `job.requestId`, `embedding`, and a generated summary.
    6.  Establish a direct connection to the local Postgres DB.
    7.  Execute a raw SQL `INSERT ... ON CONFLICT (node_id) DO UPDATE ...` query to upsert the data into the `node_embeddings` table.

### 5.5. Worker Logic

-   **File:** `worker/mech_worker.ts`
-   **Reflection Logic (Post-Job):**
    1.  Get the full job telemetry.
    2.  Spawn reflection agent with a prompt to produce the structured `execution.trace`.
    3.  Generate the text summary.
    4.  Call `embed_text` tool.
    5.  Assemble the `situation.json`.
    6.  Call `create_artifact`.
-   **Recognition Logic (Pre-Job):**
    1.  Define a new, detailed prompt for the recognition agent, specifying the "Recognize -> Analyze -> Synthesize" workflow and the required JSON output format (`{ "learnings": [...] }`).
    2.  Spawn the recognition agent with this prompt.
    3.  Await and parse its JSON output. If parsing fails or the agent fails, log the error and proceed.
-   **Prompt Injection Logic:**
    1.  Format the parsed `learnings` into the markdown structure specified in the high-level plan.
    2.  Prepend this markdown block to the main execution agent's prompt.

## 6. Development Plan

The implementation will be broken down into three logical phases.

### Phase I: The Foundation (Database & Data Model)

-   `[ ]` **Task 1.1:** Create and apply the `create_node_embeddings` SQL migration.
-   `[ ]` **Task 1.2:** Formally define the rich `situation.json` v1.1 structure in a shared types file (`packages/jinn-types/src/situation.ts`).

### Phase II: The "Write Path" (Creation & Indexing)

-   `[ ]` **Task 2.1:** Implement and register the `embed_text` MCP tool.
-   `[ ]` **Task 2.2:** Implement the `SituationEncoder` module. This module will be responsible for querying Ponder to gather the full job context (including parent/child/sibling relationships and artifacts created) required for the rich `situation.json` artifact.
-   `[ ]` **Task 2.3:** Update the worker's reflection logic to use the `SituationEncoder`, generate the trace, summary, embedding, and final `situation.json` artifact.
-   `[ ]` **Task 2.4:** Implement the Ponder handler logic to extract and index embeddings into the `node_embeddings` table.

### Phase III: The "Read Path" (Recognition & Retrieval)

-   `[ ]` **Task 3.1:** Implement and register the `search_similar_situations` MCP tool.
-   `[ ]` **Task 3.2:** Implement the recognition agent flow in the worker, including the new multi-step prompt.
-   `[ ]` **Task 3.3:** Implement the final prompt injection logic.
-   `[ ]` **Task 3.4:** Conduct an end-to-end test:
    1. Run a "creator" job to generate a situation artifact.
    2. Verify it was indexed correctly in the `node_embeddings` table.
    3. Run a "learner" job with a similar objective.
    4. Verify the recognition agent ran, found the creator job, and injected relevant learnings into the learner's prompt.

## 7. Deprecations and Code Removal

As part of this work, the following components of the old memory system will be deprecated and removed to simplify the codebase and establish a single, clear learning mechanism.

-   **`gemini-agent/mcp/tools/search_memories.ts`**: This tool, which performs a simple tag-based search, is entirely superseded by the more powerful `search_similar_situations` tool. Its functionality is a subset of what the new system provides.
-   **`gem-agent/mcp/tools/rate_memory.ts`**: The concept of rating individual memories in isolation is no longer relevant. The usefulness of a memory is now determined contextually during the recognition agent's synthesis step.
-   **`utility_scores` Table:** The database table associated with `rate_memory` will be removed in a subsequent migration.
-   **Worker Memory Injection Logic:** The existing code in `worker/mech_worker.ts` that calls `search_memories` and injects memories based on keyword matching will be entirely replaced by the new two-phase recognition/execution flow.
