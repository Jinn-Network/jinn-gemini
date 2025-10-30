# Specification and Documentation Improver Job

This document describes a continuous venture job designed to analyze the codebase and improve the specification and documentation for "job runs" in the project blueprint.

## Purpose

The job exhaustively documents and specifies how job runs work in the Jinn system by:
- Analyzing the actual code implementation
- Comparing it against existing documentation
- Creating suggestions to fill gaps in `specification.md` and `documentation.md`

## Target Files

The job focuses on improving two files in `docs/spec/blueprint/`:

1. **specification.md** - How job runs SHOULD work (ideal state)
2. **documentation.md** - How job runs CURRENTLY work (actual implementation)

## Job Configuration

- **Model**: `gemini-2.5-pro` (for strong reasoning and writing)
- **Enabled Tools**:
  - `read_file` - Read blueprint and source files
  - `codebase_search` - Search for implementation details
  - `create_artifact` - Create suggestion artifacts
  - `search_similar_situations` - Avoid duplicate suggestions
  - `get_details` - Fetch job and artifact information

## How It Works

### 1. Dispatching the Job

```bash
yarn dispatch:spec-improver
```

This creates a new on-chain request that will be picked up by the worker.

### 2. Job Execution

The agent will:
1. Read `docs/spec/blueprint/requirements.md` to understand constraints
2. Review existing `specification.md` and `documentation.md`
3. Search the codebase for implementation details (e.g., `worker/mech_worker.ts`, `gemini-agent/agent.ts`)
4. Identify gaps between implementation and documentation
5. Create SUGGESTION artifacts with markdown content

### 3. Reviewing Suggestions

After the job completes:
1. View the request in the explorer UI at `http://localhost:3000/requests/{requestId}`
2. Download artifacts with topic "SUGGESTION"
3. Review the suggested content
4. Edit and refine as needed
5. Commit changes to the repository

### 4. Iterative Improvement

On subsequent runs:
1. The agent will see the updated documentation
2. It will use `search_similar_situations` to avoid duplicate suggestions
3. It will identify remaining gaps and create new suggestions
4. The process continues until the documentation is complete

## Success Criteria

The job is complete when:

1. **specification.md** clearly describes how job runs SHOULD work:
   - Efficient search for relevant past activity
   - Synthesis of learnings to boost performance
   - Execution of the job
   - Successful on-chain delivery
   - Generation of data for future network activity

2. **documentation.md** clearly describes how job runs CURRENTLY work:
   - Worker polling and claiming
   - Agent spawning and execution
   - MCP tool interactions
   - Telemetry collection
   - Memory system integration (recognition/reflection)
   - Artifact creation and delivery
   - On-chain transaction flow

3. Both documents are comprehensive enough for a new developer to understand the complete job run lifecycle

4. No further meaningful additions can be identified

## Key Constraints

- **Focus**: ONLY "job runs" - no other system aspects
- **Requirements**: Specifications must adhere to `requirements.md` (observability, EROI)
- **Sources**: Read actual code, don't just rely on existing docs
- **Artifacts**: Create SUGGESTION artifacts with clear labels
- **Duplicates**: Use `search_similar_situations` to avoid redundancy
- **Completion**: Stop when exhausted

## Example Workflow

```bash
# 1. Dispatch the job
yarn dispatch:spec-improver
# Note the request ID from output

# 2. Worker picks up and executes the job
# (if worker is not running, start it with: yarn dev:mech)

# 3. View results in explorer
# Open http://localhost:3000/requests/{requestId}

# 4. Download and review SUGGESTION artifacts

# 5. Edit docs/spec/blueprint/specification.md and documentation.md

# 6. Commit changes
git add docs/spec/blueprint/
git commit -m "Improve job runs specification based on agent suggestions"

# 7. Repeat
# The next job run will see your changes and continue from there
```

## Integration with Blueprint

This job is designed to work within the blueprint hierarchy defined in `docs/spec/blueprint/index.md`:

```
Intent Sections (set by humans):
├── Constitution
├── Vision
└── Requirements ← This job reads these

Execution Sections (set by agents):
├── Specification ← This job improves this
├── Implementation
└── Documentation ← This job improves this
```

The job bridges the gap between human intent (requirements) and agent execution (specification/documentation).

