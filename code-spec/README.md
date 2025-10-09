# Code Spec: Orthodoxy Framework

A living specification that enforces "one obvious way" for AI-generated code.

## Philosophy

This codebase is primarily AI-generated. Without explicit patterns, different prompts produce different solutions to the same problem. This spec enforces consistency by establishing canonical patterns for common problem domains.

Inspired by OpenAI's Model Spec and the Zen of Python's principle: "There should be one—and preferably only one—obvious way to do it."

## Current Specs

### v0: Error Handling + Logging
- **Status:** Active
- **Pattern:** [`patterns/error-handling-logging.md`](./patterns/error-handling-logging.md)
- **Rationale:** Async error handling and logging are tightly coupled and appear in 29+ worker files

## How to Use

### Manual Review

Review specific files against the spec:

```bash
# Review a single file
/review-code-spec worker/mech_worker.ts

# Review all changed files in current branch
/review-code-spec --diff

# Review entire directory
/review-code-spec worker/
```

### During Development

Before committing code with async operations:
1. Run `/review-code-spec` on your changed files
2. Address any violations identified
3. If you must deviate from the pattern, document the exception in your PR

## Pattern Evolution

Patterns evolve through this process:

1. **Discovery:** Find a better approach during development
2. **Proposal:** Open GitHub Discussion to propose pattern change
3. **Documentation:** Update pattern file with rationale and date
4. **Migration:** Plan AI-assisted migration of existing code
5. **Enforcement:** New pattern becomes canonical

See [`spec.md`](./spec.md) for the full Orthodoxy Principle definition.

## Testing the Spec

To validate the spec itself:

```bash
# Test on known violations
/review-code-spec worker/control_api_client.ts

# Test on compliant code
/review-code-spec worker/logger.ts
```

## Future Enhancements

- [ ] Automated pre-commit hook validation
- [ ] GitHub Action for PR review comments
- [ ] Additional patterns (data access, configuration, etc.)
- [ ] Pattern migration tracking

## Contributing

When proposing new patterns:
1. Identify a problem domain with multiple inconsistent approaches
2. Document the canonical pattern with examples
3. Create test cases (pass/fail examples)
4. Update this README
5. Plan migration strategy for existing code
