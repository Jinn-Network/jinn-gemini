---
name: analyze-workstream
description: Use when debugging failed workstreams, investigating job failures, or when asked "why did this workstream fail?"
---

# Workstream Analysis Skill

You are debugging a workstream to identify why jobs failed and what can be done to fix them.

## Your Approach

This is **exploratory debugging**, not pattern matching. Your goal is to:
1. Gather evidence from the workstream
2. Look for anomalies (errors, unexpected status, missing data)
3. Trace causality through dispatch chains
4. Understand WHY failures occurred, not just what failed
5. Propose targeted fixes based on evidence

## Workflow

### Step 1: Triage - Get Overview

Run the inspection tool to get an overview of the workstream:

```bash
yarn inspect-workstream <workstream-id> --show-all --format=summary
```

From the summary, note:
- **Failure rate**: How many jobs failed vs completed?
- **Error distribution**: Which phases have errors? (delivery, execution, git, etc.)
- **Dispatch pattern**: Are there verification loops, recovery attempts, cycles?
- **Timing**: Are any jobs unusually slow?

If no failures exist, report "No failures detected" and stop.

### Step 2: Focus on Failures

Get detailed JSON data for failed jobs:

```bash
yarn inspect-workstream <workstream-id> --status=failed --show-all --raw --format=json
```

From the JSON output, identify:
- **Failed jobs**: Which specific jobs failed? (job names, request IDs)
- **Error messages**: What do the errors say?
- **Dispatch chain**: Which job is the root of the failure chain?

### Step 3: Trace Root Cause

Analyze the dispatch chain to find the root cause:
- Find the **deepest failed job** in the chain (earliest failure)
- Check if failures **cascade** (parent fails → children fail)
- Identify **auto-dispatch triggers** (verification, cycle, recovery, continuation)

The root cause is usually:
- The first job that failed in a chain
- The job whose failure caused downstream failures
- NOT the leaf job that just inherited a failure

### Step 4: Deep Dive into Root Cause Job

For the root cause job, get full details:

```bash
yarn inspect-job-run <request-id>
```

Extract from the job run:
- **Full error message** and stack trace (if any)
- **Tool calls**: Which tool failed? What error?
- **Phase**: Which phase failed? (git_operations, execution, delivery)
- **Telemetry**: Token usage, timing, tool metrics
- **measurementCoverage**: Were invariants measured?

### Step 5: Check Context/Invariants (if relevant)

If the job has invariant-related issues:
- Check `measurementCoverage.coveragePercent` - Is it < 100%?
- Check `measurementCoverage.unmeasuredIds` - Which invariants weren't measured?
- Check tool calls for `create_measurement` - Any with `success: false`?

### Step 6: Analyze and Propose Fix

Based on ALL the evidence gathered:

1. **What actually happened?**
   - Describe the failure chain from root cause to final state
   - Be specific: which job, which tool, which phase

2. **Why did it fail?**
   - Root cause analysis - the underlying reason, not just the symptom
   - Example: "Git merge conflict" is a symptom; "Concurrent edits to same file" is the cause

3. **Recommended fix**
   - Specific, actionable steps based on the evidence
   - Not generic advice - tailored to this specific failure

4. **How to verify**
   - How to confirm the fix worked
   - What to check in a retry

## Output Format

```
## Workstream Analysis: <workstream-id>

### Summary
- Status: X completed, Y failed, Z pending
- Affected jobs: <list of failed job names>

### What Happened
<Narrative explanation tracing the failure from root cause through the dispatch chain>

### Why It Failed
<Root cause analysis - the underlying reason, not just the symptom>

### Evidence
- <Specific data points: error messages, request IDs, tool failures>
- <Telemetry findings: timing, coverage, tool metrics>

### Recommended Fix
<Specific steps to address the root cause>

### How to Verify
<How to confirm the fix worked when re-running>
```

## Example: Tool Failure

If you find a tool failed repeatedly:

```
## Workstream Analysis: 0x123abc...

### Summary
- Status: 5 completed, 3 failed, 0 pending
- Affected jobs: code-reviewer, test-runner, code-reviewer (retry)

### What Happened
The root job `code-reviewer` (req: 0xabc...) failed during execution phase.
The tool `github_create_pr` failed with error "Resource not found".
This caused 2 child jobs to fail: `test-runner` (couldn't find PR to test) and a retry of `code-reviewer`.

### Why It Failed
The GitHub API returned 404 because the repository was renamed from `old-repo` to `new-repo`.
The job blueprint still references `old-repo` in the repository URL.

### Evidence
- Request 0xabc... tool call #12: github_create_pr failed with 404
- Error message: "Repository not found: owner/old-repo"
- Job blueprint contains: "repository": "owner/old-repo"

### Recommended Fix
Update the job definition blueprint to use the correct repository name:
1. Find job definition: 0xdef...
2. Update blueprint.repository from "owner/old-repo" to "owner/new-repo"
3. Re-dispatch the job

### How to Verify
After re-running, check:
1. The `github_create_pr` tool call succeeds (status 201)
2. Child jobs complete without inherited failures
```

## Debugging Tips

- **Large workstreams**: Use `--status=failed` to focus only on problems
- **Deep hierarchies**: Use `--depth=N` to limit tree depth
- **Recent failures**: Use `--since=<timestamp>` to filter by time
- **Full data**: Use `--raw` to see all errors without truncation
- **Specific job history**: Use `yarn inspect-job <job-def-id>` for repeat failures

## Key Commands Reference

```bash
# Full overview with all sections
yarn inspect-workstream <id> --show-all --format=summary

# Failed jobs only, full JSON
yarn inspect-workstream <id> --status=failed --show-all --raw --format=json

# Specific job execution details
yarn inspect-job-run <request-id>

# Job definition history (all runs)
yarn inspect-job <job-def-id>
```
