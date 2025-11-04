# Identity Requirements

OLAS integration and on-chain identity requirements for the Jinn protocol.

---

## IDQ-001: Gnosis Safe as Worker Identity

**Assertion:**  
Each worker must operate through a Gnosis Safe multisig wallet configured as 1/1 with agent key as signer, not through raw EOA private keys.

**Examples:**

| Do | Don't |
|---|---|
| Submit transactions via Safe using agent key signature | Use raw EOA private key for transactions |
| Configure Safe as 1/1 multisig with agent key | Create multi-signer Safe for worker |
| Read Safe address from `.operate` profile | Hardcode Safe address in configuration |
| Use Safe SDK for transaction construction | Manually construct Safe transaction calldata |

**Commentary:**

Gnosis Safe provides security and upgradeability:

**Safe Configuration:**
- **Threshold**: 1 (only one signature required)
- **Signers**: Agent key address (stored in `/.operate/keys/`)
- **Owner**: Can be changed without moving funds
- **Modules**: Support for future extensions

**Transaction Flow:**
```typescript
import { ethers } from 'ethers';
import Safe from '@safe-global/safe-core-sdk';

// Load agent key
const agentKey = await getServicePrivateKey();
const signer = new ethers.Wallet(agentKey, provider);

// Initialize Safe
const safeAddress = await getServiceSafeAddress();
const safe = await Safe.create({ safeAddress, ethAdapter });

// Create transaction
const safeTransaction = await safe.createTransaction({
  to: mechAddress,
  data: deliverCalldata,
  value: '0'
});

// Sign and execute
await safe.signTransaction(safeTransaction);
const executeTxResponse = await safe.executeTransaction(safeTransaction);
```

**Why Safe over EOA?**
- Key rotation without moving funds
- Multi-sig capability for future governance
- Module system for programmatic control
- Recovery mechanisms if key compromised
- Industry standard for institutional wallets

**Important:** Read addresses from `env/operate-profile.ts`:
```typescript
import { getServiceSafeAddress, getMechAddress } from '../env/operate-profile';

const safeAddress = await getServiceSafeAddress();
const mechAddress = await getMechAddress();
```

Never hardcode addresses—they change per deployment.

---

## IDQ-002: Two-Keystore Architecture

**Assertion:**  
The middleware must maintain two separate keystores: master wallet (encrypted) and agent keys (global), with distinct purposes in the service lifecycle.

**Examples:**

| Do | Don't |
|---|---|
| Use master wallet to create Safes (pays deployment gas) | Use master wallet for service operations |
| Use agent keys to sign from Safes (1/1 multisig) | Use agent keys to deploy Safes |
| Store master wallet encrypted in `/.operate/wallets/` | Store master wallet in plaintext |
| Store agent keys globally in `/.operate/keys/` | Store agent keys per-service |

**Commentary:**

The two-keystore architecture separates concerns:

**1. Master Wallet (EOA):**
- **Location**: `olas-operate-middleware/.operate/wallets/`
- **Format**: Encrypted JSON (requires `OPERATE_PASSWORD`)
- **Chains**: One per chain (e.g., `ethereum.txt`, `base.txt`)
- **Purpose**:
  - Creates and deploys Gnosis Safes
  - Pays gas for Safe deployment
  - Controls Safes during creation phase
  - Transaction submitter for Safe operations
- **Lifecycle**: Must be preserved on mainnet to maintain Safe access

**2. Agent Keys:**
- **Location**: `olas-operate-middleware/.operate/keys/`
- **Format**: Plain JSON with private keys (filesystem protected)
- **Naming**: `{agent_address}.json`
- **Purpose**:
  - Become signers on Safe multisigs (1/1 configuration)
  - Sign transactions from within Safe
  - Execute service operations on behalf of Safe
- **Lifecycle**:
  - Created during service creation
  - Survive service deletion (stored globally)
  - Can be reused across deployments

**Service → Safe → Agent Key Relationship:**
```
Service Creation Flow:
1. create service → generates new agent key in /.operate/keys/
2. deploy service → creates NEW Safe with agent key as signer
3. Safe configured as 1/1 multisig with agent key
4. Service runs using agent key to sign transactions from Safe

CRITICAL: Each service deployment creates a NEW Safe, even with same master wallet
```

**Key Facts:**
- ✅ Agent keys survive service deletion
- ✅ Master wallet creates multiple Safes
- ✅ Each Safe is independent with own agent key
- ✅ Deleting service does NOT delete agent keys
- ✅ Safes can be recovered using agent keys

---

## IDQ-003: Service Bootstrap Hierarchy

**Assertion:**  
Service setup must create a hierarchical wallet structure: Master Wallet → Master Safe → Agent Key → Service Safe, with appropriate funding at each level.

**Examples:**

| Do | Don't |
|---|---|
| Fund Master Wallet with ~0.002 ETH for gas | Start setup without funding |
| Fund Master Safe with ~0.002 ETH + 100 OLAS | Skip Master Safe funding |
| Fund Service Safe with ~0.001 ETH + 50 OLAS | Fund Service Safe before creation |
| Follow interactive prompts showing exact amounts | Guess funding amounts |

**Commentary:**

The bootstrap hierarchy ensures proper fund flow:

**1. Master Wallet (EOA):**
- **Funding**: ~0.002 ETH for gas
- **Purpose**: Deploy Master Safe
- **One-time**: Created once, reused across services

**2. Master Safe:**
- **Funding**: ~0.002 ETH + 100 OLAS
- **Purpose**: Deploy Service Safes, provide OLAS for service bonding
- **Reusable**: One Master Safe can create multiple services

**3. Agent Key (EOA):**
- **Funding**: Generated during service creation (no initial funding)
- **Purpose**: Becomes signer on Service Safe
- **Ephemeral**: Created per service

**4. Service Safe:**
- **Funding**: ~0.001 ETH + 50 OLAS (for staking bond)
- **Purpose**: Service operations, mech transactions
- **Per-Service**: Each service has unique Safe

**Interactive Setup:**
```bash
yarn setup:service --chain=base [--with-mech]
```

The wizard shows native funding prompts with exact amounts and auto-continues when funding detected.

**Total Funding (First Service):**
- Initial: 0.002 ETH (Master Wallet)
- Master Safe: 0.002 ETH + 100 OLAS
- Service Safe: 0.001 ETH + 50 OLAS
- **Total**: ~0.005 ETH + 150 OLAS

**Subsequent Services:**
Master Wallet and Master Safe already exist, so only Service Safe funding needed (~0.001 ETH + 50 OLAS).

---

## IDQ-004: Mech Deployment Integration

**Assertion:**  
Services may deploy mechs automatically during creation by passing `deployMech: true` option, integrating mech address into service configuration.

**Examples:**

| Do | Don't |
|---|---|
| Pass `deployMech: true` to `deployAndStakeService()` | Deploy mech separately after service creation |
| Include `mechType`, `mechRequestPrice`, `mechMarketplaceAddress` | Use default mech config without customization |
| Read mech address from service config after deployment | Query blockchain for mech address |
| Use `getMechAddress()` from operate-profile | Hardcode mech address in worker |

**Commentary:**

Mech deployment during service creation:

**Configuration:**
```typescript
const serviceInfo = await serviceManager.deployAndStakeService(undefined, {
  deployMech: true,
  mechType: 'Native',                              // 'Native', 'Token', 'Nevermined'
  mechRequestPrice: '10000000000000000',           // 0.01 ETH in wei
  mechMarketplaceAddress: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020'  // Base mainnet
});

console.log(`Mech deployed: ${serviceInfo.mechAddress}`);
```

**Flow:**
1. Service manager injects mech env vars into service config before deployment
2. Middleware detects empty `AGENT_ID` and `MECH_TO_CONFIG` variables
3. Middleware's `deploy_mech()` function runs automatically
4. Mech address and agent ID returned in service info
5. Worker reads mech address via `getMechAddress()`

**Benefits:**
- Atomic operation (service + mech in one command)
- No manual mech deployment needed
- Mech address automatically linked to service
- Configuration stored in `.operate` profile

**Base Mainnet Config:**
- **Marketplace**: `0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020`
- **Default Price**: `10000000000000000` (0.01 ETH)
- **Default Type**: `Native` (payment in ETH)

This integration emerged from JINN-198 to simplify mech deployment.

---

## IDQ-005: Testing on Tenderly Virtual TestNets

**Assertion:**  
Service deployments must be tested on Tenderly Virtual TestNets before mainnet deployment, using automated test scripts that verify complete lifecycle.

**Examples:**

| Do | Don't |
|---|---|
| Run `yarn test:tenderly` for automated testing | Deploy directly to mainnet untested |
| Create VNet, deploy service, verify on-chain state | Test with Tenderly forks (deprecated) |
| Inspect transactions in Tenderly dashboard | Rely only on script output |
| Delete VNet and create fresh one for each test | Reuse VNets across test runs |

**Commentary:**

Tenderly Virtual TestNet testing:

**Automated Testing:**
```bash
# Full integration test (staking + mech)
yarn test:tenderly

# Test staking only
yarn test:tenderly --no-mech

# Test mech only
yarn test:tenderly --no-staking

# Baseline test (neither)
yarn test:tenderly --baseline
```

**Test Flow:**
1. Create Tenderly Virtual TestNet (forked Base mainnet)
2. Update `env.tenderly` with VNet credentials
3. Deploy service with specified configuration
4. Verify staking state on-chain (if enabled)
5. Display Tenderly dashboard link for transaction inspection

**Benefits:**
- ✅ Zero cost (no real ETH/OLAS needed)
- ✅ Instant transactions (no waiting for confirmations)
- ✅ Complete transaction visibility
- ✅ Safe testing environment (can't lose real funds)
- ✅ Repeatable (delete VNet, create new one)

**Tenderly Dashboard:**
```
https://dashboard.tenderly.co/{account}/{project}/virtual-testnets/{vnet-id}
```

View all transactions, state changes, gas usage, and debug reverts with detailed stack traces.

**Manual Testing:**
```bash
# 1. Setup Tenderly credentials
cp env.tenderly.template env.tenderly
# Edit with your Tenderly API key

# 2. Create VNet
source env.tenderly
yarn tsx scripts/setup-tenderly-vnet.ts

# 3. Export VNet RPC
export TENDERLY_RPC_URL="<vnet-rpc-url>"
export RPC_URL="$TENDERLY_RPC_URL"

# 4. Run service setup
yarn setup:service --chain=base --with-mech
```

This testing infrastructure emerged from JINN-204 to enable risk-free pre-mainnet validation.

---

## IDQ-006: Fund Recovery Procedures

**Assertion:**  
The protocol must provide automated scripts for recovering stranded funds from agent EOAs and Service Safes after failed deployments.

**Examples:**

| Do | Don't |
|---|---|
| Use `scripts/recover-stranded-olas.ts` for agent EOAs | Manually transfer from each agent key |
| Use `scripts/recover-from-service-safe.ts` for Safes | Abandon funds in failed Safes |
| Check balances first with `scripts/check-agent-balances.ts` | Guess which addresses have funds |
| Include rate limiting delays between transfers | Batch transfers without delays (RPC limits) |

**Commentary:**

Fund recovery handles partial failures:

**Agent EOA Recovery:**
```bash
# 1. Check for stranded funds
yarn tsx scripts/check-agent-balances.ts

# 2. Edit recovery script to add addresses
# Edit scripts/recover-stranded-olas.ts

# 3. Run recovery
yarn tsx scripts/recover-stranded-olas.ts
```

**Script Features:**
- Checks OLAS balance in each agent EOA
- Estimates gas for transfer
- Sends OLAS back to Master Safe
- 3-second delays to avoid RPC rate limiting
- Detailed progress output

**Service Safe Recovery (Option 1: Programmatic):**
```bash
# Edit scripts/recover-from-service-safe.ts
# Set SERVICE_SAFE, AGENT_KEY_PRIVATE_KEY, AGENT_KEY_ADDRESS
yarn tsx scripts/recover-from-service-safe.ts
```

**Service Safe Recovery (Option 2: Manual via Safe UI):**
1. Find agent key in `/.operate/keys/{agent_address}`
2. Extract private key from JSON
3. Import to MetaMask
4. Access Safe at `https://app.safe.global/`
5. Transfer funds to Master Safe

**Prevention:**
- Ensure Master Safe has sufficient OLAS (100+ OLAS)
- Use QuickNode or reliable RPC provider
- Don't interrupt during "Deploying service" phase
- Monitor middleware output for errors

**Automatic Cleanup:**
Corrupt services (missing config, null Safe address, unminted tokens) are auto-deleted on next run. Agent keys are preserved.

This recovery system emerged from early deployment failures leaving funds stranded.

---

## IDQ-007: Address Resolution via Operate Profile

**Assertion:**  
All wallet addresses, Safe addresses, and mech addresses must be read from `.operate` profile via `env/operate-profile.ts`, never hardcoded.

**Examples:**

| Do | Don't |
|---|---|
| `const mechAddress = await getMechAddress()` | `const mechAddress = "0x123..."` |
| `const safeAddress = await getServiceSafeAddress()` | `const safeAddress = process.env.SAFE_ADDRESS` |
| `const privateKey = await getServicePrivateKey()` | Store private keys in `.env` |
| Read from service config JSON dynamically | Cache addresses in global variables |

**Commentary:**

The operate-profile module provides dynamic address resolution:

**Available Functions:**
```typescript
// env/operate-profile.ts
export async function getMechAddress(): Promise<string>;
export async function getServiceSafeAddress(): Promise<string>;
export async function getServicePrivateKey(): Promise<string>;
export function getServiceProfile(): ServiceProfile;
```

**Why Dynamic Resolution?**
- Addresses change per service deployment
- No manual configuration needed
- Automatic sync with middleware state
- Prevents address mismatch bugs

**Service Profile Structure:**
```json
{
  "id": 158,
  "name": "pearl_trader",
  "hash": "bafybei...",
  "multisig": "0x...",           // Service Safe address
  "agent_id": 43,
  "mech_to_config": {
    "mech_address": "0x...",      // Mech contract address
    "agent_id": 43
  }
}
```

**Usage Pattern:**
```typescript
// Worker initialization
const mechAddress = await getMechAddress();
const safeAddress = await getServiceSafeAddress();

// Query Ponder for jobs for this mech
const requests = await ponderClient.query({
  requests(where: { mech: mechAddress, delivered: false })
});

// Submit delivery via this Safe
await deliverViaSafe(requestId, ipfsHash, safeAddress);
```

**Critical:** Never hardcode addresses in:
- Configuration files
- Environment variables
- Worker initialization
- Script constants

Always use `env/operate-profile.ts` for consistency.

---

## IDQ-008: Service Lifecycle Management

**Assertion:**  
Service lifecycle operations (create, deploy, stake, claim, terminate) must be orchestrated through OlasServiceManager delegating to middleware CLI.

**Examples:**

| Do | Don't |
|---|---|
| Use `serviceManager.deployAndStakeService()` | Call middleware API endpoints directly |
| Delegate to middleware CLI for all operations | Implement service creation in TypeScript |
| Handle middleware responses with error checking | Assume operations always succeed |
| Use lazy initialization for service manager | Initialize service manager at startup |

**Commentary:**

Service lifecycle delegation:

**Architecture:**
```
TypeScript (Worker)
    ↓
OlasStakingManager (Lazy Init)
    ↓
OlasServiceManager (CLI Delegation)
    ↓
OlasOperateWrapper (Python CLI Interface)
    ↓
olas-operate-middleware (Python CLI)
    ↓
OLAS Protocol Contracts
```

**Service Manager Operations:**
```typescript
const serviceManager = await OlasServiceManager.createDefault();

// Full lifecycle
const serviceInfo = await serviceManager.deployAndStakeService(undefined, {
  deployMech: true,
  mechType: 'Native',
  mechRequestPrice: '10000000000000000',
  mechMarketplaceAddress: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020'
});

// Individual operations
await serviceManager.create();
await serviceManager.deploy();
await serviceManager.stake();
await serviceManager.claim();
await serviceManager.terminate();
```

**CLI Delegation Pattern:**
```typescript
// OlasServiceManager.deployAndStakeService()
async deployAndStakeService(config?, options?) {
  // 1. Validate environment
  await this.validateEnvironment();
  
  // 2. Start middleware server
  await this.wrapper.startServer();
  
  // 3. Delegate to CLI
  const result = await this.wrapper.makeRequest('/api/service/deploy', {
    method: 'POST',
    body: { config, options }
  });
  
  // 4. Stop server
  await this.wrapper.stopServer();
  
  return result;
}
```

**Why Delegation?**
- Middleware CLI is battle-tested in olas-operate-app
- Handles all OLAS protocol complexity
- No need to reimplement service creation in TypeScript
- Consistent with OLAS ecosystem tooling

**Lazy Initialization:**
```typescript
// Worker
let stakingManager: OlasStakingManager | null = null;

async function ensureStakingManager() {
  if (!stakingManager) {
    stakingManager = await StakingManagerFactory.createFromEnvironment();
  }
  return stakingManager;
}
```

Prevents startup failures if OLAS components unavailable.

---

## IDQ-009: Authentication State Management

**Assertion:**  
The middleware wrapper must re-authenticate before every API call to maintain valid session state, storing password during bootstrap.

**Examples:**

| Do | Don't |
|---|---|
| Call `_ensureLoggedIn()` before every API request | Assume session persists between calls |
| Store password during `bootstrapWallet()` | Ask for password on each call |
| Auto-refresh session silently | Fail on "User not logged in" error |
| Skip re-auth only for `/api/account/login` itself | Re-authenticate even during login |

**Commentary:**

The authentication pattern prevents session loss:

**Issue (JINN-198):**
Middleware's password state (`operate.password`) is stored in-process memory and can be lost:
- When time elapses between login and service creation
- When Python process garbage collects session state
- When multiple API calls happen in sequence

**Solution:**
```typescript
// OlasOperateWrapper.makeRequest()
private async makeRequest(endpoint: string, options?: RequestOptions) {
  // CRITICAL: Re-authenticate before EVERY API call
  if (this.password && endpoint !== '/api/account/login') {
    await this._ensureLoggedIn();
  }
  
  // Now make the actual request
  const response = await fetch(`${this.baseUrl}${endpoint}`, options);
  return response.json();
}

private async _ensureLoggedIn() {
  const response = await fetch(`${this.baseUrl}/api/account/login`, {
    method: 'POST',
    body: JSON.stringify({ password: this.password })
  });
  
  if (!response.ok) {
    throw new Error('Re-authentication failed');
  }
}
```

**Why This Works:**
- Middleware accepts login at any time
- Immediately refreshes in-process `operate.password`
- Overhead is ~50ms (negligible for service operations)
- Prevents "User not logged in" errors

**Alternative Considered:**
Keep middleware server alive indefinitely → Rejected because:
- Process still loses session over time
- Resource leaks in long-running scenarios
- Re-login overhead is acceptable

This fix ensures reliable service operations regardless of timing.

---

## IDQ-010: Mainnet Safety Checks

**Assertion:**  
The protocol must include validation scripts that prevent accidental wallet deletion and warn about new Safe creation on mainnet.

**Examples:**

| Do | Don't |
|---|---|
| Run validation scripts before mainnet operations | Delete `.operate` directory on mainnet |
| Show warnings for new Safe creation | Create Safes without confirmation |
| Preserve `.operate` state between runs | Treat mainnet like testnet |
| Back up service configs before deletion | Delete services without backup |

**Commentary:**

Mainnet safety mechanisms:

**Validation Script:**
```bash
# Check environment before operations
yarn tsx scripts/validate-mainnet-safety.ts
```

**Checks:**
- Warns if `.operate` directory doesn't exist (new wallet will be created)
- Warns if Master Safe doesn't exist (funds required)
- Checks ETH and OLAS balances
- Displays current addresses and their roles
- Requires explicit confirmation for destructive operations

**Service Backups:**
```bash
# Before deleting service
mkdir -p service-backups
cp -r olas-operate-middleware/.operate/services/SERVICE_ID \
      service-backups/SERVICE_ID-$(date +%Y%m%d-%H%M%S)
```

**Backup Contents:**
- Service configuration (`config.json`)
- Deployment artifacts
- SSL certificates
- Persistent data
- Service metadata

**Recovery:**
```bash
# Restore from backup
cp -r service-backups/SERVICE_ID-TIMESTAMP \
      olas-operate-middleware/.operate/services/SERVICE_ID
```

**Critical Rules:**
- ❌ Never delete `.operate` on mainnet
- ❌ Never hardcode addresses
- ❌ Never deploy without testing on Tenderly
- ✅ Always back up before deletion
- ✅ Always verify balances before operations
- ✅ Always use interactive mode for first mainnet deployment

This safety system emerged from early incidents losing access to mainnet funds.
