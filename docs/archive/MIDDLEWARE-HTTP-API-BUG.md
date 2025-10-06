# Middleware HTTP API Bug - Service Creation Fails

## Issue Summary

The middleware's HTTP API endpoint `POST /api/v2/service` returns HTTP 500 with a generic error message "Operation failed after multiple attempts. Please try again later." when attempting to create services.

**Status:** Bypassed by using CLI directly  
**Date Discovered:** 2025-10-01  
**Impact:** Prevents automated service deployment via HTTP API

## Technical Details

### Symptoms

- HTTP POST to `/api/v2/service` returns 500 Internal Server Error
- Error message: "Operation failed after multiple attempts. Please try again later."
- The `@with_retries` decorator retries 3 times before returning the generic error
- Actual Python exception is logged by middleware but not captured in TypeScript logs

### Root Cause

The HTTP API's service creation fails, but **direct Python calls succeed**:

```python
# This WORKS:
from operate.services.service import Service
service = Service.new(agent_addresses=[], service_template=template, storage=storage)
# Result: Service created successfully with config.json

# This FAILS via HTTP:
POST http://localhost:8000/api/v2/service
# Result: HTTP 500 - "Operation failed after multiple attempts"
```

### Investigation Results

1. **IPFS Download:** Works correctly (verified by checking downloaded packages)
2. **Service Template:** Valid (same template works in direct Python call)
3. **Middleware State:** Clean (tested after cleanup of corrupt services)
4. **Python Logic:** `Service.new()` succeeds when called directly
5. **HTTP API:** Fails consistently when called via FastAPI endpoint

### Likely Cause

The issue appears to be in the async/await handling or request parsing in the FastAPI endpoint:

```python
@app.post("/api/v2/service")
@with_retries
async def _create_services_v2(request: Request) -> JSONResponse:
    """Create a service."""
    if operate.password is None:
        return USER_NOT_LOGGED_IN_ERROR
    template = await request.json()
    manager = operate.service_manager()
    output = manager.create(service_template=template)  # ← Fails here
    
    return JSONResponse(content=output.json)
```

The synchronous `manager.create()` call inside an async function may be causing threading issues or the request body parsing may not be extracting the template correctly.

## Workaround

**Current Solution:** Use the `operate quickstart` CLI command directly instead of the HTTP API.

This is implemented in `OlasServiceManager.deployAndStakeService()`:
- We bypass `createServiceViaAPI()` 
- We use `executeCommand('quickstart', [configPath, '--attended=false'])`
- This works reliably and includes mech deployment support

## Future Fix

To properly fix this issue:

1. **Add detailed exception logging** to the middleware's `@with_retries` decorator to expose the actual Python exception
2. **Test async/sync interaction** - ensure `manager.create()` can safely be called from async context
3. **Validate request body parsing** - confirm the template is being extracted correctly from the request
4. **Consider using `run_in_executor`** if the issue is related to blocking I/O in async context

## Related Files

- `olas-operate-middleware/operate/cli.py` - HTTP API endpoint (line 927)
- `olas-operate-middleware/operate/services/manage.py` - ServiceManager.create() (line 252)
- `olas-operate-middleware/operate/services/service.py` - Service.new() (line 804)
- `worker/OlasServiceManager.ts` - Workaround implementation
- `scripts/deploy-service-with-mech.ts` - Uses CLI workaround

## Testing

To reproduce:
```bash
# This will fail:
curl -X POST http://localhost:8000/api/v2/service \
  -H "Content-Type: application/json" \
  -d @service-config.json

# This will succeed:
poetry run python -m operate.cli quickstart service-config.json --attended=false
```

## Notes

- The HTTP API works for other endpoints (account, wallet, safe creation)
- Only service creation is affected
- The issue emerged after cleaning up corrupt services, but the root cause predates that
- 4 services were successfully created earlier with the same template, suggesting intermittent behavior or state-dependent failure


