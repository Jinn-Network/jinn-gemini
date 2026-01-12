# Git Workflow Architecture

This document describes how Jinn manages git repositories for coding workstreams.

## Key Concept: CODE_METADATA_REPO_ROOT

The `CODE_METADATA_REPO_ROOT` environment variable is the single source of truth for where the local repository clone lives. All git operations use this path.

**Set by:**
- `launch_workstream.ts` → Creates repo, clones to `~/.jinn/workstreams/<repo-name>`, sets env var
- Worker's `jobRunner.ts` → Derives from `codeMetadata.repo.remoteUrl` if not already set

**Used by:**
- All `worker/git/` modules via `getRepoRoot(codeMetadata)`
- MCP tools (`process_branch`, `blog_create_post`, etc.)
- Agent file operations when `isCodingJob = true`

---

## Repository Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. LAUNCH (scripts/launch_workstream.ts)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ createGitHubRepo(name, token)    → Creates private repo on GitHub           │
│ initializeRepo(localPath, url)   → git init, add README, push to main       │
│ CODE_METADATA_REPO_ROOT = path   → Set env var for worker                   │
│ dispatchNewJob({...})            → Posts job with codeMetadata              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. WORKER CLAIM (worker/mech_worker.ts + orchestration/jobRunner.ts)        │
├─────────────────────────────────────────────────────────────────────────────┤
│ ensureRepoCloned(remoteUrl, path)  → Clone if missing, fetch --all          │
│ checkoutJobBranch(codeMetadata)    → Create/checkout job/xxx-job-name branch│
│ ensureGitignore(repoPath)          → Create .gitignore if missing           │
│ ensureBeadsInit(repoPath)          → Run `bd init` for issue tracking       │
│ commitRepoSetup(repoPath)          → Commit .gitignore + .beads to branch   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. AGENT EXECUTION (gemini-agent/agent.ts)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ Agent uses native file tools (write_file, replace, etc.)                    │
│ Files written to CODE_METADATA_REPO_ROOT                                    │
│ Agent can call process_branch to review child branches                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. POST-EXECUTION (worker/orchestration/jobRunner.ts)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ autoCommitIfNeeded(codeMetadata)   → Stage all, commit with summary         │
│ pushJobBranch(branchName)          → git push -u origin branch:branch       │
│ createBranchArtifact(...)          → Upload branch metadata to IPFS         │
│ createOrUpdatePullRequest(...)     → Create GitHub PR (optional)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Module Reference

| File | Purpose |
|------|---------|
| `worker/git/index.ts` | Re-exports all git modules |
| `worker/git/repoManager.ts` | Clone, fetch, repo root resolution |
| `worker/git/branch.ts` | Branch checkout, creation, sync/merge |
| `worker/git/workingTree.ts` | Status, stage, uncommitted checks |
| `worker/git/autoCommit.ts` | Derive commit message, auto-commit |
| `worker/git/push.ts` | Push branch to remote |
| `worker/git/pr.ts` | GitHub PR creation, branch artifacts |
| `worker/git/repoSetup.ts` | .gitignore, beads init, setup commit |
| `worker/git/integration.ts` | Check if child branches are merged |
| `worker/mcp/tools/git.ts` | `process_branch` MCP tool |
| `shared/repo_utils.ts` | `getRepoRoot()`, `extractRepoName()` |

---

## Branch Naming

Format: `job/<uuid-prefix>-<slugified-job-name>`

Example: `job/a1b2c3d4-ethereum-protocol-research`

Built by: `worker/git/branch.ts:buildJobBranchName()` / `gemini-agent/shared/code_metadata.ts:buildJobBranchName()`

---

## MCP Tool: process_branch

The `process_branch` tool allows agents to review and integrate child job branches.

**Actions:**
- `compare` → View diff without changing state (paginated for large diffs)
- `merge` → Merge child into base, delete child branch, push
- `reject` → Delete child branch without merging
- `checkout` → Switch to child branch for manual fixes

**Flow:**
```
1. Agent receives CTX-CHILD-xxx assertions about completed children
2. Agent calls process_branch({ action: 'compare', branch_name: 'job/xxx-...' })
3. Review diff, then: merge (approve) or reject (discard)
4. If merge conflicts: checkout → resolve → commit → merge
```

---

## Blog Tools Integration

Blog publishing tools (`gemini-agent/mcp/tools/blog-publish.ts`) use the same local git workflow:

1. Write MDX to `CODE_METADATA_REPO_ROOT/data/blog/`
2. Worker's auto-commit detects changes
3. Push happens via standard `pushJobBranch()`

**No GitHub API needed** — files are written locally, committed, and pushed like any other code change.

---

## Key Functions

### `getRepoRoot(codeMetadata?)`
Resolves the local repository path. Priority:
1. `CODE_METADATA_REPO_ROOT` env var
2. Derive from `codeMetadata.repo.remoteUrl` + `JINN_WORKSPACE_DIR`
3. Fallback to `process.cwd()`

### `ensureRepoCloned(remoteUrl, targetPath)`
Clone if not exists, otherwise `git fetch --all`.

### `checkoutJobBranch(codeMetadata)`
Smart checkout with 3 cases:
1. Local branch exists → `git checkout`
2. Remote exists, local doesn't → `git checkout -b ... origin/xxx`
3. Neither exists → `git checkout -b ... baseBranch`

### `autoCommitIfNeeded(codeMetadata, message)`
Stage all changes, commit with derived message, return commit hash.

### `pushJobBranch(branchName, codeMetadata)`
Push with upstream tracking: `git push -u origin branch:branch`

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CODE_METADATA_REPO_ROOT` | Path to local repo clone (required for coding jobs) |
| `JINN_WORKSPACE_DIR` | Base directory for repo clones (default: `~/.jinn/workstreams`) |
| `GITHUB_TOKEN` | Token for PR creation and repo operations |
| `GITHUB_REPOSITORY` | Optional override in `owner/repo` format |

---

## Common Issues

### "Cannot checkout branch" errors
- Ensure `git fetch --all` runs before checkout
- Check if remote branch exists: `git ls-remote --heads origin <branch>`

### Files in wrong directory
- Verify `CODE_METADATA_REPO_ROOT` is set correctly
- Check that agent uses absolute paths from `metadata.workspacePath`

### Push failures
- Stale nonce: Restart worker to refresh wallet state
- No upstream: `pushJobBranch()` sets `-u` flag automatically

### Merge conflicts
- `process_branch` action=checkout → resolve → commit → action=merge
- Beads files auto-committed before merge to unblock
