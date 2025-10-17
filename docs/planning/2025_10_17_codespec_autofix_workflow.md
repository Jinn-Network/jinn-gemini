# CodeSpec Autonomous Fix Workflow (Clauses-Based, PR-Gated)

## Purpose

- Establish a consistent, autonomous loop to detect, track, fix, verify, and merge changes aligned with the CodeSpec.
- Maintain a single source of truth for violations and their lifecycle.
- Only open PRs when the fix is proven: spec review passes and tests pass; otherwise, leave the worktree open and clearly signal “needs human input.”

## Clauses

- Use a single concept “clauses” for both rules and objectives; multiple clauses can apply to one finding.
- Allowed IDs (current and future):
  - Rules: `r1`, `r2`, `r3`
  - Objectives: `obj1`, `obj2`, `obj3`
  - Default behaviors (future): `db1`, `db2`, …

## Violations Ledger

- Location: `.codespec/ledger.jsonl` (append-only; one JSON object per finding).
- Fields:
  - `id`: stable handle for the finding
  - `clauses: string[]`: e.g., `["r1","obj3"]`
  - `severity`: `critical|high|medium|low|info`
  - `path`, `line`, `title`, `description`, `suggested_fix`
  - `fingerprint`: deterministic hash for dedupe
  - `first_seen`, `last_seen`
  - `status`: `open|triaged|in_progress|pr_open|merged|verified|closed|suppressed`
  - `owner`, `worktree_branch`, `pr_url` (optional)
- Fingerprint:
  - `sha1( sort(clauses).join('|') + '|' + normalized_path + '|' + stable_code_span_hash )`
  - Sort clauses to ensure determinism when multiple apply.

Example:

```json
{
  "id": "V-9c2f1a",
  "clauses": ["r1","obj3"],
  "severity": "critical",
  "path": "scripts/recover-default-service-olas.ts",
  "line": 15,
  "fingerprint": "9a8f...e2",
  "title": "Hardcoded secret in recovery script",
  "description": "Private key committed; violates Never Commit Secrets and Minimize Harm.",
  "suggested_fix": "Read from env var; validate presence; never log value.",
  "first_seen": "2025-01-12T11:15:00Z",
  "last_seen": "2025-01-12T11:15:00Z",
  "status": "open",
  "owner": "security"
}
```

## Suppressions

- File: `.codespec/suppressions.yml`
- Keys: `fingerprint`, `justification`, `owner`, `expires_at`
- Behavior: Suppressed findings remain visible but do not gate merges.

## Context Object (No Policy)

- Minimal inputs to guide the autofix; no embedded “policy” block.
- Fields:
  - `run`: `id`, `timestamp`, `branch` (optionally `base_commit`)
  - `clauses: string[]`: clause set targeted in this run
  - `spec_refs`: file pointers for spec and examples
  - `violations[]`: `{ id, clauses[], path, line, code_span, description, suggested_fix, fingerprint }`
  - `targets`: `{ files_whitelist[] }` (edit scope)

Example:

```json
{
  "run": { "id": "run-20250112-111500", "timestamp": "2025-01-12T11:15:00Z", "branch": "fix/codespec/r1+obj3/recover-olas-keys" },
  "clauses": ["r1","obj3"],
  "spec_refs": {
    "spec": "docs/spec/code-spec/spec.md:1",
    "frontend": "frontend/spec/src/pages/code-spec.md:1",
    "examples": [
      "docs/spec/code-spec/examples/obj1.md:1",
      "docs/spec/code-spec/examples/obj2.md:1",
      "docs/spec/code-spec/examples/obj3.md:1",
      "docs/spec/code-spec/examples/r1.md:1",
      "docs/spec/code-spec/examples/r2.md:1",
      "docs/spec/code-spec/examples/r3.md:1"
    ]
  },
  "violations": [
    {
      "id": "V-9c2f1a",
      "clauses": ["r1","obj3"],
      "path": "scripts/recover-default-service-olas.ts",
      "line": 15,
      "code_span": "const AGENT_KEY_PRIVATE_KEY = '0x...';",
      "description": "Private key committed in code.",
      "suggested_fix": "Use process.env.AGENT_KEY_PRIVATE_KEY and validate it.",
      "fingerprint": "9a8f...e2"
    }
  ],
  "targets": { "files_whitelist": ["scripts/recover-default-service-olas.ts"] }
}
```

## Workflows

- Pre-Commit Guard (fast, strict)
  - Trigger: pre-commit on staged diffs
  - Scope: Diff-only
  - Checks: Security + rules (obj3, r1–r3); optionally obj1/obj2
  - Gate: Block on rule/security; warn on obj1; info on obj2

- Pre‑PR / CI Gate (on PR diff)
  - Trigger: PR opened/updated
  - Scope: PR diff
  - Checks: Full spec (obj1/obj2/obj3 and r1–r3)
  - Gate: Block on new rule/security violations; warn/info for obj1/obj2

- Baseline Audit (whole repo)
  - Trigger: Manual or scheduled
  - Scope: Entire codebase
  - Output: Updated violations report/backlog; not blocking

## Autofix Flow

- Select target(s): one finding or small cluster (same path + clauses)
- Create isolated worktree + branch: `fix/codespec/<clauses-joined>/<slug>`
- Build context object (above) for the fix run
- Run Claude Code fix with a dedicated prompt (e.g., `/codespec-fix --context <path>`)
- Verify locally:
  - Run CodeSpec review on changed files
  - Run tests (`yarn test:all` or scoped)
- Decision:
  - Open PR only if changes exist AND spec review passes AND tests pass
  - Otherwise, leave the worktree open and write a “needs human input” marker (status + log pointers)

## PR Rules and Conventions

- Gates:
  - New `r1|r2|r3` and `obj3` violations block merges
  - `obj1` warns; `obj2` informs (non‑blocking)
- PR Title: `[codespec r1+obj3] <summary>`
- PR Body: Clauses affected, before/after, verification results, linked ledger IDs
- Labels/Owners: one label per clause (e.g., `codespec-r1`, `codespec-obj3`), owner mapping via `.codespec/owners.yml`

## Ownership and Triage

- Map clauses to owners in `.codespec/owners.yml` (e.g., `r1`: Security; `r2`: Protocol; `r3`: Reliability; `obj*`: Tech Lead)
- Cluster findings by clause→path; assign owner; prioritize by severity

## Modes

- Conservative: fix only `r1–r3`/`obj3` locally; no public API changes
- Standard: include trivial local `obj1/obj2` improvements when obvious
- Migration: larger orthodoxy refactors in dedicated worktrees

## Integration Points

- Reviews: reuse `codespec/scripts/detect-violations.sh` (+ `review-obj1.sh`, `review-obj2.sh`, `review-obj3.sh`)
- Spec sources: `docs/spec/code-spec/spec.md`, `frontend/spec/src/pages/code-spec.md`, `docs/spec/code-spec/examples/*`
- Reports: generate/refresh `docs/spec/code-spec/VIOLATIONS.md` from the ledger

## Next Steps (Non-Implementing)

- Confirm this plan
- Then scaffold `.codespec/` (ledger, suppressions, owners, prompts)
- Add non-destructive orchestration to create worktrees, generate context, invoke fix, verify, and PR only when green

