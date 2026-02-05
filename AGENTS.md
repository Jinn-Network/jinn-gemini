---
title: Agent Instructions
purpose: entry-point
last_verified: 2026-02-01
---

# Agent Instructions

> Single entry point for AI agents working on Jinn.

---

## Critical Rules

- **DO NOT** create .md documentation files for progress summaries
- **DO** incorporate learnings into this file or beads issues
- **DO** write progress summaries to corresponding Linear/beads issues
- **DO** add blood written rules to [docs/reference/blood-written-rules.md](docs/reference/blood-written-rules.md)

---

## Blood Written Rules

Before working on an area, check [docs/reference/blood-written-rules.md](docs/reference/blood-written-rules.md) for relevant sections. The file is organized by component (RPC & Network, Marketplace & Jobs, Agent Behavior, etc.).

For test-specific issues: [docs/reference/testing-blood-written-rules.md](docs/reference/testing-blood-written-rules.md)

---

## Recording Blood Written Rules

When you discover a non-obvious issue while coding:

**When to record:**
- Issue took significant time to debug
- Solution isn't obvious from the code
- Others will likely hit the same problem

**How to record:**
1. Add to `docs/reference/blood-written-rules.md` in the appropriate section
2. Use next number in sequence
3. Follow format:
   ```
   ### N. [Short Title]
   **Issue:** What went wrong
   **Root Cause:** Why it happened
   **Solution:** How to fix it
   **Prevention:** How to avoid it
   ```
4. Update `last_verified` date in blood-written-rules.md frontmatter

---

## System Architecture (10-Second Overview)

**On-Chain Event Loop:**
```
dispatch_new_job (MCP) → Base Marketplace Contract → Ponder Indexer → Worker Claims
  → Agent Executes (with MCP tools) → Worker Delivers to Chain → Ponder Indexes Result
```

**Key Components:**

| Component | Purpose | Location |
|-----------|---------|----------|
| Worker | Job orchestrator, polls Ponder, claims jobs, executes Agent | `worker/mech_worker.ts` |
| Gemini Agent | Spawns Gemini CLI with MCP tools | `gemini-agent/agent.ts` |
| MCP Server | Provides dispatch, artifact, search tools | `gemini-agent/mcp/server.ts` |
| Ponder | Indexes on-chain events, GraphQL reads | `ponder/` |
| Control API | Secure write gateway for off-chain data | `control-api/` |

**Memory System:**
- Jobs generate SITUATION artifacts with embeddings
- Recognition phase queries similar past jobs before execution
- Reflection phase creates MEMORY artifacts for reuse

Details: [System Overview](docs/context/system-overview.md)

---

## Quick Start

**Prerequisites:** Node.js 22+, Yarn, Gemini CLI (authenticated)

```bash
yarn install
cp .env.template .env  # Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
yarn dev:stack         # Ponder + Control API + Worker
```

---

## Monorepo Layout

```
ponder/               # Indexer (Base chain events)
control-api/          # Secure write API (Supabase)
gemini-agent/         # Agent + MCP server
  ├── agent.ts        # Gemini CLI spawner
  ├── mcp/server.ts   # Tool server
  └── mcp/tools/      # Tool implementations
worker/               # Job orchestrator
  ├── mech_worker.ts  # Main loop
  ├── recognition/    # Pre-job learning
  ├── execution/      # Agent execution
  └── reflection/     # Post-job learning
frontend/explorer/    # Next.js UI
codespec/             # Code quality enforcement
```

---

## jinn-node Subtree Sync

`jinn-node/` is synced to the standalone repo via git subtree. Run subtree commands from the branch that contains your changes.

Monorepo → standalone:
```bash
git subtree push --prefix=jinn-node jinn-node main
```

Standalone → monorepo:
```bash
git subtree pull --prefix=jinn-node jinn-node main
```

---

## Key Commands

**Development:**
```bash
yarn dev:stack              # Full stack
yarn dev:mech --single      # Single job execution
yarn dev:mech --workstream=0x...  # Filter by workstream
yarn dev:mech:parallel -w 3 # 3 parallel workers
```

**Testing:**
```bash
yarn test                   # All tests
yarn inspect-job-run <id>   # Job snapshot
```

More: [Setup Worker](docs/runbooks/setup-worker.md)

---

## MCP Tools (Universal)

Always available:
- `dispatch_new_job` - Create job + post marketplace request
- `dispatch_existing_job` - Re-run existing job definition
- `get_details` - Fetch request/artifact data from Ponder
- `create_artifact` - Upload to IPFS
- `search_similar_situations` - Semantic search over past jobs
- `list_tools` - Catalog available tools

Tool policy: [docs/reference/tool-policy.md](docs/reference/tool-policy.md)

---

## Blueprint Design

Blueprints define WHAT (outcomes), not HOW (process):

```json
{
  "invariants": [{
    "id": "GOAL-001",
    "form": "constraint",
    "description": "Declarative statement of WHAT must be satisfied"
  }]
}
```

**Forms:** boolean, threshold, range, directive, sequence, constraint

Guide: [Writing Invariants](docs/guides/writing-invariants.md)

---

## Key APIs

| API | URL | Purpose |
|-----|-----|---------|
| Ponder (reads) | `https://ponder-production-6d16.up.railway.app/graphql` | On-chain data queries |
| Control API (writes) | `http://localhost:4001/graphql` | Off-chain data writes |

Control API requires `X-Worker-Address` header.

---

## Environment

**Required:**
```bash
SUPABASE_URL=https://clnwgxgvmnrkwqdblqgf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<key>
```

Full reference: [Environment Variables](docs/reference/environment-variables.md)

---

## Critical Blood Written Rules (Top 10)

1. **Marketplace Timeout**: 300 seconds hard limit. Break complex jobs into sub-jobs.
2. **Agent Polling**: FINALIZE IMMEDIATELY after dispatch_new_job. System auto-redispatches.
3. **Circular Dependencies**: Child cannot depend on parent. Dependencies are for sibling ordering.
4. **Branch Auto-Detection**: Skip branch creation when CODE_METADATA_REPO_ROOT unset.
5. **Stale Hierarchy**: Never trust metadata.hierarchy for completion - query Ponder live.
6. **Double Execution**: Control API tracks claim staleness (5-minute threshold).
7. **Recognition Mimicry**: Learnings describe what PAST jobs did, not what CURRENT should do.
8. **IPFS Upload**: Use wrap-with-directory:true. Test `{dir-CID}/{requestId}` not raw digest.
9. **Worker Runs Locally**: No cloud deployment - runs from current git branch.
10. **SSH Aliases**: Normalize to `git@github.com:` at dispatch time.

Full list: [Blood Written Rules](docs/reference/blood-written-rules.md) (~60 rules)

---

## IPFS Delivery

**Critical Understanding:**
1. Worker uploads to Autonolas registry with `wrap-with-directory: true`
2. On-chain: Only 32-byte SHA256 digest stored in `Deliver` event
3. Ponder reconstructs directory CID, fetches: `{dir-CID}/{requestId}`

**Common Mistake:**
- ❌ Testing `https://gateway.autonolas.tech/ipfs/f01551220{digest}` (returns binary)
- ✅ Testing `https://gateway.autonolas.tech/ipfs/{dir-CID}/{requestId}` (returns JSON)

---

## Context Management

**Three Mechanisms:**

1. **Blueprint-Driven Execution** - Assertions define success criteria; agent has full autonomy on strategy
2. **Dependency Management** - Jobs can require other jobs to complete first via `dependencies: ['<job-def-id>']`
3. **Progress Checkpointing** - Recognition phase queries completed jobs, generates progress summary

---

## Memory System

**Two Pathways:**

1. **Semantic Graph Search** - Embeddings of job executions; vector search over `node_embeddings`
2. **Tag-Based Memory** - Keyword extraction from `jobName`; tag matching via Ponder

**CLI Inspection:**
```bash
yarn inspect-job-run <requestId>          # Full snapshot
tsx scripts/memory/inspect-situation.ts <requestId>  # Memory details
```

---

## Documentation Map

| Need | Location |
|------|----------|
| How-to guides | [docs/runbooks/](docs/runbooks/) |
| Architecture | [docs/context/](docs/context/) |
| API reference | [docs/reference/](docs/reference/) |
| Code standards | [docs/guides/code-spec.md](docs/guides/code-spec.md) |
| Troubleshooting | docs/runbooks/troubleshoot-*.md |
| Blood written rules | [docs/reference/blood-written-rules.md](docs/reference/blood-written-rules.md) |
| Constants | [docs/reference/constants.md](docs/reference/constants.md) |
| OLAS integration | [docs/context/olas-integration.md](docs/context/olas-integration.md) |

---

## Key File Locations

| Area | Files |
|------|-------|
| Worker | `worker/mech_worker.ts`, `worker/recognition/`, `worker/execution/`, `worker/reflection/` |
| Agent | `gemini-agent/agent.ts`, `gemini-agent/mcp/tools/` |
| Ponder | `ponder/src/index.ts`, `ponder/ponder.schema.ts` |
| Scripts | `scripts/inspect-job-run.ts`, `scripts/inspect-workstream.ts` |

---

## Task Tracking

Use beads (`bd`) for all task tracking:
```bash
bd ready              # Find available work
bd update <id> --status=in_progress  # Claim it
bd close <id>         # Mark complete
bd sync               # Push to remote
```

See `.beads/` directory for hooks and configuration.

---

*For deep architecture, see `docs/context/`. Keep this file concise and operational.*
