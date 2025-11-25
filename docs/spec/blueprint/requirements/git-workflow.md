# Git Workflow Requirements

Git integration and code lineage requirements for the Jinn protocol.

---

## GWQ-001: Branch Isolation

**Assertion:**
Each job must execute in isolation on a dedicated branch, preventing interference between concurrent jobs.

**Examples:**

| Do | Don't |
|---|---|
| Create unique branch for every job execution | Reuse branches across multiple jobs |
| Ensure branch names are deterministic and unique per job | Generate random branch names |
| Allow multiple jobs to run concurrently on different branches | Force jobs to wait for branch availability |
| Base branch name on job definition ID | Base branch name on timestamps or random IDs |

**Commentary:**

Branch isolation ensures:

**Concurrent Execution:**
- Multiple jobs can run simultaneously without conflicting file changes
- Each job has its own working tree state
- No cross-job interference during execution

**Deterministic Naming:**
- Branch name derives from job definition ID (stable, unique identifier)
- Same job definition always uses same branch name pattern
- Enables branch discovery via job metadata

**State Isolation:**
- Job A's file modifications don't affect Job B's view of the repository
- Agent can make destructive changes without impacting other jobs
- Failed jobs don't leave repository in inconsistent state for other jobs

**Test Evidence:**
- Validated by `tests/git/worker-git-lineage.test.ts:114-123` (branch exists and is unique)

Branch isolation is fundamental to the event-driven architecture (ARQ-001) where multiple workers may process different jobs concurrently.

---

## GWQ-002: Lineage Preservation

**Assertion:**
Child job branches must be based on their parent's branch, preserving hierarchical git ancestry that matches the job hierarchy.

**Examples:**

| Do | Don't |
|---|---|
| Create child branch from parent branch's latest commit | Create all branches from main/master |
| Set child's base branch to parent's job branch | Set all base branches to "main" |
| Ensure git merge-base(child, parent) equals parent commit | Allow child to diverge from parent lineage |
| Store parent job metadata in child's code metadata | Lose parent relationship information |

**Commentary:**

Lineage preservation ensures git history mirrors job delegation hierarchy:

**Git Ancestry:**
```
main
 └─ job/parent-abc123
     ├─ job/child1-def456
     │   └─ job/grandchild-ghi789
     └─ job/child2-jkl012
```

**Why This Matters:**

**PR Targeting:**
- Child PRs target parent branch (not main)
- Enables incremental review: review parent, then children
- Parent can merge without waiting for children
- Children build on parent's work

**Merge Strategy:**
- When parent merges to main, children can rebase on new main
- Git history shows true lineage of work
- Conflict resolution happens at appropriate hierarchy level

**Work Continuity:**
- Child starts with parent's file changes
- Grandchild starts with both parent and child changes
- No need to re-implement parent's work

**Metadata Tracking:**
- Code metadata includes `baseBranch`, `parent.jobDefinitionId`, `parent.requestId`
- Enables reconstruction of full job tree from git + on-chain data

**Test Evidence:**
- Validated by `tests/git/worker-git-lineage.test.ts:625,667,671-676` (baseBranch, merge-base, metadata)

This design emerged from issues where child jobs couldn't access parent's code changes, forcing duplication. Lineage preservation (GWQ-002) combined with branch isolation (GWQ-001) enables both concurrency and hierarchy.

---

## GWQ-003: Work Persistence

**Assertion:**
All file changes made during job execution must be persisted to the job's branch and visible in the pull request diff.

**Examples:**

| Do | Don't |
|---|---|
| Ensure all agent file modifications appear on job branch | Lose changes if worker crashes mid-job |
| Commit changes before worker process exits | Leave uncommitted changes in working tree |
| Push branch to remote after committing | Keep changes only in local clone |
| Make changes visible in PR diff for review | Hide changes from reviewers |

**Commentary:**

Work persistence guarantees that agent work is not lost:

**Durability:**
- File changes survive worker restarts
- Changes survive local git clone deletion
- Remote branch serves as source of truth

**Reviewability:**
- All changes visible in PR diff
- Reviewers see exactly what the agent modified
- No hidden state or uncommitted changes

**Auditability:**
- Git history shows what changed and when
- Commits are signed/attributed (if configured)
- Changes are immutable once pushed

**Recovery:**
- If worker crashes after push, another worker can continue from branch state
- No need to re-execute job to recover work
- Branch state checkpoints progress

**Test Evidence:**
- Validated by `tests/git/worker-git-lineage.test.ts:230-232,259` (commits exist, branch pushed)
- Validated by `tests/git/worker-git-auto-commit.test.ts:109,113` (changes persisted)

**Implementation Flexibility:**
This requirement specifies **what** must be persisted, not **how**:
- Could use auto-commit on completion
- Could use periodic checkpointing
- Could use commit-per-tool-call strategy
- Any approach satisfying "changes visible in PR" is valid

The key guarantee: work done by agent is not lost and is reviewable.

---

## GWQ-004: Pull Request Creation

**Assertion:**
Completed jobs must result in an open pull request from the job branch to the parent/base branch, with the PR URL available in the delivery payload.

**Examples:**

| Do | Don't |
|---|---|
| Create PR automatically when job completes | Require manual PR creation |
| Set PR source to job branch, target to base branch | Create PR to wrong target branch |
| Include PR URL in delivery payload for discoverability | Store PR URL only in artifacts |
| Mark PR as "open" state for review | Auto-merge PRs without review |

**Commentary:**

Pull request creation enables code review workflow:

**Human Oversight:**
- All agent code changes require human review before merging
- Reviewers can comment, request changes, or approve
- Safety layer preventing unreviewed code from reaching main branch

**PR Metadata:**
```json
{
  "source": "job/abc123-optimize-staking",
  "target": "job/parent-def456",  // or "main" for root jobs
  "state": "open",
  "url": "https://github.com/owner/repo/pull/42"
}
```

**Delivery Integration:**
- PR URL stored in delivery payload (not artifacts)
- Enables programmatic discovery of PR for status updates
- Parent jobs can link to child PRs in their own PR body

**Hierarchical Review:**
- Jobs with no parent (`sourceJobDefinitionId: null`) have PRs that target main
- Child jobs have PRs that target their parent's branch
- Can review/merge parent before children complete
- Enables incremental delivery

**Note:** The branching hierarchy is a structural artifact management feature, not a behavioral difference. All jobs follow the same execution logic regardless of their position in the hierarchy.

**Branch Protection:**
- Repository branch protection rules apply
- Required reviewers/checks enforced via GitHub
- No bypassing review process

**Test Evidence:**
- Validated by `tests/git/worker-git-lineage.test.ts:394,420-422` (PR exists, correct branches, open state)

**Why in Delivery Payload?**
The PR URL is operational metadata (like `ipfsHash` or `blockNumber`), not a work artifact. It belongs in the delivery structure itself, enabling:
- Status monitoring (check if PR merged)
- Parent job context (link to child PRs)
- Programmatic PR management

This design supports the protocol's goal of transparency (OBS-001) by making all work reviewable before integration.

---

## GWQ-005: Execution Traceability

**Assertion:**
Commits and pull requests must contain descriptive information about what was accomplished, enabling review without examining code diffs.

**Examples:**

| Do | Don't |
|---|---|
| Include execution summary in commit message | Use generic message like "auto-commit" |
| Include execution summary in PR body | Leave PR body empty |
| Describe what was accomplished, not just what changed | Write commit message listing file names |
| Enable reviewer to understand work without reading diff | Force reviewer to read code to understand purpose |

**Commentary:**

Execution traceability improves review efficiency and auditability:

**Commit Messages:**
- Derived from agent's execution summary
- Describes accomplishment in human terms
- Example: "Implemented OLAS staking parameter optimization" not "Modified staking.ts, utils.ts"

**PR Body Format:**
```markdown
## Job Information
- Job Definition: abc123-optimize-staking
- Request ID: 0xdef456...
- Model: gemini-2.5-pro

## Execution Summary
- Analyzed current staking parameters (8-12% APY, 1w-1y locks)
- Proposed optimization strategy balancing participation and sustainability
- Created configuration file with recommended parameters

## Artifacts
- [olas-staking-analysis](https://gateway.autonolas.tech/ipfs/baf...)
```

**Review Efficiency:**
- Reviewer reads summary to understand goal/outcome
- Only examines diff if needed to verify implementation
- Can approve/reject based on accomplishment, not code quality alone

**Auditability:**
- Git history shows what was accomplished, not just what changed
- `git log` provides human-readable timeline of work
- No need to interpret diffs to understand project evolution

**Search/Discovery:**
- Can search commit messages for "implemented feature X"
- Can filter PRs by execution summary keywords
- Enables programmatic analysis of work done

**Test Evidence:**
- Validated by `tests/git/worker-git-lineage.test.ts:426-431` (PR body includes execution summary)
- Validated by `tests/git/worker-git-auto-commit.test.ts:114` (commit message meaningful)

**Flexibility:**
This requirement specifies **what** information must be present (execution description), not **how** it's formatted or derived:
- Could extract from "Execution Summary" section in agent output
- Could use status message
- Could use job objective as fallback
- Any approach providing reviewable description is valid

The key guarantee: reviewers can understand what was done without reading code.

---

## Navigation

- [← Back to Requirements Index](./index.md)
- [Style Guide](../style-guide.md)

## See Also

- **Architecture Requirements (ARQ):** Defines event-driven architecture enabling concurrent job execution
- **Lifecycle Requirements (LCQ):** Defines job hierarchy and delegation that git lineage mirrors
- **Persistence Requirements (PER):** Defines IPFS storage; git supplements with code lineage
- **Observability Requirements (OBS):** Defines three levels of observability; git PRs enable human observability
