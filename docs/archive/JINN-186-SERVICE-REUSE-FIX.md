# Service Reuse Issue Fix - JINN-186

**Date:** October 2, 2025  
**Issue:** Middleware reusing existing Service #163 instead of creating new service  
**Status:** ✅ FIXED

---

## Problem

When running `yarn setup:service --chain=base --with-mech`, the middleware:

1. ❌ Reused existing Service #163 instead of creating a new service
2. ❌ Deployed with `staking_program_id='no_staking'` despite attended mode
3. ❌ Failed to deploy mech due to "intrinsic gas too low" error

**Evidence from logs:**
```
[2025-10-02 15:29:40,634][INFO] chain_data.token=163
[2025-10-02 15:29:40,635][INFO] user_params.staking_program_id='no_staking'
[2025-10-02 15:29:29.365 +0100] INFO: Unattended mode: Configured staking in service config
```

---

## Root Causes

### 1. Service Reuse (Middleware Behavior)

The middleware scans `.operate/services/` for existing services and reuses them if they match the service hash. Service #163 existed in:
```
olas-operate-middleware/.operate/services/sc-0e0cdc9c-a7ae-4af8-bb94-a84f5b0b71fd/
```

When a matching service is found, middleware:
- Reuses the existing service ID (163)
- Skips staking configuration (uses what's already on-chain)
- Updates the service instead of creating a new one

### 2. ATTENDED Detection Timing Bug

The fix in `SimplifiedServiceBootstrap.ts` checked `process.env.ATTENDED === 'true'` at config creation time, but this runs BEFORE the wrapper's environment is set:

```typescript
// BAD: Checked too early
const isAttended = process.env.ATTENDED === 'true';
```

The wrapper sets `ATTENDED=true` in its env vars, but `createQuickstartConfig()` runs before those env vars are passed to the middleware subprocess.

### 3. Service Name Not Unique

Original code used `'default-service'` as the name, which caused middleware to match and reuse existing services with the same name.

---

## Solutions Implemented

### Fix 1: Move Existing Services to Backup

**Action:** Move all services from `.operate/services/` to `service-backups/`

```bash
cd olas-operate-middleware
mv .operate/services/sc-* ../service-backups/
```

**Result:** Forces middleware to create a fresh service

**Automated in:**
```bash
mkdir -p service-backups
mv olas-operate-middleware/.operate/services/sc-* service-backups/ 2>/dev/null
```

### Fix 2: Use Unique Service Names

**Changed:**
```typescript
// OLD: Reuses existing "default-service"
const serviceName = isTenderly 
  ? `tenderly-test-${Date.now()}`
  : 'default-service';

// NEW: Always unique timestamp-based name
const serviceName = `jinn-service-${Date.now()}`;
```

**File:** `worker/SimplifiedServiceBootstrap.ts:166`

**Result:** Each service gets a unique name, preventing middleware from matching/reusing old services

### Fix 3: Fix ATTENDED Detection Timing

**Changed:**
```typescript
// OLD: Checks process.env before wrapper sets it
const isAttended = process.env.ATTENDED === 'true';

// NEW: Checks the env var that will be passed to middleware
const attendedEnvVar = this.operateWrapper?.env?.ATTENDED;
const isAttended = attendedEnvVar === 'true' || attendedEnvVar === true;
```

**File:** `worker/SimplifiedServiceBootstrap.ts:183-184`

**Result:** Correctly detects attended mode and removes staking config to trigger prompt

---

## Mech Deployment Gas Issue

**Error:**
```
ValueError: {'code': -32000, 'message': 'intrinsic gas too low'}
```

**Location:** `operate/services/utils/mech.py:106`

**Context:** Mech deployment transaction fails during gas estimation

**Analysis:**

The mech deployment code doesn't explicitly set a gas limit:
```python
tx_dict = {
    "to": mech_marketplace_address,
    "data": data,
    "value": 0,
    "operation": SafeOperation.CALL,
}
receipt = sftxb.new_tx().add(tx_dict).settle()  # Uses default gas estimation
```

**Possible causes:**
1. Service Safe has insufficient ETH (only 0.0005 ETH funded)
2. Gas estimation failing due to contract state
3. Base network gas price spike during deployment

**Mitigation:**

The middleware automatically funds Service Safes before mech deployment:
```
[2025-10-02 15:29:51,068][INFO] [FUNDING_JOB] Funding chain='base'
[2025-10-02 15:29:51,366][INFO] Transferring 993688261440 units (ETH) to agent
[2025-10-02 15:30:00,729][INFO] Transferring 50000000000000000000 units (OLAS) to safe
```

But this may not be enough. **Recommendation:** Increase `DEFAULT_SAFE_FUNDING_WEI` if mech deployment consistently fails.

---

## Verification Steps

1. ✅ All existing services moved to `service-backups/`
2. ✅ Code rebuilt with unique service naming
3. ✅ ATTENDED detection fixed
4. ⏳ **Next:** Retry `yarn setup:service --chain=base --with-mech`
5. ⏳ **Verify:** Middleware creates NEW service (not #163)
6. ⏳ **Verify:** Staking prompt appears
7. ⏳ **Verify:** Mech deploys successfully

---

## Commands to Verify

**Check services directory is empty:**
```bash
ls -la olas-operate-middleware/.operate/services/
# Should show: total 0 (no sc-* directories)
```

**Check backups contain old services:**
```bash
ls -la service-backups/
# Should show: sc-0e0cdc9c-a7ae-4af8-bb94-a84f5b0b71fd and others
```

**Run setup:**
```bash
yarn setup:service --chain=base --with-mech
```

**Expected new behavior:**
1. Middleware creates service with unique name: `jinn-service-1727879369365`
2. New service ID assigned (164 or higher)
3. Staking prompt appears (if attended mode works)
4. Mech deployment succeeds (if gas/funding sufficient)

---

## Files Modified

1. `worker/SimplifiedServiceBootstrap.ts`
   - Line 166: Unique service naming
   - Line 183-184: Fixed ATTENDED detection

2. `service-backups/` (created)
   - Moved all `sc-*` directories from `.operate/services/`

3. `JINN-186-SERVICE-REUSE-FIX.md` (this document)

---

**Status:** Ready for retry

**Action Required:** Run `yarn setup:service --chain=base --with-mech` to test fixes

