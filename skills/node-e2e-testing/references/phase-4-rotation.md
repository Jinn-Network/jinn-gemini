# Phase 4: Rotation Worker — Child Pickup (Docker)

**Prerequisites**: Phase 3 PASS (parent executed, child dispatched via `dispatch_new_job`)
**Abort on failure**: Continue

Test forced rotation switching by picking up the child job dispatched in Phase 3. Simulate activity on Service A so the rotator picks Service B. With `WORKER_MECH_FILTER_MODE=any`, Service B can claim the child even though it was dispatched to Service A's mech.

## Steps

### 1. Simulate activity for Service A

**Do this BEFORE running the worker.** This makes the rotator pick Service B.

From the monorepo root:
```bash
yarn test:e2e:vnet seed-activity $SERVICE_A_SAFE \
  --staking 0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139 \
  --value 1000
```

Expected: `Verified nonces: [ '1000', '1000' ]`

**Do NOT call checkpoint or advance time between activity seeding and the worker run.**

### 2. Run worker via Docker (picks up child from Phase 3)

The child job dispatched in Phase 3 is already on-chain. No new dispatch needed.

Stale telemetry files are cleaned automatically before the container starts.

```bash
yarn test:e2e:docker-run --cwd "$CLONE_DIR" \
  --workstream 0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac \
  --env X402_GATEWAY_URL=http://host.docker.internal:3001
```

`WORKER_MECH_FILTER_MODE=any` is set automatically, allowing Service B to pick up the child job even though it was dispatched to Service A's mech. Tool static config/secrets are fetched via the credential bridge at runtime; venture-scoped `JINN_JOB_*` config is already embedded in the dispatched payload.

### 3. Fallback: dispatch fresh job if no child

If Phase 3's `dispatch_new_job` failed (DELEGATE-001 was FAIL), the child won't be on-chain. In that case, dispatch a fresh job from the monorepo root:

```bash
yarn test:e2e:dispatch \
  --workstream 0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac \
  --cwd "$CLONE_DIR" \
  --input /tmp/e2e-input.json
```

Then re-run step 2.

### 4. Save telemetry

```bash
mkdir -p /tmp/jinn-telemetry-rotation
cp /tmp/jinn-telemetry/telemetry-*.json /tmp/jinn-telemetry-rotation/
echo "TELEMETRY_DIR_ROTATION=/tmp/jinn-telemetry-rotation" >> .env.e2e
```

## Expected Output

- Storage manipulation: `Verified nonces: [ '1000', '1000' ]`
- Worker output should show:
  - `Multi-service rotation active` — confirms ServiceRotator has 2 services
  - `activeService` set to Service B's config ID (not A)
  - `reason` — should indicate Service A is eligible, B needs work
- Worker finds the child request (dispatched by parent in Phase 3) or the fallback dispatch
- Child agent claims and processes the job (simpler blueprint: web search + artifact only)

## On Failure

- **tenderly_setStorageAt fails**: Capture RPC error. Ensure you're using the admin RPC URL (from VNet creation), not a public RPC.
- **Nonces don't verify to 1000**: Capture actual values. The storage slot calculation may be wrong for the contract version.
- **Worker picks Service A instead of B**: Capture full worker output. The rotator logic may have changed — document the `reason` field and which service was selected.
- **Worker finds 0 requests**: The child from Phase 3 may not have been indexed by Ponder yet. Check Ponder query output. If Phase 3's DELEGATE-001 failed, use the fallback dispatch (step 3).
- **Cross-mech pickup fails**: Check that `WORKER_MECH_FILTER_MODE=any` appears in the Docker command output. Without it, Service B won't find Service A's child request.

## CHECKPOINT: Phase 4 — Rotation Worker (Docker)

- [PASS|FAIL] `tenderly_setStorageAt` made Service A appear eligible (nonces verified as `[1000, 1000]`)
- [PASS|FAIL] Worker initialized rotation with 2 services
- [PASS|FAIL] Worker picked Service B as active (not Service A)
- [PASS|FAIL] Worker found and claimed request (child from Phase 3 or fallback)
- [PASS|FAIL] Agent executed and produced output
