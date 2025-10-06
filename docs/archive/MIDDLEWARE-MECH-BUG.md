# Middleware Mech Deployment Bug

**Date:** 2025-10-01  
**Status:** ❌ **BLOCKING** - Prevents mech deployment completion  
**Severity:** High - Service deployment fails after mech is created on-chain

---

## Summary

The middleware successfully deploys a mech contract on-chain but crashes immediately after with `KeyError: 'GNOSIS_LEDGER_RPC'`. The bug is a variable name mismatch in the middleware code.

---

## Error Details

**Error:**
```
KeyError: 'GNOSIS_LEDGER_RPC'
  File ".../operate/services/manage.py", line 1160, in _deploy_service_onchain_from_safe
    "ETHEREUM_LEDGER_RPC_0": service.env_variables["GNOSIS_LEDGER_RPC"]["value"]
                             ~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^
```

**Location:** `operate/services/manage.py:1160`

**Root Cause:** Middleware expects `GNOSIS_LEDGER_RPC` (no suffix) but the service config correctly provides `GNOSIS_LEDGER_RPC_0` (with `_0` suffix).

---

## What Works

✅ **Mech deployment succeeds:**
- Service 158 deployed on Base mainnet
- Mech contract: `0x436FC548d0cF78A71852756E9b4dD53077d2B06c`
- Service Safe: `0x85cCa19f096cdaE00057c1CB1a26281bB47Cd5CE`
- All on-chain transactions complete successfully

❌ **Post-deployment config update fails:**
- Middleware crashes after mech deployment
- `AGENT_ID` and `MECH_TO_CONFIG` never get written to service config
- Service left in incomplete state (mech deployed but not configured)

---

## Service Config State

Our service config correctly provides:
```json
{
  "env_variables": {
    "GNOSIS_LEDGER_RPC_0": {
      "value": "",
      "provision_type": "computed"
    },
    "ETHEREUM_LEDGER_RPC_0": {
      "value": "",
      "provision_type": "computed"
    }
  }
}
```

---

## Middleware Bug

**File:** `operate/services/manage.py`  
**Line:** ~1160

**Current (broken) code:**
```python
"ETHEREUM_LEDGER_RPC_0": service.env_variables["GNOSIS_LEDGER_RPC"]["value"]
#                                                ^^^^^^^^^^^^^^^^^
#                                                Missing _0 suffix!
```

**Expected code:**
```python
"ETHEREUM_LEDGER_RPC_0": service.env_variables["GNOSIS_LEDGER_RPC_0"]["value"]
#                                                ^^^^^^^^^^^^^^^^^^^
#                                                Correct variable name
```

---

## Impact

1. **Service 158 state:**
   - ✅ Deployed on-chain
   - ✅ Mech deployed
   - ❌ Missing `AGENT_ID` in config
   - ❌ Missing `MECH_TO_CONFIG` in config
   - ❌ Cannot be used by worker (incomplete config)

2. **No fund loss:** Agent EOA and Service Safe are empty (funds never transferred from Master Safe).

3. **Recovery:** Service 158 backed up to `service-backups/service-158-20251001-185810/`

---

## Workarounds Attempted

### 1. ❌ Add `GNOSIS_LEDGER_RPC` (no suffix)

**Tried:** Added `GNOSIS_LEDGER_RPC` to config alongside `GNOSIS_LEDGER_RPC_0`.

**Result:** Would work but violates middleware's own naming convention (all RPC vars use `_0` suffix for multi-chain support).

### 2. ✅ **Recommended: Wait for middleware fix**

This is a clear bug in the middleware codebase. The fix is trivial (add `_0` suffix).

---

## Next Steps

1. **Report to OLAS team:**
   - File: `operate/services/manage.py:1160`
   - Issue: `KeyError: 'GNOSIS_LEDGER_RPC'` should be `'GNOSIS_LEDGER_RPC_0'`
   - Context: Mech deployment in `_deploy_service_onchain_from_safe`

2. **After middleware fix:**
   - Clean service 158: `rm -rf olas-operate-middleware/.operate/services/sc-1e296607-5470-41a7-ade6-7368c888a4a8`
   - Retry: `yarn setup:service --chain=base --with-mech`

3. **Alternative (if urgent):**
   - Fork middleware
   - Apply one-line fix to `manage.py:1160`
   - Use forked version until upstream fix

---

## Testing Details

**Command:** `yarn setup:service --chain=base --with-mech`

**Timeline:**
- 18:12:27 - Service minting started
- 18:12:28 - Service 158 minted
- 18:12:33 - Service activated
- 18:12:38 - Agent registered
- 18:12:43 - Service deployed
- 18:12:43 - **Mech deployment started** ✅
- 18:12:48 - **Mech deployed successfully** ✅ (tx: `0x753f14ae...`)
- 18:12:53 - **Crashed with KeyError** ❌

**Total time:** 26 seconds from start to crash

---

## Related Files

- **Service backup:** `service-backups/service-158-20251001-185810/`
- **Mech config:** `worker/config/MechConfig.ts`
- **Bootstrap script:** `scripts/interactive-service-setup.ts`

---

## Message for OLAS Team

```
Hi OLAS team,

We're successfully deploying mech contracts using `quickstart --attended=true` with 
`use_mech_marketplace: true`, but the middleware crashes immediately after mech 
deployment with:

  KeyError: 'GNOSIS_LEDGER_RPC'
  File: operate/services/manage.py, line ~1160

The issue is a variable name mismatch. Our service config correctly provides 
`GNOSIS_LEDGER_RPC_0` (with _0 suffix), but line 1160 tries to read 
`GNOSIS_LEDGER_RPC` (without suffix).

Current (broken):
  "ETHEREUM_LEDGER_RPC_0": service.env_variables["GNOSIS_LEDGER_RPC"]["value"]

Expected:
  "ETHEREUM_LEDGER_RPC_0": service.env_variables["GNOSIS_LEDGER_RPC_0"]["value"]

The mech deployment itself works perfectly (tx confirms on-chain), but the 
post-deployment config update fails.

Config structure:
{
  "configurations": {
    "base": {
      "use_mech_marketplace": true
    }
  },
  "env_variables": {
    "MECH_MARKETPLACE_ADDRESS": {"value": "0x...", "provision_type": "fixed"},
    "AGENT_ID": {"value": "", "provision_type": "computed"},
    "MECH_TO_CONFIG": {"value": "", "provision_type": "computed"},
    "ON_CHAIN_SERVICE_ID": {"value": "", "provision_type": "computed"},
    "ETHEREUM_LEDGER_RPC_0": {"value": "", "provision_type": "computed"},
    "GNOSIS_LEDGER_RPC_0": {"value": "", "provision_type": "computed"}
  }
}

Functions used:
- operate quickstart --attended=true
- use_mech_marketplace: true in config
- deploy_mech() (called from _deploy_service_onchain_from_safe)

Is this a known issue? Can we work around it, or do we need to wait for a fix?

Thanks!
```

