# Jinn Protocol Requirements

This directory contains the formal requirements for the Jinn protocol, structured as verifiable assertions following the [Blueprint Style Guide](../style-guide.md).

## Requirements Documents

### [Architecture](./architecture.md)
Core architecture and data flow requirements. Defines the six-layer system architecture, event-driven on-chain loop, component separation, and data flow patterns.

**Key Requirements:**
- ARQ-001: Event-Driven On-Chain Loop
- ARQ-002: Six-Layer System Architecture  
- ARQ-003: Single Active Worker Process
- ARQ-005: Control API as Write Gateway
- ARQ-006: Multi-Modal Data Persistence

### [Lifecycle](./lifecycle.md)
Job lifecycle and work protocol requirements. Covers job states, status transitions, hierarchy, delegation, and completion criteria.

**Key Requirements:**
- LCQ-001: Five Job States
- LCQ-002: Terminal vs Non-Terminal States
- LCQ-003: processOnce() as Atomic Unit
- LCQ-004: Job Hierarchy via Source Fields
- LCQ-005: Automatic Parent Re-Dispatch

### [Execution](./execution.md)
Agent execution and tooling requirements. Defines agent operating system, tool architecture, isolation, and telemetry collection.

**Key Requirements:**
- EXQ-001: Agent Operating System Specification
- EXQ-002: Non-Interactive Execution Mode
- EXQ-003: Loop Protection
- EXQ-005: Tool-Based Environment Interaction
- EXQ-006: Tool Enablement Control

### [Memory](./memory.md)
Learning and memory system requirements. Covers SITUATION artifacts, MEMORY artifacts, semantic search, and observability.

**Key Requirements:**
- MEM-001: Dual-Path Learning System
- MEM-002: SITUATION Artifact Structure
- MEM-005: Recognition Phase Execution
- MEM-006: Reflection Phase Execution
- MEM-009: Situation Indexing by Ponder

### [Persistence](./persistence.md)
Data persistence and IPFS requirements. Defines storage layers, content addressing, lineage, and cleanup strategies.

**Key Requirements:**
- PER-001: Four-Layer Storage Architecture
- PER-002: On-Chain as Source of Truth
- PER-003: IPFS Content Addressing
- PER-004: Lineage Preservation
- PER-005: IPFS Delivery Architecture

### [Identity](./identity.md)
OLAS integration and on-chain identity requirements. Covers Gnosis Safe setup, service lifecycle, mech deployment, and safety procedures.

**Key Requirements:**
- IDQ-001: Gnosis Safe as Worker Identity
- IDQ-002: Two-Keystore Architecture
- IDQ-003: Service Bootstrap Hierarchy
- IDQ-005: Testing on Tenderly Virtual TestNets
- IDQ-007: Address Resolution via Operate Profile

### [Observability](./observability.md)
System observability requirements. Defines three levels of observability (human, programmatic, agentic), telemetry, logging, and error reporting.

**Key Requirements:**
- OBS-001: Three Levels of Observability
- OBS-002: Structured Telemetry
- OBS-003: Worker Telemetry
- OBS-005: Request Detail Pages
- OBS-006: CLI Inspection Scripts

## About This Document Set

Each document follows a consistent structure where requirements are expressed as:

1. **Assertion** - A clear, verifiable statement
2. **Examples** - Concrete do/don't guidance (in table format)
3. **Commentary** - Context and rationale

This structure ensures requirements are:
- **Actionable**: Can be implemented directly
- **Testable**: Can be validated through code inspection or tests
- **Traceable**: Can be linked to specific implementation files

## Navigation

- [← Back to Blueprint](../index.md)
- [Style Guide](../style-guide.md) - Assertion format specification
- [Protocol Model](../../documentation/protocol-model.md) - Detailed protocol description

## Requirement Numbering

Requirements use a three-letter prefix indicating their domain:
- **ARQ**: Architecture Requirements
- **LCQ**: Lifecycle Requirements
- **EXQ**: Execution Requirements
- **MEM**: Memory Requirements
- **PER**: Persistence Requirements
- **IDQ**: Identity Requirements
- **OBS**: Observability Requirements

Each requirement has a unique ID (e.g., ARQ-001) for cross-referencing.
