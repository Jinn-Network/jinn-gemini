---
title: Quick Start - Setting Up an OLAS Service
purpose: runbook
scope: [deployment]
last_verified: 2026-01-30
related_code:
  - olas-operate-middleware/.operate/services
keywords: [olas, service, deployment, setup, wizard, master-wallet, master-safe]
when_to_read: "When deploying your first OLAS service using the interactive setup wizard"
---

# Quick Start: Setting Up an OLAS Service

This guide walks you through deploying your first OLAS service using the interactive setup wizard.

## Prerequisites

1. **Node.js and Yarn**: Ensure you have Node.js (v18+) and Yarn installed
2. **Python Environment**: The system requires Python and Poetry (automated via `yarn setup:dev`)
3. **Funds**: You'll need ETH and OLAS tokens on your chosen network
   - Base mainnet: ~0.005 ETH + 150 OLAS total
   - OLAS Token: `0x54330d28ca3357F294334BDC454a032e7f353416` (Base)
4. **RPC Access**: A reliable RPC endpoint for your chosen network

## Step 1: Environment Setup

Create a `.env` file in the project root:

```bash
# Required
OPERATE_PASSWORD="your-secure-password-here"
BASE_LEDGER_RPC="https://your-base-rpc-url"

# Optional (for other networks)
GNOSIS_LEDGER_RPC="https://your-gnosis-rpc-url"
MODE_LEDGER_RPC="https://your-mode-rpc-url"
OPTIMISM_LEDGER_RPC="https://your-optimism-rpc-url"
```

Run the development setup:

```bash
yarn setup:dev
```

This will:
- Initialize git submodules (olas-operate-middleware)
- Set up Python/Poetry environment
- Install Node.js dependencies

## Step 2: Run the Interactive Setup Wizard

Launch the wizard:

```bash
yarn setup:service --chain=base
```

Or with mech deployment:

```bash
yarn setup:service --chain=base --with-mech
```

## Step 3: Follow the Wizard

The wizard will guide you through **4 funding steps**:

### 3.1: Fund Master Wallet

```
═══════════════════════════════════════════════════════════════════════════════
  STEP 1: Master Wallet Creation
═══════════════════════════════════════════════════════════════════════════════

✅ Master wallet created: 0xABCD...1234

📍 Step 1/4: Fund Master Wallet
───────────────────────────────────────────────────────────────────────────────

The Master Wallet is your primary EOA that will deploy the Master Safe.

🔑 Address: 0xABCD...1234

💰 Required Funding:
   • 0.002 ETH
   • 0 OLAS

📋 Instructions:
   1. Send 0.002 ETH to the address above
   2. Send 0 OLAS to the address above
   3. Type 'check' to verify balance
   4. Type 'continue' to proceed once funded
   5. Type 'skip' to bypass check (CAUTION: may fail later)

> check
```

**What to do:**
1. Send the required ETH from your wallet (MetaMask, hardware wallet, etc.)
2. Type `check` to verify the wizard sees the funds
3. Type `continue` to proceed

The wizard shows current vs. required balances and won't proceed until funded.

### 3.2: Fund Master Safe

```
═══════════════════════════════════════════════════════════════════════════════
  STEP 2: Master Safe Deployment
═══════════════════════════════════════════════════════════════════════════════

✅ Master Safe deployed: 0xDEF0...5678

📍 Step 2/4: Fund Master Safe
───────────────────────────────────────────────────────────────────────────────

The Master Safe will create and fund service Safes.

🔑 Address: 0xDEF0...5678

💰 Required Funding:
   • 0.002 ETH
   • 100 OLAS

   OLAS Token Address: 0x54330d28ca3357F294334BDC454a032e7f353416
```

**What to do:**
1. Send 0.002 ETH to the Master Safe address
2. Send 100 OLAS tokens to the Master Safe address
   - Use the token address shown (Base: `0x54330...`)
   - Transfer via MetaMask or your wallet's token interface
3. Type `check` to verify
4. Type `continue` to proceed

### 3.3: Create Service

```
═══════════════════════════════════════════════════════════════════════════════
  STEP 3: Service Creation
═══════════════════════════════════════════════════════════════════════════════

✅ Service config created: sc-abc123-def456-789
✅ Agent key generated: 0x9876...CDEF
```

**No funding required** - This step just creates the service configuration locally.

### 3.4: Fund Service Safe

```
═══════════════════════════════════════════════════════════════════════════════
  STEP 4: Service Deployment & Staking
═══════════════════════════════════════════════════════════════════════════════

✅ Service Safe deployed: 0x1234...ABCD

📍 Step 3/4: Fund Service Safe
───────────────────────────────────────────────────────────────────────────────

The Service Safe executes service operations and holds staked OLAS.

🔑 Address: 0x1234...ABCD

💰 Required Funding:
   • 0.001 ETH
   • 50 OLAS
```

**What to do:**
1. Send 0.001 ETH to the Service Safe address
2. Send 50 OLAS tokens to the Service Safe address
3. Type `check` to verify
4. Type `continue` to proceed

The service will then be **automatically staked**!

## Step 4: Success!

```
═══════════════════════════════════════════════════════════════════════════════
  ✅ BOOTSTRAP COMPLETE
═══════════════════════════════════════════════════════════════════════════════

Your OLAS service is now fully deployed and staked!

📋 Summary:
   • Master Wallet:  0xABCD...1234
   • Master Safe:    0xDEF0...5678
   • Service Safe:   0x1234...ABCD
   • Agent Key:      0x9876...CDEF
   • Service Config: sc-abc123-def456-789

🎉 You can now run the worker to start processing jobs!

📝 Setup details saved to: /tmp/jinn-service-setup-1234567890.json
```

## Step 5: Run the Worker

Now that your service is deployed and staked, start the worker:

```bash
# Build first
yarn build

# Run the worker
yarn start
```

The worker will:
- Process jobs from the on-chain marketplace
- Execute OLAS staking operations every hour
- Manage the service lifecycle automatically

## Troubleshooting

### "Insufficient funds" after transferring

**Problem**: You transferred funds but the wizard still shows insufficient balance.

**Solutions**:
1. Wait 5-10 seconds for the transaction to confirm
2. Type `check` to refresh the balance
3. Verify you sent to the correct address
4. Check block explorer to confirm transaction succeeded

### "User not logged in" error

**Problem**: Middleware session expired during setup.

**Solution**: The wrapper automatically re-authenticates. If persistent, restart the wizard.

### "Failed to deploy service"

**Problem**: Service Safe has insufficient funds for on-chain operations.

**Solutions**:
1. Verify the Service Safe has the required amounts
2. Check gas prices aren't unusually high
3. Ensure OLAS token approvals are set (usually automatic)

### Want to skip funding verification?

**CAUTION**: Only use in testing environments!

Type `skip` at any funding prompt to bypass the balance check. The deployment may fail later if funds are actually insufficient.

## Understanding the Architecture

### Master Wallet (EOA)
- Your primary wallet
- Deploys the Master Safe
- Needs ETH for gas only
- **Location**: `.operate/wallets/{chain}.txt` (encrypted)

### Master Safe
- Gnosis Safe contract
- Owns and controls all services
- Needs ETH for gas + OLAS for service funding
- **Controlled by**: Master Wallet

### Agent Key
- Service-specific key
- Signs transactions from Service Safe
- Stored globally, survives service deletion
- **Location**: `.operate/keys/{address}.json`

### Service Safe
- Gnosis Safe for the service
- Executes service operations
- Holds staked OLAS
- **Controlled by**: Agent Key (1/1 multisig)
- **Owned by**: Master Safe

### Flow Diagram

```
Master Wallet (EOA)
    │
    ├─> Deploys Master Safe
    │
Master Safe (Gnosis Safe)
    │
    ├─> Creates Service Config
    │   └─> Generates Agent Key
    │
    ├─> Deploys Service Safe
    │   └─> Agent Key as signer (1/1)
    │
    └─> Funds Service Safe
        └─> Stakes OLAS
```

## Next Steps

- **Monitor your service**: Check the Olas Dashboard at https://operate.olas.network
- **View staking rewards**: Your service earns OLAS rewards while staked
- **Deploy a mech**: Run `yarn setup:service --with-mech` for marketplace participation
- **Review logs**: Worker logs show job processing and OLAS operations

## Advanced: Manual Recovery

If you need to access funds from a Safe:

1. **Find the agent key**: `.operate/keys/{agent-address}.json`
2. **Extract private key**: `cat .operate/keys/{agent-address}.json`
3. **Import to MetaMask**: Use the private key to import
4. **Access Safe**: Visit https://app.safe.global and connect with the imported key

See `ARCHITECTURE_WALLET_SAFES.md` for complete recovery procedures.

## Resources

- **Full Documentation**: [AGENTS.md](../../AGENTS.md)
- **Wallet Architecture**: `ARCHITECTURE_WALLET_SAFES.md`
- **Safety Guide**: `MAINNET_SAFETY.md`
- **OLAS Dashboard**: https://operate.olas.network
- **Base Explorer**: https://basescan.org

