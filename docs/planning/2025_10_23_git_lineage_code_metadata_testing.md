# Git Lineage Workflow – Testing Plan

## Integration scenarios

1. **Branch + PR happy path**
   - Dispatch a coding job from the agent, confirm the worker checks out `job/<jobDefinitionId>`.
   - Run the configured validation command (e.g., `yarn test --watch=false`) and ensure failure prevents finalize.
   - After success, verify the worker commits, pushes, and opens a PR against the recorded base branch.
   - Assert Ponder exposes `jobDefinition.codeMetadata` and the request references the same blob.

2. **Missing metadata fallback**
   - Dispatch a legacy job without `codeMetadata` and confirm the worker skips Git operations but still processes artifacts.
   - Ensure telemetry reports the omission without crashing the worker.

3. **GitHub outage / token missing**
   - Simulate missing `GITHUB_TOKEN` and verify the worker marks the job as failed with a clear error before finalizing.
   - Retry logic should not loop; the job remains claimable for manual intervention.

4. **Conflict / push failure**
   - Introduce divergent commits on the remote branch, ensure the worker surfaces the merge conflict and fails fast.
   - Telemetry should include `git status` diff snippet for debugging.

## Unit coverage

- `runGit` helper: success, failure, and `allowFailure` branches.
- `prepareBranchForJob`: local-only branch creation, remote-only branch, and happy path.
- `runValidations`: command success/failure, timeout handling.
- `createOrUpdatePullRequest`: existing PR, new PR, API error (mock fetch).
- Ponder indexer utilities: validate deep clone of `codeMetadata` and GraphQL response shape.

## Tooling

- Add a `yarn test:git-workflow` script that stubs git/gh commands and executes the integration scenario in CI.
- Use GitHub Actions with a temporary PAT to exercise PR creation in a throwaway fork.
- Extend Control API smoke tests to ensure `result.pr` artifact is persisted when the worker emits a PR URL.
