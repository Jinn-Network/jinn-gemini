# Future Improvements

This document tracks ideas and potential enhancements for the Jinn system.

## 1. Telemetry-Based Job Logging and Analysis (COMPLETED)

**Status:** ✅ **COMPLETED** - Integrated telemetry collection has been fully implemented and is operational.

**Goal:** Implement a robust logging system by capturing structured telemetry data from the Gemini CLI to enable detailed debugging, usage tracking, and performance analysis.

**Implementation Summary:**
The telemetry system has been successfully implemented with the following features:

- **Integrated Telemetry Collection**: Built directly into the Agent class, eliminating the need for external collectors
- **Comprehensive Data Capture**: Captures token usage, tool calls, performance metrics, errors, and warnings
- **Direct File Parsing**: Reads telemetry data directly from Gemini CLI output files using `--telemetry-outfile`
- **Enhanced Error Handling**: Captures both critical failures and warning-level issues with full context
- **Complete Job Reporting**: Stores detailed execution reports in the `job_reports` table

**Current Features:**
- Token usage tracking (`total_tokens`, input/output breakdown)
- Tool call logging with duration and success metrics (`tools_called`)
- Complete conversation logs (`request_text`, `response_text`)
- Error and warning capture (`error_message`, `error_type`)
- Raw telemetry preservation for debugging (`raw_telemetry`)
- Performance metrics (`duration_ms`)

**Background:**
The initial approach of using the `--debug` flag to capture logs proved difficult due to the asynchronous nature of stream handling, which resulted in lost or incomplete log data. The final implementation uses the Gemini CLI's built-in telemetry features with direct file parsing for reliable data capture.

**Final Implementation:**

1.  **Integrated Agent Telemetry Collection:**
    *   Modified the `Agent` class to use Gemini CLI's built-in telemetry flags:
        *   `--telemetry`: Enables telemetry collection
        *   `--telemetry-target local`: Uses local file output
        *   `--telemetry-outfile <path>`: Writes structured telemetry to temporary files
        *   `--telemetry-log-prompts`: Includes full prompt text in telemetry

2.  **Direct Telemetry File Parsing:**
    *   Implemented robust telemetry parser that reads NDJSON (newline-delimited JSON) output files
    *   Extracts token counts, tool calls, timing data, and conversation logs
    *   Handles both successful completions and error conditions
    *   Captures stderr warnings even on successful runs

3.  **Enhanced `job_reports` Table Schema:**
    *   Comprehensive reporting table with fields for:
        *   `job_id`, `worker_id`, `status`, `duration_ms`
        *   `total_tokens` (with input/output breakdown available in raw data)
        *   `tools_called` (JSONB array with detailed call information)
        *   `request_text`, `response_text` (complete conversation logs)
        *   `error_message`, `error_type` (including warning-level issues)
        *   `raw_telemetry` (complete telemetry data for debugging)

**Achieved Benefits:**
*   **Reliable Data Capture:** Direct file parsing eliminates race conditions and data loss
*   **Comprehensive Coverage:** Captures all aspects of job execution including warnings
*   **Production Ready:** No external dependencies, works in containerized environments
*   **Immediate Visibility:** Error messages populated for both failures and warnings

### 1.1 Enhanced Telemetry with Jaeger Tracing (ABANDONED FOR NOW)

**Goal:** Export telemetry data to Jaeger for distributed tracing visualization and performance analysis.

**Implementation:**

1.  **Add Jaeger Service:**
    ```yaml
    # Jaeger configuration for local development
    # This would be set up as a separate service
    ```

2.  **Update OpenTelemetry Collector Configuration:**
    ```yaml
    exporters:
      jaeger:
        endpoint: jaeger:14268
        tls:
          insecure: true
      debug:
        verbosity: detailed

    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [batch]
          exporters: [jaeger, debug]
    ```

**Benefits:**
*   **Visual Request Flow:** See complete job execution timeline from pickup to completion
*   **Performance Bottleneck Identification:** Identify slow API calls, database operations, etc.
*   **Error Correlation:** Track exactly where failures occur in the pipeline
*   **Service Dependency Mapping:** Visualize interactions between worker, Gemini API, and Supabase
*   **Historical Performance Analysis:** Track performance trends over time

**Alternative Log Storage Options:**
*   **Elasticsearch + Kibana:** Full-text search, dashboards, alerting
*   **Loki + Grafana:** Lightweight log aggregation with metrics integration
*   **Local File Storage:** Simple setup using JSON files for analysis with jq/grep

### 1.2 Job Execution Reporting System (COMPLETED)

**Status:** ✅ **COMPLETED** - Comprehensive job reporting has been implemented and is fully operational.

**Goal:** Create comprehensive execution reports for each job run to enable debugging, monitoring, and usage analytics.

**Current Implementation:**

The `job_reports` table has been implemented and is actively used by all job executions:

```sql
-- Current production schema (see DATABASE_MAP.md for full details)
CREATE TABLE job_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES job_board(id),
  worker_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Execution Summary
  status TEXT NOT NULL, -- COMPLETED, FAILED
  duration_ms INTEGER NOT NULL,
  
  -- Token Usage (captured from Gemini telemetry)
  total_tokens INTEGER DEFAULT 0,
  
  -- Complete Conversation Data
  request_text JSONB, -- Full conversation sent to Gemini API
  response_text JSONB, -- Complete API response with all rounds
  final_output TEXT, -- Clean final answer returned to job_board
  
  -- Tool Usage (detailed logging)
  tools_called JSONB DEFAULT '[]', -- Array of tool calls with execution details
  
  -- Enhanced Error Tracking
  error_message TEXT, -- Includes both failures and warnings
  error_type TEXT, -- API_ERROR, TOOL_ERROR, WARNING, etc.
  
  -- Complete Telemetry Data
  raw_telemetry JSONB DEFAULT '{}' -- Full telemetry for advanced debugging
);
```

**Current Reporting Features:**

1.  **Automatic Report Generation:**
    The Worker automatically generates comprehensive job reports for every execution:
    ```typescript
    // Implemented in worker/worker.ts
    interface JobReportData {
      job_id: string;
      worker_id: string;
      status: 'COMPLETED' | 'FAILED';
      duration_ms: number;
      total_tokens: number;
      tools_called: ToolCall[];
      request_text: any[];
      response_text: any[];
      final_output: string;
      error_message: string | null;
      error_type: string | null;
      raw_telemetry: any;
    }
    ```

2.  **Integrated Telemetry Collection:**
    Reports are populated directly from Agent telemetry parsing:
    - Token usage extracted from Gemini CLI telemetry files
    - Tool calls logged with duration, success status, and parameters
    - Complete conversation history preserved
    - Error and warning capture with full context

**Available Report Features:**

*   **✅ Debugging Capability:**
    *   Complete prompt and response history (`request_text`, `response_text`)
    *   Detailed tool call sequences with parameters and timing (`tools_called`)
    *   Full error traces with context (`error_message`, `raw_telemetry`)
    *   Complete execution timeline and duration (`duration_ms`)

*   **✅ Usage Analytics:**
    *   Token consumption tracking (`total_tokens`)
    *   Tool usage patterns and frequency analysis
    *   Success/failure rate monitoring (`status`)
    *   Performance metric collection

*   **✅ Performance Insights:**
    *   Job execution timing analysis
    *   Tool call performance metrics (duration per tool)
    *   Resource utilization patterns
    *   Error pattern identification

*   **✅ Operational Reports:**
    *   Real-time job execution status
    *   Historical performance analysis
    *   Error and warning trend monitoring
    *   Worker performance tracking

**Example Current Report Data:**
```json
{
  "job_id": "0310a7be-0f4d-418b-bb68-88274db8c3cb",
  "status": "COMPLETED",
  "duration_ms": 89078,
  "total_tokens": 23796,
  "error_message": "Job completed with warnings. Check raw_telemetry.stderrWarnings for details: Accessing resource attributes before async attributes settled",
  "error_type": "WARNING",
  "tools_called": [
    {
      "tool": "read_records",
      "success": true,
      "duration_ms": 548
    },
    {
      "tool": "get_schema", 
      "success": true,
      "duration_ms": 174
    },
    // ... 11 more tool calls
  ],
  "raw_telemetry": {
    "sessionId": "442532a1-e1f3-4926-a666-7535f8f075e5",
    "eventCount": 31,
    "stderrWarnings": "Accessing resource attributes before async attributes settled\n"
  }
}
```

**Achieved Benefits:**
*   **✅ Immediate Debugging:** Complete execution context available in database
*   **✅ Usage Monitoring:** Real-time token consumption and cost tracking
*   **✅ Performance Analysis:** Tool-level timing and bottleneck identification
*   **✅ Quality Assurance:** Success rates and warning pattern monitoring
*   **✅ Operational Visibility:** Full system transparency for optimization

## 2. Use gemini.md (COMPLETED)

**Goal:** Implement a standardized documentation format using `gemini.md` files to provide comprehensive context and instructions for agents.

**Implementation Summary:**
This has been implemented, but with a key modification to ensure the context is only used for agent-driven sessions and not for manual CLI use.
- A file named `AGENT_CONTEXT.md` was created in the project root. This file contains the core operational framework for the agent (OODA loop, output requirements, etc.).
- The filename `AGENT_CONTEXT.md` is intentionally not `GEMINI.md` to prevent the Gemini CLI from automatically loading it.
- The `agent.ts` script has been modified to manually read `AGENT_CONTEXT.md` and pipe its contents into the `stdin` of the spawned `gemini` process.
- This approach provides full control over when the agent's core context is applied, achieving the goal of standardized instructions without interfering with other uses of the CLI.

**Original Proposal:**

1.  **Create gemini.md Template:**
    *   Define a standard markdown structure for agent documentation
    *   Include sections for: agent purpose, capabilities, constraints, examples, and operational guidelines
    *   Establish naming conventions and file organization

2.  **Agent Documentation System:**
    *   Create `gemini.md` files for each agent type/role
    *   Implement a system to load and parse these files as context
    *   Ensure agents can reference their own documentation during execution

3.  **Integration with Context System:**
    *   Modify the context snapshot tool to include relevant `gemini.md` content
    *   Enable dynamic loading of documentation based on agent type or job requirements

**Benefits:**
*   **Standardized Communication:** Consistent format for agent instructions and capabilities
*   **Improved Performance:** Better context leads to more accurate and efficient agent behavior
*   **Maintainability:** Centralized documentation that's easy to update and version control

## 3. Improve Context Snapshot Tool (COMPLETED)

**Status:** ✅ **COMPLETED** - The context snapshot tool has been enhanced with comprehensive system state gathering and temporal awareness.

**Goal:** Enhance the context snapshot tool to provide more comprehensive and intelligent context gathering for agents.

**Implementation Summary:**
The context snapshot tool has been successfully enhanced to provide comprehensive system state information with temporal awareness and intelligent data gathering.

**Current Implementation:**

The enhanced `getContextSnapshot` tool in `packages/metacog-mcp/src/tools/context-snapshot.ts` provides:

1.  **Temporal Context Awareness:**
    *   **Lookback Window Calculation:** Automatically determines time windows based on completed `Metacog.GenesysMetacog` job runs
    *   **Configurable Lookback:** Supports configurable lookback periods (default: 1 run)
    *   **Time-based Filtering:** Retrieves data from the start of the lookback window to present

2.  **Comprehensive System State Gathering:**
    *   **Full System State:** Always retrieves complete `system_state` table for current mission and configuration
    *   **Job Schedules:** Complete `job_schedules` table with active job definitions and triggers
    *   **Recent Activity:** All jobs, artifacts, messages, and threads within the lookback period
    *   **Mission Context:** Extracts and highlights the current mission from system state

3.  **Enhanced Data Structure:**
    ```typescript
    interface ContextSnapshot {
      snapshot_details: {
        lookback_runs: number;
        start_time: string;
        end_time: string;
        generated_at: string;
      };
      mission: string;
      system_state: any[];
      job_schedules: any[];
      jobs_in_lookback: any[];
      artifacts_in_lookback: any[];
      messages_in_lookback: any[];
      threads_in_lookback: any[];
    }
    ```

**Current Features:**

*   **✅ Temporal Awareness:** Understands recent changes and activity patterns
*   **✅ Comprehensive Coverage:** Captures all major system entities and their relationships
*   **✅ Mission Context:** Provides current mission and system configuration
*   **✅ Recent Activity Tracking:** Shows jobs, artifacts, messages, and threads within lookback period
*   **✅ Flexible Lookback:** Configurable time windows based on job completion patterns
*   **✅ Error Handling:** Robust error handling with informative error messages

**Benefits Achieved:**
*   **Better Decision Making:** Agents have complete system context including mission, recent activity, and configuration
*   **Temporal Understanding:** Awareness of recent changes and activity patterns
*   **Comprehensive Coverage:** All major system entities captured in a single snapshot
*   **Operational Context:** Clear understanding of current mission and system state

## 4. Create Intelligence Network Tools

**Goal:** Develop tools that enable agents to form intelligent networks for collaborative problem-solving and knowledge sharing.

**Background:**
Individual agents have limited perspectives and capabilities. Creating networks of agents can enable more complex problem-solving through collaboration and knowledge sharing.

**Proposed Implementation:**

1.  **Agent Network Infrastructure:**
    *   Design a network topology system for connecting agents
    *   Implement agent discovery and registration mechanisms
    *   Create routing protocols for inter-agent communication

2.  **Collaborative Tools:**
    *   Develop tools for agents to share knowledge and insights
    *   Implement consensus-building mechanisms for coordinated decision-making
    *   Create task delegation and coordination protocols

3.  **Network Intelligence:**
    *   Implement collective learning mechanisms across the agent network
    *   Add network-wide optimization algorithms
    *   Create monitoring and analytics for network performance

**Benefits:**
*   **Enhanced Problem Solving:** Networks can tackle complex problems beyond individual agent capabilities
*   **Knowledge Sharing:** Collective intelligence improves overall system performance
*   **Scalability:** Network approach allows for horizontal scaling of intelligence

## 5. Enable Passing Messages Between Agents

**Goal:** Implement a robust messaging system that allows agents to communicate directly with each other for coordination and collaboration.

**Background:**
Current agent communication is primarily through the job board system. Direct agent-to-agent messaging would enable more dynamic and responsive collaboration.

**Proposed Implementation:**

1.  **Messaging Infrastructure:**
    *   Design a message broker system for agent communication
    *   Implement message routing and delivery mechanisms
    *   Create message persistence and reliability features

2.  **Message Types and Protocols:**
    *   Define standard message formats for different types of communication
    *   Implement request-response patterns for synchronous communication
    *   Add support for asynchronous messaging and event-driven communication

3.  **Security and Control:**
    *   Implement message authentication and authorization
    *   Add rate limiting and spam prevention
    *   Create monitoring and logging for message traffic

**Benefits:**
*   **Real-time Collaboration:** Agents can coordinate and respond to each other in real-time
*   **Flexible Communication:** Support for various communication patterns and use cases
*   **Improved Efficiency:** Direct messaging reduces latency compared to job board communication

## 6. Dynamic Tool Discovery in `list-tools` (COMPLETED)

**Status:** ✅ **COMPLETED** - The `list-tools` tool has been refactored to be fully dynamic, ensuring it is always in sync with the tools registered on the server.

**Goal:** Refactor the `list-tools` tool to dynamically discover available tools from the MCP server, rather than relying on a manually maintained static list.

**Implementation Summary:**
The `list-tools` tool has been successfully refactored to eliminate the need for a manually maintained static list. It now uses a "single source of truth" approach, ensuring that the discoverable tools are always identical to the executable tools registered on the server.

**Final Implementation:**

1.  **Single Source of Truth:**
    *   A single `serverTools` array has been defined in `packages/metacog-mcp/src/server.ts`. This array acts as the definitive manifest for all tools available on the server, containing each tool's name, schema, and handler function.

2.  **Dynamic Registration:**
    *   The `McpServer` now iterates through the `serverTools` array at startup to register all tools programmatically.

3.  **Dynamic `list-tools` Handler:**
    *   The `listTools` function has been refactored to be a pure function that accepts the `serverTools` array as an argument.
    *   When registered, the `list_tools` handler is passed the `serverTools` array, allowing it to generate a complete and accurate list of all other registered tools on the fly.
    *   This eliminates the old, error-prone pattern of maintaining a separate, static list of tools for discovery.

**Benefits Achieved:**
*   **✅ Single Source of Truth:** The `serverTools` array in `server.ts` is now the single, definitive source for all tool information.
*   **✅ Reduced Maintenance:** Adding a new tool now only requires adding it to the `serverTools` array in one place. The manual, error-prone step of updating a separate discovery list has been eliminated.
*   **✅ Guaranteed Consistency:** The list of discoverable tools is now guaranteed to be perfectly in sync with the list of executable tools, improving system reliability.
