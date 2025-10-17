# Getting Started with Jinn OLAS Worker

This guide will help you deploy your first OLAS service and start processing on-chain jobs.

## Quick Setup (5 Steps)

### 1. Clone and Install

```bash
git clone <repository-url>
cd jinn-cli-agents
yarn install
yarn setup:dev
```

### 2. Configure Environment

Create a `.env` file:

```bash
# Required for service setup
OPERATE_PASSWORD="your-secure-password"
BASE_LEDGER_RPC="https://your-base-rpc-url"

# Required for worker operation
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
CONTROL_API_URL="http://localhost:4001/graphql"
```

### 3. Get Funds

You'll need approximately:
- **0.005 ETH** (for gas)
- **150 OLAS** (for service bond + staking)

On **Base mainnet**:
- Bridge ETH from Ethereum mainnet or buy on an exchange
- Get OLAS tokens from Uniswap or Bridge:
  - Token Address: `0x54330d28ca3357F294334BDC454a032e7f353416`

### 4. Run Interactive Setup

```bash
yarn setup:service --chain=base
```

The wizard will guide you through:
1. Creating master wallet → **Fund with 0.002 ETH**
2. Deploying master Safe → **Fund with 0.002 ETH + 100 OLAS**
3. Creating service config (no funding needed)
4. Deploying service Safe → **Fund with 0.001 ETH + 50 OLAS**
5. Staking the service automatically

At each step:
- The wizard shows you the address to fund
- You transfer the required amounts
- Type `check` to verify your transfer arrived
- Type `continue` to proceed

**Example session:**
```
📍 Step 1/4: Fund Master Wallet
───────────────────────────────────────────────────────────────────────────────

The Master Wallet is your primary EOA that will deploy the Master Safe.

🔑 Address: 0xABCD1234...WXYZ5678

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

📊 Current Balance:
   • 0.002 ETH (need 0.002) ✅
   • 0 OLAS (need 0) ✅

✅ Funding requirements met!

> continue

✅ Proceeding to next step...
```

### 5. Start the Worker

```bash
yarn build
yarn start
```

Your worker is now:
- Processing jobs from the on-chain marketplace
- Earning OLAS staking rewards
- Automatically managing the service lifecycle

## What Just Happened?

The interactive setup created a hierarchical wallet structure:

```
┌─────────────────────────────────────────────────────────┐
│ Master Wallet (Your EOA)                                │
│ • Encrypted with OPERATE_PASSWORD                       │
│ • Stored in .operate/wallets/base.txt                   │
│ • Deploys and controls Master Safe                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Master Safe (Gnosis Safe)                               │
│ • On-chain smart contract wallet                        │
│ • Owned by Master Wallet                                │
│ • Creates and funds Service Safes                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Service Safe (Gnosis Safe)                              │
│ • Holds staked OLAS tokens                              │
│ • Executes service operations                           │
│ • Controlled by Agent Key (1/1 multisig)                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Agent Key (Service Signer)                              │
│ • Stored in .operate/keys/{address}.json                │
│ • Signs transactions from Service Safe                  │
│ • Survives service deletion                             │
└─────────────────────────────────────────────────────────┘
```

## Next Steps

### Monitor Your Service

Check your service on the OLAS dashboard:
- **Base mainnet**: https://operate.olas.network
- View staking status, rewards, and service health

### Deploy with Mech (Optional)

To enable marketplace participation:

```bash
yarn setup:service --chain=base --with-mech
```

This deploys a mech contract that allows your service to:
- Accept requests from the MechMarketplace
- Process AI/LLM tasks
- Earn additional rewards

### View Logs

```bash
# Worker logs
tail -f worker.log

# Filter for OLAS operations
grep "OLAS" worker.log

# Filter for job processing
grep "Job" worker.log
```

### Check Service Status

```bash
cd olas-operate-middleware
poetry run operate service status
```

## Troubleshooting

### "Insufficient funds" error

**Problem**: Transfer didn't arrive or insufficient amount

**Solution**:
1. Wait 5-10 seconds for confirmation
2. Type `check` to refresh balance
3. Verify correct address in block explorer
4. Ensure you sent correct token (ETH vs OLAS)

### "Failed to deploy service"

**Problem**: Service Safe has insufficient funds

**Solution**:
1. Check balance on block explorer
2. Verify OLAS token balance (not just ETH)
3. Ensure gas prices aren't extremely high

### "User not logged in"

**Problem**: Middleware session expired

**Solution**: The wrapper auto-re-authenticates. If persistent:
```bash
rm -rf olas-operate-middleware/.operate
yarn setup:service --chain=base
```

### Want to recover funds?

If you need to access funds from a Safe:

1. Find agent key: `.operate/keys/{agent-address}.json`
2. Extract private key from the JSON
3. Import to MetaMask
4. Access Safe via https://app.safe.global
5. Transfer funds as needed

See `ARCHITECTURE_WALLET_SAFES.md` for detailed recovery procedures.

## Architecture Deep Dive

For detailed explanations:
- **Service Setup**: `docs/QUICK_START_SERVICE_SETUP.md`
- **Wallet Architecture**: `ARCHITECTURE_WALLET_SAFES.md`
- **System Overview**: `AGENT_README.md`
- **Safety Procedures**: `MAINNET_SAFETY.md`

## Advanced Usage

### Multiple Services

You can create multiple services by running the wizard again. Each service gets:
- Its own Service Safe
- Its own Agent Key
- Independent staking

They all share the same Master Wallet and Master Safe.

### Different Networks

```bash
yarn setup:service --chain=gnosis
yarn setup:service --chain=mode
yarn setup:service --chain=optimism
```

Each network requires its own RPC URL in `.env`.

### Custom Configuration

Set environment variables before running:

```bash
# Custom service config
export OLAS_SERVICE_CONFIG_PATH="/path/to/custom-config.json"

# Custom staking interval (default: 1 hour)
export STAKING_INTERVAL_MS_OVERRIDE="3600000"

yarn setup:service
```

## Support

- **Issues**: Open a GitHub issue
- **Documentation**: See `/docs` directory
- **Examples**: See `/scripts` directory

## Security Notes

🔒 **Your Keys**:
- Master wallet encrypted with `OPERATE_PASSWORD`
- Agent keys stored unencrypted (filesystem protection only)
- Service Safes protected by on-chain signature requirements

⚠️ **Mainnet Safety**:
- Always verify addresses before funding
- Test on testnets first (Base Sepolia)
- Keep backups of `.operate` directory
- Document all Safe addresses

🛡️ **Best Practices**:
- Use hardware wallet for large amounts
- Never share private keys or mnemonics
- Monitor service regularly
- Keep middleware updated

---

**Ready to start?** Run `yarn setup:service --chain=base` and follow the prompts!

