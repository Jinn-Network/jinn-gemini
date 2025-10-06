# Quick Start: Safe-based Mech Marketplace

## TL;DR - Run This

```bash
# Terminal 1: Start Ponder
cd ponder && yarn dev

# Terminal 2: Run complete E2E test
yarn test:safe-e2e
```

**This will:**
1. ✅ Submit marketplace request via Safe
2. ✅ Run worker once to deliver via Safe
3. ✅ Verify end-to-end flow

---

## Available Commands

| Command | What It Does |
|---------|--------------|
| `yarn test:safe-request` | Submit one request via Safe |
| `yarn test:safe-e2e` | Complete E2E: request + deliver |
| `yarn dev:mech` | Run worker once (single job) |
| `yarn dev:mech:continuous` | Run worker continuously |
| `yarn dev:stack` | Run everything (Ponder + Control API + Worker) |

---

## What Happens Without DRY_RUN

When you run `yarn test:safe-request` (without `DRY_RUN=true`):

1. **Reads service config** from middleware
   - Safe: `0xb8B7A89760A4430C3f69eeE7Ba5D2B985D593D92`
   - Mech: `0x8c083Dfe9bee719a05Ba3c75A9B16BE4ba52c299`

2. **Submits request via Safe**
   - Agent EOA signs Safe transaction
   - Executes `Safe.execTransaction()` → `Marketplace.request()`
   - **Cost: ~0.000005 ETH** (gas only)

3. **On-chain result:**
   - ✅ Transaction confirmed
   - ✅ MarketplaceRequest event emitted
   - ✅ Request added to undelivered queue
   - ✅ Ponder indexes the event

4. **Output:**
   ```
   ✅ MARKETPLACE REQUEST SUCCESSFUL!
   Transaction Hash: 0x...
   View on BaseScan: https://basescan.org/tx/0x...
   ```

---

## Mech Worker

The worker (`yarn dev:mech`) automatically:
1. Reads Safe address from service config (no manual setup)
2. Loads agent private key from middleware
3. Polls Ponder for undelivered requests
4. Claims request via Control API
5. Executes with Gemini agent
6. Delivers via Safe (auto-configured)

**Zero configuration needed** - everything read from middleware!

---

## Ponder Requirement

Ponder indexes blockchain events so the worker can detect requests.

**Start Ponder:**
```bash
cd ponder && yarn dev
```

**Check Ponder health:**
```bash
curl http://localhost:42069/graphql -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "{ __typename }"}'
```

---

## Testing Workflow

### Option 1: Automated E2E (Recommended)

```bash
# Terminal 1
cd ponder && yarn dev

# Terminal 2
yarn test:safe-e2e
```

### Option 2: Manual Steps

```bash
# Terminal 1: Start Ponder
cd ponder && yarn dev

# Terminal 2: Submit request
yarn test:safe-request

# Terminal 3: Wait ~10s, then run worker
yarn dev:mech
```

### Option 3: Continuous (Production-like)

```bash
# Runs Ponder + Control API + Worker together
yarn dev:stack

# Then submit requests as needed
yarn test:safe-request
```

---

## Complete Details

See `JINN-209-TESTING-GUIDE.md` for:
- Detailed command explanations
- Environment requirements
- Troubleshooting guide
- Architecture diagrams
- Production deployment

---

**Ready to test? Run `yarn test:safe-e2e` now!**

