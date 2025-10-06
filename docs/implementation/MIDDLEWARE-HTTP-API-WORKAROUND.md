# Middleware HTTP API Workaround

**Status:** Temporary workaround (JINN-202)  
**Issue:** Middleware HTTP API `/api/services` endpoint failing  
**Impact:** Cannot use `OlasOperateWrapper` HTTP-based service creation  
**Workaround:** Use CLI `quickstart` command directly via `SimplifiedServiceBootstrap`

---

## Background

### Original Architecture (JINN-179 through JINN-186)

The OLAS integration was designed to use the middleware's **HTTP API**:

```typescript
// Preferred approach (currently broken)
const wrapper = await OlasOperateWrapper.create({ ... });
await wrapper.makeRequest('/api/services', { method: 'POST', ... });
```

**Advantages:**
- Structured request/response (JSON)
- Better error handling
- State management via API
- Programmatic control
- Type-safe interfaces

### Current Reality (JINN-202)

The HTTP API is **unreliable** after cleanup of corrupt services:

**Symptom:**
```
POST /api/services
→ 500 Internal Server Error
→ "Operation failed after multiple attempts"
```

**Root Cause (Suspected):**
- Mech config injection triggers middleware validation bugs
- Marketplace address `0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020` missing from `DEFAULT_PRIORITY_MECH`
- Service state corruption after 25+ failed deployments
- HTTP server state not fully reset after cleanup

---

## Workaround: CLI-Based Approach

### Implementation

**New class:** `SimplifiedServiceBootstrap` (JINN-202)

```typescript
// Workaround approach (currently used)
const bootstrap = new SimplifiedServiceBootstrap({
  chain: 'base',
  operatePassword: '12345678',
  rpcUrl: 'https://mainnet.base.org'
});

await bootstrap.bootstrap(); // Calls CLI directly
```

**How it works:**
1. Create quickstart config file (JSON)
2. Execute `poetry run operate quickstart config.json --attended=true`
3. Stream CLI output directly to user
4. Parse output for service info
5. No HTTP API involvement

### Trade-offs

**Advantages:**
- ✅ Works around HTTP API bug
- ✅ Uses battle-tested CLI code path
- ✅ Native middleware prompts (better UX)
- ✅ 73% code reduction (575 → 155 lines)
- ✅ Single atomic operation

**Disadvantages:**
- ❌ Less structured (parsing text output)
- ❌ Harder to unit test
- ❌ Can't inspect intermediate state
- ❌ Must spawn child process
- ❌ Error messages less detailed

---

## When to Switch Back

### Criteria for Reverting to HTTP API

Switch back to HTTP-based approach when:

1. **Bug Fixed:** Middleware HTTP API reliably creates services with mech config
2. **Validated:** JINN-186 unblocked and services deploy successfully via API
3. **Tested:** E2E tests pass using `OlasOperateWrapper.makeRequest()`
4. **Documented:** Middleware changelog confirms fix

### How to Revert

**Step 1: Update `OlasServiceManager`**

```typescript
// Current (CLI-based)
async deployAndStakeService() {
  const result = await this.operateWrapper.executeCommand(
    'quickstart',
    [configPath, '--attended=true']
  );
}

// Revert to (HTTP-based)
async deployAndStakeService() {
  const result = await this.operateWrapper.makeRequest(
    '/api/services',
    { method: 'POST', body: config }
  );
}
```

**Step 2: Deprecate `SimplifiedServiceBootstrap`**

Archive the class (keep for reference):
```bash
mv worker/SimplifiedServiceBootstrap.ts worker/archive/
```

**Step 3: Update CLI entry point**

```typescript
// Restore HTTP-based workflow
import { OlasServiceManager } from '../worker/OlasServiceManager.js';

const manager = await OlasServiceManager.createDefault();
await manager.deployAndStakeService();
```

**Step 4: Update documentation**

- Remove workaround notices from `AGENT_README.md`
- Update `JINN-186` issue with resolution
- Document HTTP API fix in changelog

---

## Testing the HTTP API

### Quick Validation Script

```bash
# Test if HTTP API is healthy
yarn tsx scripts/test-http-api-health.ts
```

**Script should test:**
1. Server starts successfully
2. `/api/account/login` works
3. `/api/services` POST succeeds
4. Service creation with mech config doesn't fail
5. Service state persists correctly

### Full Regression Test

Once HTTP API validated:

```bash
# Run full E2E test suite
yarn test:e2e

# Specifically test service creation via HTTP
yarn test worker/OlasServiceManager.test.ts
```

---

## Known HTTP API Issues

### Issue 1: Service Creation with Mech Config

**Symptom:** `/api/services` returns 500 error when `use_mech_marketplace: true`

**Workaround:** Use CLI `quickstart` command

**Suspected Fix Needed:**
```python
# olas-operate-middleware/operate/services/manage.py
def validate_service_config(config):
    # Add validation for mech marketplace address
    if config.get('use_mech_marketplace'):
        marketplace = config.get('mech_marketplace_address')
        if marketplace not in DEFAULT_PRIORITY_MECH.values():
            # Don't fail - log warning instead
            logger.warning(f"Unknown mech marketplace: {marketplace}")
```

### Issue 2: State Corruption After Cleanup

**Symptom:** HTTP server state not fully reset after `cleanupCorruptServices()`

**Workaround:** Restart middleware server after cleanup

**Suspected Fix Needed:**
```python
# olas-operate-middleware/operate/http.py
@app.post('/api/services/cleanup')
def cleanup_corrupt_services():
    # Cleanup service files
    cleanup_result = service_manager.cleanup_corrupt_services()
    
    # CRITICAL: Reset internal state caches
    service_manager._service_cache.clear()
    service_manager._reload_services()
    
    return cleanup_result
```

### Issue 3: Re-authentication Required

**Symptom:** API calls fail with "User not logged in" after time elapses

**Fix:** Implemented in `OlasOperateWrapper._ensureLoggedIn()` (JINN-198)

**Status:** ✅ Resolved

---

## Documentation Impact

### Files Updated for Workaround

1. **`AGENT_README.md`**
   - Bootstrap Process section mentions CLI approach
   - Notes HTTP API as future improvement

2. **`JINN-202-IMPLEMENTATION-SUMMARY.md`**
   - Explains CLI workaround
   - Documents 73% code reduction

3. **`worker/SimplifiedServiceBootstrap.ts`**
   - Inline comments note temporary nature
   - Links to this document

4. **`docs/implementation/OLAS_MIDDLEWARE_SETUP.md`**
   - Original HTTP API documentation preserved
   - Workaround section added

### Files to Update When Reverting

1. **`AGENT_README.md`** - Remove workaround notes
2. **`JINN-186.md`** - Close with resolution
3. **`CHANGELOG.md`** - Document reversion
4. **Code comments** - Remove "temporary workaround" notes

---

## Upstream Issue Tracking

### Filed with Middleware Team?

**Status:** ⏳ Not yet filed

**Recommendation:** File issue with:
- Minimal reproduction case
- Logs showing API failure
- Service config that triggers bug
- Expected vs actual behavior

**Where to file:**
- Repository: `valory-xyz/olas-operate-middleware`
- Template: Bug report
- Labels: `api`, `service-creation`, `mech`

### Workaround Lifespan Estimate

**Optimistic:** 2-4 weeks (if high priority)  
**Realistic:** 1-2 months (normal priority)  
**Pessimistic:** 3-6 months (low priority or complex fix)

**Recommendation:** Keep CLI workaround in place until HTTP API proven stable for 2+ weeks.

---

## Lessons Learned

### What Worked Well

1. **Quick pivot to CLI** - Unblocked JINN-186 progress
2. **Simplification bonus** - CLI approach actually cleaner (73% less code)
3. **Native prompts** - Better UX than custom wizard
4. **Middleware-first** - Trust battle-tested code paths

### What to Avoid

1. **Don't bypass middleware** - Always use official interfaces
2. **Don't assume HTTP API works** - Validate before building on it
3. **Don't over-engineer** - CLI approach proved simpler than HTTP orchestration
4. **Don't ignore state issues** - Corrupt service cleanup critical

### Architecture Insights

**Key realization:** The HTTP API adds complexity without clear benefits for our use case.

**Questions for future:**
- Do we ever need HTTP API granularity?
- Is CLI + text parsing actually more reliable?
- Should we advocate for CLI-first in middleware design?

---

## Related Issues

- **JINN-186:** Parent ticket (full validation)
- **JINN-198:** Mech deployment implementation
- **JINN-202:** Simplified bootstrap (CLI workaround)
- **JINN-204:** Tenderly validation (uses CLI approach)

---

## Contact

**Questions about this workaround?**
- See `SimplifiedServiceBootstrap.ts` implementation
- Review JINN-202 implementation summary
- Check JINN-186 for original HTTP API blocker details

**When HTTP API is fixed:**
- Update this document with resolution
- Test reversion thoroughly
- Document in changelog

