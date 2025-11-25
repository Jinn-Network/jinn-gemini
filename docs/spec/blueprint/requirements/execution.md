# Execution Requirements

Agent execution and tooling requirements for the Jinn protocol.

---

## EXQ-001: Agent Operating System Specification

**Assertion:**  
Agents must operate according to the specification defined in `gemini-agent/GEMINI.md`, which governs autonomy, tool usage, and work protocol.

**Examples:**

| Do | Don't |
|---|---|
| Agents act autonomously without seeking permission | Agents ask user "Should I proceed?" |
| Agents use tools to discover information | Agents hallucinate file contents or API responses |
| Agents decompose complex tasks via delegation | Agents try to complete everything in single run |
| Agents follow Work Protocol: Contextualize → Decide → Act → Report | Agents skip context gathering and act immediately |

**Commentary:**

The `GEMINI.md` specification defines the agent's "operating system"—the invariants and constraints under which it operates. Key principles:

**Autonomy:**
- Agents never pause for user input (non-interactive mode)
- Agents make decisions based on tools and context
- Agents don't ask questions or seek clarification

**Factual Grounding:**
- Agents only use information obtained from tools
- Agents don't guess or hallucinate
- Agents verify assumptions before acting

**Work Decomposition:**
- Complex tasks are broken into sub-jobs via `dispatch_new_job`
- Child jobs are specialized and bounded
- Parent jobs synthesize child results

**Work Protocol Phases:**
1. **Contextualize & Plan**: Use `get_details` or `search_artifacts` to understand position in hierarchy
2. **Decide & Act**: Complete directly, delegate to children, wait for children, or fail
3. **Report**: Produce execution summary describing accomplishment

This specification emerged from early issues where agents would pause for input (breaking automation), hallucinate file contents (causing errors), or try to complete unbounded tasks directly (causing timeouts).

By codifying these principles, we ensure consistent agent behavior across different job types and models.

---

## EXQ-002: Non-Interactive Execution Mode

**Assertion:**  
Agent execution must be non-interactive, with prompts sent via stdin and the `--prompt` flag to prevent "Please continue" loops.

**Examples:**

| Do | Don't |
|---|---|
| Spawn Gemini CLI with `--prompt` flag set | Rely on interactive REPL mode |
| Send full prompt via stdin immediately | Send prompt incrementally with pauses |
| Kill process if it pauses waiting for input | Let process hang indefinitely |
| Use `--yolo` flag to disable confirmations | Allow Gemini to ask "Is this correct?" |

**Commentary:**

Non-interactive mode is enforced through specific Gemini CLI configuration:

```typescript
const geminiProcess = spawn('gemini', [
  '--model', model,
  '--yolo',                    // Skip confirmations
  '--prompt', promptText,      // Enable non-interactive mode
  '--telemetry', 'true',
  '--telemetry-target', 'local',
  '--telemetry-outfile', telemetryFile
]);

// Send prompt via stdin (required even with --prompt flag)
geminiProcess.stdin.write(promptText);
geminiProcess.stdin.end();
```

The combination of `--prompt` flag and stdin write ensures the CLI:
- Starts execution immediately
- Never pauses for user input
- Exits when complete or on error

Without this configuration, the Gemini CLI would enter interactive mode, waiting for user to type "continue" or provide additional context. This would hang the worker indefinitely.

The `--yolo` flag disables all confirmation prompts (e.g., "Should I execute this command?"), ensuring fully autonomous operation.

---

## EXQ-003: Loop Protection

**Assertion:**  
Agent execution must be terminated if it produces excessive output, large chunks, or repetitive lines indicating a runaway loop.

**Examples:**

| Do | Don't |
|---|---|
| Kill process if stdout exceeds 5MB total | Let agents produce unlimited output |
| Kill process if single chunk exceeds 100KB | Buffer infinite output in memory |
| Kill process if same line repeats 10+ times in 20-line window | Ignore repetitive output patterns |
| Preserve partial output and telemetry on loop detection | Discard all data when killing process |

**Commentary:**

Loop protection prevents resource exhaustion from runaway agents:

**Thresholds (configurable via env vars):**
- `AGENT_MAX_STDOUT_SIZE`: 5MB total output (default)
- `AGENT_MAX_CHUNK_SIZE`: 100KB per chunk (default)
- `AGENT_REPETITION_WINDOW`: 20 lines (default)
- `AGENT_REPETITION_THRESHOLD`: 10 identical lines (default)
- `AGENT_MAX_IDENTICAL_CHUNKS`: 10 identical chunks (default)

**Detection Logic:**
1. Monitor stdout stream in real-time
2. Accumulate chunks and check size thresholds
3. Keep sliding window of recent lines
4. Count identical lines within window
5. If threshold exceeded, kill process immediately

**On Loop Detection:**
1. Process is killed with SIGKILL
2. Partial output is preserved
3. Telemetry is parsed from outfile
4. Error is thrown with type `LOOP_DETECTED`
5. Job status becomes FAILED

This protection is critical because:
- LLMs can enter infinite loops (e.g., retrying same failed action)
- Token costs scale with output size
- Memory exhaustion can crash worker
- Other jobs would be blocked waiting for runaway job

The thresholds are calibrated to allow legitimate large outputs (full file contents, comprehensive reports) while catching pathological cases.

---

## EXQ-004: Per-Job Model Selection

**Assertion:**  
Each job must specify its own Gemini model in the job definition, not at the worker level.

**Examples:**

| Do | Don't |
|---|---|
| Include `model: "gemini-2.5-flash"` in job metadata | Configure model globally in worker |
| Pass job-specified model to `agent.run()` | Hardcode model in agent.ts |
| Use `gemini-2.5-flash` for fast, cost-effective tasks | Use same model for all jobs |
| Use `gemini-2.5-pro` for complex reasoning tasks | Restart worker to change models |

**Commentary:**

Per-job model selection enables optimization:

**Available Models:**
- `gemini-2.5-flash`: Fast, cost-effective, default for most tasks
- `gemini-2.5-pro`: High-quality reasoning for complex tasks

**Model Storage Flow:**
1. Job creator specifies `model` in `dispatch_new_job`
2. Model stored in IPFS metadata with job definition
3. Worker reads model from IPFS at execution time
4. All phases (recognition, execution, reflection) use job-specified model
5. Defaults to `gemini-2.5-flash` if not specified

**Benefits:**
- Each job uses optimal model for its task complexity
- No worker restart needed to change models
- Model choice is auditable (stored on-chain via IPFS)
- Enables A/B testing across different job types
- Cost optimization (flash for simple tasks, pro for complex)

This design emerged from the need to balance cost and quality. Simple tasks like code formatting don't need expensive models, while complex tasks like architecture design benefit from advanced reasoning.

The model is passed to all agent phases consistently to prevent mid-job model switching.

---

## EXQ-005: Tool-Based Environment Interaction

**Assertion:**  
Agents must interact with their environment exclusively through MCP tools, not by executing arbitrary code or system commands.

**Examples:**

| Do | Don't |
|---|---|
| Use `get_file_contents` tool to read files | Execute `cat file.txt` in shell |
| Use `web_fetch` tool to retrieve URLs | Execute `curl` command directly |
| Use `dispatch_new_job` to create child jobs | Spawn subprocess to run worker |
| Return structured JSON from tool handlers | Return unstructured string output |

**Commentary:**

Tool-based interaction provides:

1. **Security**: Tools are vetted, sandboxed, and rate-limited
2. **Auditability**: All tool calls are logged in telemetry
3. **Testability**: Tools can be mocked for testing
4. **Consistency**: Same interface across different agents and models

**Tool Architecture:**
- MCP server registers tools with Gemini CLI
- Each tool has Zod schema for input validation
- Tool handlers return structured JSON
- Tools are prefixed with `mcp_` by protocol
- Tools have no side effects on agent state

**Tool Categories:**
- **Universal**: Always available (dispatch, artifact, context)
- **Code**: Available in code jobs (file operations, search)
- **Search**: Available when enabled (web search, fetch)
- **Memory**: Available for recognition/reflection (embed, search situations)

By restricting agents to tools, we prevent:
- Arbitrary code execution vulnerabilities
- Untracked side effects
- Resource exhaustion attacks
- Credential leakage

Agents are untrusted by design. Tools are the trusted, validated interface to the environment.

---

## EXQ-006: Tool Enablement Control

**Assertion:**  
Agent toolsets must be strictly limited to universal tools plus job-specific `enabledTools`, with native Gemini CLI tools excluded by default.

**Examples:**

| Do | Don't |
|---|---|
| Generate settings.json with only allowed tools | Give agent access to all available tools |
| Exclude native CLI tools unless explicitly enabled | Allow file operations by default |
| Include `code_search` tool only for code jobs | Give search tools to all jobs |
| Validate enabledTools against whitelist | Trust job creator to specify safe tools |

**Commentary:**

Tool enablement prevents privilege escalation:

**Settings Generation:**
```typescript
const toolsToInclude = [
  ...UNIVERSAL_TOOLS,           // Always available
  ...metadata.enabledTools      // Job-specific
];

// Generate .gemini/settings.json with only toolsToInclude
```

**Universal Tools (always available):**
- `dispatch_new_job`, `dispatch_existing_job`
- `get_details`, `search_artifacts`, `search_jobs`
- `create_artifact`
- `list_tools`

**Conditional Tools (must be explicitly enabled):**
- Native Gemini CLI tools: `file_*`, `web_search`, `terminal`
- Code tools: `get_file_contents`, `search_code`, `list_commits`
- Search tools: `google_web_search`, `web_fetch`

**Why exclude native tools by default?**
- File operations could read sensitive data
- Terminal access could execute arbitrary commands
- Web search could leak information about job context
- Not all jobs need these capabilities

Job creators specify `enabledTools` based on job requirements. Workers validate tools against whitelist and generate restrictive settings.

This principle of least privilege minimizes attack surface.

---

## EXQ-007: Telemetry Collection

**Assertion:**  
All agent executions must produce structured telemetry including tool calls, token usage, duration, and errors.

**Examples:**

| Do | Don't |
|---|---|
| Use `--telemetry-outfile` to capture structured JSON | Parse stdout for tool calls |
| Parse telemetry after process exit | Try to read telemetry during execution |
| Extract tool args and results from telemetry | Infer tool usage from output text |
| Preserve telemetry even on execution failure | Discard telemetry on error |

**Commentary:**

Telemetry provides observability into agent behavior:

**Telemetry Structure:**
```json
{
  "totalTokens": 12345,
  "toolCalls": [
    {
      "tool": "web_fetch",
      "args": {"url": "..."},
      "duration_ms": 1234,
      "success": true,
      "result": {...}
    }
  ],
  "duration": 5678,
  "errorMessage": "...",
  "errorType": "PROCESS_ERROR",
  "raw": {
    "lastApiRequest": {...},
    "stderrWarnings": "...",
    "partialOutput": "..."
  }
}
```

**Collection Process:**
1. Spawn Gemini with `--telemetry true --telemetry-target local --telemetry-outfile /tmp/telemetry-{unique}.json`
2. Wait for process exit
3. Read telemetry file
4. Parse JSON
5. Delete telemetry file (cleanup)

**Telemetry Uses:**
- **Artifact Extraction**: Worker parses tool outputs from telemetry
- **Cost Tracking**: Token counts enable billing and optimization
- **Debugging**: Tool sequences reveal execution logic
- **Reflection**: Telemetry is input to reflection phase

Telemetry is preserved even on error, enabling post-mortem analysis of failures.

The separation between agent output (user-facing) and telemetry (system-facing) ensures agents can't tamper with observability data.

---

## EXQ-008: Settings Generation and Cleanup

**Assertion:**  
MCP settings must be generated fresh for each job at `gemini-agent/.gemini/settings.json` and deleted after execution.

**Examples:**

| Do | Don't |
|---|---|
| Generate settings before spawning agent | Reuse settings across multiple jobs |
| Use dev template with `tsx` when `USE_TSX_MCP=1` | Hardcode MCP server command |
| Use prod template with `node dist/...` in production | Mix dev and prod templates |
| Delete settings file after job completes | Leave settings accumulating on disk |

**Commentary:**

Settings generation ensures per-job isolation:

**Template Selection:**
- Dev (`settings.template.dev.json`): Runs MCP via `tsx gemini-agent/mcp/server.ts`
- Prod (`settings.template.json`): Runs compiled `dist/gemini-agent/mcp/server.js`

**Settings Content:**
```json
{
  "ai": {
    "models": ["gemini-2.5-flash", "gemini-2.5-pro"]
  },
  "mcp_servers": {
    "jinn-tools": {
      "command": "tsx",  // or "node" in prod
      "args": ["gemini-agent/mcp/server.ts"],
      "env": {
        "JINN_REQUEST_ID": "0x...",
        "JINN_MECH_ADDRESS": "0x...",
        "ENABLED_TOOLS": "tool1,tool2"
      }
    }
  }
}
```

**Generation Flow:**
1. Read appropriate template file
2. Inject job-specific env vars
3. Filter MCP server tools to allowed set
4. Write to `.gemini/settings.json`
5. Spawn Gemini CLI (reads settings automatically)
6. Wait for completion
7. Delete settings file

This ensures:
- No cross-job tool access
- Clean slate for each execution
- Environment matches dev/prod context
- No disk clutter from old settings

---

## EXQ-009: MCP Tool Registration

**Assertion:**  
MCP tools must be registered in `gemini-agent/mcp/server.ts` with Zod schemas and return structured JSON responses.

**Examples:**

| Do | Don't |
|---|---|
| Export `{ schema, handler }` from tool file | Define tool directly in server.ts |
| Use Zod for input validation | Manually parse and validate strings |
| Return `{ content: [{ type: 'text', text: JSON.stringify(...) }] }` | Return plain strings or objects |
| Register tools in serverTools array | Dynamically import tools at runtime |

**Commentary:**

Tool registration follows a consistent pattern:

**Tool File Structure (`gemini-agent/mcp/tools/my_tool.ts`):**
```typescript
import { z } from 'zod';

export const schema = z.object({
  param1: z.string(),
  param2: z.number().optional()
});

export async function handler(params: z.infer<typeof schema>) {
  // Implementation
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        data: { /* results */ },
        meta: { ok: true }
      }, null, 2)
    }]
  };
}
```

**Server Registration (`gemini-agent/mcp/server.ts`):**
```typescript
import * as myTool from './tools/my_tool.js';

const serverTools = [
  { name: 'my_tool', tool: myTool },
  // ... other tools
];

// Registration loop
for (const { name, tool } of serverTools) {
  server.registerTool(name, tool.schema, tool.handler);
}
```

**Benefits:**
- Type safety from Zod schemas
- Automatic validation errors
- Consistent response format
- Easy testing (import and call handler)
- Clear tool catalog

The `list_tools` MCP tool introspects registered tools, providing agents with a self-documenting catalog.

---

## EXQ-010: Tool Output Capture Pattern

**Assertion:**  
Tools must output structured data captured in telemetry; tools must not have database credentials or direct persistence access.

**Examples:**

| Do | Don't |
|---|---|
| `create_artifact` returns `{ cid, name, topic }` | `create_artifact` writes to Supabase |
| Worker parses telemetry for artifact CIDs | Agent tools call Control API directly |
| Worker persists artifacts via Control API | Tools have SUPABASE_SERVICE_ROLE_KEY |
| Tools are pure functions of input | Tools maintain state between calls |

**Commentary:**

The tool output capture pattern separates execution from persistence:

**Tool Execution Flow:**
1. Agent calls `create_artifact` tool
2. Tool uploads content to IPFS
3. Tool returns `{ cid, name, topic, contentPreview }`
4. Gemini CLI captures return value in telemetry
5. Agent execution completes
6. Worker parses telemetry
7. Worker extracts artifact CIDs
8. Worker calls Control API to persist artifacts
9. Artifacts included in delivery payload

**Why tools can't persist directly:**
- Agents are untrusted, tools are trusted
- Persistence requires validation (worker does this)
- Lineage injection needs request context (worker has this)
- Audit trail must be complete (worker ensures this)

**Tool Security Model:**
- Tools have read access (Ponder, IPFS)
- Tools have write access (IPFS only)
- Tools have NO database write access
- Tools return structured data, not side effects

This pattern emerged from JINN-195 when tools writing directly to Supabase created inconsistent lineage data. By making tools pure and having the worker orchestrate persistence, we ensure data integrity.

The worker is the only component with Control API credentials.
