# Interactive Setup UX Improvements

## Changes Made

### 1. Suppressed Noisy Middleware Logs

**Problem**: The middleware logs all INFO messages to stderr, making the interactive wizard extremely noisy and hard to read.

**Solution**: Modified `OlasOperateWrapper.ts` to suppress INFO and DEBUG logs from middleware, only showing ERROR and WARN:

```typescript
// Before: All stderr output logged as ERROR
operateLogger.error({ stream: 'stderr' }, output);

// After: Filter by log level
if (level === 'ERROR' || level === 'WARN' || level === 'WARNING') {
  operateLogger.error({ stream: 'stderr' }, output);
} else {
  // Suppress INFO and DEBUG (too noisy)
  operateLogger.debug({ stream: 'stderr' }, output);
}
```

**Result**: Clean, readable output showing only what the user needs to see.

### 2. Reduced Master Wallet Funding Requirement

**Problem**: The wizard asked for 0.002 ETH to fund the Master Wallet, which is more than necessary.

**Solution**: Reduced to 0.001 ETH:

```typescript
// Before
requirements: {
  eth: '0.002',
  olas: '0',
}

// After
requirements: {
  eth: '0.001',
  olas: '0',
}
```

**Result**: Users spend less on gas for the initial wallet deployment.

### 3. Hide "0 OLAS" When Not Needed

**Problem**: The wizard showed "• 0 OLAS" for Master Wallet, which is confusing.

**Solution**: Conditionally hide OLAS requirement when it's 0:

```typescript
// In printStep()
console.log(`💰 Required Funding:`);
console.log(`   • ${step.requirements.eth} ETH`);
if (step.requirements.olas !== '0') {
  console.log(`   • ${step.requirements.olas} OLAS`);
}

// In waitForFunding() instructions
let step = 1;
console.log(`   ${step++}. Send ${requirements.eth} ETH to the address above`);
if (requirements.olas !== '0') {
  console.log(`   ${step++}. Send ${requirements.olas} OLAS to the address above`);
}
console.log(`   ${step++}. Type 'check' to verify balance`);
// ... etc
```

**Result**: Cleaner, less confusing output. Instructions are auto-numbered correctly.

## Before vs After

### Before
```
Network: BASE
RPC: https://...

[2025-10-01 12:23:49.696 +0100] ERROR: [2025-10-01 12:23:49,696][INFO] Operate version: 0.10.15
[2025-10-01 12:23:49.697 +0100] ERROR: [2025-10-01 12:23:49,697][INFO] Directories in ...
[2025-10-01 12:23:49.697 +0100] ERROR: [2025-10-01 12:23:49,697][INFO] Migrating service configs...
[2025-10-01 12:23:49.698 +0100] ERROR: [2025-10-01 12:23:49,698][INFO] Migrating service configs done.
... 50+ more INFO log lines ...

📍 Step 1/4: Fund Master Wallet
────────────────────────────────────────────────────────────────────────────────

The Master Wallet is your primary EOA that will deploy the Master Safe.

🔑 Address: 0xB1517bB7C0932f1154Fa4b17DeC2a6a4a3d02CC2

💰 Required Funding:
   • 0.002 ETH
   • 0 OLAS

📋 Instructions:
   1. Send 0.002 ETH to the address above
   2. Send 0 OLAS to the address above
   3. Type 'check' to verify balance
   4. Type 'continue' to proceed once funded
   5. Type 'skip' to bypass check (CAUTION: may fail later)

> [2025-10-01 12:23:52.425 +0100] ERROR: [INFO] Making HTTP request...
[continues with more noise...]
```

### After
```
Network: BASE
RPC: https://...

🧹 Checking for corrupted service directories...

✅ No corrupted services found

════════════════════════════════════════════════════════════════════════════════
  STEP 1: Master Wallet Creation
════════════════════════════════════════════════════════════════════════════════

Creating master wallet (EOA)...
This wallet will deploy and control the Master Safe.

✅ Master wallet created: 0xB1517bB7C0932f1154Fa4b17DeC2a6a4a3d02CC2


📍 Step 1/4: Fund Master Wallet
────────────────────────────────────────────────────────────────────────────────

The Master Wallet is your primary EOA that will deploy the Master Safe.

🔑 Address: 0xB1517bB7C0932f1154Fa4b17DeC2a6a4a3d02CC2

💰 Required Funding:
   • 0.001 ETH

📋 Instructions:
   1. Send 0.001 ETH to the address above
   2. Type 'check' to verify balance
   3. Type 'continue' to proceed once funded
   4. Type 'skip' to bypass check (CAUTION: may fail later)

> 
```

## Impact

✅ **Much cleaner output** - No more walls of INFO logs  
✅ **Clear instructions** - Only shows what's actually needed  
✅ **Lower costs** - 0.001 ETH instead of 0.002 ETH for Master Wallet  
✅ **Less confusion** - No "0 OLAS" requirement shown  
✅ **Auto-numbered steps** - Instructions always numbered correctly

## Files Modified

1. `worker/OlasOperateWrapper.ts` - Suppressed INFO/DEBUG middleware logs
2. `worker/InteractiveServiceBootstrap.ts`:
   - Reduced Master Wallet ETH requirement to 0.001
   - Hide OLAS requirement when 0
   - Auto-number instructions based on what's shown

## Testing

Run the wizard to see the clean output:

```bash
yarn setup:service --chain=base
```

The terminal should now be clean and readable, with only the essential information displayed.

