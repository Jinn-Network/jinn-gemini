# Blueprint Style Guide

**Version**: 1.0  
**Last Updated**: 2025-11-14

## Purpose

Blueprints define **what** must be true about the system state after job completion - not **how** to achieve it. They specify acceptance criteria, constraints, and quality standards that the system must satisfy.

## Core Principles

### 1. Declarative Over Imperative

**GOOD** - Specifies desired outcome:
```json
{
  "id": "DATA-001",
  "assertion": "Analysis must include real-time protocol TVL data from authoritative sources with timestamps",
  "examples": {
    "do": [
      "Report TVL with source attribution: 'Uniswap V3 TVL: $2.1B (DeFi Llama, 2024-11-14 16:30 UTC)'",
      "Cross-reference data across multiple sources for validation"
    ],
    "dont": [
      "Report TVL without timestamp or source",
      "Use data older than 24 hours without justification"
    ]
  },
  "commentary": "Real-time accuracy requires transparent data provenance and recency validation."
}
```

**BAD** - Prescribes implementation steps:
```json
{
  "assertion": "Agent must call web_search with 'DeFi Llama TVL' then parse the results",
  "examples": {
    "do": ["Use web_search tool", "Parse JSON response"],
    "dont": ["Skip tool usage"]
  }
}
```

### 2. Outcome-Focused Over Process-Focused

Blueprints define success criteria, not execution paths.

**GOOD**:
- "Deliverable must provide 3 actionable trade ideas with entry/exit parameters"
- "Code changes must pass all existing tests"
- "API response time must be under 200ms"

**BAD**:
- "Agent should first research, then write, then review"
- "Use dispatch_new_job to delegate subtasks"
- "Break work into phases"

### 3. Constraints Over Commands

State what boundaries exist, not what actions to take.

**GOOD**:
- "Analysis must focus on protocols with >$100M TVL"
- "Code must maintain backward compatibility"
- "Changes must not modify the public API"

**BAD**:
- "Only analyze large protocols"
- "Don't break the API"
- "Keep it compatible"

## Blueprint Structure

### Required Fields

Every assertion must contain:

```json
{
  "id": "CATEGORY-NNN",
  "assertion": "Brief declarative statement",
  "examples": {
    "do": ["Positive example 1", "Positive example 2"],
    "dont": ["Negative example 1", "Negative example 2"]
  },
  "commentary": "Explanation of rationale and implications"
}
```

### Assertion ID Conventions

Use semantic prefixes:
- `DATA-xxx`: Data sourcing, quality, provenance
- `ANALYSIS-xxx`: Analytical methodology, rigor
- `OUTPUT-xxx`: Deliverable format, content
- `SCOPE-xxx`: Boundaries, focus areas
- `QUALITY-xxx`: Standards, validation criteria
- `CONSTRAINT-xxx`: Technical or business constraints

## Anti-Patterns

### ❌ Prescribing Tools

**BAD**:
```json
{
  "assertion": "Must use web_search and create_artifact tools"
}
```

**GOOD**:
```json
{
  "assertion": "Research must cite authoritative external sources with timestamps",
  "commentary": "System will determine optimal information gathering approach."
}
```

### ❌ Dictating Architecture

**BAD**:
```json
{
  "assertion": "Create separate jobs for data gathering, analysis, and synthesis"
}
```

**GOOD**:
```json
{
  "assertion": "Analysis must synthesize data from multiple distinct information sources",
  "commentary": "System will determine optimal decomposition strategy."
}
```

### ❌ Specifying Sequence

**BAD**:
```json
{
  "assertion": "First validate inputs, then process data, finally generate output"
}
```

**GOOD**:
```json
{
  "assertion": "Output must be derived from validated, processed input data",
  "commentary": "System ensures logical dependency order."
}
```

### ❌ Implementation Details

**BAD**:
```json
{
  "assertion": "Use RegEx pattern ^[A-Z]{3}$ to validate currency codes"
}
```

**GOOD**:
```json
{
  "assertion": "Currency codes must conform to ISO 4217 three-letter standard",
  "examples": {
    "do": ["USD", "EUR", "GBP"],
    "dont": ["us", "dollar", "US$"]
  }
}
```

## System Autonomy

The execution system (agent, worker, orchestrator) has **full autonomy** to determine:

- Which tools to use
- How to decompose work
- Whether to delegate subtasks
- Execution order and parallelization
- Resource allocation
- Error recovery strategies

Blueprints constrain **what is acceptable**, not **how to get there**.

## Job Homomorphism

All jobs execute with identical logic regardless of their position in the hierarchy. Root jobs (with no parent) and child jobs (with a parent) follow the same Work Protocol, use the same tools, and have status determined the same way.

**Implications for Blueprints:**

- Do not write assertions that assume special "root job" behaviors
- Do not prescribe different execution paths based on hierarchy position
- Specialization comes from blueprint content variation, not hierarchy-based conditionals

Any behavioral differences between jobs must be encoded in blueprint assertions, not in the execution system itself.

## Quality Examples

### Research Job Blueprint

```json
{
  "assertions": [
    {
      "id": "DATA-001",
      "assertion": "Research must use authoritative sources with timestamps within the specified time window",
      "examples": {
        "do": [
          "DeFi Llama protocol metrics (timestamp: 2024-11-14 15:00 UTC)",
          "Dune Analytics dashboard data (updated: 2 hours ago)"
        ],
        "dont": [
          "Generic web searches without source attribution",
          "Data without timestamps or provenance"
        ]
      },
      "commentary": "Credibility depends on verifiable, recent data sources."
    },
    {
      "id": "ANALYSIS-001",
      "assertion": "Findings must be quantified relative to historical baselines",
      "examples": {
        "do": [
          "Volume is 2.3x the 7-day average",
          "TVL decreased 15% vs. previous 24h"
        ],
        "dont": [
          "Volume was high",
          "TVL dropped significantly"
        ]
      },
      "commentary": "Statistical context prevents spurious signal detection."
    }
  ]
}
```

### Code Modification Blueprint

```json
{
  "assertions": [
    {
      "id": "QUALITY-001",
      "assertion": "All existing tests must pass after changes",
      "examples": {
        "do": ["Run full test suite and verify zero failures"],
        "dont": ["Skip tests", "Disable failing tests"]
      },
      "commentary": "Regression prevention is non-negotiable."
    },
    {
      "id": "CONSTRAINT-001",
      "assertion": "Public API surface must remain unchanged",
      "examples": {
        "do": ["Add new methods", "Modify private internals"],
        "dont": ["Remove public methods", "Change method signatures"]
      },
      "commentary": "API stability ensures downstream compatibility."
    }
  ]
}
```

## Recognition Learnings vs. Blueprints

**Blueprints** define job requirements (what must be satisfied).

**Recognition learnings** provide execution strategies (how similar jobs succeeded/failed).

The agent synthesizes both:
1. Blueprint defines success criteria
2. Recognition suggests proven approaches
3. Agent decides final execution plan

If recognition learnings conflict with blueprint requirements, **blueprint always wins**.

## Validation

Before finalizing a blueprint, verify:

- [ ] No imperative verbs (use, call, execute, run, dispatch)
- [ ] No tool names (web_search, create_artifact, dispatch_new_job)
- [ ] No architectural prescriptions (decompose, delegate, parallelize)
- [ ] All assertions are testable/verifiable
- [ ] Examples are concrete and specific
- [ ] Commentary explains "why", not "how"

## Summary

**Blueprint Purpose**: Define the target state, not the path.

**System Responsibility**: Determine optimal execution strategy.

**Golden Rule**: If you're telling the agent what to do, you're writing it wrong. Tell it what must be true instead.
