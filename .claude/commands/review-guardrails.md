---
argument-hint: [file-path] or [directory] or --diff
description: Review automation for secret guardrails (r4 / db7 / db8)
allowed-tools: Read, Glob, Grep, Bash(git diff:*)
---

# Code Spec Review: Guardrails (Secrets Automation)

You are reviewing code for violations of:
- **Rule r4:** Enforce automated secret guardrails
- **Default behavior db7:** Keep ephemeral secret fixtures out of tracked repos
- **Default behavior db8:** Validate staged content before auto-commit

## Step 1: Read the Specification

Before analyzing code:
1. Read `docs/spec/code-spec/spec.md` focusing on r4, db7, and db8.
2. Read supporting examples:
   - `docs/spec/code-spec/examples/r4.md`
   - `docs/spec/code-spec/examples/db7.md`
   - `docs/spec/code-spec/examples/db8.md`

## Step 2: Determine the Analysis Target

Based on `$ARGUMENTS`:
- `--diff`: Review staged changes (`git diff --cached`), falling back to `git diff HEAD` if nothing staged.
- File path (e.g., `worker/mech_worker.ts`): Review the full file.
- Directory path (e.g., `tests/`): Use Glob to inspect all `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, `.py`, `.sh`, or configuration files inside.
- No argument: Default to the repository root.

## Step 3: Search for Guardrail Violations

Focus on automation that touches git state or writes `.operate` data.

### 1. Missing staged-tree validation (r4, db8)
- Look for functions that call `git commit`, `git push`, or `git add --all` without a preceding `gitGuard.ensureSafeStagedTree()` call.
- Common locations: worker automation (`worker/mech_worker.ts`), scripts under `codespec/scripts/`, CI tooling, test harnesses.
- Grep helpers:
  ```bash
  grep -R "git\\.commit" -n $TARGET_FILES
  grep -R "git\\.push" -n $TARGET_FILES
  grep -R "git add --all" -n $TARGET_FILES
  ```
- Flag paths where commit/push occurs without the guard being invoked in the same flow.

### 2. Secret fixtures living inside repos (db7)
- Identify code that creates `.operate`, `.operate-test`, or similar directories relative to `process.cwd()` or the repo root.
- Grep helpers:
  ```bash
  grep -R "\\.operate" -n tests/ worker/ scripts/
  grep -R "process\\.cwd()" -n tests/ worker/ scripts/
  ```
- Violations include writing to `.operate*` paths within the repository instead of to a temp directory (`os.tmpdir()` / `tmpdir()` / shared helper).

### 3. Bypassing canonical secret guard (r4)
- For automation helpers that already call `gitGuard.ensureSafeStagedTree()`, confirm they do so every time before commit/push.
- Ensure no alternate path skips the guard (e.g., early returns, conditional commits, legacy helpers).
- Watch for custom allowlists that disable guard checks without documentation.

## Step 4: Confirm Violations

For each finding:
1. Read surrounding context to ensure it's an actual violation (not tests deliberately mocking guard behavior).
2. Verify it impacts real automation (production worker, CI scripts, real tests) rather than isolated examples.
3. Cross-reference spec clauses (r4, db7, db8) to cite the correct pattern.

## Step 5: Report Findings

Output each violation using the exact format:
```
File: <path>
Line: <number>
Issue: <summary of the violation>
Pattern reference: r4, db8
Current code:
<excerpt>
Suggested fix:
<corrected code or remediation steps>
---
```

Guidelines:
- Include both rule and default behavior references as applicable (e.g., `r4, db8`).
- Keep explanations concise but actionable.
- Provide suggested fixes that align with the spec (e.g., “Call gitGuard.ensureSafeStagedTree() before git.commit()” or “Write fixtures to tmpdir() instead of process.cwd()”).
