# Code Spec

## Overview

This specification defines desired code patterns for an AI-generated codebase. It ensures consistency across multiple AI sessions and makes the codebase maintainable by both humans and future AI agents.

**Inspired by:** [OpenAI Model Spec](https://github.com/openai/model_spec)

**Philosophy:** In an AI-generated codebase, different prompts naturally produce different solutions to the same problem. Without explicit guidance, patterns drift and the codebase becomes inconsistent. This spec provides that guidance.

## How to Read This Spec

This specification is organized into three tiers:

1. **Objectives** - High-level goals and guiding philosophies
2. **Rules** - Hard constraints that must never be violated
3. **Default Behaviors** - Standard patterns for common operations

### What is a "clause"?

A **clause** is a single item within the spec—one objective, one rule, or one default behavior. For example:
- "Follow the principle of orthodoxy" is an objective clause
- "Never commit secrets" would be a rule clause (when we add it)
- "Use environment variables for configuration" could be a default behavior clause (when we add one)

Each clause has:
- A **title** - What it addresses
- A **description** - What it means and why it matters
- **Footnote references** - Links to example files (e.g., `[^db01]`)

### Example files

The `examples/` directory contains test cases that demonstrate what correct and incorrect code looks like:
- **Naming:** `obj1.md`, `obj2.md` (objectives), `r1.md`, `r2.md` (rules), `db1.md`, `db2.md` (default behaviors)
- **Content:** Each file shows either correct implementation or a specific violation
- **Purpose:** These teach both humans and AI agents what the clause means in practice

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

### Code for the next agent[^obj2]

> "Explicit is better than implicit."
> — PEP 20 (The Zen of Python), Principle #2

**The principle:** AI agents are the primary developers and maintainers of this codebase. Every line of code should be written with the next AI session in mind—optimized for machine discoverability, readability, and comprehension.

**Why this matters for AI-generated code:**
- AI agents learn by reading existing code
- AI agents navigate codebases by pattern matching and search
- Implicit behavior, clever tricks, and hidden context confuse AI
- The ratio of code-reading to code-writing is extreme in AI development

**What this means in practice:**
- **Explicit over implicit:** Make intentions clear through naming, types, and structure
- **Discoverable patterns:** Use consistent, greppable patterns that AI can find
- **Self-documenting:** Code should explain what it does without requiring external context
- **Minimal cleverness:** Favor clarity over conciseness when they conflict
- **Fail fast, fail explicitly:** Prefer throwing errors over silent fallbacks. If something is broken, make it visible—don't hide failures behind degraded behavior

**Application:** When writing code, ask: "Will the next AI agent understand this?" If it requires human intuition, domain knowledge not in the codebase, or clever inference, it violates this objective.

[^obj2]: See examples/obj2.md

### Minimize harm[^obj3]

> "First, do no harm."
> — Adapted from the Hippocratic Oath

**The principle:** Prevent code from causing harm to users, systems, or data. Security, safety, and privacy are not optional features—they are foundational requirements.

**Why this matters for AI-generated code:**
- AI agents may not understand all security implications
- AI agents learn from examples that might include insecure patterns
- Security vulnerabilities compound across AI sessions
- A single compromised secret or SQL injection can cascade through the system

**What this means in practice:**
- **Security by default:** Choose secure patterns over convenient ones
- **Validate all inputs:** External data is untrusted until proven safe
- **Fail securely:** When errors occur, fail closed (deny access) not open
- **Guard secrets:** Never commit credentials, API keys, or sensitive data to the repository
- **Principle of least privilege:** Grant minimum necessary permissions

**Application:** When generating code, ask: "Could this be exploited? Could this leak data? Could this cause damage?" If the answer is possibly yes, redesign before implementing.

**Relationship to Rules:** This objective informs future Rules like "Never commit secrets" and "Always validate external input." The objective is the "why," Rules are the "must never."

[^obj3]: See examples/obj3.md

---

## Rules

Rules are hard constraints that must never be violated. Unlike objectives (which are directional) and default behaviors (which can have rare exceptions), rules are absolute.

### (None defined yet)

As the codebase evolves, critical constraints will be elevated to rules with corresponding example files.

---

## Default Behaviors

Default behaviors define the standard way to handle common operations. They are consistent with objectives and rules. In rare cases, deviations may be justified (e.g., third-party library constraints), but must be explicitly documented.

### (None defined yet)

When a default behavior is added, it will include:
- The canonical approach with code examples
- Rationale for why this approach is preferred
- Links to example files demonstrating correct usage and violations
- Guidance on rare exceptions

The first default behaviors will likely address universal patterns like configuration management, data access conventions, or API client structure.

---

## Enforcement

This spec is enforced through multiple verification layers, ensuring code quality without blocking developer productivity.

### Current Enforcement Methods

#### 1. Pre-commit Git Hooks (Strict Mode)

**Status:** ✅ Implemented

Automatically reviews staged TypeScript files before each commit:

```bash
# Install once
yarn setup:hooks

# Commits are now automatically reviewed
git commit -m "feat: new feature"  # Review runs (strict)
git commit -m "wip: experimenting" # Skipped (WIP prefix)
git commit --no-verify             # Bypassed (emergency)
```

**How it works:**
- Runs `claude -p "/review-code-spec --diff"` via `scripts/review-code-spec.sh`
- Analyzes only staged changes (fast, focused)
- Blocks commit if violations found (strict enforcement)
- WIP commits (`wip:` prefix) skip review for developer flow
- Emergency bypass available via `--no-verify`

**Timing:** 30-120 seconds depending on code size

#### 2. Manual Review (Interactive & Headless)

**Status:** ✅ Implemented

Developers can manually trigger reviews at any time:

```bash
# Interactive mode (within Claude Code session)
/review-code-spec worker/mech_worker.ts
/review-code-spec --diff
/review-code-spec worker/

# Headless mode (anywhere, via scripts)
yarn lint:spec              # Review staged changes
yarn lint:spec:all          # Review all worker files
./scripts/review-code-spec.sh worker/file.ts
```

**Use cases:**
- Pre-commit validation before staging
- Exploratory review during refactoring
- Batch review of existing code

#### 3. Deliberative Alignment

**Concept:** Claude Code "deliberates" on the spec before generating code.

**How it works:**
1. Developer requests code changes
2. Claude reads `spec.md` and `examples/` files
3. Claude reasons about how to satisfy both the request and the spec
4. Claude generates code that follows canonical patterns by default

**Implementation:** The `/review-code-spec` slash command embeds this concept by requiring Claude to read the spec files before analyzing code.

**Inspiration:** OpenAI's Model Spec uses a similar approach where the model reasons about its specification before responding to user queries.

### Enforcement Philosophy

**Strict but flexible:**
- Default: Block violations before they enter the codebase
- Escape hatches: WIP commits, `--no-verify` for legitimate exceptions
- Transparency: Clear messaging about violations and how to fix them

**Educational, not punitive:**
- Violations include suggested fixes with exact code
- Pattern references explain the "why"
- Exceptions are documented, not hidden

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
| Rules: "Comply with laws" | Rules: (Future) |
| Default Behaviors: "Express uncertainty" | Default Behaviors: (Future) |
| Examples: 114 test case files | Examples: Test cases per clause |
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
