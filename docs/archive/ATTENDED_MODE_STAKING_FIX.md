# Attended Mode Staking Prompt Fix

**Date:** October 2, 2025  
**Issue:** Middleware not prompting for staking configuration in attended mode  
**Status:** ✅ FIXED

---

## Problem

When running `yarn setup:service --chain=base --with-mech`, the middleware was **not prompting** the user to select a staking option, even though `ATTENDED=true` was set.

**Expected behavior:**
```
Select staking option:
[1] No staking
[2] Custom staking contract
Enter choice:
```

**Actual behavior:**
Service was deployed with pre-configured staking (or no staking), skipping the interactive prompt entirely.

---

## Root Cause

In `SimplifiedServiceBootstrap.ts` (lines 182-194), we were **explicitly setting** `staking_program_id` and `use_staking` in the service configuration file before calling middleware's quickstart.

```typescript
// OLD CODE (WRONG)
serviceConfig.configurations[this.config.chain].staking_program_id = 'agents_fun_1';
serviceConfig.configurations[this.config.chain].use_staking = true;
```

**Middleware behavior:**
- If `staking_program_id` is **present** in config → middleware assumes staking is already configured → **skips prompt**
- If `staking_program_id` is **absent/undefined** in config → middleware shows interactive prompt

---

## Solution

Detect whether we're in attended or unattended mode, and handle staking configuration accordingly:

```typescript
// NEW CODE (CORRECT)
const isAttended = process.env.ATTENDED === 'true';

if (isAttended) {
  // ATTENDED MODE: Remove staking config to trigger middleware prompt
  delete serviceConfig.configurations[chain].staking_program_id;
  delete serviceConfig.configurations[chain].use_staking;
} else {
  // UNATTENDED MODE: Set explicitly to avoid prompts
  serviceConfig.configurations[chain].staking_program_id = 'agents_fun_1';
  serviceConfig.configurations[chain].use_staking = true;
}
```

---

## Implementation

**File Changed:** `worker/SimplifiedServiceBootstrap.ts`

**Lines:** 181-208

**Key Changes:**
1. Check `ATTENDED` environment variable
2. If attended: **delete** staking fields from config
3. If unattended: **set** staking fields explicitly

---

## Testing

**Before fix:**
```bash
yarn setup:service --chain=base --with-mech
# Result: No staking prompt, service deployed without staking
```

**After fix:**
```bash
yarn setup:service --chain=base --with-mech
# Expected output:
#   Select staking option:
#   [1] No staking
#   [2] Custom staking contract
#   Enter choice: 2
#   Enter staking contract address: 0x2585e63df7BD9De8e058884D496658a030b5c6ce
```

---

## Attended vs Unattended Mode

### Attended Mode (Interactive)

**When to use:** Manual deployments, first-time setup, mainnet operations

**Configuration:**
```bash
ATTENDED=true
OPERATE_PASSWORD=12345678
BASE_LEDGER_RPC="https://mainnet.base.org"
# No STAKING_PROGRAM env var needed - user will be prompted
```

**Behavior:**
- Middleware shows interactive prompts
- User selects staking option manually
- Real-time funding instructions
- Auto-continues when funded

### Unattended Mode (Programmatic)

**When to use:** CI/CD, automated tests, Tenderly testing

**Configuration:**
```bash
ATTENDED=false
OPERATE_PASSWORD=12345678
BASE_LEDGER_RPC="https://mainnet.base.org"
STAKING_PROGRAM="custom_staking"  # Must be set explicitly
CUSTOM_STAKING_ADDRESS="0x2585e63df7BD9De8e058884D496658a030b5c6ce"
```

**Behavior:**
- No interactive prompts
- Staking configured via env vars
- Requires pre-funded addresses
- Fails immediately if funds insufficient

---

## Why This Matters

**User expectation:** "I should be able to choose my staking contract when deploying"

**Previous behavior:** Staking was pre-configured, no choice offered

**New behavior:** User is prompted to select staking option and enter contract address

This aligns with OLAS middleware's intended UX and gives users full control over staking configuration.

---

## Related Issues

- **JINN-186:** Full validation of OLAS service staking implementation
- **JINN-202:** Simplified interactive service setup
- **JINN-204:** Validate service staking on Tenderly Virtual TestNet

---

## Documentation Updates

**Updated files:**
1. `worker/SimplifiedServiceBootstrap.ts` - Core fix
2. `ATTENDED_MODE_STAKING_FIX.md` - This document
3. `AGENT_README.md` - Updated attended mode section (if needed)

**Intro text updated:**
- Now explains that staking prompt will appear
- Shows expected options [1] No staking, [2] Custom staking
- Provides AgentsFun1 contract address for reference

---

## Verification Checklist

- [x] Code fix implemented
- [x] Build succeeds (`yarn build`)
- [ ] Manual test: Run `yarn setup:service --chain=base --with-mech`
- [ ] Verify staking prompt appears
- [ ] Verify selecting option 2 + entering address works
- [ ] Verify service deploys with staking
- [ ] Update AGENT_README if needed

---

**Status:** Ready for testing

**Next step:** Run manual test to confirm staking prompt now appears correctly.

