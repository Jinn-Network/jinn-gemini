# Blueprint Style Guide

## Purpose

This style guide defines the structural requirements for all blueprint documentation. Every document in the blueprint—including the constitution, vision, requirements, and specifications—must adhere to this homomorphic assertion format to ensure clarity, verifiability, and actionable guidance.

## Assertion Structure

Each assertion in the blueprint must contain three components:

### 1. Assertion

A brief, declarative statement that defines a principle, requirement, or constraint according to which the venture should operate.

**Characteristics:**
- Concise (typically 1-2 sentences)
- Unambiguous
- Actionable or verifiable
- Written in imperative or declarative mood

### 2. Examples

A two-column table providing concrete positive and negative guidance:

| Do | Don't |
|---|---|
| Positive example showing correct application | Negative example showing violation or anti-pattern |

**Requirements:**
- Minimum 1 example pair per assertion
- Examples must be concrete and specific
- Do column shows alignment with the assertion
- Don't column shows clear violation or misapplication
- Use code snippets, architectural patterns, or process descriptions as appropriate

### 3. Commentary

Human-readable context explaining the rationale, background, or implications of the assertion.

**Purpose:**
- Explain *why* the assertion exists
- Provide historical context or motivation
- Clarify edge cases or nuances
- Connect to broader architectural or philosophical principles

**Characteristics:**
- Written for comprehension, not enforcement
- May reference related assertions
- Should aid interpretation without changing the assertion's meaning

## Full Example

**Assertion:**  
All off-chain writes related to an on-chain job must be routed through the Control API.

**Examples:**

| Do | Don't |
|---|---|
| `await controlApiClient.createArtifact({ requestId, artifactData })` | `await supabase.from('onchain_artifacts').insert({ ... })` |
| Route artifact creation through Control API mutations | Write directly to Supabase tables from agent tools |
| Let Control API inject lineage metadata automatically | Manually construct lineage fields in tool code |

**Commentary:**

The Control API serves as a mandatory security and integrity layer for all database writes associated with on-chain jobs. By enforcing this bottleneck, we ensure:
- Request IDs are validated against Ponder before writes occur
- Worker addresses and lineage metadata are injected consistently
- Audit trails are complete and tamper-evident
- Direct database access cannot bypass validation logic

This pattern emerged from JINN-195 after observing inconsistent lineage data in production. The Control API centralizes validation logic that was previously scattered across tools, reducing the attack surface and preventing malformed writes.

## Application Guidelines

### Scope

This structure applies to:
- `constitution.md` - Core immutable principles
- `vision.md` - Strategic direction and goals
- `requirements.md` - Technical and operational requirements

### Granularity

- One assertion per distinct principle or requirement
- Avoid compound assertions that bundle multiple constraints
- Use cross-references when assertions relate to each other

### Evolution

- Assertions may be added as the system evolves
- Existing assertions should be versioned if modified
- Deprecated assertions should be marked but not removed

### Verification

Each assertion should be:
- **Testable**: Can be validated through code inspection, tests, or monitoring
- **Traceable**: Can be linked to specific implementation files or architectural decisions
- **Enforceable**: Violations can be detected and prevented

## Migration Path

Existing blueprint documents should be incrementally refactored to this format:
1. Extract implicit assertions from prose
2. Formulate as explicit declarative statements
3. Add concrete examples from codebase
4. Preserve context as commentary
5. Verify no information is lost in translation

