# Database Architecture Map - Marketplace Project

## 📋 **Overview**
This document provides a comprehensive map of the database structure for the Intelligence Network marketplace project, including all tables, schemas, triggers, and functions.

## 🗂️ **Schemas**

### **Primary Schema**
- **`public`** - Main application schema containing all business logic tables

### **System Schemas**
- **`auth`** - Supabase authentication system
- **`storage`** - Supabase file storage system  
- **`realtime`** - Supabase real-time subscriptions
- **`extensions`** - PostgreSQL extensions
- **`vault`** - Supabase secrets management
- **`graphql`** - GraphQL API schema
- **`supabase_migrations`** - Migration history

---

## 📊 **Tables & Schemas**

### **Core Business Tables**

#### **`job_board`** - Unified Job Queue
**Purpose**: Central job queue for the Intelligence Network where workers claim and execute jobs.

**Columns**:
- `id` (UUID, PK) - Auto-generated job ID
- `status` (ENUM: PENDING, IN_PROGRESS, COMPLETED, FAILED) - Job execution status
- `worker_id` (TEXT) - ID of worker processing the job
- `created_at` (TIMESTAMPTZ) - Job creation time
- `updated_at` (TIMESTAMPTZ) - Last modification time
- `output` (TEXT) - Job execution results
- `in_progress_at` (TIMESTAMPTZ) - When job started processing
- `input_prompt` (TEXT, NOT NULL) - The prompt/instruction for the job
- `input_context` (TEXT) - Context data for job execution
- `job_definition_id` (UUID, FK) - References job_definitions table
- `enabled_tools` (TEXT[]) - Array of tools enabled for this job
- `model_settings` (JSONB) - LLM configuration parameters for this job
- `job_name` (TEXT) - Human-readable job name for identification
- `job_report_id` (UUID, FK) - References job_reports table for detailed execution reports

**Triggers**:
- `job_board_updated_at_trigger` - Auto-updates `updated_at` on modifications
- `on_job_board_status_update` - Handles job chaining and system state updates
- `set_job_in_progress_timestamp` - Sets `in_progress_at` when job starts

---

#### **`job_definitions`** - Job Templates
**Purpose**: Defines reusable job templates with prompts, tools, and configurations.

**Columns**:
- `id` (UUID, PK) - Job definition ID
- `name` (TEXT, UNIQUE, NOT NULL) - Job definition name
- `description` (TEXT) - Human-readable description
- `enabled_tools` (TEXT[]) - List of available tools for this job
- `model_settings` (JSONB) - LLM configuration parameters
- `response_schema` (JSONB) - Expected response structure
- `is_active` (BOOLEAN) - Whether this definition is active
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last modification timestamp
- `approved_agents` (JSONB) - List of agents allowed to execute
- `prompt_ref` (TEXT, NOT NULL) - Reference to prompt in format "name@version"

**Triggers**:
- `job_definitions_updated_at_trigger` - Auto-updates `updated_at`
- `job_definition_update_trigger` - Logs changes to history table
- `trigger_update_job_schedules_name` - Syncs name changes to schedules

---

#### **`job_schedules`** - Job Scheduling Rules
**Purpose**: Defines when and how jobs should be triggered based on system events.

**Columns**:
- `id` (UUID, PK) - Schedule ID
- `job_definition_id` (UUID, FK) - References job_definitions
- `trigger_filter` (JSONB) - Conditions for triggering
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last modification timestamp
- `last_run_at_processing_seconds` (FLOAT8) - Processing time threshold tracking
- `dispatch_trigger` (ENUM) - Trigger type (on_new_artifact, on_job_status_change, etc.)
- `trigger_context_key` (TEXT) - Key name for context propagation
- `dispatch_quota` (INT) - Maximum concurrent jobs (default: 5)
- `processed_at` (TIMESTAMPTZ) - For one-off schedules
- `job_name` (TEXT, NOT NULL) - Cached job name for performance

**Triggers**:
- `job_schedules_updated_at_trigger` - Auto-updates `updated_at`
- `job_schedule_update_trigger` - Logs changes to history
- `trg_one_off_processing` - Processes one-time schedules
- `trigger_set_job_schedules_name_on_insert` - Sets job_name on insert

---

#### **`prompt_library`** - Prompt Storage
**Purpose**: Centralized storage for versioned prompts used by job definitions.

**Columns**:
- `id` (UUID, PK) - Prompt ID
- `name` (TEXT, NOT NULL) - Prompt name
- `version` (INT, DEFAULT 1) - Version number
- `content` (TEXT, NOT NULL) - Prompt text
- `is_active` (BOOLEAN, DEFAULT true) - Whether prompt is active
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last modification timestamp

**Triggers**:
- `handle_updated_at` - Auto-updates `updated_at` on modifications

---

#### **`threads`** - Research & Execution Threads
**Purpose**: Organizes work into hierarchical research and execution threads.

**Columns**:
- `id` (UUID, PK) - Thread ID
- `parent_thread_id` (UUID, FK) - Self-reference for hierarchy
- `title` (TEXT, NOT NULL) - Thread title
- `objective` (TEXT) - Thread objective/goal
- `status` (TEXT, DEFAULT 'OPEN') - Thread status
- `summary` (JSONB) - Thread summary data
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last modification timestamp
- `dispatcher_processed_at` (TIMESTAMPTZ) - Trigger processing timestamp
- `created_by_job_id` (UUID, FK) - References job_board table (job that created this thread)

**Triggers**:
- `on_threads_update` - Auto-updates `updated_at`
- `on_new_thread_insert` - Dispatches jobs on thread creation
- `on_thread_update` - Dispatches jobs on thread updates

---

#### **`artifacts`** - Generated Content
**Purpose**: Stores artifacts generated or collected during thread execution.

**Columns**:
- `id` (UUID, PK) - Artifact ID
- `thread_id` (UUID, FK, NOT NULL) - References threads table
- `content` (TEXT, NOT NULL) - Artifact content
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `status` (TEXT, DEFAULT 'RAW') - Processing status
- `topic` (TEXT) - Artifact topic/category
- `dispatcher_processed_at` (TIMESTAMPTZ) - Trigger processing timestamp
- `source` (TEXT) - Source of the artifact
- `created_by_job_id` (UUID, FK) - References job_board table (job that created this artifact)
- `updated_at` (TIMESTAMPTZ) - Last modification timestamp

**Triggers**:
- `artifacts_touch_updated_at` - Auto-updates `updated_at`
- `on_artifact_status_update` - Dispatches jobs on status changes
- `on_new_artifact_insert` - Dispatches jobs on new artifacts

---

#### **`memories`** - Vector Memory Storage
**Purpose**: Vector-based memory storage for semantic search and retrieval.

**Columns**:
- `id` (UUID, PK) - Memory ID
- `content` (TEXT, NOT NULL) - Memory content
- `embedding` (VECTOR, NOT NULL) - Vector embedding for similarity search
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `last_accessed_at` (TIMESTAMPTZ) - Last access timestamp
- `metadata` (JSONB) - Additional metadata for classification

**Triggers**:
- `memory_delete_trigger` - Logs deletions to history table

---

#### **`messages`** - Inter-Agent Communication
**Purpose**: Messaging system for communication and coordination between agents.

**Columns**:
- `id` (UUID, PK) - Message ID
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `from_agent` (TEXT, NOT NULL) - Sending agent identifier
- `to_agent` (TEXT, NOT NULL) - Receiving agent identifier
- `content` (TEXT, NOT NULL) - Message content
- `metadata` (JSONB) - Additional message metadata
- `status` (TEXT, DEFAULT 'pending') - Message status

**Triggers**: None

---

#### **`system_state`** - Global System State
**Purpose**: Stores global key-value pairs for system-wide state and counters.

**Columns**:
- `key` (TEXT, PK) - State key name
- `value` (JSONB) - State value (flexible JSON structure)
- `updated_at` (TIMESTAMPTZ) - Last modification timestamp

**Triggers**:
- `system_state_updated_at_trigger` - Auto-updates `updated_at`
- `on_system_state_update` - Handles processing time threshold triggers

---

#### **`job_reports`** - Job Execution Reports
**Purpose**: Comprehensive execution reports for job debugging, analytics, and telemetry.

**Columns**:
- `id` (UUID, PK) - Report ID
- `job_id` (UUID, FK) - References job_board table
- `worker_id` (TEXT, NOT NULL) - ID of worker that executed the job
- `created_at` (TIMESTAMPTZ) - Report creation time
- `status` (TEXT, NOT NULL) - Execution status (COMPLETED, FAILED)
- `duration_ms` (INTEGER, NOT NULL) - Total execution time in milliseconds
- `total_tokens` (INTEGER, DEFAULT 0) - Total tokens consumed
- `request_text` (JSONB) - Complete conversation sent to Gemini API
- `response_text` (JSONB) - Full API response with all rounds
- `final_output` (TEXT) - Clean final answer returned to job_board
- `tools_called` (JSONB, DEFAULT '[]') - Array of tool calls with execution details
- `error_message` (TEXT) - Error message if job failed
- `error_type` (TEXT) - Error classification (API_ERROR, TOOL_ERROR, TIMEOUT, SYSTEM_ERROR)
- `raw_telemetry` (JSONB, DEFAULT '{}') - Additional telemetry data

**Indexes**:
- `idx_job_reports_job_id` - For job lookup
- `idx_job_reports_created_at` - For time-based queries
- `idx_job_reports_status` - For status filtering
- `idx_job_reports_worker_id` - For worker analysis
- `idx_job_reports_duration` - For performance analysis
- `idx_job_reports_error_type` - For error analysis (failed jobs only)

---

### **History Tables**

#### **`job_definitions_history`** - Job Definition Audit Trail
**Purpose**: Archives changes to job definitions for audit purposes.

**Columns**: Archives all fields from job_definitions plus:
- `id` (UUID, PK) - History record ID
- `task_id` (UUID) - Original job definition ID
- `archived_at` (TIMESTAMPTZ) - When record was archived
- `job_type` (TEXT) - Legacy field (nullable)
- `prompt_config` (JSONB) - Legacy field (nullable)
- `prompt_source` (JSONB) - Source information

---

#### **`job_schedules_history`** - Schedule Change Audit Trail
**Purpose**: Archives changes to job schedules.

**Columns**: Archives all fields from job_schedules plus:
- `id` (UUID, PK) - History record ID
- `schedule_id` (UUID) - Original schedule ID
- `archived_at` (TIMESTAMPTZ) - When record was archived

---

#### **`memories_history`** - Memory Deletion Archive
**Purpose**: Archives deleted memories for recovery purposes.

**Columns**: All fields from memories plus:
- `deleted_at` (TIMESTAMPTZ) - When memory was deleted

---

#### **`system_state_history`** - System State Change Log
**Purpose**: Logs changes to system state for debugging and analysis.

**Columns**:
- `id` (UUID, PK) - History record ID
- `state_key` (TEXT) - The system state key that changed
- `old_value` (TEXT) - Previous value before change
- `rationale_for_change` (TEXT) - Reason for the change
- `created_at` (TIMESTAMPTZ) - When change occurred

---

## ⚙️ **Functions**

### **CRUD Functions**
- **`create_record(table_name, data)`** - Generic record creation
- **`read_records(table_name, filter)`** - Generic record retrieval
- **`update_records(table_name, filter, updates)`** - Generic record updates
- **`delete_records(table_name, filter)`** - Generic record deletion
- **`get_all_tables()`** - Returns list of allowed tables
- **`get_table_schema(table_name)`** - Returns table column information

### **Job Management Functions**
- **`create_job_from_schedule(schedule_record, context_id, additional_context)`** - Creates jobs from schedules
- **`universal_job_dispatcher()`** - Triggers job creation based on table events
- **`handle_job_board_status_change()`** - Handles job chaining and system state updates
- **`process_one_off_triggers()`** - Processes one-time scheduled jobs

### **System Functions**
- **`handle_system_state_update()`** - Processes system state changes and thresholds
- **`update_updated_at_column()`** - Generic timestamp update function
- **`handle_updated_at()`** - Thread-specific timestamp update
- **`touch_artifacts_updated_at()`** - Artifact-specific timestamp update

### **Utility Functions**
- **`jsonb_matches_conditions(data, conditions)`** - Checks if JSONB matches conditions
- **`set_in_progress_timestamp()`** - Sets job processing start time
- **`log_job_definition_update()`** - Logs job definition changes
- **`log_job_schedule_update()`** - Logs schedule changes
- **`log_memory_deletion()`** - Logs memory deletions

### **Vector Functions** (pgvector extension)
- Distance functions: `cosine_distance`, `l1_distance`, `l2_distance`
- Vector operations: `vector_add`, `vector_sub`, `vector_mul`
- Normalization: `l2_normalize`, `vector_norm`
- Type conversions: `array_to_vector`, `vector_to_halfvec`

---

## 🔗 **Relationships**

### **Primary Relationships**
- `job_schedules.job_definition_id` → `job_definitions.id`
- `job_board.job_definition_id` → `job_definitions.id`
- `job_board.job_report_id` → `job_reports.id`
- `job_reports.job_id` → `job_board.id`
- `artifacts.thread_id` → `threads.id`
- `artifacts.created_by_job_id` → `job_board.id`
- `threads.parent_thread_id` → `threads.id` (self-reference)
- `threads.created_by_job_id` → `job_board.id`

### **Referential Integrity**
- All foreign key relationships are enforced
- Cascade deletes are configured where appropriate
- History tables maintain referential links via archived IDs

---

## 🎯 **Trigger Architecture**

### **Event-Driven Job Dispatch**
The system uses a sophisticated trigger architecture for automatic job dispatching:

1. **Universal Dispatcher**: `universal_job_dispatcher()` handles:
   - New artifact creation → `on_new_artifact`
   - Thread creation → `on_new_research_thread`
   - Artifact updates → `on_artifact_status_change`
   - Thread updates → `on_research_thread_update`

2. **Job Status Triggers**: `handle_job_board_status_change()` handles:
   - Job chaining based on completion
   - Processing time accumulation
   - Idle loop detection and metacognitive job triggering

3. **System State Triggers**: `handle_system_state_update()` handles:
   - Processing time threshold monitoring
   - Automatic schedule triggering based on cumulative metrics

### **Timestamp Automation**
- All tables with `updated_at` columns have automatic timestamp triggers
- Specialized triggers for `in_progress_at` on job status changes
- Wall-clock time vs transaction time handling for accurate metrics

### **Audit Trail Automation**
- Automatic history logging for critical table changes
- Soft delete pattern for memories with history preservation
- Change rationale tracking for system state modifications

---

## 🔧 **Configuration**

### **Allowed Tables**
The CRUD functions restrict access to these tables:
- `artifacts`, `job_board`, `job_definitions`, `job_schedules`, `job_reports`
- `memories`, `messages`, `prompt_library`, `threads`, `system_state`

### **Dispatch Trigger Types**
- `on_new_artifact` - New artifact created
- `on_artifact_status_change` - Artifact status updated
- `on_job_status_change` - Job status updated
- `one-off` - Single execution
- `on_new_research_thread` - New thread created
- `on_research_thread_update` - Thread updated
- `on_processing_time_update` - Processing time threshold crossed

### **Job Status Enums**
- `PENDING` - Job ready for processing
- `IN_PROGRESS` - Job being executed
- `COMPLETED` - Job finished successfully
- `FAILED` - Job execution failed

---

## 📈 **Performance Considerations**

### **Indexing**
- Primary keys (UUIDs) on all tables
- Foreign key indexes for relationships
- Vector indexes (HNSW, IVFFlat) for embedding searches

### **Partitioning**
- History tables can be partitioned by date for performance
- Large tables like `job_board` benefit from status-based indexing

### **Caching**
- `job_name` denormalized in `job_schedules` for performance
- Prompt content resolved at job creation time (not runtime)

---

*Last Updated: 2025-01-31*
*Database Version: PostgreSQL 15.8 with pgvector extension*