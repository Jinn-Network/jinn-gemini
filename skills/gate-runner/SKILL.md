---
name: gate-runner
description: Progressive integration validation with iterative fix-and-retry loop. Runs gates tier by tier — unit, inspect, tenderly, canary, smoke — and when one fails, diagnoses the failure, fixes the code, commits, and retries. Use when asked to "run gates", "validate integration", "run the pipeline", or "gate-runner".
allowed-tools: Bash Read Edit Write Glob Grep
user-invocable: true
disable-model-invocation: true
---

# Gate Runner

Progressive integration validation with an iterative fix-and-retry loop.

## Quick Start

```
/gate-runner                  # Resume or start with profile=full
/gate-runner quick            # Unit + inspect only (~2 min)
/gate-runner standard         # + Tenderly E2E (~35 min)
/gate-runner full             # + canary + smoke (~90 min)
```

## How It Works

1. Read `.tmp/gate-runner/state.json` + `.tmp/gate-runner/session-log.md`
2. If state exists with FAIL/PENDING gates → **resume** from current tier
3. If no state → **initialize** with all gates PENDING
4. Run gates tier by tier, fix failures, retry, advance
5. On completion → produce final summary

## Profiles

| Profile | Tiers | Estimated Time | Use Case |
|---------|-------|----------------|----------|
| `quick` | unit, inspect | ~2 min | Fast sanity check |
| `standard` | + tenderly | ~35 min | Pre-merge validation |
| `full` | + canary, smoke | ~90 min | Release candidate |

---

## Step 0: Initialize or Resume

### Resume (state.json exists)

```bash
# Read state and session log
cat .tmp/gate-runner/state.json
cat .tmp/gate-runner/session-log.md
```

Read the session-log.md header for current status. Resume from the last entry. Run `bd prime` to restore beads context.

### Initialize (no state)

Determine the profile from the argument (default: `full`). Determine the branch:

```bash
git branch --show-current
```

Read the gate registry to get all gate IDs for the profile:

```typescript
// tests/pipeline/gate-registry.ts
import { gateIdsForProfile } from './tests/pipeline/gate-registry.js';
```

Create initial state by writing `.tmp/gate-runner/state.json`:

```json
{
  "runId": "<branch>-<timestamp>",
  "branch": "<current-branch>",
  "profile": "<quick|standard|full>",
  "startedAt": "<ISO timestamp>",
  "currentTier": "unit",
  "ephemeralServices": {},
  "gates": { "<id>": { "status": "PENDING", "attempts": 0 } },
  "fixes": [],
  "recoveryNotes": ""
}
```

Create initial session-log.md with header (see Session Logging below).

---

## Step 1: Execute Tiers

Execute tiers in order. **Stop advancing** if a tier has unresolvable failures.

### Tier: unit

```bash
yarn vitest run 2>&1 | head -100
```

- Single gate: `UNIT`
- On pass: mark gate PASS, log tier pass
- On fail: read test output, diagnose, fix the production code (NOT the test), commit, retry

### Tier: inspect

```bash
yarn test:pipeline:inspect
```

- Runs all code inspection gates (P1-P6, CR9-CR12, W10-W12, C1, E1, N1-N4, F1-F5)
- On pass: mark all gates PASS
- On fail: read the output, check `failureHints` from the gate registry for each failing gate
- Fix the production code, commit, re-run only failing gates:

```bash
yarn test:pipeline:inspect -- --gates P4,CR9
```

### Tier: tenderly

Invoke the `/node-e2e-testing` skill. This tier uses AI judgment for failure diagnosis.

1. Run the e2e skill: `/node-e2e-testing`
2. Map phases to gates:
   - Phase 1 (setup): W1
   - Phase 2 (2nd service): W2, W3, W4
   - Phase 3 (worker): W5, W6, W7, W8, W9, W13
   - Phase 4 (rotation + creds): CR1, CR2, CR3, CR4, CR5
3. On failure:
   - Read the checkpoint output
   - Identify the failing phase
   - Fix the code
   - Re-run from the failing phase (not from scratch)

### Tier: canary

**Create ephemeral services first:**

```bash
yarn test:pipeline:canary:create --branch <branch> \
  --env-from-worker canary-worker-2 \
  --env-from-gateway x402-gateway-canary
```

Save the output service names to `state.json` → `ephemeralServices`.

**Run the canary harness:**

```bash
yarn test:railway:canary -- \
  --session pre-smoke \
  --repo Jinn-Network/jinn-node \
  --branch <branch> \
  --worker-service <ephemeral-worker> \
  --gateway-service <ephemeral-gateway> \
  --worker-project jinn-worker \
  --gateway-project jinn-shared
```

Map harness phases to gates:
- Phase 0 (preflight): part of CANARY_DEPLOY
- Phase 1 (deploy assert): CANARY_DEPLOY
- Phase 2 (baseline dispatch): CANARY_BASELINE
- Phase 3 (credential matrix): CANARY_CRED_TRUSTED, CANARY_CRED_UNTRUSTED, CANARY_FILTERING, CANARY_FAILCLOSED
- Phase 4 (log security): CANARY_SECURITY, CANARY_DELIVERY_RATE

On failure:
1. Read the artifact JSON from `.tmp/railway-canary-e2e/<run-id>/`
2. Diagnose the failure
3. Fix production code, commit, push to branch
4. If jinn-node/ changed: `yarn subtree:push` to push to standalone repo
5. Redeploy ephemeral services: `railway redeploy -s <service> -y`
6. Re-run only the failing phase

### Tier: smoke

```bash
yarn test:railway:canary -- \
  --session smoke \
  --worker-service <ephemeral-worker> \
  --gateway-service <ephemeral-gateway> \
  --worker-project jinn-worker \
  --gateway-project jinn-shared
```

- Single gate: CANARY_SMOKE (30-minute stability window)
- Not retryable — if it fails, investigate root cause before re-running

**Teardown ephemeral services after smoke (pass or fail):**

```bash
yarn test:pipeline:canary:teardown \
  --worker-service <ephemeral-worker> \
  --gateway-service <ephemeral-gateway>
```

---

## The Fix Loop

When a gate fails:

```
1. Log FAIL in session-log.md (error output, root cause, files to check)
2. Read failureHints from gate registry: tests/pipeline/gate-registry.ts
3. Read the failing source files
4. Diagnose root cause
5. Fix the PRODUCTION CODE (never weaken a gate assertion — Rule 2)
6. Commit the fix to the branch
7. Push to branch
8. If jinn-node/ changed: yarn subtree:push
9. Log FIX in session-log.md (file, change, commit SHA, subtree pushed?)
10. Re-run ONLY the failed gate
11. Max 3 retries per gate — then STOP and ask human
```

---

## Session Logging Protocol

**CRITICAL**: Update the session log after EVERY significant action. This is the compaction recovery mechanism AND the post-session review artifact.

### Session Log Structure

**File**: `.tmp/gate-runner/session-log.md`

**Header** (updated in-place after every state change):

```markdown
# Gate Runner Session — <branch>
Branch: <branch> | Profile: <profile> | Started: <timestamp>
Status: IN_PROGRESS | Current tier: <tier> | Gates: X/Y PASS, Z FAIL, W PENDING

## Recovery Instructions
1. Read this file top-to-bottom for full context
2. Read `.tmp/gate-runner/state.json` for current gate statuses
3. Run `bd prime` to restore beads context
4. Resume from the last log entry below
```

**Body** (append-only — never delete entries):

```markdown
---

## [HH:MM:SS] Tier: <tier> — START
<what you're about to run>

## [HH:MM:SS] Tier: <tier> — PASS
<summary: X/Y gates, time elapsed>

## [HH:MM:SS] Gate <id> — FAIL
<error output>
**Root cause**: <diagnosis>
**Files to check**: <list>

## [HH:MM:SS] FIX: <gate-id>
- File: `<path>`
- Change: <description>
- Commit: `<SHA>`
- Subtree pushed: yes/no

## [HH:MM:SS] RETRY: <gate-id> (attempt N)
<what you're re-running>
```

### When to Log

| Event | Log Entry |
|-------|-----------|
| Starting a tier | `Tier: <tier> — START` with what you'll run |
| Tier passes | `Tier: <tier> — PASS` with gate counts and time |
| Gate fails | `Gate <id> — FAIL` with error, root cause, files |
| Applying a fix | `FIX: <id>` with file, change, commit, subtree |
| Retrying a gate | `RETRY: <id> (attempt N)` |
| Run complete | `COMPLETE` or `STOPPED` with summary |

### State Updates

After every gate result:
1. Update `state.json` → `gates[id]`
2. Update `state.json` → `currentTier`
3. Update session-log.md header
4. If fix applied: add to `state.json` → `fixes[]`

---

## Rules

1. **Never finish with failing gates.** Either fix them or stop and escalate.
2. **Fix code, not tests.** Never weaken a gate assertion to make it pass.
3. **Update state.json** after every gate result change.
4. **Log every action** in session-log.md (START, PASS, FAIL, FIX, RETRY).
5. **Update session-log.md header** after every state change.
6. **Commit fixes** to the branch under test. Include descriptive messages.
7. **Push + subtree push** when jinn-node/ files change.
8. **Max 3 retries** per gate. After 3 failures, stop and report to human.
9. **Don't skip ahead.** A tier must fully pass before advancing.
10. **Teardown ephemeral services** when done (pass or fail).

---

## Recovery After Compaction

If you're resuming after context compaction:

1. Read `.tmp/gate-runner/session-log.md` — header has status + last action
2. Read `.tmp/gate-runner/state.json` — current gate statuses
3. Run `bd prime` to restore beads context
4. Find the last log entry — that's where you stopped
5. Continue from there

---

## Reference Files

| File | Purpose |
|------|---------|
| `tests/pipeline/gate-registry.ts` | Gate definitions: tiers, deps, failureHints |
| `scripts/test/pipeline/state.ts` | State + session log read/write helpers |
| `scripts/test/pipeline/inspect-gates.ts` | Automated code inspection checks |
| `scripts/test/pipeline/ephemeral-canary.ts` | Ephemeral Railway service lifecycle |
| `scripts/test/railway/canary-harness.ts` | Canary test orchestrator |
| `skills/node-e2e-testing/SKILL.md` | Tenderly E2E skill (used for tenderly tier) |

---

## Completion

When all gates pass:

1. Log `COMPLETE` entry in session-log.md with final summary
2. Update state.json — all gates PASS
3. Teardown ephemeral services if created
4. Print final gate status table
5. Clean up orphaned canary services:

```bash
yarn test:pipeline:canary:cleanup --max-age-hours 2
```

The session-log.md + state.json together are the review artifact. Share them for post-session audit.
