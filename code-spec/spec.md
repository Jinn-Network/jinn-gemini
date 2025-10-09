# Code Spec

## Overview

This specification defines desired code patterns for an AI-generated codebase. It ensures consistency across multiple AI sessions and makes the codebase maintainable by both humans and future AI agents.

**Inspired by:** [OpenAI Model Spec](https://github.com/openai/model_spec)

**Philosophy:** In an AI-generated codebase, different prompts naturally produce different solutions to the same problem. Without explicit guidance, patterns drift and the codebase becomes inconsistent. This spec provides that guidance.

## Structure

This document is organized into three tiers, following the OpenAI Model Spec structure:

1. **Objectives** - High-level goals and guiding philosophies
2. **Rules** - Hard constraints that must never be violated
3. **Default Behaviors** - Standard patterns for common operations

Each clause includes footnote references to example files that demonstrate correct usage and common violations.

---

## Objectives

Objectives are high-level goals that provide directional guidance for all code. They inform the rules and default behaviors.

### Follow the principle of orthodoxy[^obj1]

> "There should be one—and preferably only one—obvious way to do it."
> — PEP 20 (The Zen of Python), Principle #13

**The principle:** For any given problem domain in this codebase, there must be one canonical approach. All code must follow the established approach, even if alternative approaches exist.

**Why this matters for AI-generated code:**
- Different prompts → different solutions
- Different AI models → different idioms
- Different sessions → stylistic drift
- Result: Codebase becomes unlearnable

**Application:** When you encounter code that solves the same problem in multiple ways, this violates orthodoxy. Identify the canonical approach, document it as a default behavior, and migrate all code to follow it.

[^obj1]: See examples/obj1.md

### Maintain codebase consistency

Ensure AI-generated code follows predictable patterns across sessions, enabling both human developers and future AI agents to understand and maintain the code effectively.

### Support observability and debugging

Write code that is traceable, loggable, and debuggable. Structured data is preferred over unstructured strings. Silent failures are never acceptable.

---

## Rules

Rules are hard constraints that must never be violated. Unlike objectives (which are directional) and default behaviors (which can have rare exceptions), rules are absolute.

### (None defined yet)

Future examples:
- Never commit secrets or credentials
- Never use deprecated dependencies
- Always validate external input

As the codebase evolves, critical constraints will be elevated to rules.

---

## Default Behaviors

Default behaviors define the standard way to handle common operations. They are consistent with objectives and rules. In rare cases, deviations may be justified (e.g., third-party library constraints), but must be explicitly documented.

### Handle async errors with try/catch and structured logging[^db01]

All asynchronous operations must use try/catch blocks with structured logging via `workerLogger`.

**Standard approach:**

```typescript
async function operation(param: string): Promise<Result> {
  try {
    const result = await riskyOperation(param);
    return result;
  } catch (error) {
    workerLogger.error('Operation failed', {
      param,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error; // Re-throw for caller to handle
  }
}
```

**Key elements:**
1. Use `try/catch` blocks, not `.catch()` promise chains[^db01][^db02]
2. Use `workerLogger.*` methods, not `console.*`[^db02][^db03]
3. Include structured context object with relevant debugging information[^db03][^db04]
4. Serialize errors properly (check `instanceof Error`)[^db04]
5. Re-throw errors or handle explicitly—never silent catch[^db05]
6. Avoid multiple property fallbacks that indicate no canonical data structure[^db06]

**Rationale:**
- **try/catch** - Explicit, aligns with async/await, composable
- **workerLogger** - Structured, observable, integrates with OpenTelemetry
- **Context objects** - Enables debugging, querying, telemetry correlation
- **Re-throw** - Lets caller decide if error is recoverable

**Rare exceptions:**
- Third-party callback APIs that don't support async/await
- Fire-and-forget background operations (must still log errors)

When deviating, document in PR:
```markdown
## ⚠️ Code Spec Exception: Error Handling
**Reason:** Third-party library uses callbacks, not async/await
**Alternative:** Callback with structured logging
**File:** `worker/legacy-adapter.ts:42`
```

[^db01]: See examples/db01.md for correct implementation
[^db02]: See examples/db02.md for .catch() violation
[^db03]: See examples/db03.md for console.* violation
[^db04]: See examples/db04.md for unstructured logging
[^db05]: See examples/db05.md for silent catch violation
[^db06]: See examples/db06.md for property fallbacks violation

---

## Pattern Evolution

Default behaviors are not immutable. They evolve as the codebase grows and we discover better approaches.

### Evolution process:

1. **Discovery** - During development, you find a better approach or discover the current pattern doesn't cover a use case
2. **Proposal** - Open GitHub Discussion proposing the change with rationale and examples
3. **Amendment** - Update this spec with the new approach and migration plan
4. **Migration** - Use AI-assisted migration to update existing code
5. **Enforcement** - The updated pattern becomes canonical

### When to create a new default behavior:

If you encounter code that:
- Solves the same problem in multiple different ways (violates orthodoxy)
- Is a common operation that lacks guidance
- Has multiple "obvious" approaches and needs a canonical one

Then:
1. Identify the best approach based on observability, maintainability, consistency
2. Add a new default behavior to this spec
3. Create example files demonstrating correct and incorrect usage
4. Plan migration of existing code

### Changelog format:

When updating default behaviors, add an entry:

```markdown
### 2025-01-15: Added error serialization requirement
**Change:** Require `instanceof Error` check before accessing `.message`
**Reason:** Error objects from third-party code may not have expected shape
**Migration PR:** #123
**Examples:** Updated db01.md, db04.md
```

---

## Relationship to OpenAI Model Spec

This code spec is directly inspired by OpenAI's Model Spec and the concept of "deliberative alignment."

| OpenAI Model Spec | Our Code Spec |
|-------------------|---------------|
| Defines desired model behavior | Defines desired code patterns |
| Objectives: "Assist users" | Objectives: "Follow orthodoxy" |
| Rules: "Comply with laws" | Rules: (Future: "Never commit secrets") |
| Default Behaviors: "Express uncertainty" | Default Behaviors: "Use try/catch + logger" |
| Examples: 114 test case files | Examples: Test cases per behavior |
| Enforcement: Grader model + RLHF | Enforcement: Claude review + git hooks |
| Evolution: Public feedback | Evolution: Developer discovery |

**Key insight from Sean's talk:**
> "Code is a lossy projection of a spec. The spec is the source of truth."

For an AI-generated codebase:
- The prompts were the true source code
- The generated code is the binary artifact
- The spec preserves intent across AI sessions

---

## References

- [OpenAI Model Spec](https://github.com/openai/model_spec)
- [OpenAI: Shaping Desired Model Behavior](https://openai.com/index/introducing-the-model-spec/)
- [PEP 20 - The Zen of Python](https://peps.python.org/pep-0020/)
- [OpenAI: Deliberative Alignment](https://openai.com/index/deliberative-alignment/)
- Sean's Talk: "The New 'Code': Specifications" (see project files)
