# Work Decomposition Architecture

## System Overview

The work decomposition system enables agents to break complex goals into manageable tasks, execute them with full context continuity, and recompose results. This creates a powerful framework for autonomous task orchestration.

```mermaid
graph TB
    subgraph "High-Level Goal"
        Goal["`**Complex Objective**
        'Become top creator on Zora'`"]
    end
    
    subgraph "Decomposition Decision"
        Decision{"`Agent Decision:
        Execute directly or
        decompose?`"}
    end
    
    subgraph "Direct Execution"
        DirectExec["`**Single Job**
        Execute with tools`"]
    end
    
    subgraph "Decomposition Flow"
        Parent["`**Parent Job**
        Orchestrator`"]
        
        subgraph "Child Jobs"
            Child1["`**Job 1**
            Create Content`"]
            Child2["`**Job 2** 
            Analyze Trends`"]
            Child3["`**Job 3**
            Engage Community`"]
        end
        
        subgraph "Context Flow"
            TriggerCtx["`**Trigger Context**
            Parent → Child`"]
            DelegatedCtx["`**Delegated Context**
            Child → Parent`"]
        end
    end
    
    subgraph "Recomposition"
        Review["`**Review & Synthesis**
        Analyze child outputs`"]
        NextSteps["`**Next Steps**
        Iterate or conclude`"]
    end
    
    Goal --> Decision
    Decision -->|Simple Task| DirectExec
    Decision -->|Complex Task| Parent
    
    Parent --> Child1
    Parent --> Child2  
    Parent --> Child3
    
    Parent -.->|Context| TriggerCtx
    TriggerCtx -.-> Child1
    TriggerCtx -.-> Child2
    TriggerCtx -.-> Child3
    
    Child1 -.->|Results| DelegatedCtx
    Child2 -.->|Results| DelegatedCtx
    Child3 -.->|Results| DelegatedCtx
    DelegatedCtx -.-> Parent
    
    Parent --> Review
    Review --> NextSteps
    NextSteps -.->|If needed| Parent
```

## Event-Driven Orchestration

The system operates through an event-driven architecture where job completion triggers subsequent work:

```mermaid
sequenceDiagram
    participant Agent as Agent
    participant Events as Event Bus
    participant Dispatcher as Job Dispatcher
    participant JobBoard as Job Board
    participant Worker as Worker
    
    Agent->>Events: create_job_batch(serial)
    Events->>Dispatcher: INSERT event triggers
    Dispatcher->>JobBoard: Create PENDING jobs with context
    
    loop Job Execution Cycle
        Worker->>JobBoard: Claim PENDING job
        Worker->>Agent: Execute with rich context
        Agent-->>Worker: Complete with output
        Worker->>Events: job.completed event
        Events->>Dispatcher: Trigger next job in sequence
        Dispatcher->>JobBoard: Create next PENDING job
    end
    
    Worker->>JobBoard: Final job completion
    JobBoard-->>Agent: Delegated work context available
```

## Context Construction and Flow

The system maintains rich context across job boundaries:

```mermaid
graph LR
    subgraph "Context Types"
        TC["`**Trigger Context**
        • Event details
        • Parent job info
        • Source artifacts`"]
        
        DWC["`**Delegated Work Context**
        • Child job summaries
        • Outputs & artifacts
        • Token-safe truncation`"]
        
        RRC["`**Recent Runs Context**
        • Historical executions
        • Timing patterns
        • Success metrics`"]
    end
    
    subgraph "Job Execution"
        Job["`**Current Job**
        With full context`"]
    end
    
    subgraph "Tools Available"
        CreateJob["`create_job`"]
        CreateBatch["`create_job_batch`"]
        UpdateJob["`update_job`"]
        SendMsg["`send_message`"]
    end
    
    TC --> Job
    DWC --> Job
    RRC --> Job
    
    Job --> CreateJob
    Job --> CreateBatch
    Job --> UpdateJob
    Job --> SendMsg
    
    CreateJob -.->|Creates| TC
    CreateBatch -.->|Creates| TC
    SendMsg -.->|Provides| DWC
```

## Database Architecture

The work decomposition system relies on several key database components:

```mermaid
erDiagram
    events ||--o{ job_board : triggers
    jobs ||--o{ job_board : defines
    job_board ||--|| job_reports : generates
    job_board }o--|| artifacts : references
    job_board }o--|| messages : receives
    
    events {
        uuid id PK
        text event_type
        jsonb payload
        timestamp created_at
        uuid source_table_id
    }
    
    jobs {
        uuid id PK
        text job_id
        int version
        text name
        text prompt_content
        text[] enabled_tools
        jsonb schedule_config
        boolean is_active
        uuid parent_job_definition_id FK
    }
    
    job_board {
        uuid id PK
        text status
        text job_name
        uuid source_event_id FK
        uuid project_run_id
        jsonb trigger_context
        jsonb delegated_work_context
        jsonb recent_runs_context
        uuid job_definition_id FK
        uuid parent_job_definition_id FK
    }
    
    job_reports {
        uuid id PK
        uuid job_board_id FK
        text final_output
        jsonb telemetry
        timestamp completed_at
    }
    
    artifacts {
        uuid id PK
        text topic
        jsonb content
        uuid job_board_id FK
        uuid project_run_id FK
    }
    
    messages {
        uuid id PK
        text content
        uuid target_job_definition_id FK
        uuid source_job_board_id FK
    }
```

## Decomposition Patterns

### Serial Pipeline
```mermaid
graph LR
    A["`**Data Collection**
    Gather information`"] --> B["`**Analysis**
    Process data`"]
    B --> C["`**Report Generation**
    Synthesize findings`"]
    
    A -.->|artifact_id| B
    B -.->|analysis_id| C
```

### Parallel Fan-out
```mermaid
graph TB
    Parent["`**Strategy Orchestrator**
    Explore multiple approaches`"]
    
    Parent --> Child1["`**Strategy A**
    Content creation`"]
    Parent --> Child2["`**Strategy B**
    Community building`"]
    Parent --> Child3["`**Strategy C**
    Trend analysis`"]
    
    Child1 --> Synthesis["`**Synthesis Job**
    Compare results`"]
    Child2 --> Synthesis
    Child3 --> Synthesis
```

### Iterative Evolution
```mermaid
graph TB
    V1["`**Job v1**
    Initial approach`"] --> Execute1["`Execute & Monitor`"]
    Execute1 --> Review1["`Review Results`"]
    Review1 --> Update1{"`Performance OK?`"}
    
    Update1 -->|No| V2["`**Job v2**
    Updated approach`"]
    Update1 -->|Yes| Success["`Continue Execution`"]
    
    V2 --> Execute2["`Execute & Monitor`"]
    Execute2 --> Review2["`Review Results`"]
    Review2 --> Update2{"`Performance OK?`"}
    
    Update2 -->|No| V3["`**Job v3**
    Further refinement`"]
    Update2 -->|Yes| Success
```

This architecture enables autonomous agents to tackle complex, long-term objectives by intelligently decomposing work while maintaining full context and traceability throughout the execution process.
