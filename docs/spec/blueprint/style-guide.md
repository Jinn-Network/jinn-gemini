# Blueprint Style Guide

**Version**: 3.0  
**Last Updated**: 2025-12-17

## Purpose

Blueprints define **what** must be true about the system state after job completion - not **how** to achieve it. They specify acceptance criteria, constraints, and quality standards using **invariants** - conditions that must hold true.

## Core Principles

### 1. Declarative Over Imperative

**GOOD** - Specifies desired outcome:
```json
{
  "id": "GOAL-001",
  "form": "constraint",
  "description": "Analysis must include real-time protocol TVL data from authoritative sources with timestamps",
  "examples": {
    "do": ["Report TVL with source attribution: 'Uniswap V3 TVL: $2.1B (DeFi Llama, 2024-11-14 16:30 UTC)'"],
    "dont": ["Report TVL without timestamp or source"]
  },
  "commentary": "Real-time accuracy requires transparent data provenance and recency validation."
}
```

**BAD** - Prescribes implementation steps:
```json
{
  "description": "Agent must call web_search with 'DeFi Llama TVL' then parse the results"
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

### 4. Quantified Over Vague

Replace ambiguous terms with specific, measurable requirements.

**GOOD**:
- "Analysis must cite minimum 3 distinct sources with inline URLs per quantitative claim"
- "Metrics must include 7-day average comparison and percentile ranking for outliers"
- "Coverage must span minimum 3 protocols with per-protocol metrics"

**BAD**:
- "Analysis must cite multiple sources"
- "Metrics should provide context"
- "Cover major protocols"

## Blueprint Structure

### Required Fields

Every invariant must contain:

```json
{
  "id": "GOAL-NNN",
  "form": "constraint",
  "description": "Brief declarative statement",
  "examples": {
    "do": ["One specific positive example"],
    "dont": ["One specific negative example"]
  },
  "commentary": "Explanation of rationale and implications"
}
```

### Invariant Forms

- `boolean` – True/false conditions
- `threshold` – Minimum value requirements  
- `constraint` – Boundaries and limits
- `directive` – Guidance without hard verification
- `sequence` – Ordered steps or phases
- `range` – Value within bounds

### Invariant ID Conventions

Use `GOAL-NNN` format for venture blueprints. System invariants use domain prefixes (SYS, LEARN, COORD, etc.).

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
  "invariants": [
    {
      "id": "GOAL-001",
      "form": "constraint",
      "description": "Research must use authoritative sources with timestamps within the specified time window",
      "examples": {
        "do": ["DeFi Llama protocol metrics (timestamp: 2024-11-14 15:00 UTC)"],
        "dont": ["Generic web searches without source attribution"]
      },
      "commentary": "Credibility depends on verifiable, recent data sources."
    },
    {
      "id": "GOAL-002",
      "form": "constraint",
      "description": "Findings must be quantified relative to historical baselines",
      "examples": {
        "do": ["Volume is 2.3x the 7-day average"],
        "dont": ["Volume was high"]
      },
      "commentary": "Statistical context prevents spurious signal detection."
    }
  ]
}
```

### Code Modification Blueprint

```json
{
  "invariants": [
    {
      "id": "GOAL-001",
      "form": "boolean",
      "description": "All existing tests must pass after changes",
      "examples": {
        "do": ["Run full test suite and verify zero failures"],
        "dont": ["Disable failing tests"]
      },
      "commentary": "Regression prevention is non-negotiable."
    },
    {
      "id": "GOAL-002",
      "form": "constraint",
      "description": "Public API surface must remain unchanged",
      "examples": {
        "do": ["Add new methods; modify private internals"],
        "dont": ["Remove public methods; change method signatures"]
      },
      "commentary": "API stability ensures downstream compatibility."
    }
  ]
}
```

## Recognition Learnings vs. Blueprints

**Blueprints** define job requirements (what invariants must hold).

**Recognition learnings** provide execution strategies (how similar jobs succeeded/failed).

The agent synthesizes both:
1. Blueprint defines success criteria via invariants
2. Recognition suggests proven approaches
3. Agent decides final execution plan

If recognition learnings conflict with blueprint invariants, **blueprint always wins**.

## Enforcement Patterns

### Multi-Source Validation

For research and analysis jobs, enforce rigorous data validation:

```json
{
  "id": "RIGOR-001",
  "assertion": "Every quantitative claim must cite minimum 3 distinct independent sources with explicit URLs inline",
  "examples": {
    "do": [
      "Uniswap 24h volume: $378M (defillama.com/protocol/uniswap), $379M (coingecko.com/en/exchanges/uniswap), $381M (dune.com/uniswap/volume)",
      "Flag discrepancies >5%: 'Source A $414M (url1) vs Source B $378M (url2) = 9.5% variance'"
    ],
    "dont": [
      "Cite fewer than 3 sources per claim",
      "List sources generically at document end",
      "Omit URLs or provide only source names"
    ]
  },
  "commentary": "Multi-source validation prevents data errors. Each claim needs minimum 3 distinct sources with inline URLs, not generic footer."
}
```

### Statistical Context Requirements

Prevent shallow analysis by mandating historical comparison:

```json
{
  "id": "ANALYSIS-001",
  "assertion": "All metrics must include 7-day average comparison and percentile ranking for outliers",
  "examples": {
    "do": [
      "Volume $378M is 1.8x the 7-day average of $210M",
      "Liquidations $31.6M at 92nd percentile (7-day range: $12M-$35M)"
    ],
    "dont": [
      "Report absolute numbers without historical context",
      "Use subjective terms like 'high volume' without quantification against averages"
    ]
  },
  "commentary": "Statistical rigor requires historical baselines. Every metric needs 7-day average comparison minimum. Percentiles identify truly unusual activity."
}
```

### Coverage Requirements

Specify minimum item counts to prevent narrow scope:

```json
{
  "id": "SCOPE-001",
  "assertion": "Analysis must cover minimum 3 protocols with >$100M TVL, providing per-protocol metrics for each",
  "examples": {
    "do": [
      "Uniswap: $6.2B TVL, $378M 24h volume. Aave: $12.1B TVL, $89M borrowed. Lido: $33.4B TVL, 15K ETH staked",
      "Focus on protocols with >$100M TVL threshold verified"
    ],
    "dont": [
      "Analyze fewer than 3 protocols",
      "Provide aggregate data without protocol-specific breakdowns"
    ]
  },
  "commentary": "Minimum 3 protocols ensures comparative analysis and reduces single-protocol bias. Each protocol needs specific metrics, not aggregates."
}
```

### Explicit Ranking Requirements

For outputs with multiple items, mandate explicit prioritization:

```json
{
  "id": "OUTPUT-001",
  "assertion": "Deliverable must provide 3 items ranked by explicit conviction level (High/Medium/Low), with each citing minimum 3 distinct sources with URLs",
  "examples": {
    "do": [
      "Trade 1 (High Conviction): Long ETH. Supports: Metric A $X (url1), Metric B $Y (url2), Metric C $Z (url3)",
      "Trade 2 (Medium Conviction): Short UNI. Supports: Metric D $W (url4), Metric E $V (url5), Metric F $U (url6)"
    ],
    "dont": [
      "Present items without conviction ranking",
      "Cite fewer than 3 sources per item",
      "List all items with same conviction level"
    ]
  },
  "commentary": "Explicit ranking forces prioritization. Each item needs minimum 3 distinct sources with inline URLs to support conviction level."
}
```

### Mandatory Verification Assertion

For blueprints with 3+ assertions, add verification enforcement:

```json
{
  "id": "VERIFICATION-001",
  "assertion": "Before finalizing work, explicitly enumerate each assertion ID and confirm satisfaction status with supporting evidence",
  "examples": {
    "do": [
      "Verification checklist: '✓ DATA-001: SATISFIED - cited 4 sources with timestamps. ✗ SCOPE-001: UNSATISFIED - only 2 protocols, need 1 more'",
      "Include evidence per assertion: 'ANALYSIS-001: SATISFIED - Volume quantified as 1.8x 7-day average, liquidations at 92nd percentile'",
      "Document gap and action: 'OUTPUT-001: UNSATISFIED - only 2 sources per trade. Dispatching child job for additional source validation'"
    ],
    "dont": [
      "Finalize without assertion-by-assertion review",
      "Claim completion when any assertion unsatisfied",
      "Skip verification for multi-assertion blueprints"
    ]
  },
  "commentary": "Verification enforcement prevents premature finalization. Agent must explicitly confirm EVERY assertion satisfied before marking COMPLETED. System enforces two-phase execution for 3+ assertion blueprints."
}
```

## Common Quantification Patterns

### Vague → Quantified Translation

| Vague Term | Quantified Requirement |
|------------|------------------------|
| "multiple sources" | "minimum 3 distinct sources with inline URLs" |
| "major protocols" | "minimum 3 protocols with >$100M TVL" |
| "statistical analysis" | "7-day average comparison and percentile ranking" |
| "cite sources" | "cite 3+ specific metrics with URLs: 'Value $X (domain.com/path)'" |
| "rank ideas" | "explicit conviction levels (High/Medium/Low)" |
| "provide context" | "quantify as multiple of 7-day average" |
| "flag outliers" | "report percentile ranking (e.g., 92nd percentile)" |

### Attribution Patterns

**❌ Generic Footer:**
```
Analysis shows protocol growth.

Sources: DeFi Llama, CoinGecko, Dune Analytics
```

**✅ Inline Attribution:**
```
Uniswap 24h volume increased to $378M (defillama.com/protocol/uniswap), 
confirmed by $379M on CoinGecko (coingecko.com/en/exchanges/uniswap) 
and $381M on Dune (dune.com/uniswap/volume) - average $379.3M across 3 sources.
```

### Statistical Context Patterns

**❌ Absolute Numbers:**
```
Volume: $378M
Liquidations: $31.6M
```

**✅ Historical Context:**
```
Volume: $378M (1.8x the 7-day average of $210M, indicating accumulation phase)
Liquidations: $31.6M (92nd percentile, 7-day range $12M-$35M, suggests elevated volatility)
```

## Validation Checklist

Before finalizing a blueprint, verify:

### Style Compliance
- [ ] No imperative verbs (use, call, execute, run, dispatch)
- [ ] No tool names (web_search, create_artifact, dispatch_new_job)
- [ ] No architectural prescriptions (decompose, delegate, parallelize)
- [ ] All assertions are testable/verifiable
- [ ] Examples are concrete and specific
- [ ] Commentary explains "why", not "how"

### Quantification Requirements
- [ ] All vague terms replaced with specific numbers
- [ ] Source requirements specify minimum count (e.g., "minimum 3 distinct sources")
- [ ] Coverage requirements specify minimum items (e.g., "minimum 3 protocols")
- [ ] Attribution requires inline URLs, not generic footer
- [ ] Statistical requirements mandate historical comparison (7-day average minimum)
- [ ] Rankings require explicit levels (High/Medium/Low)

### Enforcement Mechanisms
- [ ] VERIFICATION-001 assertion present if blueprint has 3+ assertions
- [ ] Multi-source validation specifies minimum source count per claim
- [ ] Statistical assertions mandate specific comparisons (7-day average, percentiles)
- [ ] Coverage assertions quantify minimum item counts
- [ ] Output assertions require explicit ranking/conviction levels
- [ ] Discrepancy thresholds specified (e.g., "flag variances >5%")

## Summary

**Blueprint Purpose**: Define measurable target state, not the path.

**System Responsibility**: Determine optimal execution strategy.

**Golden Rules**: 
1. Tell what must be true, not what to do
2. Quantify every requirement with specific numbers
3. Add VERIFICATION-001 for blueprints with 3+ assertions
4. Require inline attribution with URLs per claim
5. Mandate statistical context (7-day averages minimum)
