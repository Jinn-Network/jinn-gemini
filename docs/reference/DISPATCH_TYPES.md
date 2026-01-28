# Dispatch Types Reference

Quick reference for dispatch types and auto-recovery mechanisms.

---

## Dispatch Types

When viewing workstream dispatch chains, you'll see type annotations like `[verification]` or `[loop_recovery]`. Here's what each means:

### manual

User or script triggered dispatch. Entry point for a workstream.

```
○ Community Hub Template – H3N         ← manual (root)
```

### verification

Parent job re-dispatched to verify children's integrated work.

- Triggered when all children complete
- Parent reviews merged code before marking complete
- Up to 3 verification attempts

```
✓ Site Manager [verification]          ← Re-run to verify children
```

### parent

Parent auto-dispatched when children complete.

- Uses Control API to claim dispatch slot
- Prevents concurrent parent execution
- Continues parent's workflow after children finish

```
✓ Content Manager [parent]             ← Auto-dispatched after children
```

### cycle

Cyclic job auto-restart after completion.

- Job definition has `cyclic: true`
- Tracks cycle number and previous request ID
- Used for continuous/recurring workstreams

```
○ Daily Monitor [cycle]                ← Cycle #2, #3, etc.
```

### continuation

Job continued from a checkpoint when child work not yet integrated.

- Parent re-dispatched to continue integration work
- Prevents parent completion until all code integrated

---

## Recovery Dispatches

Recovery dispatches are **normal system behavior** - they indicate the system detected a problem and automatically recovered.

### loop_recovery

Triggered when agent hits repetition threshold (10+ identical lines in output).

- Agent was stuck in a loop
- Process was killed
- Job auto-redispatched with recovery context

**Context includes:**
- `loopMessage` - Why loop was detected
- `attempt` - Recovery attempt number (1-indexed)
- `previousRequestId` - The terminated run

```
○ Ecosystem Research Specialist [loop_recovery]
```

### timeout_recovery

Triggered when execution exceeds the response timeout.

- Agent took too long
- Process was terminated
- Job auto-redispatched

**Context includes:**
- `attempt` - Recovery attempt number
- `triggeredAt` - When timeout occurred

```
○ Ecosystem Research Specialist [timeout_recovery]
```

---

## Dispatch Cooldowns

To prevent infinite loops, there's a **5-minute cooldown** between same parent/child dispatch pairs.

If a parent-child dispatch pattern repeats within 5 minutes, the system will block it.

---

## Recovery Context in Jobs

When a job is dispatched due to recovery, it receives additional context:

```typescript
additionalContext: {
  loopRecovery?: {
    attempt: number,           // 1-indexed
    loopMessage: string,       // Why terminated
    triggeredAt: string,       // Timestamp
    previousRequestId?: string // Terminated run
  },

  timeoutRecovery?: {
    attempt: number,           // 1-indexed
    triggeredAt: string        // Timestamp
  },

  verificationRequired?: boolean,
  verificationAttempt?: number,

  cycle?: {
    isCycleRun: boolean,
    cycleNumber: number,
    previousCycleRequestId?: string
  }
}
```

---

## Interpreting Dispatch Chains

When analyzing a workstream:

1. **Multiple recovery dispatches** for same job may indicate a persistent issue
2. **Verification dispatches** are normal - parent reviewing children
3. **Parent dispatches** are normal - workflow continuation
4. **Cycle dispatches** are normal for continuous workstreams

**Not a problem:**
```
○ Job A [loop_recovery]        ← System recovered
✓ Job A                        ← Later run succeeded
```

**May need investigation:**
```
○ Job A [loop_recovery]        ← Attempt 1
○ Job A [loop_recovery]        ← Attempt 2
○ Job A [loop_recovery]        ← Attempt 3 - persistent issue?
```

---

## Related Documentation

- Worker internals: `docs/documentation/WORKER_INTERNALS.md`
- Job lifecycle: `docs/documentation/JOB_TERMINOLOGY.md`
- Auto-dispatch code: `worker/status/autoDispatch.ts`
