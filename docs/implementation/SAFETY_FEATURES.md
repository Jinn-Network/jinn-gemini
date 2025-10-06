# OLAS Service Safety Features

This document describes the comprehensive safety features implemented in the core worker codebase to prevent fund loss and ensure safe mainnet operations.

## Overview

After the incident where funds were locked in an orphaned Safe (see `SAFETY_IMPROVEMENTS_SUMMARY.md`), we implemented robust safety features **in the core codebase** rather than relying on test scripts.

## Core Safety Features

### 1. Safe Detection and Reuse (`OlasOperateWrapper`)

**Location**: `worker/OlasOperateWrapper.ts`

**Features**:
- `createSafe()` now accepts options: `checkExisting` and `warnIfNew`
- `getExistingSafeForChain()` checks if a Safe already exists for a chain before creating a new one
- Automatically reuses existing Safes when `checkExisting: true`
- Warns before creating new Safes when `warnIfNew: true`

**Usage**:
```typescript
const safeResult = await wrapper.createSafe('base', undefined, {
  checkExisting: true,  // Reuse existing Safe if available
  warnIfNew: true       // Warn if creating new Safe
});
```

### 2. Service and Safe Listing (`OlasServiceManager`)

**Location**: `worker/OlasServiceManager.ts`

**Features**:
- `listExistingServices()` scans middleware state and returns all services with their Safes
- Automatically called before deployment when `checkExistingServices: true`
- Provides comprehensive view of existing services, Safes, chains, and agent keys

**Usage**:
```typescript
const services = await serviceManager.listExistingServices();
// Returns: [{ serviceConfigId, safeAddress, tokenId, chain, agentAddress }]
```

### 3. Balance Verification (`OlasServiceManager`)

**Location**: `worker/OlasServiceManager.ts`

**Features**:
- `verifySafeBalance()` checks ETH and token balances against config requirements
- Automatically called before deployment when `verifyBalanceBeforeDeployment: true`
- Prevents deployment if Safe has insufficient funds
- Records balance snapshots in state tracker

**Usage**:
```typescript
await serviceManager.deployAndStakeService(configPath, {
  verifyBalanceBeforeDeployment: true
});
// Throws error if balance insufficient
```

### 4. Safe Address Prediction (`SafeAddressPredictor`)

**Location**: `worker/SafeAddressPredictor.ts`

**Features**:
- Predicts Safe address before deployment using CREATE2
- Allows funding predicted address before Safe creation
- Supports 1/1 Safe prediction (most common for OLAS agents)
- Chain-aware (Base, Gnosis, Ethereum)

**Usage**:
```typescript
import { predict1of1SafeAddress } from './SafeAddressPredictor.js';

const prediction = predict1of1SafeAddress(agentKey, 'base');
console.log(`Fund this address: ${prediction.predictedAddress}`);
// ... fund the address ...
// ... then create Safe ...
```

**⚠️ WARNING**: Address prediction is best-effort and may differ if:
- Safe factory uses a different singleton version
- Initialization parameters differ
- Salt nonce is different

### 5. Persistent State Tracking (`ServiceStateTracker`)

**Location**: `worker/ServiceStateTracker.ts`

**Features**:
- Tracks all services, Safes, wallets, and balances in `.olas-service-state/state.json`
- Automatic registration of new services
- Status updates (created → deployed → staked → stopped → terminated)
- Balance snapshots with timestamps
- Human-readable reports
- Import/export for backups

**Usage**:
```typescript
const tracker = new ServiceStateTracker();
await tracker.load();

// Automatically called by OlasServiceManager during deployment
// Or manually:
await tracker.registerService({
  serviceConfigId: 'sc-abc123',
  serviceName: 'My Service',
  chain: 'base',
  safeAddress: '0x...',
  agentAddress: '0x...',
  masterWalletAddress: '0x...'
});

// Generate report
const report = await tracker.generateReport();
console.log(report);
```

**State File Location**: `./.olas-service-state/state.json`

**State File Format**:
```json
{
  "version": "1.0",
  "updatedAt": "2025-09-30T12:00:00.000Z",
  "services": [
    {
      "serviceConfigId": "sc-abc123",
      "serviceName": "My Service",
      "chain": "base",
      "safeAddress": "0x1234...",
      "agentAddress": "0x5678...",
      "masterWalletAddress": "0x9abc...",
      "tokenId": 146,
      "createdAt": "2025-09-30T11:00:00.000Z",
      "status": "staked",
      "balances": [
        {
          "timestamp": "2025-09-30T11:30:00.000Z",
          "eth": "0.01",
          "tokens": {
            "0x54330d28ca3357F294334BDC454a032e7f353416": "100000000000000000000"
          }
        }
      ]
    }
  ]
}
```

## Integrated Safety Workflow

When deploying a service with all safety features enabled:

```typescript
const serviceManager = await OlasServiceManager.createDefault({
  serviceConfigPath: '/path/to/config.json'
});

// Deploy with full safety checks
await serviceManager.deployAndStakeService(undefined, {
  checkExistingServices: true,        // List existing services first
  verifyBalanceBeforeDeployment: true // Verify balance before deploying
});
```

This will:
1. ✅ List all existing services with their Safes
2. ✅ Warn that a new service will create a new Safe
3. ✅ Create the service (generates agent key + new Safe)
4. ✅ Register service in state tracker
5. ✅ Verify Safe has sufficient balance
6. ✅ Record balance snapshot
7. ✅ Deploy service
8. ✅ Update status to 'staked' in state tracker

## Migration from Test Script

The following safety logic was **moved from test scripts to core**:

### Before (in test script):
```typescript
// 200+ lines of pre-flight checks, service listing, balance verification in test script
```

### After (in core):
```typescript
await serviceManager.deployAndStakeService(configPath, {
  checkExistingServices: true,
  verifyBalanceBeforeDeployment: true
});
```

## Preventing Fund Loss

These features address the root causes of the fund loss incident:

| Root Cause | Prevention |
|------------|------------|
| No Safe reuse → created new Safes unnecessarily | `OlasOperateWrapper.createSafe({ checkExisting: true })` |
| No pre-warning → user didn't know new Safe would be created | `OlasServiceManager.deployAndStakeService({ checkExistingServices: true })` |
| No balance verification → deployed without checking funds | `OlasServiceManager.deployAndStakeService({ verifyBalanceBeforeDeployment: true })` |
| No persistent tracking → couldn't find which Safe belonged to which service | `ServiceStateTracker` |
| No Safe address prediction → couldn't fund before creation | `SafeAddressPredictor` |

## Best Practices

1. **Always enable safety checks on mainnet**:
   ```typescript
   if (isMainnet) {
     options.checkExistingServices = true;
     options.verifyBalanceBeforeDeployment = true;
   }
   ```

2. **Review state tracker regularly**:
   ```bash
   cat .olas-service-state/state.json
   ```

3. **Backup state before major operations**:
   ```typescript
   const snapshot = await stateTracker.exportState();
   await writeFile('backup.json', JSON.stringify(snapshot));
   ```

4. **Check existing services before deployment**:
   ```typescript
   const services = await serviceManager.listExistingServices();
   console.log('Existing services:', services);
   ```

5. **Use Safe address prediction for pre-funding**:
   ```typescript
   const prediction = predict1of1SafeAddress(agentKey, 'base');
   console.log(`Pre-fund this address: ${prediction.predictedAddress}`);
   ```

## Testing

Safety features are automatically tested in:
- `worker/OlasServiceManager.test.ts`
- `worker/OlasOperateWrapper.test.ts`
- `scripts/jinn-186-full-e2e-validation.ts` (simplified to use core features)

## Future Enhancements

Planned improvements:
- [ ] Automatic Safe address prediction during service creation
- [ ] Real-time balance monitoring with alerts
- [ ] Database-backed state tracking (replace JSON file)
- [ ] Web UI for state visualization
- [ ] Automatic fund recovery tools
- [ ] Safe ownership transfer utilities
