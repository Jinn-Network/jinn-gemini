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

### Automated Enforcement (Recommended)

Set up git hooks to automatically check code before commits:

```bash
# One-time setup
yarn setup:hooks

# Now the pre-commit hook runs automatically on every commit
git commit -m "your message"

# To bypass the check when needed (with justification)
git commit --no-verify -m "your message"
```

### Manual Review

#### Interactive Mode (requires Claude Code session)

```bash
# Review a single file
/review-code-spec worker/mech_worker.ts

# Review all changed files
/review-code-spec --diff

# Review entire directory
/review-code-spec worker/
```

#### Headless/Script Mode (works anywhere)

```bash
# Review staged changes
yarn lint:spec

# Review all worker files
yarn lint:spec:all

# Review specific file
./scripts/review-code-spec.sh worker/mech_worker.ts

# Review directory
./scripts/review-code-spec.sh worker/
```

### During Development

**With git hooks installed** (recommended):
- Violations are caught automatically before commit
- Fix violations, or use `wip:` prefix for quick commits, or use `--no-verify` with justification

**Manual workflow**:
1. Run `yarn lint:spec` before committing
2. Address any violations identified
3. If you must deviate from the pattern, document the exception in your PR

**Quick commits (WIP):**
```bash
# Skip review for work-in-progress commits
git commit -m "wip: experimenting with approach"

# Review runs for proper commits
git commit -m "feat: implement feature"
```

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

## Troubleshooting

### Review takes a long time

**This is normal!** Code spec reviews take 30-120 seconds because Claude must:
1. Read 5 spec/example files (~700 lines)
2. Analyze your code thoroughly
3. Generate specific fixes with line numbers

**Typical timing:**
- Small file: 30-60s
- Medium file: 60-120s
- Large file/directory: 120-180s

**If it times out (> 5 minutes):**
```bash
# Increase timeout (default is 300 seconds / 5 minutes)
TIMEOUT=600 yarn lint:spec
```

### Script hangs or gets stuck

1. **Check Claude is responsive:**
   ```bash
   claude -p "test"
   ```

2. **Kill hung processes:**
   ```bash
   ps aux | grep claude | grep -v grep
   kill -9 <PID>
   ```

3. **Try with a smaller target:**
   ```bash
   # Instead of whole directory
   ./scripts/review-code-spec.sh worker/

   # Try specific file
   ./scripts/review-code-spec.sh worker/logger.ts
   ```

### Authentication errors

If you see OAuth or authentication errors:
```bash
# Refresh Claude authentication
claude --version
# If prompted, log in again
```

### Progress indicator doesn't show

The progress dots (`.`) appear every 5 seconds. If you don't see any after 10 seconds, the claude command may have failed immediately. Check the error output.

## Local vs CI/CD Enforcement

### Local Enforcement (Current)

✅ **Implemented** - Uses your Claude subscription, no extra costs
- Pre-commit hooks catch violations before they're committed
- Runs on developer's machine with local Claude authentication
- Fast feedback during development

### CI/CD Enforcement (Future)

⏳ **Planned** - Would require API key for remote execution
- GitHub Actions could review PRs automatically
- Useful for catching violations from contributors without hooks
- Requires `ANTHROPIC_API_KEY` in repository secrets

## Future Enhancements

- [x] Automated pre-commit hook validation
- [x] Headless/script mode for code spec review
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
