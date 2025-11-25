# Agent MCP Reference

**Deep reference for MCP tools, configuration, and extension**

This document contains detailed technical information about the Model Context Protocol (MCP) integration. For operational guidance, see `AGENT_README_TEST.md`.

---

## Headless Execution Configuration

The Agent runs Gemini CLI in headless (non-interactive) mode for automated execution. Tool access is controlled through MCP server settings rather than CLI flags.

**Configuration (`gemini-agent/agent.ts`):**
- Tool permissions are defined in the generated `settings.json` file via `includeTools` and `excludeTools` per MCP server
- The `--prompt` flag enables non-interactive mode to prevent "Please continue" prompts
- The `--include-directories` flag ensures the job workspace is accessible for file operations

**Why this matters:**
- The Gemini CLI no longer accepts `--approval-mode` or `--allowed-tools` flags
- Tool access control is now exclusively managed through MCP server configuration
- The `toolPolicy.ts` module computes which tools are available based on job requirements and security constraints

This configuration ensures fully autonomous execution with proper tool access controls.

---

## Per-Job MCP Settings

Per-job MCP settings are generated at `gemini-agent/.gemini/settings.json` from templates:
- Dev (`settings.template.dev.json`): runs MCP via `tsx`.
- Prod (`settings.template.json`): runs built `server.js`.

Loop protection terminates runs on excessive output size, large chunks, or repetitive lines.

---

## Per-Job Model Selection

Each job specifies its own Gemini model in the job definition. Model selection is per-job, not worker-level.

**Model Storage & Execution:**
1. Model is stored in IPFS metadata with the job definition
2. Worker reads model from IPFS at execution time
3. All phases (recognition, execution, reflection) use the job-specified model
4. Defaults to `gemini-2.5-flash` if not specified

**Available Models:**
- `gemini-2.5-flash`: Fast, cost-effective for most tasks (default)
- `gemini-2.5-pro`: High-quality reasoning for complex tasks

**Benefits:**
- Each job uses the optimal model for its task
- No worker restart needed to change models
- Model choice is auditable (stored on-chain via IPFS)
- Enables A/B testing across different job types

---

## Blueprint Design Philosophy

**Blueprints specify WHAT, not HOW:**

Blueprints must define success criteria and outcomes, not implementation steps or strategies. The agent has full autonomy to determine execution approach.

**Key Requirements:**
- **Quantify Everything**: Replace vague terms with specific numbers ("minimum 3 distinct sources with URLs")
- **Inline Attribution**: Citations with URLs per claim, not generic footer ("Volume $378M (defillama.com)")
- **Statistical Context**: All metrics need 7-day average comparison minimum
- **Verification Assertion**: Add VERIFICATION-001 for blueprints with 3+ assertions

❌ **Wrong - Prescribes HOW:**
```json
{
  "id": "DEPTH-001",
  "assertion": "If initial web searches return aggregate data, delegate deep-dive research to child jobs",
  "examples": {
    "do": ["Dispatch child job for protocol-specific analysis"]
  }
}
```

✅ **Correct - Defines WHAT:**
```json
{
  "id": "DEPTH-001", 
  "assertion": "Analysis must include protocol-specific breakdowns with 7-day historical comparisons",
  "examples": {
    "do": ["Report Uniswap volume: $378M (1.2x 7-day average)"],
    "dont": ["Report aggregate DeFi volume without protocol breakdowns"]
  }
}
```

The agent decides independently whether to:
- Complete work directly using available tools
- Delegate to specialist child jobs for depth
- Request additional tools or capabilities

Blueprints that prescribe delegation strategies, tool usage, or workflow patterns violate agent autonomy and reduce adaptability.

**Blueprint Style Guide**: See `docs/spec/blueprint/style-guide.md` for comprehensive guidance.

---

## MCP Tool Reference

### list_tools
- **Purpose**: Discover available core CLI and MCP tools.
- **Params**: `{ include_parameters?: boolean, include_examples?: boolean, tool_name?: string }`
- **Returns**: `{ data: { total_tools, tools: [{ name, description, parameters?, examples? }] }, meta: { ok: true } }`

### get_details
- **Purpose**: Fetch `request` and `artifact` records via Ponder; optionally resolve IPFS content.
- **Params**: `{ ids: string | string[], cursor?: string, resolve_ipfs?: boolean }`
  - Request IDs: `0x...`
  - Artifact IDs: `0x<requestId>:<index>` (e.g., `0x123abc...:0`)
  - CIDs: IPFS content identifiers (e.g., `bafkreid5ebotrkenji...`, `Qm...`, `f01...`)
  - Job Definition IDs: UUID format
- **Returns**: Single-page response with `data` in requested order and `meta` (cursor, token estimates).

### dispatch_new_job
- **Purpose**: Create a new job definition and post a marketplace request on Base.
- **Params**: `{ jobName: string, blueprint: string, model?: string, enabledTools?: string[], message?: string, dependencies?: string[], responseTimeout?: number }`
  - `blueprint`: **REQUIRED**. JSON string containing structured assertions array. Each assertion must have: `id`, `assertion`, `examples` (with `do`/`dont` arrays), and `commentary`.
  - `model`: Gemini model to use (e.g., `'gemini-2.5-flash'`, `'gemini-2.5-pro'`). Defaults to `'gemini-2.5-flash'` if not specified.
  - `dependencies`: Optional array of job definition IDs that must complete before this job executes.
  - `responseTimeout`: Optional timeout in seconds for marketplace delivery (defaults to 300, max 300). Marketplace enforces a 5-minute hard limit.
- **Returns**: Mech client result plus `ipfs_gateway_url` when indexed.
- **Validation**: Blueprint structure is validated at dispatch time. Invalid JSON or missing required fields will return error codes: `INVALID_BLUEPRINT`, `INVALID_BLUEPRINT_STRUCTURE`.

### dispatch_existing_job
- **Purpose**: Dispatch a new request for an existing job definition.
- **Params**: `{ jobId?: string, jobName?: string, enabledTools?: string[], prompt?: string, message?: string, responseTimeout?: number }`
  - `responseTimeout`: Optional timeout in seconds for marketplace delivery (defaults to 300, max 300). Marketplace enforces a 5-minute hard limit.
- **Returns**: Mech client result plus `ipfs_gateway_url` when indexed.

### create_artifact
- **Purpose**: Upload content to IPFS.
- **Params**: `{ name: string, topic: string, content: string, mimeType?: string, type?: string, tags?: string[] }`
- **Returns**: `{ cid, name, topic, contentPreview }`
- **Important**: This tool does NOT write to Supabase. Artifacts are indexed by Ponder from the on-chain delivery payload. The flow is: tool → telemetry → delivery payload → Ponder indexing.

### search_similar_situations
- **Purpose**: Semantic search over stored job execution contexts.
- **Params**: `{ query_text: string, k?: number }`
- **Returns**: Top-k similar situations with scores and metadata from `node_embeddings` table.

### inspect_situation
- **Purpose**: Inspect memory system for a given request.
- **Params**: `{ request_id: string, include_similar?: boolean, similar_k?: number }`
- **Returns**: SITUATION artifact, database record, and optionally similar situations.

---

## Adding a New MCP Tool

1. **Create Tool File**: Add a new file in `gemini-agent/mcp/tools/`.
2. **Define Schema**: Use Zod to define the input parameter schema for your tool.
3. **Implement Logic**: Write the tool's function. For any writes related to on-chain jobs, the tool **must** use the client in `worker/control_api_client.ts` to interact with the Jinn Control API. Direct database access is prohibited for on-chain workflows.
4. **Register Tool**: In `gemini-agent/mcp/server.ts`, import your new tool and add it to the `serverTools` array. The tool name will be automatically prefixed with `mcp_`. The tool will be automatically discoverable by the `list_tools` tool.

**Example Tool Structure:**
```typescript
import { z } from 'zod';
import { createTool } from '@modelcontextprotocol/sdk/types.js';

const inputSchema = z.object({
  param1: z.string().describe('Description'),
  param2: z.number().optional().describe('Optional param')
});

export const myTool = createTool({
  name: 'my_tool',
  description: 'What this tool does',
  inputSchema: inputSchema.shape,
  handler: async (input) => {
    // Implementation
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify(result) 
      }]
    };
  }
});
```

---

## Agent Tool Behavior

**Critical Architecture Note:**
- Agent tools like `create_artifact` **do not write directly to the database**. 
- Their structured output is captured in execution telemetry. 
- After the job is finished, the **worker** is responsible for calling the Control API to persist artifacts, messages, and reports off-chain.
- `dispatch_new_job` enriches with the IPFS gateway URL by querying Ponder (retrying briefly for indexing).
- When the Safe delivers, the AgentMech contract emits the `Deliver` event that Ponder listens for.
- CLI-only delivery shortcuts (for example `scripts/deliver_request.ts`) emit only `MarketplaceDelivery` with `delivered=false`, so the subgraph will never flip the `request.delivered` flag.
- For automated tests and production flows always go through the MCP toolchain (dispatch via `dispatch_new_job`, deliver via Safe).

---

## Universal Tools

Universal tools always available to every job:
- `list_tools`
- `get_details`
- `dispatch_new_job`
- `dispatch_existing_job`

**Effective toolset** = universal tools + job `enabledTools`. Native Gemini CLI tools are excluded unless explicitly enabled.

---

## Job Context Injection

**NOTE:** The context injection described below was part of the legacy system. The new on-chain worker injects a simpler context (`JINN_REQUEST_ID` and `JINN_MECH_ADDRESS`) directly as environment variables.

When the worker executes a job, it passes a job context to the MCP tool layer. This context is available to tools and is automatically injected into writes where appropriate.

- Fields provided in job context:
  - `job_definition_id`: The definition/version ID from `jobs.id` that the run references.
  - `job_name`: The human‑readable job name from the job definition.
  - `project_run_id`: The resolved project scope for the job, when available.

---

**End of MCP Reference**

