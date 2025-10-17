# CodeSpec Violation Autofix

You are tasked with fixing code spec violations in this codebase. You have been provided with detailed context about the violation(s) to fix.

## Context

**Violation ID:** {{VIOLATION_ID}}
**Clauses:** {{CLAUSES}}
**Severity:** {{SEVERITY}}
**File:** {{FILE_PATH}}:{{LINE}}

### Violation Description

{{DESCRIPTION}}

### Current Code

```typescript
{{CURRENT_CODE}}
```

### Suggested Fix

{{SUGGESTED_FIX}}

## Code Spec Reference

The full Code Spec is available at: `docs/spec/code-spec/spec.md`

Key objectives:
- **obj1 (Orthodoxy):** Follow the principle of orthodoxy - use one obvious way for each problem
- **obj2 (Discoverability):** Code for the next agent - make code explicit and discoverable
- **obj3 (Security):** Minimize harm - fail securely, validate inputs, never log secrets

## Your Task

1. **Read the full Code Spec** at `docs/spec/code-spec/spec.md` to understand the canonical patterns
2. **Read the target file** at `{{FILE_PATH}}` to understand the surrounding context
3. **Fix the violation** by:
   - Applying the suggested fix (if appropriate)
   - Following the canonical patterns from the spec
   - Ensuring the fix is minimal and focused on the violation
   - Preserving all existing functionality
4. **Verify the fix** by:
   - Running the review script again: `./codespec/scripts/detect-violations.sh {{FILE_PATH}}`
   - Running tests if applicable: `yarn test`
   - Ensuring no new violations were introduced

## Constraints

- **Conservative fixes only:** Do not refactor code beyond what's needed to fix the violation
- **No public API changes:** Do not change function signatures, exports, or public interfaces
- **Preserve behavior:** Ensure all existing functionality continues to work
- **Follow existing patterns:** Match the code style and patterns used in the rest of the file

## Additional Context

{{ADDITIONAL_CONTEXT}}

## Workflow

After you complete the fix:
1. The autofix system will run `./codespec/scripts/detect-violations.sh {{FILE_PATH}}` to verify the violation is resolved
2. The autofix system will run `yarn test` to ensure tests still pass
3. If both pass, a PR will be automatically created
4. If either fails, the worktree will be left open for manual review at: `.codespec/worktrees/{{VIOLATION_ID}}`

Please proceed with fixing the violation now.
