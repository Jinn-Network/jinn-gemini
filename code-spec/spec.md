# The Orthodoxy Principle

> "There should be one—and preferably only one—obvious way to do it."
> — PEP 20 (The Zen of Python), Principle #13

## The Rule

For any given problem domain in this codebase, there must be **one canonical pattern**. All code must follow the established pattern, even if alternative approaches exist. Deviation requires explicit justification.

## Why This Matters

### The Problem with AI-Generated Code

AI-generated code compounds pattern inconsistency:

- **Different prompts** → different solutions
- **Different AI models** → different idioms
- **Different sessions** → stylistic drift
- **Result:** The codebase becomes unlearnable—every file is a surprise

### The Solution: Explicit Orthodoxy

By documenting canonical patterns and enforcing them through code review (manual or automated), we ensure:

- **Consistency:** Same problems solved the same way
- **Learnability:** New developers (human or AI) can predict patterns
- **Maintainability:** Changes follow established conventions
- **Observability:** Consistent patterns enable better tooling

## Philosophy: Specs Over Code

As described in OpenAI's Model Spec approach and Sean's talk on specifications:

> "Code is a lossy projection of a spec. The spec is the source of truth."

For an AI-generated codebase:
- **The prompts were the true source code**
- **The generated code is the binary artifact**
- **The spec preserves intent across AI sessions**

## Pattern Domains

Each problem domain has one canonical pattern. Current domains:

### v0 Patterns

1. **Error Handling + Logging** ([`patterns/error-handling-logging.md`](./patterns/error-handling-logging.md))
   - How we handle async errors
   - How we log failures with context
   - Established: 2025-01-09

### Future Patterns (Proposed)

- Data access patterns
- Configuration loading
- Database operations
- API client patterns
- Testing conventions

## Pattern Evolution

Patterns are not immutable. They evolve through:

### 1. Discovery
During development, you find a better approach or discover the current pattern doesn't cover a use case.

### 2. Proposal
Open a GitHub Discussion or PR proposing:
- What the current pattern doesn't handle
- The proposed new pattern
- Rationale for the change
- Examples of current violations

### 3. Amendment
Update the pattern document with:
```markdown
## Changelog

### 2025-02-01: Added error serialization helper
**Change:** Require use of `serializeError()` for Error objects
**Reason:** Error objects don't JSON.stringify() cleanly
**Migration PR:** #456
```

### 4. Migration
Plan AI-assisted migration:
- Identify all affected files
- Create migration task list
- Use Claude Code to systematically update files
- Submit as single "migration" PR

### 5. Enforcement
The updated pattern becomes canonical. Code spec reviews enforce it going forward.

## Exceptions

Rare cases may require deviation from canonical patterns. Document exceptions in your PR:

```markdown
## ⚠️ Code Spec Exception

**Pattern:** Error Handling + Logging
**Reason:** Third-party library callback doesn't support async/await
**Alternative:** Using `.catch()` with Promise wrapper
**Files affected:** `worker/legacy-adapter.ts:42-56`
```

## Enforcement

### Manual Review (Current)
```bash
/review-code-spec path/to/changed-files
```

### Automated Review (Future)
- Pre-commit hooks
- GitHub Actions on PRs
- IDE integration

## Relationship to OpenAI's Model Spec

This code spec is directly inspired by OpenAI's Model Spec and the concept of "deliberative alignment":

| OpenAI Model Spec | Our Code Spec |
|-------------------|---------------|
| Defines desired model behavior | Defines desired code patterns |
| Test cases: challenging prompts | Test cases: correct/incorrect examples |
| Evaluator: Claude grades responses | Evaluator: Claude grades code |
| Training loop: RLHF | Development loop: PR review |
| Goal: Aligned AI behavior | Goal: Consistent codebase |

## References

- [OpenAI Model Spec](https://github.com/openai/model_spec)
- [PEP 20 - The Zen of Python](https://peps.python.org/pep-0020/)
- Sean's Talk: "The New 'Code': Specifications" (attached file)
- [OpenAI: Shaping Desired Model Behavior](https://openai.com/index/introducing-the-model-spec/)
