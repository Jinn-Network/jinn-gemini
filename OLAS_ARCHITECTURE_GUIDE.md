# OLAS Architecture Guide

**Complete Reference for OLAS Middleware Integration**

Last Updated: October 2, 2025  
Status: Consolidated from JINN-186, JINN-197, JINN-198, JINN-202

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Key Subsystems](#key-subsystems)
3. [Testing & Development](#testing--development)
4. [Common Gotchas](#common-gotchas)
5. [Operational Procedures](#operational-procedures)
6. [Code Patterns](#code-patterns)
7. [Reference](#reference)

---

## Core Concepts

### The Dual Key Storage System

**CRITICAL ARCHITECTURE**: The middleware maintains **TWO SEPARATE** key stores that serve different purposes.

#### 1. Master Wallet (EOA)

**Location**: `olas-operate-middleware/.operate/wallets/`  
**Format**: Encrypted JSON keystore (one per chain: `ethereum.txt`, `base.txt`)  
**Encryption**: Uses `OPERATE_PASSWORD` environment variable  

**Purpose**:
- Creates and deploys Gnosis Safes (pays gas for Safe deployment)
- Controls Safes during creation phase
- Acts as the transaction submitter for Safe operations

**Persistence**: MUST be preserved on mainnet to maintain access to created Safes

**Security**: Encrypted, requires password, creates Safes

#### 2. Agent Keys

**Location**: `olas-operate-middleware/.operate/keys/`  
**Format**: Plain JSON with private keys (e.g., `0xABCD1234...json`)  
**Storage**: Global directory, shared across all services  

**Purpose**:
- Become the **signers** on Safe multisigs (1/1 configuration)
- Sign transactions from within the Safe
- Execute service operations on behalf of the Safe

**Lifecycle**:
- Created when service is created (`ServiceManager.create()`)
- Survive service deletion (stored globally, not per-service)
- Can be reused across service deployments

**Security**: Plain JSON (protected by filesystem permissions), sign from Safes

### Service → Safe → Agent Key Relationship

```
Service Creation Flow:
┌─────────────────────────────────────────────────────────────┐
│ 1. create service → generates NEW agent key                 │
│    Location: /.operate/keys/0xAGENT_ADDRESS                │
│                                                              │
│ 2. deploy service → creates NEW Safe                        │
│    Safe address is deterministic but unique per deployment │
│                                                              │
│ 3. Safe configured as 1/1 multisig                         │
│    Agent key = only signer                                  │
│                                                              │
│ 4. Service runs using agent key                            │
│    Signs transactions from within the Safe                  │
└─────────────────────────────────────────────────────────────┘

CRITICAL: Each service deployment creates a NEW Safe, 
          even when reusing the same Master Wallet
```

**Wallet Hierarchy**:
```
Master EOA (e.g., 0xB151...)
  └─> Master Safe (e.g., 0x15aD...)
      └─> Service Safes (one per service deployment)
          ├─> Service #149: 0x15aD... (DEPLOYED_AND_STAKED) ✅
          ├─> Service #150: 0xbcE2... (DEPLOYED_AND_STAKED) ✅
          └─> Agent Keys (signers on Service Safes)
```

**Key Architectural Facts**:
- ✅ Agent keys stored globally in `/.operate/keys/` (survive service deletion)
- ✅ Master wallet creates multiple Safes (one per service deployment)
- ✅ Each Safe is independent with its own agent key signer
- ✅ Deleting a service does NOT delete the agent keys
- ✅ Safes can be recovered using agent private keys from `/.operate/keys/`

### Service Lifecycle States

```
PRE_REGISTRATION → ACTIVE_REGISTRATION → FINISHED_REGISTRATION → DEPLOYED → DEPLOYED_AND_STAKED
```

**State Transitions**:
1. **PRE_REGISTRATION**: Service created, NFT minted
2. **ACTIVE_REGISTRATION**: Service activated with security deposit
3. **FINISHED_REGISTRATION**: Agent registration complete
4. **DEPLOYED**: Service Safe deployed on-chain
5. **DEPLOYED_AND_STAKED**: Service staked in staking contract

### Middleware Operating Modes

#### Unattended Mode (Programmatic/Automation - JINN-186/198)

**Use Case**: Automated deployments, CI/CD, scripts

**Required Environment Variables**:
```bash
ATTENDED=false                    # Disable all interactive prompts
OPERATE_PASSWORD=<password>       # Required for wallet operations
<CHAIN>_LEDGER_RPC=<rpc_url>     # Chain-specific RPC (e.g., BASE_LEDGER_RPC)
STAKING_PROGRAM=<program>         # "no_staking" or "custom_staking"
```

**Behavior**:
- No interactive prompts
- Requires pre-funded addresses before operations
- Fails immediately if balances insufficient
- Suitable for Tenderly (unlimited ETH) and pre-funded mainnet

**Example**:
```bash
ATTENDED=false \
OPERATE_PASSWORD=12345678 \
BASE_LEDGER_RPC=https://mainnet.base.org \
STAKING_PROGRAM=no_staking \
yarn deploy:service
```

#### Attended Mode (Interactive - JINN-202)

**Use Case**: Manual setup, first-time deployment, mainnet operations

**Required Environment Variables**:
```bash
ATTENDED=true                      # Enable interactive prompts (both env var AND CLI flag)
OPERATE_PASSWORD=<password>        # Prevents password prompt only
<CHAIN>_LEDGER_RPC=<rpc_url>      # Chain-specific RPC
STAKING_PROGRAM=<program>          # Staking configuration
```

**Behavior**:
- Shows native middleware funding prompts
- Real-time balance polling (1-second intervals)
- Auto-continues when funding detected (no manual "continue" needed)
- User-friendly progress indicators with exact amounts

**Example Prompt Flow**:
```
Pearl Trader quickstart
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Master EOA exists: 0xB151...
✓ Master Safe exists: 0x15aD...

[base] Creating Agent Key...
✓ Agent Key: 0x9876...

[base] Please transfer at least 0.001 ETH to Agent Key 0x9876...
⠋ [base] Waiting for 0.001 ETH... (0.001 ETH remaining)

[User funds address → auto-continues]

✓ Service Safe deployed: 0x1234...
[base] Please transfer at least 50.0 OLAS to Service Safe 0x1234...

[User funds address → auto-continues]

✅ SETUP COMPLETED SUCCESSFULLY
```

**CLI Usage**:
```bash
# Interactive service setup on Base mainnet
yarn setup:service --chain=base

# With mech deployment
yarn setup:service --chain=base --with-mech
```

**When to Use Each Mode**:

| Mode | Tenderly | Mainnet | CI/CD |
|------|----------|---------|-------|
| **ATTENDED=false** | ✅ Recommended | ⚠️ Requires pre-funding | ✅ Ideal |
| **ATTENDED=true** | ⚠️ Requires manual input | ✅ Best UX | ❌ Blocks automation |

**Tenderly-Specific Note**: Virtual TestNets have unlimited ETH by default. ATTENDED=false is recommended for automation, but ATTENDED=true may work if balance checks pass immediately.

**CRITICAL ATTENDED MODE BEHAVIOR (JINN-186)**:
- When `ATTENDED=true`, middleware **ALWAYS prompts** for configuration choices
- Config file `staking_program_id` field controls whether prompt appears:
  - If `staking_program_id` is SET in config → middleware skips prompt
  - If `staking_program_id` is UNSET/deleted → middleware shows prompt
- Environment variables like `STAKING_PROGRAM` are **IGNORED** in attended mode
- You must manually enter choices (e.g., "2" for custom staking)
- Only `ATTENDED=false` respects configuration env vars like `STAKING_PROGRAM`

**SimplifiedServiceBootstrap Staking Fix** (October 2, 2025):
```typescript
// Check the ATTENDED env var that will be passed to middleware
const attendedEnvVar = this.operateWrapper?.env?.ATTENDED;
const isAttended = attendedEnvVar === 'true' || attendedEnvVar === true;

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

**Service Reuse Prevention** (October 2, 2025):
- Middleware reuses existing services if service hash matches and service directory exists
- Use unique service names to force new service creation: `jinn-service-${Date.now()}`
- Clean `.operate/services/` or move to backups before new deployments

---

## Key Subsystems

### OlasOperateWrapper

**Purpose**: TypeScript interface to the `olas-operate-middleware` HTTP server

**Key Capabilities**:
- HTTP server lifecycle management (start/stop)
- Automatic authentication handling
- Environment variable configuration
- Command execution with timeout protection

**Critical Implementation Detail**: Session Management Bug Fix (JINN-198)

**Problem**: Middleware loses session state (`operate.password`) between API calls.

**Solution**: Auto-re-authenticate before every API call:
```typescript
// OlasOperateWrapper.makeRequest()
if (this.password && endpoint !== '/api/account/login') {
  await this._ensureLoggedIn(); // Refresh session silently (~50ms)
}
```

**Why This Works**: Middleware accepts login at any time and refreshes in-process state immediately. Overhead is negligible (~50ms) vs deployment operations (minutes).

**File**: `worker/OlasOperateWrapper.ts`

### OlasServiceManager

**Purpose**: High-level service lifecycle orchestration including mech deployment

**Key Methods**:
- `deployAndStakeService(config, options)`: Complete deployment pipeline
- `cleanupCorruptServices()`: Auto-removes broken configs
- `checkExistingServices()`: Detects reusable services

**Mech Deployment Integration** (JINN-198):
```typescript
const serviceInfo = await serviceManager.deployAndStakeService(undefined, {
  deployMech: true,
  mechType: 'Native',                    // 'Native' | 'Token' | 'Nevermined'
  mechRequestPrice: '10000000000000000', // 0.01 ETH in wei
  mechMarketplaceAddress: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020' // Base mainnet
});

console.log(`Mech deployed: ${serviceInfo.mechAddress}`);
console.log(`Agent ID: ${serviceInfo.agentId}`);
```

**How Mech Deployment Works**:
1. Service manager injects mech environment variables into service config before deployment
2. Middleware detects empty `AGENT_ID` and `MECH_TO_CONFIG` env vars
3. Middleware's `deploy_mech()` function called automatically during service deployment
4. Mech address and agent ID returned in service info

**CRITICAL TIMING**: Mech deployment happens **ONLY during service creation**, not post-deployment.

**Middleware Logic**:
```python
# operate/services/manage.py:1133
if all(var in service.env_variables for var in ["AGENT_ID", "MECH_TO_CONFIG", ...]):
    if not service.env_variables["AGENT_ID"]["value"]:
        mech_address, agent_id = deploy_mech(sftxb=sftxb, service=service)
```

**File**: `worker/OlasServiceManager.ts`

### OlasStakingManager

**Purpose**: Orchestrates automated OLAS staking operations via service lifecycle

**Key Features**:
- Lazy initialization (prevents startup failures)
- Timed triggers (hourly execution in main worker loop)
- Service lifecycle progression automation
- Graceful degradation (worker continues if staking fails)

**Integration Pattern**:
```typescript
// worker/worker.ts
const stakingManager = await StakingManagerFactory.create();
setInterval(async () => {
  await stakingManager.processStakingOperations();
}, STAKING_INTERVAL_MS);
```

**File**: `worker/OlasStakingManager.ts`

### SimplifiedServiceBootstrap (JINN-202)

**Purpose**: Interactive service setup using middleware's native attended mode

**Architecture Change**:

**Before (JINN-186/198 - 575 lines)**:
- TWO quickstart calls with manual orchestration
- Custom funding prompts and balance polling
- Manual state tracking via directory diffing
- Complex error handling

**After (JINN-202 - 155 lines)**:
- ONE quickstart call, middleware handles everything
- Native middleware prompts with auto-continue
- Middleware manages its own state
- **73% code reduction**

**Key Method**:
```typescript
async bootstrap(config: BootstrapConfig): Promise<ServiceInfo> {
  // 1. Initialize wrapper with ATTENDED=true
  await this.initializeWrapper();
  
  // 2. Create quickstart config
  const configPath = await this.createQuickstartConfig();
  
  // 3. Show intro (what to expect)
  this.printIntro();
  
  // 4. Single quickstart call (middleware handles all prompts)
  const result = await this.runQuickstart(configPath);
  
  // 5. Extract results
  return this.extractResults(result);
}
```

**File**: `worker/SimplifiedServiceBootstrap.ts`

### StakingManagerFactory

**Purpose**: Factory for initializing staking managers with proper dependency injection

**Features**:
- Lazy initialization
- Configuration validation
- Flexible configuration
- Error handling

**File**: `worker/StakingManagerFactory.ts`

### ServiceConfig & MechConfig

**Purpose**: Centralized configuration utilities for service and mech deployment settings

**Critical Configuration Details**:

**Real IPFS Hash Required**:
```typescript
// ✅ Correct (validated working hash)
hash: "bafybeihnzvqexxegm6auq7vcpb6prybd2xcz5glbvhos2lmmuazqt75nuq"

// ❌ Wrong (causes ReadTimeout from registry.autonolas.tech)
hash: "bafybeiflqjig7qlvpfrlqbvlcqv2h7ry6sytcx6fxqzwlpjqvdm7nfxpqy" // FAKE
```

**Supported Chains**:
```typescript
// ✅ Correct (lowercase only)
home_chain: "gnosis" | "mode" | "optimism" | "base"

// ❌ Wrong (will fail with "Chain not supported")
home_chain: "ethereum" | "Ethereum" | "Base"
```

**Fund Requirements Type**:
```typescript
// ✅ Correct (integers)
fund_requirements: {
  "0x0000000000000000000000000000000000000000": {
    agent: 100000000000000000,
    safe: 50000000000000000
  }
}

// ❌ Wrong (strings cause TypeError)
fund_requirements: {
  "0x0000000000000000000000000000000000000000": {
    agent: "100000000000000000",
    safe: "50000000000000000"
  }
}
```

**Files**: `worker/config/ServiceConfig.ts`, `worker/config/MechConfig.ts`

---

## Testing & Development

### Tenderly Virtual TestNets (JINN-197)

**What They Are**:
- Ephemeral blockchain simulations
- Base mainnet fork with unlimited ETH
- Isolated environments (no impact on production)
- API endpoint: `/testnet/container` (NOT deprecated `/fork`)

**Advantages**:
- Free (no gas costs)
- Fast (instant block confirmation)
- Resettable (create/destroy on demand)
- Realistic (actual contract bytecode)

**Setup**:
```bash
# Required environment variables
TENDERLY_ACCESS_KEY=your_key
TENDERLY_ACCOUNT_SLUG=your_account
TENDERLY_PROJECT_SLUG=your_project
```

**Usage in Tests**:
```typescript
// Create VNet
const vnet = await tenderly.createVirtualTestnet({
  chainId: 8453, // Base
  displayName: 'test-service-deployment'
});

// Fund addresses (unlimited ETH)
await tenderly.fundAddress(vnet.id, walletAddress, '100000000000000000000'); // 100 ETH

// Use VNet RPC
const rpcUrl = vnet.rpcUrl; // https://virtual.base.eu.rpc.tenderly.co/...

// Cleanup
await tenderly.deleteVirtualTestnet(vnet.id);
```

### E2E Worker Testing (JINN-197)

**Philosophy**: Test the **actual production worker**, not isolated components.

**Why**:
```typescript
// ❌ Component Testing (Misses Integration Bugs)
const serviceManager = new OlasServiceManager(...);
await serviceManager.deployAndStakeService();

// ✅ E2E Testing (Tests Real Worker)
const workerProcess = spawn('yarn', ['start']);
// Monitor logs for OLAS operations
// Verify middleware state after operations
```

**Implementation**:

**File**: `scripts/test-worker-e2e.ts`

**Test Flow**:
```
1. Build Worker
   └─> yarn build

2. Start Worker Process
   └─> yarn start (with test env)
   └─> Monitor logs for startup

3. Wait for OLAS Staking
   └─> Monitor for "OLAS staking operation completed"
   └─> Timeout: 90 seconds

4. Verify Middleware State
   └─> Query: operate service status
   └─> Confirm service exists

5. Verify Worker Continues
   └─> Check process still running
   └─> Wait 5 seconds
   └─> Confirm no exit

6. Cleanup
   └─> Kill worker gracefully
   └─> Delete VNet
   └─> Clean temp files
```

**Fast Test Mode**:
```bash
# Override staking interval for CI/CD
STAKING_INTERVAL_MS_OVERRIDE=60000  # 1 minute instead of 1 hour
yarn test:worker-e2e
```

**Worker Configuration**:
```typescript
// worker/worker.ts
const STAKING_INTERVAL_MS = process.env.STAKING_INTERVAL_MS_OVERRIDE 
  ? parseInt(process.env.STAKING_INTERVAL_MS_OVERRIDE, 10)
  : 60 * 60 * 1000; // 1 hour default, overridable for testing
```

**What This Validates**:
- ✅ Production entrypoint works (`yarn start` launches)
- ✅ OLAS integration in main loop
- ✅ Middleware integration and communication
- ✅ Graceful operation (worker continues after OLAS ops)

**What This Does NOT Validate**:
- ❌ Service functionality (mech requests, job execution)
- ❌ On-chain verification (transactions, contract state)
- ❌ Long-running behavior (multi-hour operation, rewards)
- ❌ Service lifecycle management (unstaking, termination)

**Running the Test**:
```bash
yarn test:worker-e2e
```

**Expected Duration**: ~77 seconds

### Recommended Test Sequence (4 Phases)

**Context**: Services #149 and #150 already validated staking on Base mainnet. Testing focuses on Tenderly reproduction and mech integration.

#### Phase 0: Baseline (No Staking, No Mech)

**Goal**: Confirm Tenderly + SimplifiedServiceBootstrap works at all.

**Configuration**:
```typescript
staking_program_id: "no_staking"
deployMech: false
```

**Command**:
```bash
TENDERLY_ENABLED=true yarn setup:service --chain=base
```

**Expected Result**: Service deployed successfully on Tenderly without staking or mech.

#### Phase 1: Add Staking

**Goal**: Reproduce mainnet success (Services #149, #150) on Tenderly.

**Configuration**:
```typescript
staking_program_id: "agents_fun_1"  // or appropriate program
deployMech: false
```

**Expected Result**: Service deployed AND staked on Tenderly.

**Success Criteria**:
- Service state: `DEPLOYED_AND_STAKED`
- Staking contract shows service as active
- OLAS deposit recorded

#### Phase 2: Add Mech (No Staking)

**Goal**: Isolate mech deployment issues separate from staking.

**Configuration**:
```typescript
staking_program_id: "no_staking"
deployMech: true
```

**Expected Result**: Service deployed with mech contract, no staking.

**Success Criteria**:
- Mech contract deployed
- Mech address captured and returned
- Agent ID set correctly

#### Phase 3: Full Integration (Staking + Mech)

**Goal**: Test the unknown combination that may trigger middleware bugs.

**Configuration**:
```typescript
staking_program_id: "agents_fun_1"
deployMech: true
```

**Expected Result**: Service deployed, staked, AND has mech.

**Success Criteria**:
- Service state: `DEPLOYED_AND_STAKED`
- Mech contract deployed
- Both integrations work together

**Known Risk**: This combination may trigger middleware HTTP API bugs discovered in JINN-186.

### Checkpoint Testing Reality Check

**DO NOT attempt in JINN-204**. Make it JINN-205 (separate ticket).

**Why**:
```typescript
// This won't work
await provider.send("evm_increaseTime", [86400]);
```

**Problem**: Staking contracts check for **service activity** (Safe transaction nonces), not just time. Advancing time alone won't make rewards claimable.

**What's Required**:
- Simulating service operation (worker running)
- Generating Safe transactions
- Possibly mocking external calls (mech requests)
- Complex test infrastructure

**Too complex for initial validation scope.**

---

## Common Gotchas

### 1. Middleware HTTP API Authentication Loss (JINN-198)

**Symptom**: "User not logged in" errors during API calls after successful `bootstrapWallet()`

**Root Cause**: Middleware's password state (`operate.password`) stored in-process memory, lost between calls.

**When It Happens**:
- Time elapses between login and service creation
- Python process garbage collects session state
- Multiple API calls in sequence

**Solution**: Implemented in `OlasOperateWrapper.makeRequest()`:
```typescript
// CRITICAL: Re-authenticate before EVERY API call
if (this.password && endpoint !== '/api/account/login') {
  await this._ensureLoggedIn(); // Refresh session
}
```

**Why This Works**: Middleware accepts login at any time, refreshes session immediately. Overhead (~50ms) negligible.

### 2. Stale Wallet Configuration (JINN-188)

**Symptom**: "Invalid password" during quickstart

**Root Cause**: Stale wallet configuration in `olas-operate-middleware/.operate` directory

**Solution**:
```bash
rm -rf olas-operate-middleware/.operate
```

**Prevention**: Always set `OPERATE_PASSWORD` in environment before operations.

### 3. Multiple Service Safes Created

**Common Mistake**: Assuming one Safe per Master Wallet.

**Reality**: Each service deployment creates a **NEW Safe**, even with same Master Wallet.

**Example**:
```
Master Wallet: 0xB151...
├─> Service #149 Safe: 0x15aD... ✅
├─> Service #150 Safe: 0xbcE2... ✅
└─> Service #151 Safe: 0x61e2... (orphaned, has 100 OLAS)
```

**Prevention**: Check existing services before deployment:
```typescript
const existingServices = await serviceManager.listServices();
const chainServices = existingServices.filter(s => 
  s.chain_configs[targetChain] && 
  s.chain_configs[targetChain].chain_data.multisig !== NON_EXISTENT_MULTISIG
);

if (chainServices.length > 0) {
  // STOP - warn user, show existing Safes
}
```

### 4. Service Configuration Errors

**IPFS Hash Must Be Real**:
```typescript
// ❌ Causes ReadTimeout from registry.autonolas.tech
"bafybeiflqjig7qlvpfrlqbvlcqv2h7ry6sytcx6fxqzwlpjqvdm7nfxpqy" // FAKE

// ✅ Validated working hash
"bafybeihnzvqexxegm6auq7vcpb6prybd2xcz5glbvhos2lmmuazqt75nuq"
```

**Chain Names Lowercase Only**:
```typescript
// ✅ Correct
"gnosis" | "mode" | "optimism" | "base"

// ❌ Fails with "Chain not supported"
"ethereum" | "Ethereum" | "Base"
```

**Fund Requirements Must Be Integers**:
```typescript
// ✅ Correct
agent: 100000000000000000

// ❌ Causes TypeError
agent: "100000000000000000"
```

### 5. Mech Deployment Timing

**Critical**: Mech deployment **ONLY** happens during service creation, not post-deployment.

**Middleware Check**:
```python
if all(var in service.env_variables for var in ["AGENT_ID", "MECH_TO_CONFIG", ...]):
    if not service.env_variables["AGENT_ID"]["value"]:
        mech_address, agent_id = deploy_mech(sftxb=sftxb, service=service)
```

**Wrong Approach**:
```typescript
// ❌ This won't work
await serviceManager.deployAndStakeService();
await serviceManager.deployMech(); // NO SUCH METHOD
```

**Correct Approach**:
```typescript
// ✅ Deploy mech DURING service creation
await serviceManager.deployAndStakeService(undefined, {
  deployMech: true
});
```

### 6. Corrupt Service Cleanup

**When Services Become Corrupt**:
- Missing config files
- Null Safe address (`0x0000000000000000000000000000000000000000`)
- Unminted service tokens
- Interrupted deployments

**Auto-Cleanup**: Worker automatically removes corrupt services on startup.

**Implementation**: `OlasServiceManager.cleanupCorruptServices()`

**Manual Cleanup**:
```bash
rm -rf olas-operate-middleware/.operate/services/SERVICE_ID
```

**IMPORTANT**: Agent keys preserved (stored globally in `/.operate/keys/`, never deleted).

### 7. Mixed Network Service Storage

**CRITICAL**: Middleware stores ALL services in the same directory (`.operate/services/`) regardless of network.

**What This Means**:
- Tenderly test services stored alongside mainnet production services
- No automatic separation by network
- Must manually identify which services are which

**How to Identify Network**:
```bash
# Check RPC URL to determine network
for dir in olas-operate-middleware/.operate/services/sc-*/; do
  echo "=== $(basename "$dir") ==="
  jq -r '.name, .chain_configs.base.ledger_config.rpc' "$dir/config.json"
done

# Tenderly services have RPC URL like:
# https://virtual.base.eu.rpc.tenderly.co/...

# Mainnet services have RPC URL like:
# https://mainnet.base.org
# https://quick-sly-needle.base-mainnet.quiknode.pro/...
```

**Fund Recovery Implications**:
- **Before recovering funds**: Verify service is on the target network
- **Check RPC URL first**: Ensure you're querying the right network
- **Service #146 vs #149**: Same middleware storage, different networks
- **List all services**: May include Tenderly test services with real-looking IDs

**Bulk Operations Warning**:
```typescript
// ❌ WRONG: Assumes all services are mainnet
const allServices = await serviceManager.listServices();
for (const service of allServices) {
  await recoverFunds(service.safeAddress); // May query wrong network!
}

// ✅ CORRECT: Filter by RPC URL
const allServices = await serviceManager.listServices();
const mainnetServices = allServices.filter(s => {
  const rpc = s.chain_configs?.base?.ledger_config?.rpc || '';
  return !rpc.includes('tenderly.co');
});
for (const service of mainnetServices) {
  await recoverFunds(service.safeAddress, 'https://mainnet.base.org');
}
```

**Automated Tenderly Cleanup** (JINN-204):
- `yarn test:tenderly` automatically removes Tenderly test services after completion
- Identifies by both service name (`tenderly-test-*`) AND RPC URL (`tenderly.co`)
- Mainnet services preserved (different RPC URL)
- Agent keys never deleted (stored globally)

**Best Practice**:
1. Always check RPC URL before operations on a service
2. Never assume service ID = network
3. List and inspect services before bulk operations
4. Back up `.operate/services/` before cleanup on mainnet systems

### 8. Environment Variable Modes

**For Programmatic/Unattended Use** (JINN-186/198):
```bash
ATTENDED=false
OPERATE_PASSWORD=<required>
<CHAIN>_LEDGER_RPC=<required>
STAKING_PROGRAM=<required>
```

**For Interactive/Attended Use** (JINN-202):
```bash
ATTENDED=true           # Both env var AND CLI flag
OPERATE_PASSWORD=<required>
<CHAIN>_LEDGER_RPC=<required>
STAKING_PROGRAM=<required>
```

**Tenderly-Specific**:
- Virtual TestNets have unlimited ETH by default
- ATTENDED=false recommended for automation
- ATTENDED=true may work if balance checks pass immediately

### 9. CLI vs HTTP API (Temporary Workaround)

**Current State (JINN-202)**:
- Using CLI via `quickstart` command directly
- HTTP API has known bugs (service creation failures)

**Historical Context (JINN-186)**:
- Original design: HTTP API first
- Principle: "NEVER test the middleware CLI directly"

**This is a temporary workaround**. Once HTTP API is fixed, revert to HTTP-first approach.

**Document**: See `MIDDLEWARE-HTTP-API-WORKAROUND.md` (to be created)

### 10. Missing Quickstart Requirements

**For unattended mode** (`--attended=false`):
```bash
OPERATE_PASSWORD=12345678
BASE_LEDGER_RPC="https://mainnet.base.org"
STAKING_PROGRAM="custom_staking"  # or "no_staking"
CUSTOM_STAKING_ADDRESS="0x2585e63df7BD9De8e058884D496658a030b5c6ce"  # AgentsFun1 staking
```

**Without these**: Command hangs waiting for interactive input.

### 11. Fund Loss Prevention

**What Went Wrong** (Historical Incident):
1. Multiple Safe creation without checking existing services
2. Inconsistent funding (EOA funded one Safe, OLAS sent to different Safe)
3. No pre-flight checks
4. Misleading cleanup (service deletion appeared to lose keys, but didn't)

**Prevention**:
- ✅ Check existing services before deployment
- ✅ Verify which Safe needs funds
- ✅ Back up wallet state on mainnet
- ✅ Never assume keys are lost (check `/.operate/keys/`)

---

## Operational Procedures

### Interactive Service Setup (Recommended for Mainnet)

**Command**:
```bash
# Interactive service setup on Base mainnet
yarn setup:service --chain=base

# With mech deployment
yarn setup:service --chain=base --with-mech

# Other supported chains
yarn setup:service --chain=gnosis
yarn setup:service --chain=mode
yarn setup:service --chain=optimism
```

**How It Works** (JINN-202):
- Middleware detects or reuses existing Master EOA/Safe
- Shows **native funding prompts** when addresses need funding
- Displays exact amounts needed with real-time waiting indicators
- **Auto-continues** when funding is detected (no manual "continue" needed)
- Handles complete lifecycle in one atomic operation

**Total Time**: 5-10 minutes (depending on transfer confirmation speed)

**Example Output**:
```
🚀 Starting quickstart in attended mode...

Pearl Trader quickstart
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Master EOA exists: 0xB151...
✓ Master Safe exists: 0x15aD...

[base] Creating Agent Key...
✓ Agent Key: 0x9876...

[base] Please transfer at least 0.001 ETH to Agent Key 0x9876...
⠋ [base] Waiting for 0.001 ETH... (0.001 ETH remaining)

[User funds address → auto-continues]

✓ Service Safe deployed: 0x1234...
[base] Please transfer at least 50.0 OLAS to Service Safe 0x1234...

[User funds address → auto-continues]

✅ SETUP COMPLETED SUCCESSFULLY
```

**Key Features**:
- ✅ Single command for complete setup
- ✅ Native middleware prompts (battle-tested in olas-operate-app)
- ✅ Automatic balance polling and verification
- ✅ Clear error messages and recovery guidance
- ✅ Can interrupt with Ctrl+C (auto-cleanup on next run)
- ✅ Saves all addresses and configuration for reference

**Troubleshooting**: See `docs/TROUBLESHOOTING_INTERACTIVE_SETUP.md`

### Programmatic Service Deployment (CI/CD, Scripts)

**Use Case**: Automated deployments, Tenderly testing

**Environment Setup**:
```bash
ATTENDED=false
OPERATE_PASSWORD=12345678
BASE_LEDGER_RPC="https://mainnet.base.org"
STAKING_PROGRAM="no_staking"  # or "custom_staking"
```

**Code Example**:
```typescript
import { OlasServiceManager } from './worker/OlasServiceManager.js';
import { OlasOperateWrapper } from './worker/OlasOperateWrapper.js';

const wrapper = new OlasOperateWrapper({
  operatePath: './olas-operate-middleware',
  defaultEnv: {
    attended: false,
    operatePassword: process.env.OPERATE_PASSWORD,
    rpcUrls: {
      base: process.env.BASE_LEDGER_RPC
    },
    stakingProgram: 'no_staking'
  }
});

const serviceManager = new OlasServiceManager(wrapper, configPath);

const result = await serviceManager.deployAndStakeService(undefined, {
  deployMech: true,
  mechType: 'Native',
  mechRequestPrice: '10000000000000000',
  mechMarketplaceAddress: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020'
});

console.log('Service Safe:', result.serviceSafeAddress);
console.log('Mech Address:', result.mechAddress);
console.log('Agent ID:', result.agentId);
```

### Fund Recovery Procedures

#### Scenario 1: Stranded Funds in Agent EOAs

**Detection**:
```bash
yarn tsx scripts/check-agent-balances.ts
```

**Output**:
```
🔍 Checking OLAS balances in agent keys...

Found 5 agent keys

═══════════════════════════════════════════════════════════════════
✅ 0x38bE2396d43a157eEDCF1d3d63f5F074053180D0: 50.0 OLAS
   0x1234567890abcdef1234567890abcdef12345678: 0 OLAS
═══════════════════════════════════════════════════════════════════

📊 Summary:
   Agents with OLAS: 1/5
   Total OLAS: 50.0 OLAS

⚠️  Stranded OLAS found! Consider running scripts/recover-stranded-olas.ts
```

**Recovery**:
```bash
# Edit scripts/recover-stranded-olas.ts to add agent addresses/keys
# Keys are in: olas-operate-middleware/.operate/keys/AGENT_ADDRESS
yarn tsx scripts/recover-stranded-olas.ts
```

**Script Actions**:
1. Checks OLAS balance in each agent EOA
2. Estimates gas for transfer
3. Sends OLAS back to Master Safe
4. Includes 3-second delays to avoid RPC rate limiting

**Example Output**:
```
🔄 OLAS Recovery Script

Master Safe: 0x15aDF0eD29b6D76DB365670DfEeD8F9C5dAD4645
OLAS Token: 0x54330d28ca3357F294334BDC454a032e7f353416

📍 Agent: 0x38bE2396d43a157eEDCF1d3d63f5F074053180D0
   Balance: 50.0 OLAS
   ETH Balance: 0.0005 ETH
   🚀 Sending 50.0 OLAS to Master Safe...
   ✅ Success! Recovered 50.0 OLAS

📊 Recovery Summary:
   ✅ Successful: 1
   💰 Total Recovered: 50.0 OLAS
```

#### Scenario 2: Stranded Funds in Service Safes

**Service Safes are Gnosis Safe multisigs** (1/1 with agent key as signer).

**IMPORTANT**: When recovering funds from a **staked service**, you need to recover:
- **Bond Amount** (e.g., 50 OLAS) - Locked in the service contract
- **Staking Amount** (e.g., 50 OLAS) - Locked in the staking contract
- Total: **100 OLAS** for `agents_fun_1`

You must **unstake** the service before recovering funds from the staking contract.

**Method 1: Programmatic Recovery** (Recommended if RPC healthy)

```bash
# Edit scripts/recover-from-service-safe.ts to set:
# - SERVICE_SAFE address
# - AGENT_KEY_PRIVATE_KEY (from /.operate/keys/)
# - AGENT_KEY_ADDRESS
yarn tsx scripts/recover-from-service-safe.ts
```

**Script Actions**:
1. Verifies agent key is Safe owner
2. Checks OLAS balance in Service Safe
3. Constructs and signs Safe transaction
4. Transfers OLAS to Master Safe
5. Falls back to Safe UI instructions if signature fails

**Method 2: Manual Recovery via Safe UI** (Most reliable)

**Step 1: Find the agent key**
```bash
ls olas-operate-middleware/.operate/keys/
cat olas-operate-middleware/.operate/keys/0xAGENT_ADDRESS
```

**Step 2: Extract the private key** from the JSON file

**Step 3: Import to MetaMask**
- MetaMask → Import Account → Paste private key

**Step 4: Access the Safe**
- Go to https://app.safe.global/
- Connect MetaMask (now controls the Safe as 1/1 multisig)
- Switch to Base network
- Load the Service Safe address (or use direct URL):
  ```
  https://app.safe.global/home?safe=base:SERVICE_SAFE_ADDRESS
  ```

**Step 5: Transfer funds**
- New Transaction → Send tokens
- Select OLAS token
- Enter amount and Master Safe address
- Sign with MetaMask (agent key)
- Execute transaction

**Master Safe Address (Base)**: `0x15aDF0eD29b6D76DB365670DfEeD8F9C5dAD4645`

#### Full Recovery Session Example

```bash
# Step 1: Check which services have funds
yarn tsx scripts/check-agent-balances.ts

# Step 2: Recover from agent EOAs
yarn tsx scripts/recover-stranded-olas.ts

# Step 3: Identify Service Safes (from middleware config)
grep -r "multisig" olas-operate-middleware/.operate/services/*/config.json

# Step 4: Recover from Service Safes
# Option A: Programmatic (if RPC is healthy)
yarn tsx scripts/recover-from-service-safe.ts

# Option B: Safe UI (if RPC rate-limited)
# Use instructions above with Safe UI
```

### Service Backups

**Before deleting or re-deploying a service**:
```bash
# Backup service config
mkdir -p service-backups
cp -r olas-operate-middleware/.operate/services/SERVICE_ID \
      service-backups/SERVICE_ID-$(date +%Y%m%d-%H%M%S)
```

**Backups preserve**:
- Service configuration (`config.json`)
- Deployment artifacts (Docker Compose files)
- SSL certificates
- Persistent data
- Service metadata

**To restore a backup**:
```bash
cp -r service-backups/SERVICE_ID-TIMESTAMP \
      olas-operate-middleware/.operate/services/SERVICE_ID
```

**Existing backups**:
- `service-backups/service-158-20251001-185810/` - Service 158 with mech `0x436FC548d0cF78A71852756E9b4dD53077d2B06c` (middleware crashed after mech deployment)

### Starting Fresh on Mainnet

**⚠️ EXTREME CAUTION: Only do this if you understand the implications**

```bash
# 1. Backup existing state (CRITICAL)
mkdir -p ~/Downloads/olas-backup-$(date +%s)
cp -r olas-operate-middleware/.operate ~/Downloads/olas-backup-$(date +%s)/

# 2. Clean state (ONLY if starting completely fresh)
rm -rf olas-operate-middleware/.operate/wallets/*
rm -rf olas-operate-middleware/.operate/services/*
# NOTE: Keep /.operate/keys/ - these can be reused

# 3. Run validation script
# It will create new wallet and Safe
# Fund the addresses shown in logs
```

### Continuing Existing Work

```bash
# 1. Check existing state
ls -la olas-operate-middleware/.operate/wallets/
ls -la olas-operate-middleware/.operate/services/

# 2. Run validation script
# It will reuse existing wallet
# It may create a NEW service/Safe - be ready to fund

# 3. Before funding, verify which Safe needs funds
# Check script logs for the Safe address
```

### Mainnet Safety Checklist

**Before ANY mainnet operation**:

- [ ] Wallet state backed up to `~/Downloads/olas-wallet-backup/`
- [ ] Know your Master EOA address
- [ ] Know your Master Safe address
- [ ] Check existing services: `ls -la olas-operate-middleware/.operate/services/`
- [ ] Verify which Safe will be used/created
- [ ] Fund the correct addresses (check logs carefully)
- [ ] Never delete wallet directory on mainnet
- [ ] Document all Safe addresses created

**Remember**: 
- Services are disposable
- Wallets are NOT disposable
- Agent keys survive service deletion
- Funds can always be recovered with backed-up keys

---

## Code Patterns

### ✅ Best Practices

#### 1. Always Use HTTP API Through OlasOperateWrapper

**Correct**:
```typescript
const wrapper = new OlasOperateWrapper(config);
const serviceManager = new OlasServiceManager(wrapper, configPath);
await serviceManager.deployAndStakeService();
```

**Wrong**:
```typescript
// ❌ Never test middleware CLI directly
execSync('poetry run operate service create');
```

**Rationale**: Worker must be production-ready. Testing direct CLI bypasses integration issues.

#### 2. Check Existing Services Before Deployment

**Correct**:
```typescript
const existingServices = await serviceManager.listServices();
const chainServices = existingServices.filter(s => 
  s.chain_configs[targetChain] && 
  s.chain_configs[targetChain].chain_data.multisig !== NON_EXISTENT_MULTISIG
);

if (chainServices.length > 0 && !options.forceNewService) {
  throw new Error(`Service already exists: ${chainServices[0].name}`);
}
```

**Wrong**:
```typescript
// ❌ Blindly create services without checking
await serviceManager.deployAndStakeService();
```

#### 3. Validate Configuration Before Middleware Operations

**Correct**:
```typescript
const validation = validateServiceConfig(config);
if (!validation.isValid) {
  throw new Error(`Invalid config: ${validation.errors.join(', ')}`);
}

// Then proceed
await serviceManager.deployAndStakeService(config);
```

**Wrong**:
```typescript
// ❌ Skip validation, fail during deployment
await serviceManager.deployAndStakeService(config);
```

#### 4. Backup Wallet State on Mainnet

**Correct**:
```typescript
if (!useTenderly) {
  // Mainnet mode - backup first
  await backupWalletState();
}
```

**Wrong**:
```typescript
// ❌ No backup before mainnet operations
await deployToMainnet();
```

#### 5. Use Tenderly VNets for Testing

**Correct**:
```typescript
const vnet = await tenderly.createVirtualTestnet({ chainId: 8453 });
// Run tests
await tenderly.deleteVirtualTestnet(vnet.id);
```

**Wrong**:
```typescript
// ❌ Test directly on mainnet
const rpcUrl = 'https://mainnet.base.org';
```

#### 6. Test Actual Worker, Not Components

**Correct**:
```typescript
// Spawn real worker process
const workerProcess = spawn('yarn', ['start'], { env: testEnv });
// Monitor logs for operations
```

**Wrong**:
```typescript
// ❌ Test components in isolation
const manager = new OlasServiceManager(...);
await manager.deployAndStakeService();
```

**Rationale**: E2E tests validate production code paths, not isolated components.

#### 7. Parse Transaction Receipts for Service IDs

**Correct**:
```typescript
const receipt = await processTransactionRequestWithReceipt(txRequest);
const serviceId = parseServiceIdFromReceipt(receipt);
```

**Wrong**:
```typescript
// ❌ Hardcode service IDs
const serviceId = 0;
```

#### 8. Inject Mech Config Before Service Creation

**Correct**:
```typescript
await serviceManager.deployAndStakeService(undefined, {
  deployMech: true,  // Inject BEFORE deployment
  mechType: 'Native'
});
```

**Wrong**:
```typescript
// ❌ Try to deploy mech after service created
await serviceManager.deployAndStakeService();
await serviceManager.deployMech(); // NO SUCH METHOD
```

### ❌ Anti-Patterns

#### 1. Testing Middleware CLI Directly

**Don't**:
```bash
poetry run operate service create
poetry run operate service deploy
```

**Why**: Bypasses worker integration, hides production issues.

#### 2. Starting Fresh Middleware Without Preserving State

**Don't**:
```bash
rm -rf olas-operate-middleware/.operate
```

**Why**: Loses wallet state, agent keys, service configs.

#### 3. Assuming One Safe Per Master Wallet

**Don't**:
```typescript
const safe = await getSafe(masterWallet);
```

**Why**: Each service deployment creates a NEW Safe.

#### 4. Using Fake IPFS Hashes

**Don't**:
```typescript
hash: "bafybeiflqjig7qlvpfrlqbvlcqv2h7ry6sytcx6fxqzwlpjqvdm7nfxpqy" // FAKE
```

**Why**: Causes ReadTimeout from registry.autonolas.tech.

#### 5. Hardcoding Service IDs

**Don't**:
```typescript
const serviceId = 0;
```

**Why**: Doesn't reflect actual on-chain service ID.

#### 6. Bypassing Validation Pipeline

**Don't**:
```typescript
await serviceManager.deployAndStakeService(untrustedConfig);
```

**Why**: Can cause deployment failures with cryptic errors.

#### 7. Deleting Agent Keys Manually

**Don't**:
```bash
rm -rf olas-operate-middleware/.operate/keys/*
```

**Why**: Loses ability to recover funds from Service Safes.

---

## Reference

### Contract Addresses (Base Mainnet)

```
Service Registry:            0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE
Service Registry Token Util: 0x3d77596beb0f130a4415df3D2D8232B3d3D31e44
AgentsFun1 Staking:         0x2585e63df7BD9De8e058884D496658a030b5c6ce
Mech Marketplace:           0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020
OLAS Token:                 0x54330d28ca3357F294334BDC454a032e7f353416
```

### Staking Programs (Base)

| Program | Total OLAS Required | Bond Amount | Staking Amount | Contract Address |
|---------|---------------------|-------------|----------------|------------------|
| agents_fun_1 | **100 OLAS** | 50 OLAS | 50 OLAS | 0x2585e63df7BD9De8e058884D496658a030b5c6ce |
| agents_fun_2 | **1000 OLAS** | TBD | TBD | TBD |
| agents_fun_3 | **5000 OLAS** | TBD | TBD | TBD |

**IMPORTANT**: Staking requires **two equal parts** of OLAS:
1. **Bond Amount** - Security deposit locked in the service contract
2. **Staking Amount** - Deposit locked in the staking contract

For `agents_fun_1`: You need **100 OLAS total** (50 OLAS bond + 50 OLAS stake), not just 50 OLAS.

### Service Configuration Template

```json
{
  "name": "canonical-validation-service",
  "hash": "bafybeihnzvqexxegm6auq7vcpb6prybd2xcz5glbvhos2lmmuazqt75nuq",
  "home_chain": "gnosis",
  "configurations": {
    "gnosis": {
      "agent_id": 14,
      "fund_requirements": {
        "0x0000000000000000000000000000000000000000": {
          "agent": 100000000000000000,
          "safe": 50000000000000000
        }
      }
    }
  }
}
```

### Key Files

**Worker Core**:
- `worker/OlasStakingManager.ts` - Main orchestration
- `worker/OlasServiceManager.ts` - Service lifecycle + cleanup
- `worker/OlasOperateWrapper.ts` - HTTP API wrapper
- `worker/SimplifiedServiceBootstrap.ts` - Interactive setup (JINN-202)
- `worker/config/ServiceConfig.ts` - Service configuration
- `worker/config/MechConfig.ts` - Mech deployment config

**Scripts**:
- `scripts/interactive-service-setup.ts` - CLI entry point for setup
- `scripts/deploy-service-with-mech.ts` - Mainnet deployment
- `scripts/test-worker-e2e.ts` - E2E worker validation
- `scripts/recover-stranded-olas.ts` - Agent EOA fund recovery
- `scripts/recover-from-service-safe.ts` - Service Safe fund recovery
- `scripts/check-agent-balances.ts` - Balance checking utility

**Tests**:
- `worker/OlasServiceManager.test.ts` - Corrupt service cleanup tests
- `worker/OlasOperateWrapper.test.ts` - HTTP API wrapper tests

**Documentation**:
- `AGENT_README.md` - Main project documentation
- `ARCHITECTURE_WALLET_SAFES.md` - Wallet/Safe architecture
- `MAINNET_SAFETY.md` - Safety procedures and recovery
- `docs/TROUBLESHOOTING_INTERACTIVE_SETUP.md` - Interactive setup troubleshooting
- `docs/implementation/OLAS_MIDDLEWARE_SETUP.md` - Middleware setup guide
- `JINN-197-IMPLEMENTATION-SUMMARY.md` - E2E testing implementation
- `JINN-202-IMPLEMENTATION-SUMMARY.md` - Simplified setup implementation
- `SAFETY_IMPROVEMENTS_SUMMARY.md` - Safety incident report

### Commands Reference

#### Service Management

```bash
# Interactive service setup (mainnet)
yarn setup:service --chain=base
yarn setup:service --chain=base --with-mech

# Check existing services
ls -la olas-operate-middleware/.operate/services/

# Check service status
cd olas-operate-middleware && poetry run operate service status
```

#### Wallet & Key Management

```bash
# List all agent keys
ls -la olas-operate-middleware/.operate/keys/

# View agent key
cat olas-operate-middleware/.operate/keys/AGENT_ADDRESS

# Find which services use which Safes
for dir in olas-operate-middleware/.operate/services/sc-*/; do
  safe=$(jq -r '.chain_configs.base.chain_data.multisig // "none"' "$dir/config.json" 2>/dev/null)
  agent=$(jq -r '.agent_addresses[0] // "none"' "$dir/config.json" 2>/dev/null)
  echo "$(basename $dir): safe=$safe agent=$agent"
done
```

#### Testing

```bash
# E2E worker test
yarn test:worker-e2e

# Run with custom interval
STAKING_INTERVAL_MS_OVERRIDE=60000 yarn test:worker-e2e
```

#### Fund Recovery

```bash
# Check agent balances
yarn tsx scripts/check-agent-balances.ts

# Recover from agent EOAs
yarn tsx scripts/recover-stranded-olas.ts

# Recover from Service Safe
yarn tsx scripts/recover-from-service-safe.ts
```

#### Cleanup

```bash
# Remove corrupt service
rm -rf olas-operate-middleware/.operate/services/SERVICE_ID

# Backup before cleanup
mkdir -p service-backups
cp -r olas-operate-middleware/.operate/services/SERVICE_ID \
      service-backups/SERVICE_ID-$(date +%Y%m%d-%H%M%S)
```

### Environment Variables Reference

**Required for All Operations**:
```bash
OPERATE_PASSWORD=<password>         # Wallet encryption password
<CHAIN>_LEDGER_RPC=<rpc_url>       # Chain-specific RPC (e.g., BASE_LEDGER_RPC)
```

**Mode Selection**:
```bash
ATTENDED=true|false                 # Interactive prompts vs automation
```

**Staking Configuration**:
```bash
STAKING_PROGRAM=<program>           # "no_staking", "custom_staking", etc.
CUSTOM_STAKING_ADDRESS=<address>    # If using custom_staking
```

**Tenderly Testing**:
```bash
TENDERLY_ACCESS_KEY=<key>
TENDERLY_ACCOUNT_SLUG=<account>
TENDERLY_PROJECT_SLUG=<project>
TENDERLY_ENABLED=true               # Enable Tenderly mode
```

**Testing Overrides**:
```bash
STAKING_INTERVAL_MS_OVERRIDE=60000  # Override staking interval for tests
```

### Mech Marketplace & Balance Tracker (JINN-207)

**Critical Architecture Understanding** (October 3, 2025):

The Mech Marketplace uses a **Balance Tracker** contract as an escrow system for request payments. This allows requesters to deposit funds once and make multiple requests without constantly funding each transaction.

**Key Contracts (Base Mainnet)**:
- **Mech Marketplace**: `0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020`
- **Balance Tracker**: `0xB3921F8D8215603f0Bd521341Ac45eA8f2d274c1` (BalanceTrackerFixedPriceNative)

**How Request Payment Works**:

1. **Request Submission** (via `marketplace.request()`):
   - Requester sends ETH value with the transaction (e.g., 0.01 ETH)
   - Marketplace calls `balanceTracker.checkAndRecordDeliveryRates()`
   - Balance tracker records: `mapRequesterBalances[requester] -= deliveryRate`
   - Funds are **immediately deducted** from the requester's balance in the tracker

2. **Request Delivery** (mech delivers within timeout):
   - Mech calls `marketplace.deliver(requestId, data)`
   - Marketplace calls `balanceTracker.finalizeDeliveryRates()`
   - For `deliveredRequests[i] == true`:
     - Funds transferred from requester balance to mech balance
     - `mapMechBalances[mech] += deliveryRate`
   - Mech can later call `balanceTracker.processPayment()` to withdraw

3. **Request Timeout** (no delivery within responseTimeout):
   - **CRITICAL**: The deployed balance tracker (0xB392...) **DOES NOT** have a `withdraw()` function
   - Undelivered requests are NOT automatically refunded
   - When `marketplace.finalizeDeliveryRates()` is called with `deliveredRequests[i] == false`:
     - Funds remain in `mapRequesterBalances[requester]`
     - NO automatic credit back mechanism exists
   - **Current State**: Funds are effectively **LOCKED** in the balance tracker for undelivered requests

**Mech `maxDeliveryRate` Setting**:
- Set during mech deployment (e.g., 0.01 ETH = 10000000000000000 wei)
- Determines the cost per request for that specific mech
- Different mechs have different rates (some as low as 0.00005 ETH)
- Our mech (Service #164): **0.01 ETH per request**
- This is why other agents pay less - they use mechs with lower `maxDeliveryRate`

**Fund Recovery Status** (JINN-207):
- ❌ **No `withdraw()` function** in deployed balance tracker
- ❌ **No automatic refund** for timed-out requests
- ❌ **Funds locked** at 0 balance (already deducted, not credited back)
- ⚠️ **Action Required**: Contact Mech Marketplace team or investigate alternative recovery mechanisms

**Lessons Learned**:
1. Audit files (internal3) showed a `withdraw()` function, but **deployed contract differs**
2. Always verify deployed contract code, not just audit files
3. Balance tracker versions vary - the production version lacks refund mechanisms
4. For activity checker requirements, must send fresh funds per request (cannot reuse timed-out funds)

### Known Services (Base Mainnet)

| Service | Safe Address | Status | Notes |
|---------|-------------|--------|-------|
| #149 | 0x15aDF0eD29b6D76DB365670DfEeD8F9C5dAD4645 | DEPLOYED_AND_STAKED ✅ | Successfully validated (Oct 1, 2025) |
| #150 | 0xbcE25403FE17Cc0C41F334A07ca26cd8890090d9 | DEPLOYED_AND_STAKED ✅ | Successfully validated (Oct 1, 2025) |
| #158 | See service-backups | MECH_DEPLOYED | Middleware crashed after mech deployment |
| #164 | 0xdB225C794218b1f5054dffF3462c84A30349B182 | DEPLOYED_AND_STAKED ✅ | **Full integration validated** (Oct 2, 2025) - Mech: 0xE403cd520cfC2C3580D6C1C9302b74723Ef48B8E |

**Service #164 Details** (Complete Success):
- **Mech Address:** `0xE403cd520cfC2C3580D6C1C9302b74723Ef48B8E`
- **Agent EOA:** `0x3944aB4EbAe6F9CA96430CaE97B71FB878E1e100`
- **Staking:** AgentsFun1 (`0x2585e63df7BD9De8e058884D496658a030b5c6ce`)
- **Status:** Service deployed, mech deployed, staked, and running
- **Validation:** JINN-186 complete (deploy + mech + stake + attended mode)

### Related Issues & Pull Requests

**Parent Epic**:
- **JINN-186**: Full validation of OLAS implementation (In Progress)
  - PR: https://github.com/oaksprout/jinn-gemini/pull/36

**Sub-Issues**:
- **JINN-197**: Worker E2E testing (Done)
- **JINN-198**: Integrated mech deployment (Done)
- **JINN-202**: Simplified interactive setup (Done)
- **JINN-203**: Consolidate OLAS documentation (This document)
- **JINN-204**: Validate staking on Tenderly (Triage)

**Historical Issues**:
- **JINN-185**: Implement mech deployment (Done)
- **JINN-187**: Phase 1 Tenderly setup (In Progress)
- **JINN-188**: Resolve wallet authentication (Done)
- **JINN-189**: Complete service deployment (Done)
- **JINN-190**: Service staking and mech deployment (Done)
- **JINN-191**: Fix Tenderly funding timing (Done)

### Support & Troubleshooting

**Documentation**:
- `docs/TROUBLESHOOTING_INTERACTIVE_SETUP.md` - Common issues and solutions
- `MAINNET_SAFETY.md` - Recovery procedures and safety checklist
- `ARCHITECTURE_WALLET_SAFES.md` - Deep dive into wallet/Safe architecture

**Common Issues**:
1. "Invalid password" → Remove `.operate` directory
2. "User not logged in" → Auto-handled by OlasOperateWrapper
3. "Chain not supported" → Use lowercase chain names
4. "ReadTimeout" → Use real IPFS hash
5. "TypeError" on fund requirements → Use integers, not strings

**Getting Help**:
1. Check troubleshooting documentation first
2. Review error logs carefully (include full error output)
3. Verify on-chain state (Safe balances, service status)
4. Check middleware logs for detailed errors
5. Include environment configuration (without secrets)

---

## Appendix: Historical Context

### The Journey to This Architecture

**September 2025**: Started with manual OLAS integration attempts.

**JINN-185**: Implemented basic mech deployment.

**JINN-186**: Full validation epic launched. Discovered:
- HTTP API authentication bugs
- Wallet/Safe hierarchy complexity
- Service state persistence issues

**JINN-188**: Resolved wallet authentication issues (stale `.operate` directory).

**JINN-189**: Switched to HTTP API after CLI issues.

**JINN-190**: Resolved server management conflicts.

**JINN-191**: Fixed Tenderly funding timing with balance polling.

**JINN-197**: Created E2E worker tests to validate production code paths.

**JINN-198**: Integrated mech deployment into service creation flow. Discovered:
- Mech deployment timing requirements
- HTTP API session management bugs
- Need for auto-re-authentication

**JINN-202**: Simplified interactive setup by 73%. Discovered:
- Middleware's native prompts are superior
- Single atomic quickstart call more reliable
- ATTENDED mode provides better UX

**October 1, 2025**: Services #149 and #150 successfully deployed on Base mainnet. Staking validated.

**October 2, 2025**: Service #164 deployed with **complete integration** - service + mech + staking in attended mode. All JINN-186 requirements met:
- ✅ Deploy service on Base mainnet
- ✅ Deploy mech contract automatically during service creation
- ✅ Stake in custom staking contract (AgentsFun1)
- ✅ Attended mode with interactive staking prompt
- ✅ Fresh service creation (not reusing existing services)
- ✅ All transactions confirmed on-chain
- ✅ Service running in Docker containers

### Lessons Learned

1. **Trust the Middleware**: Native middleware functionality is battle-tested. Don't reimplement.
2. **Test Production Paths**: E2E tests that spawn actual worker catch integration bugs.
3. **Preserve State**: Wallet state and agent keys must survive service deletion.
4. **Session Management**: Middleware's in-process state is volatile. Re-authenticate often.
5. **Configuration Validation**: Validate early to avoid cryptic deployment errors.
6. **Recovery First**: Always have fund recovery procedures before mainnet operations.
7. **Document Everything**: Complex systems need comprehensive documentation.

---

**End of OLAS Architecture Guide**

*This document consolidates learnings from JINN-186, JINN-197, JINN-198, and JINN-202.*  
*Last Updated: October 2, 2025*

