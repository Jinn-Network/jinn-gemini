# Job Terminology: Template vs Instance

**Version**: 1.0  
**Last Updated**: 2025-12-15

## Core Concepts

### Job Template (Static Policy Document)

A **job template** is a reusable specification that defines:

- **What** the job accomplishes (blueprint assertions)
- **Which tools** are available (enabledToolsPolicy)
- **Input contract** (inputSchema: JSON Schema)
- **Output contract** (outputSpec: schema + mapping)
- **Safety tier** (tool restrictions, execution constraints)
- **Pricing** (derived from historical runs)

Templates are **immutable** once published. They describe a class of work, not a specific execution.

**Example Templates:**

| Template ID | Name | Description |
|-------------|------|-------------|
| `ethereum-daily-research` | Ethereum Daily Research | Generates daily on-chain activity report with TVL, volume, liquidations |
| `code-review-pr` | PR Code Review | Reviews a GitHub PR for security, style, and correctness |
| `market-sentiment-analysis` | Market Sentiment Analysis | Analyzes social/news sentiment for specified tokens |

### Job Instance (Stateful Execution)

A **job instance** is a single execution of a template with:

- **Specific inputs** (context, parameters)
- **Execution state** (pending → in_progress → completed/failed)
- **Request ID** (on-chain identifier)
- **Artifacts** (outputs generated during execution)
- **Telemetry** (tool calls, timing, errors)

Instances are **ephemeral** and tied to a specific workstream/request.

**Example Instances:**

| Request ID | Template | Input | Status |
|------------|----------|-------|--------|
| `0xabc123...` | `ethereum-daily-research` | `{"date": "2025-12-14"}` | completed |
| `0xdef456...` | `ethereum-daily-research` | `{"date": "2025-12-15"}` | in_progress |
| `0x789abc...` | `code-review-pr` | `{"pr_url": "github.com/..."}` | pending |

## Current System Mapping

### `jobDefinition` = Instance Container

The current `job_definition` table in Ponder behaves as an **instance container**:

```typescript
// ponder/ponder.schema.ts
export const jobDefinition = onchainTable("job_definition", (t) => ({
  id: t.text().primaryKey(),           // UUID, unique per dispatch
  name: t.text(),                       // Job name (varies per instance)
  enabledTools: t.text().array(),       // Tools for this instance
  blueprint: t.text(),                  // Blueprint JSON (can vary)
  workstreamId: t.text(),               // First workstream (instance-specific)
  sourceJobDefinitionId: t.text(),      // Parent instance
  sourceRequestId: t.text(),            // Parent request
  codeMetadata: t.json(),               // Repo context (instance-specific)
  dependencies: t.text().array(),       // Sibling dependencies
  createdAt: t.bigint(),
  lastInteraction: t.bigint(),
  lastStatus: t.text(),                 // Current status
}));
```

**Why "instance container":**
- Each `dispatch_new_job` creates a NEW `jobDefinition` row
- Same logical job (e.g., "Ethereum Research") gets different IDs across workstreams
- `workstreamId` stores only the FIRST workstream (not reusable across workstreams)
- Blueprint content can vary between "instances" of the same logical job

### Current: `job_templates` Registry (Supabase)

The `job_templates` table in Supabase holds **reusable templates**:

```sql
-- migrations/create_job_templates_table.sql
CREATE TABLE job_templates (
  id TEXT PRIMARY KEY,                    -- Stable template ID (e.g., "ethereum-daily-research")
  name TEXT NOT NULL,                     -- Display name
  description TEXT,                       -- Human description
  tags TEXT[] DEFAULT '{}',               -- Discovery tags
  enabled_tools_policy JSONB,             -- Tool allowlist JSON array
  input_schema JSONB,                     -- JSON Schema for inputs
  output_spec JSONB,                      -- Output mapping + schema
  x402_price BIGINT DEFAULT 0,            -- Price in wei (derived)
  safety_tier TEXT DEFAULT 'public',      -- "public" | "private" | "restricted"
  status TEXT DEFAULT 'visible',          -- "visible" | "hidden"
  canonical_job_definition_id TEXT,       -- Optional: link to example instance
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Why Supabase (not Ponder)?**
- Templates are not on-chain events - they're administrative data
- Control API already uses Supabase for writes
- Enables direct SQL queries and admin tools
- Ponder remains focused on chain indexing

## Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        JOB TEMPLATE                             │
│  (Static Policy Document)                                       │
│                                                                 │
│  id: "ethereum-daily-research"                                  │
│  name: "Ethereum Daily Research"                                │
│  inputSchema: { date: "string (ISO 8601)" }                     │
│  outputSpec: { schema: {...}, mapping: {...} }                  │
│  x402Price: 0.001 ETH                                           │
│  safetyTier: "public"                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ instantiates
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      JOB INSTANCE                               │
│  (Stateful Execution)                                           │
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐               │
│  │ jobDefinition       │  │ request             │               │
│  │ (instance container)│  │ (on-chain record)   │               │
│  │                     │  │                     │               │
│  │ id: "abc-123-..."   │  │ id: "0xabc123..."   │               │
│  │ name: "Ethereum..." │  │ jobDefinitionId:    │               │
│  │ blueprint: {...}    │  │   "abc-123-..."     │               │
│  │ lastStatus: "done"  │  │ delivered: true     │               │
│  └─────────────────────┘  └─────────────────────┘               │
│                                                                 │
│  Artifacts: [SITUATION, MEMORY, RESEARCH_REPORT]                │
│  Telemetry: {tool_calls: [...], duration: 45s}                  │
└─────────────────────────────────────────────────────────────────┘
```

## API/Explorer Naming Guidelines

### Use "Template" When:
- Referring to the reusable specification
- Displaying the catalog/registry
- Showing pricing, input/output contracts
- Describing what a job *does* (capability)

**Examples:**
- "Browse available templates"
- "Template: Ethereum Daily Research"
- "Template price: 0.001 ETH"
- "Input schema for this template"

### Use "Instance" or "Run" When:
- Referring to a specific execution
- Showing status, artifacts, telemetry
- Displaying workstream context
- Describing what a job *did* (execution)

**Examples:**
- "View run details"
- "Instance status: completed"
- "Run artifacts"
- "Execution telemetry"

### Avoid:
- "Job definition" in user-facing UI (internal term)
- "Job" alone (ambiguous - template or instance?)
- Mixing terminology in the same context

## Migration Path

### Phase 1: Current State ✅
- `jobDefinition` = instance container (per-dispatch)
- No template registry
- Templates implicit in blueprint JSON files

### Phase 2: Template Registry (jinn-gemini-6z8.2) ✅
- Added `job_templates` table to Supabase
- Control API exposes `jobTemplates` query and `createJobTemplate` mutation
- Seeding script: `yarn tsx scripts/templates/seed-hackathon-templates.ts`
- 3 hackathon templates: ethereum-daily-research, x402-ecosystem-research, prediction-market-analysis

### Phase 3: Template-First Dispatch
- `dispatch_new_job` accepts `templateId` instead of inline blueprint
- Instance inherits template's inputSchema, outputSpec, safetyTier
- `jobDefinition` stores `templateId` reference

### Phase 4: Full Separation
- Templates managed separately from instances
- Template versioning support
- Instance cleanup (ephemeral, can be pruned)

## Summary

| Concept | Current Name | Future Name | Mutable? | Lifecycle |
|---------|--------------|-------------|----------|-----------|
| Reusable spec | (implicit in blueprint files) | `job_template` | No (immutable once published) | Permanent |
| Single execution | `jobDefinition` | `job_instance` (conceptual) | Yes (status changes) | Ephemeral |
| On-chain record | `request` | `request` | Yes (delivered flag) | Permanent |

**Key Insight:** The current `jobDefinition` behaves like an instance container, not a template. The hackathon work introduces a proper template registry (`job_template`) to enable reusable, priced, callable workflows via x402.

---

## OutputSpec: Deterministic Output Contract

Templates define an **OutputSpec** that extracts structured results from delivery payloads.

### Format

```typescript
interface OutputSpec {
  schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  mapping: Record<string, string>;  // field → JSONPath selector
  transforms?: Record<string, { type: string; params?: any }>;  // v1 feature
}
```

### Available Delivery Payload Fields

From `worker/delivery/payload.ts`:

| Selector | Type | Description |
|----------|------|-------------|
| `$.output` | string | Main agent output |
| `$.structuredSummary` | string | Summary of output |
| `$.artifacts` | array | Generated artifacts `[{name, cid, topic}]` |
| `$.status` | string | Job status (COMPLETED, FAILED, DELEGATING, WAITING) |
| `$.statusMessage` | string | Optional status explanation |
| `$.jobDefinitionId` | string | UUID of the job definition |
| `$.jobName` | string | Human-readable job name |
| `$.pullRequestUrl` | string | PR URL if code changes were made |
| `$.recognition` | object | Recognition phase data |
| `$.reflection` | object | Reflection phase data |

### Default OutputSpec

Templates without custom output contracts use:

```typescript
const DEFAULT_OUTPUT_SPEC = {
  schema: {
    type: 'object',
    properties: {
      raw: { type: 'string', description: 'Raw agent output' },
      summary: { type: 'string', description: 'Structured summary' },
      artifacts: { type: 'array', description: 'Generated artifacts' },
      status: { type: 'string', description: 'Job completion status' },
    },
    required: ['raw', 'summary'],
  },
  mapping: {
    raw: '$.output',
    summary: '$.structuredSummary',
    artifacts: '$.artifacts',
    status: '$.status',
  },
};
```

### Validation Behavior

- Gateway applies OutputSpec mapping after job completion
- If validation fails (missing required fields, type mismatch), returns **502 Bad Gateway**
- Partial results are never returned to ensure contract reliability

