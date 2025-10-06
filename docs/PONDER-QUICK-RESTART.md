# Ponder Quick Restart Guide

## Problem
Ponder was syncing from block 35,577,849, which would take ~25 hours to reach the current block (36,481,259).

## Solution
Updated `ponder/ponder.config.ts` to start from block **36,480,000** (about 1 hour ago), which will catch recent test requests and sync in seconds instead of hours.

---

## Steps to Restart Ponder

1. **Stop Current Ponder Process**
   ```bash
   # In the terminal where Ponder is running, press Ctrl+C
   ```

2. **Clear Ponder Database** (optional but recommended)
   ```bash
   cd ponder
   rm -rf .ponder/sqlite
   ```

3. **Restart Ponder**
   ```bash
   cd ponder
   yarn dev
   ```

4. **Verify Sync Speed**
   - Should sync from block 36,480,000 → 36,481,259 in **seconds**
   - Look for your test requests in the output

---

## Configuration Options

### Start from a Specific Block
```bash
# Default: 36,480,000 (configured in ponder.config.ts)
cd ponder && yarn dev
```

### Start from Latest Block (skip all history)
```bash
PONDER_START_BLOCK=latest cd ponder && yarn dev
```

### Start from Custom Block
```bash
PONDER_START_BLOCK=36481000 cd ponder && yarn dev
```

---

## Expected Output

After restarting, you should see:
```
Started syncing 'base' with 0.0% cached
Indexed MarketplaceRequest
...
Sync complete (or near 100%)
```

Instead of:
```
Indexed 1 events with 0.8% complete and 25h 04m 25s remaining ❌
```

---

## Your Recent Test Transactions

These should be indexed after restart:
- Block 36481035: `0x347639eee410eaf42e915ac7c201e0ad0b98b891116abaaf50c27cb97073e93e`
- Block 36481220: `0xca6c6f81091bd54acc10ee89eaf54728c3947e8959d7982a7e2cb20357b116d1`

---

## Full E2E Test After Ponder Restart

Once Ponder has synced (should take ~30 seconds):

```bash
# Submit a new request and verify it's delivered
yarn test:safe-e2e
```

This will:
1. ✅ Submit a request via Safe
2. ✅ Wait for Ponder to index it (~10 seconds)
3. ✅ Run worker to claim and deliver
4. ✅ Verify delivery on-chain

---

## Why This Works

- **Ponder stores events in SQLite**: Old data from block 35M was unnecessary for testing
- **Recent blocks only**: We only need events from the last hour for testing
- **Fast sync**: Syncing 1,259 blocks takes seconds vs 900,000 blocks taking 25 hours
- **Configurable**: Can always change `PONDER_START_BLOCK` if you need different history

---

**TL;DR**: Stop Ponder, delete `.ponder/sqlite`, restart. Sync will take 30 seconds instead of 25 hours. 🚀

