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

## 4. Create Intelligence Network Tools (COMPLETED)

**Status:** ✅ **COMPLETED** - A comprehensive suite of intelligence network tools has been implemented and is operational.

**Goal:** Develop tools that enable agents to form intelligent networks for collaborative problem-solving and knowledge sharing.

**Implementation Summary:**
A complete set of intelligence network tools has been implemented, providing agents with sophisticated capabilities for collaborative work, knowledge management, and contextual awareness.

**Current Implementation:**

### 4.1 Memory and Knowledge Management System

**Vector-Based Memory Storage:**
- **`createMemory`**: Creates structured memories with vector embeddings for semantic search
  - Supports metadata classification (source_job_id, memory_type, etc.)
  - Enables memory linking with relationship types (CAUSE, EFFECT, ELABORATION, CONTRADICTION, SUPPORT)
  - Builds knowledge graphs through linked memories
  - Uses OpenAI text-embedding-3-small for high-quality embeddings

- **`searchMemories`**: Performs semantic search across the knowledge base
  - Natural language query processing with vector similarity search
  - Configurable similarity thresholds and result limits
  - Metadata filtering capabilities
  - Optional linked memory retrieval for knowledge graph exploration
  - Supports complex knowledge graph traversal

### 4.2 Collaborative Work Management

**Thread and Artifact Management:**
- **`manageThread`**: Unified tool for creating and updating research threads
  - Supports hierarchical thread organization with parent-child relationships
  - Flexible status management (OPEN, COMPLETED, etc.)
  - Summary and objective tracking
  - Full CRUD operations in a single interface

- **`manageArtifact`**: Comprehensive artifact creation and manipulation
  - Content operations: REPLACE, APPEND, PREPEND
  - Source attribution and topic classification
  - Status tracking (RAW, PROCESSED, etc.)
  - Atomic updates with rollback capabilities
  - Thread association and organization

### 4.3 System Context and Intelligence

**Context Awareness:**
- **`getContextSnapshot`**: Provides comprehensive system state awareness
  - Temporal lookback based on metacognitive job completion patterns
  - Complete system state retrieval including mission, configuration, and recent activity
  - Job schedules, recent jobs, artifacts, messages, and threads within lookback window
  - Mission context extraction and highlighting
  - Configurable lookback periods for different analysis needs

**Network Communication Infrastructure:**
- **`messages` table**: Inter-agent communication system
  - Structured messaging between agents with metadata support
  - Message status tracking and delivery confirmation
  - Support for various communication patterns

### 4.4 Universal Data Access Layer

**Generic CRUD Operations:**
- **`createRecord`**, **`readRecords`**, **`updateRecords`**, **`deleteRecords`**: Universal data access
- **`getDetails`**: Specialized record retrieval with relationship mapping
- **`getSchema`**: Dynamic schema discovery and validation
- **`listTools`**: Dynamic tool discovery and capability enumeration

**Benefits Achieved:**
*   **✅ Enhanced Problem Solving:** Agents can collaborate through shared threads, artifacts, and knowledge
*   **✅ Knowledge Sharing:** Vector-based memory system enables semantic knowledge discovery and sharing
*   **✅ Scalability:** Universal tools support horizontal scaling of agent networks
*   **✅ Context Awareness:** Comprehensive system state understanding for intelligent decision-making
*   **✅ Collaborative Work:** Thread and artifact management enable coordinated problem-solving
*   **✅ Knowledge Persistence:** Long-term memory storage with semantic search capabilities
*   **✅ Network Intelligence:** Collective learning through shared knowledge graphs and context snapshots

**Current Capabilities:**
- **Semantic Knowledge Management:** Vector embeddings enable natural language knowledge discovery
- **Collaborative Workspaces:** Thread-based organization with artifact management
- **System Intelligence:** Context-aware decision making with temporal awareness
- **Network Communication:** Structured messaging between agents
- **Universal Data Access:** Generic tools for any table or data structure
- **Knowledge Graph Building:** Linked memories create interconnected knowledge networks

## 5. Unify Artifacts and Messages into Posts System

**Status:** 📋 **PLANNED** - See detailed specification in `docs/planning/2025_08_06_refactor_spec_posts.md`

**Goal:** Merge `artifacts` and `messages` tables into a unified `posts` table with enhanced agent communication and inbox context awareness.

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

## 7. Database Schema Cleanup and Improvements

**Goal:** Clean up unused database columns, improve data integrity, and enhance the system's operational capabilities.

### 7.1 Remove Unused `dispatcher_processed_at` Columns

**Status:** ✅ **COMPLETED** - The unused columns have been successfully removed from both tables.

**Goal:** Remove the `dispatcher_processed_at` column from both `artifacts` and `threads` tables if it's not being used anywhere in the codebase.

**Background:**
The `dispatcher_processed_at` column existed on both tables but was confirmed to be unused:
- No references found in TypeScript code
- No references found in SQL migrations or triggers
- Only documented in `DATABASE_MAP.md` as "Trigger processing timestamp"
- All values were NULL in both tables (38 artifacts, 19 threads)

**Implementation Completed:**
1. **Verified Unused Status:** Confirmed the columns were truly unused by:
   - Checking all database triggers and functions (no references found)
   - Reviewing TypeScript codebase (no references found)
   - Analyzing current data (all values were NULL)

2. **Safe Removal Process:**
   ```sql
   -- Remove from artifacts table
   ALTER TABLE artifacts DROP COLUMN dispatcher_processed_at;
   
   -- Remove from threads table  
   ALTER TABLE threads DROP COLUMN dispatcher_processed_at;
   ```

**Benefits Achieved:**
*   **✅ Cleaner Schema:** Removed unused columns that were confusing developers
*   **✅ Reduced Storage:** Eliminated unnecessary data storage
*   **✅ Simplified Maintenance:** Fewer columns to maintain and document
*   **✅ Improved Clarity:** Database schema now accurately reflects actual usage

### 7.2 Include Job Definition in Agent Context

**Status:** ✅ **COMPLETED** - Job definition context has been successfully integrated into agent prompts.

**Goal:** Include job definition information in the agent's prompt context so that jobs know their identity and can properly source artifacts and communicate on the network.

**Implementation Summary:**
The job definition context has been successfully implemented in the worker system, providing agents with explicit knowledge of their identity and capabilities.

**Current Implementation:**

1. **Enhanced Job Context Integration:**
   ```typescript
   // Implemented in worker/worker.ts
   function buildPromptWithContext(job: JobBoard, promptContent: string, inputContext: string | null): string {
     // Add the job's identity to the top of the prompt
     let finalPrompt = `You are executing as job "${job.job_name}" (Definition ID: ${job.job_definition_id}).\n\n---\n\n${promptContent}`;
     
     if (inputContext) {
       // Parse and include additional context data
       // ... context processing logic
     }
     
     return finalPrompt;
   }
   ```

2. **Job Identity Awareness:**
   - Agents now receive their job name and definition ID at the start of every prompt
   - Clear identification format: `"You are executing as job "job_name" (Definition ID: job_definition_id)"`
   - Context is automatically injected before the main prompt content

3. **Enhanced Context Processing:**
   - Additional context data is parsed and formatted for agent consumption
   - Support for both JSON and plain text context formats
   - Structured context presentation in the prompt

**Benefits Achieved:**
*   **✅ Better Attribution:** Agents now have explicit knowledge of their job identity
*   **✅ Improved Communication:** Jobs can identify themselves in their responses and tool usage
*   **✅ Enhanced Context:** Agents have full awareness of their role and job definition
*   **✅ Clear Identity:** Standardized format for job identification across all executions
*   **✅ Context Integration:** Seamless integration of job context with additional input context

**Current Capabilities:**
- **Job Identity Injection:** Every agent execution includes job name and definition ID
- **Context Awareness:** Agents know which job definition they're executing
- **Enhanced Prompting:** Structured context presentation for better agent understanding
- **Identity Persistence:** Job identity maintained throughout the entire execution session


### 7.3 Improve Metacog Job Naming

**Status:** 📋 **PLANNED** - Design phase needed.

**Goal:** Improve the naming convention for metacognitive jobs to be more descriptive and consistent.

**Background:**
Current metacog jobs use names like `Metacog.GenesysMetacog` which are functional but not very descriptive. Better naming would improve:
- Code readability and maintenance
- Debugging and logging clarity
- System documentation

**Implementation Plan:**

1. **New Naming Convention:**
   ```typescript
   // Current: Metacog.GenesysMetacog
   // Proposed: metacog.system_analysis
   // or: metacog.performance_review
   // or: metacog.workflow_optimization
   ```

2. **Update Existing Jobs:**
   - Rename existing metacog job definitions
   - Update all references in code and documentation
   - Ensure backward compatibility during transition

3. **Naming Guidelines:**
   - Use lowercase with underscores
   - Include action/function in the name
   - Maintain consistency across all metacog jobs

**Benefits:**
*   **Better Readability:** More descriptive and intuitive names
*   **Improved Debugging:** Clearer identification in logs and reports
*   **Enhanced Documentation:** Self-documenting job names

### 7.4 Add on_new_job_definition and on_job_definition_update Trigger

**Status:** 📋 **PLANNED** - Design phase needed.

**Goal:** Implement a trigger that fires when new job definitions are created, enabling automatic setup of related resources and validation.

**Background:**
Currently, job definitions are created without automatic validation or setup. A trigger would enable:
- Automatic validation of job definition parameters
- Setup of default schedules or configurations
- Integration with other system components

**Implementation Plan:**

1. **Trigger Function:**
   ```sql
   CREATE OR REPLACE FUNCTION on_new_job_definition()
   RETURNS TRIGGER AS $$
   BEGIN
     -- Validate job definition parameters
     -- Set up default configurations
     -- Create related resources if needed
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```

2. **Trigger Registration:**
   ```sql
   CREATE TRIGGER trg_new_job_definition
   AFTER INSERT ON job_definitions
   FOR EACH ROW
   EXECUTE FUNCTION on_new_job_definition();
   ```

3. **Validation and Setup Logic:**
   - Validate prompt_ref exists in prompt_library
   - Check enabled_tools are available
   - Set up default model_settings if not provided
   - Create audit trail entries

**Benefits:**
*   **Data Integrity:** Automatic validation of new job definitions
*   **Consistency:** Standardized setup process
*   **Reduced Errors:** Catch configuration issues early

## 8. Use gemini.md (COMPLETED)

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
