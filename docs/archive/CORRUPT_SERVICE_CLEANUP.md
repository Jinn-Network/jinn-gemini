# Automatic Corrupt Service Cleanup

## Overview

The system now automatically detects and removes corrupted service directories from `olas-operate-middleware/.operate/services/` before starting any service operations.

## What Gets Cleaned Up

The cleanup logic removes service directories that have:

1. **Missing `config.json`** - Service directory exists but has no configuration file
2. **Zero address Safe** - `multisig` field is `0x0000000000000000000000000000000000000000`
3. **NO_MULTISIG placeholder** - `multisig` field is the string `"NO_MULTISIG"`
4. **Unminted token** - `token` field is `-1` (indicates service wasn't minted)
5. **Malformed JSON** - `config.json` exists but contains invalid JSON

## Where It Runs

### 1. Interactive Setup Wizard

When you run `yarn setup:service`, cleanup happens automatically:

```bash
yarn setup:service --chain=base
```

Output:
```
🧹 Checking for corrupted service directories...

✅ Cleaned up 3 corrupted service(s):
   - sc-67b0ad4b-d742-413d-84f9-c2ac6d0c3aa2
   - sc-1cf43f99-a1f6-4663-a454-a5620bd790e8
   - sc-113517e7-6633-46ff-a897-0c50eacf3beb

```

### 2. Worker Initialization

When the worker starts via `OlasStakingManager.ensureServiceManager()`:

```typescript
// Automatic cleanup on first service manager initialization
const stakingManager = new OlasStakingManager(config);
await stakingManager.ensureServiceManager(); // Cleanup runs here
```

Log output:
```json
{
  "level": "info",
  "msg": "Checking for corrupt service configs to clean up",
  "component": "OLAS-STAKING"
}
{
  "level": "info", 
  "msg": "Cleaned up corrupt services",
  "count": 3,
  "services": ["sc-...", "sc-...", "sc-..."]
}
```

## Implementation

### Core Method: `OlasServiceManager.cleanupCorruptServices()`

```typescript
async cleanupCorruptServices(): Promise<{ 
  cleaned: string[]; 
  errors: string[]; 
}>
```

**Location**: `worker/OlasServiceManager.ts` (lines 788-903)

**Returns**:
- `cleaned`: Array of service directory names that were removed
- `errors`: Array of error messages for services that couldn't be cleaned

### Integration Points

#### Interactive Bootstrap
```typescript
// worker/InteractiveServiceBootstrap.ts (lines 298-320)
const serviceManager = new OlasServiceManager(this.operateWrapper, '/tmp/bootstrap-cleanup.json');
const cleanupResult = await serviceManager.cleanupCorruptServices();
```

#### Worker Initialization
```typescript
// worker/OlasStakingManager.ts (lines 60-79)
const manager = await OlasServiceManager.createDefault(finalOptions);
const cleanupResult = await manager.cleanupCorruptServices();
```

## Why This Matters

### The Problem Before

The middleware would fail on startup if it found corrupted service directories:

```
ERROR: Service sc-xxx missing config.json
ERROR: Failed to migrate service sc-yyy
Server failed to start
```

This blocked legitimate operations because of leftover test data or failed deployments.

### The Solution Now

Cleanup runs automatically and silently removes corrupt directories before any operations begin. The middleware starts cleanly every time.

## Testing

Full test coverage in `worker/OlasServiceManager.test.ts`:

```bash
yarn test worker/OlasServiceManager.test.ts
```

Tests verify cleanup for:
- Missing config.json ✓
- Zero address Safe ✓
- NO_MULTISIG placeholder ✓
- Token ID -1 (unminted) ✓
- Malformed JSON ✓
- Valid services are preserved ✓
- Multiple services in one pass ✓

## Manual Cleanup (Not Needed Anymore)

Previously you had to manually delete corrupted services:

```bash
cd olas-operate-middleware/.operate/services
rm -rf sc-corrupted-service-id
```

**This is no longer necessary.** The system does it automatically.

## Safety

- **Non-destructive**: Only removes directories with clear corruption markers
- **Preserves valid services**: Services with proper config and valid data are untouched
- **Error handling**: Continues even if individual cleanup operations fail
- **Logging**: All cleanup actions are logged for audit trail

## Related Files

- `worker/OlasServiceManager.ts` - Core cleanup implementation
- `worker/OlasServiceManager.test.ts` - Test coverage
- `worker/InteractiveServiceBootstrap.ts` - Bootstrap integration
- `worker/OlasStakingManager.ts` - Worker integration

