# Manual Service + Mech Deployment on Base Mainnet

⚠️ **DEPRECATED**: This manual process is no longer needed!

## ✅ Use the Interactive Setup Wizard Instead

```bash
yarn setup:service --chain=base --with-mech
```

The wizard automatically handles all the steps below with a user-friendly interface that:
- Guides you through each funding requirement
- Shows real-time balance verification
- Pauses at each step for you to fund addresses
- Verifies funding before proceeding
- Handles service creation and mech deployment automatically

See `GETTING_STARTED.md` or `docs/QUICK_START_SERVICE_SETUP.md` for the complete guide.

---

## Legacy Manual Process (For Reference Only)

The automated script cannot handle interactive prompts properly. Follow these steps to deploy manually:

## Step 1: Set up environment

```bash
cd /Users/gcd/Repositories/main/jinn-cli-agents/.conductor/oak-jinn-186-full-validation-of-implementation
export OPERATE_PASSWORD="your-password-here"
export BASE_LEDGER_RPC="https://quick-sly-needle.base-mainnet.quiknode.pro/4f34d3d5372ca01c3fbb15ed3571865c81312db8/"
```

## Step 2: Create service config with mech

The service config at `/tmp/jinn-mech-service-1759316343499/service-config.json` has been created with mech environment variables already injected.

## Step 3: Run quickstart in attended mode

```bash
cd olas-operate-middleware
poetry run python -m operate.cli quickstart /tmp/jinn-mech-service-1759316343499/service-config.json
```

**IMPORTANT**: The quickstart command will:
1. Create a new Service Safe
2. Display the Safe address and ask you to fund it with ~0.001 ETH
3. Wait for you to press Enter after funding
4. Deploy the service on-chain (including mech deployment!)
5. Stake the service

## Alternative: Use a fresh config

If you want to create a brand new service config:

```bash
# Create config with mech support
cat > /tmp/my-service-config.json << 'EOF'
{
  "name": "my-mech-service",
  "hash": "bafybeiardecju3sygh7hwuywka2bgjinbr7vrzob4mpdrookyfsbdmoq2m",
  "description": "OLAS service with mech",
  "image": "https://operate.olas.network/_next/image?url=%2Fimages%2Fprediction-agent.png&w=3840&q=75",
  "service_version": "v0.26.3",
  "home_chain": "base",
  "configurations": {
    "base": {
      "staking_program_id": "agents_fun_1",
      "nft": "bafybeiardecju3sygh7hwuywka2bgjinbr7vrzob4mpdrookyfsbdmoq2m",
      "rpc": "https://quick-sly-needle.base-mainnet.quiknode.pro/4f34d3d5372ca01c3fbb15ed3571865c81312db8/",
      "threshold": 1,
      "agent_id": 14,
      "use_staking": true,
      "use_mech_marketplace": true,
      "mech_marketplace_address": "0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020",
      "cost_of_bond": "10000000000000000",
      "fund_requirements": {
        "0x0000000000000000000000000000000000000000": {
          "agent": 500000000000000,
          "safe": 500000000000000
        },
        "0x54330d28ca3357F294334BDC454a032e7f353416": {
          "agent": 50000000000000000000,
          "safe": 50000000000000000000
        }
      }
    }
  },
  "env_variables": {
    "MECH_TO_CONFIG": {
      "default": "{\"Native\": {\"mech_marketplace_address\": \"0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020\", \"mech_request_price\": 10000000000000000}}"
    }
  }
}
EOF

# Run quickstart
cd olas-operate-middleware
poetry run python -m operate.cli quickstart /tmp/my-service-config.json
```

## What to expect

When you run quickstart:
- It will show you a Safe address like `0xABCD...`
- You need to send ~0.001 ETH to that address
- After funding, press Enter
- The service will be deployed with the mech contract!
- The mech address will be displayed in the output

## After successful deployment

The service will be created in `.operate/services/sc-XXXXX/` with:
- `config.json` - includes the mech address in env_variables
- Service Safe address
- Token ID (service ID on-chain)

You can then manage it with the worker/OlasServiceManager.


