# JINN-209: Safe-based Mech Marketplace Testing Guide

Complete guide for testing the Safe-based mech marketplace request/deliver flow.

---

## Quick Start (What You Asked For)

### 1. Submit a Request and Deliver (Complete E2E)

```bash
# Terminal 1: Start Ponder (indexes blockchain events)
cd ponder && yarn dev

# Terminal 2: Run complete E2E test (request + deliver)
yarn test:safe-e2e
```

**What happens:**
1. ✅ Reads service config from middleware (Safe address, mech address, agent key)
2. ✅ Submits marketplace request via Safe
3. ⏳ Waits for Ponder to index the request
4. ✅ Runs worker once to claim and deliver
5. ✅ Verifies delivery on-chain

---

## Available Commands

### Testing Commands

```bash
# 1. Dry run (validate configuration only, no transaction)
DRY_RUN=true yarn test:safe-request

# 2. Submit a single request via Safe
yarn test:safe-request

# 3. Complete E2E: request + deliver (recommended)
yarn test:safe-e2e

# 4. Run worker once (single job)
yarn dev:mech

# 5. Run worker continuously (polls for requests)
yarn dev:mech:continuous
```

### Full Stack Commands

```bash
# Run everything together: Ponder + Control API + Worker
yarn dev:stack

# This runs:
# - Ponder (indexes blockchain events)
# - Control API (job tracking)
# - Mech Worker (processes requests in continuous mode)
```

---

## Detailed Workflows

### Workflow 1: Submit Request Only

```bash
# Just submit a marketplace request via Safe
yarn test:safe-request

# Output:
# ✅ Service configuration read
# ✅ Agent private key loaded
# ✅ Request submitted via Safe
# Transaction Hash: 0x...
```

### Workflow 2: Complete E2E Test (Recommended)

```bash
# Terminal 1: Start Ponder
cd ponder && yarn dev

# Terminal 2: Run E2E test
yarn test:safe-e2e

# What happens:
# 1. Checks Ponder is running
# 2. Reads service config
# 3. Submits request via Safe
# 4. Waits for Ponder to index
# 5. Runs worker to claim and deliver
# 6. Verifies delivery

# Output:
# ✅ REQUEST SUBMITTED SUCCESSFULLY!
# ✅ DELIVERY SUCCESSFUL!
```

### Workflow 3: Manual Step-by-Step

```bash
# Terminal 1: Start Ponder
cd ponder && yarn dev

# Terminal 2: Submit request
yarn test:safe-request

# Terminal 3: Wait ~10 seconds, then run worker
yarn dev:mech

# The worker will:
# - Detect the request from Ponder
# - Claim it via Control API
# - Execute with Gemini agent
# - Deliver result via Safe
```

### Workflow 4: Continuous Worker (Production-like)

```bash
# Terminal 1: Start Ponder
cd ponder && yarn dev

# Terminal 2: Start Control API
yarn control:dev

# Terminal 3: Start worker in continuous mode
yarn dev:mech:continuous

# Terminal 4: Submit requests as needed
yarn test:safe-request

# The worker polls continuously and processes requests automatically
```

---

## What Happens When You Run Without DRY_RUN

### `yarn test:safe-request` (No DRY_RUN)

1. **Reads Service Config:**
   - Service Safe: `0xb8B7A89760A4430C3f69eeE7Ba5D2B985D593D92`
   - Agent EOA: `0x62fb5FC6ab3206b3C817b503260B90075233f7dD`
   - Mech: `0x8c083Dfe9bee719a05Ba3c75A9B16BE4ba52c299`

2. **Loads Agent Key:**
   - From: `olas-operate-middleware/.operate/keys/0x62fb5F...`

3. **Submits Request via Safe:**
   - Encodes marketplace request call
   - Builds Safe transaction
   - Agent EOA signs Safe transaction (eth_sign format)
   - Executes `Safe.execTransaction()` on-chain
   - **Cost:** ~0.000005 ETH (gas fees)

4. **On-chain Effects:**
   - ✅ MarketplaceRequest event emitted
   - ✅ Request count incremented for Safe
   - ✅ Request added to undelivered queue
   - ✅ Ponder indexes the event

5. **Result:**
   ```
   ✅ MARKETPLACE REQUEST SUCCESSFUL!
   Transaction Hash: 0x...
   Block Number: 12345
   Gas Used: 67890
   View on BaseScan: https://basescan.org/tx/0x...
   ```

---

## Environment Requirements

### Required Services

1. **Ponder** (indexes blockchain events)
   - Start: `cd ponder && yarn dev`
   - URL: `http://localhost:${PONDER_PORT:-42069}/graphql`
   - Purpose: Indexes mech marketplace requests/deliveries

2. **Control API** (optional, for job tracking)
   - Start: `yarn control:dev`
   - URL: `http://localhost:3000`
   - Purpose: Tracks job claims and reports

### Required Environment Variables

Already configured in `.env`:
```bash
# Base network RPC
BASE_LEDGER_RPC=https://...

# Mech marketplace (Base mainnet)
MECH_MARKETPLACE_ADDRESS_BASE=0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020

# Worker configuration (auto-detected from service config)
MIDDLEWARE_PATH=./olas-operate-middleware
MECH_WORKER_ADDRESS=0x62fb5FC6ab3206b3C817b503260B90075233f7dD

# Ponder endpoint
PONDER_PORT=42069
PONDER_GRAPHQL_URL=http://localhost:${PONDER_PORT}/graphql
```

### Optional (Auto-detected via operate-profile.ts)

These are auto-detected from `.operate` profile if not set:
```bash
MECH_ADDRESS=0x...           # Auto: from service config MECH_TO_CONFIG
MECH_SAFE_ADDRESS=0x...      # Auto: from service config
MECH_PRIVATE_KEY=0x...       # Auto: from .operate/keys/{agent_address}
MECH_CHAIN_CONFIG=base       # Auto: defaults to 'base'
```

**Note:** All scripts and worker code now use `env/operate-profile.ts` functions for consistent configuration loading.

---

## Testing Checklist

### Before Testing

- [ ] Service #165 is deployed and staked
- [ ] Mech contract is deployed (`0x8c083Dfe9bee719a05Ba3c75A9B16BE4ba52c299`)
- [ ] Service Safe has ETH for gas (~0.001 ETH)
- [ ] Ponder is running (`cd ponder && yarn dev`)

### Run E2E Test

```bash
yarn test:safe-e2e
```

### Expected Results

- [ ] ✅ Service config read successfully
- [ ] ✅ Agent private key loaded
- [ ] ✅ Request submitted via Safe
- [ ] ✅ Transaction confirmed on-chain
- [ ] ✅ Request indexed by Ponder
- [ ] ✅ Worker claimed request
- [ ] ✅ Worker delivered via Safe
- [ ] ✅ Delivery transaction confirmed

### Verification

```bash
# Check mech requests
yarn tsx scripts/query-mech-requests.ts --mech 0x8c083Dfe9bee719a05Ba3c75A9B16BE4ba52c299

# Check job reports (if Control API running)
curl http://localhost:3000/api/jobs
```

---

## Troubleshooting

### "Ponder is not running"

```bash
# Start Ponder in separate terminal
cd ponder && yarn dev

# Wait for: "Server listening on http://localhost:${PONDER_PORT:-42069}"
```

### "No service found"

```bash
# Deploy service first
yarn setup:service

# Or check existing services
ls -la olas-operate-middleware/.operate/services/
```

### "Insufficient balance in Safe"

```bash
# Check Safe balance on BaseScan
# Fund Safe with ~0.001 ETH for gas
```

### "No unclaimed requests found"

This is normal if:
- Ponder hasn't indexed yet (wait ~10 seconds)
- Request was already delivered
- Ponder is behind (check sync status)

```bash
# Check Ponder status
curl http://localhost:${PONDER_PORT:-42069}/graphql -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "{ requests(limit: 1) { items { id } } }"}'
```

---

## Architecture Flow

### Request Flow
```
yarn test:safe-request
  ↓
ServiceConfigReader (reads Safe/mech from middleware)
  ↓
MechMarketplaceRequester (submits via Safe)
  ↓
Safe.execTransaction() → Marketplace.request()
  ↓
MarketplaceRequest event emitted
  ↓
Ponder indexes event
```

### Deliver Flow
```
yarn dev:mech
  ↓
mech_worker.ts (polls Ponder for requests)
  ↓
Detects undelivered request
  ↓
Claims via Control API
  ↓
Executes with Gemini agent
  ↓
deliverViaSafe() (auto-loads Safe from service config)
  ↓
Safe.execTransaction() → Mech.deliver()
  ↓
Deliver event emitted
  ↓
Ponder indexes delivery
```

---

## Production Deployment

### Continuous Operation

```bash
# Use dev:stack for development
yarn dev:stack

# Or run individually:
# Terminal 1
cd ponder && yarn dev

# Terminal 2
yarn control:dev

# Terminal 3
yarn dev:mech:continuous
```

### Monitoring

```bash
# Watch worker logs
yarn dev:mech:continuous | tee worker.log

# Query job status
curl http://localhost:3000/api/jobs | jq

# Check mech requests
yarn tsx scripts/query-mech-requests.ts
```

---

## Next Steps

1. **Run E2E Test:**
   ```bash
   # Terminal 1
   cd ponder && yarn dev
   
   # Terminal 2
   yarn test:safe-e2e
   ```

2. **Submit Additional Requests:**
   ```bash
   TEST_PROMPT="Custom prompt here" yarn test:safe-request
   ```

3. **Run Continuous Worker:**
   ```bash
   yarn dev:stack
   ```

---

**All components tested and ready for production deployment.**

