# Tests-Next Setup Debugging

## Issue
Transaction submits successfully to Tenderly VNet, but Ponder never indexes the request. Test times out waiting for `waitForRequestIndexed()`.

**Working**: Your colleague's environment ✅  
**Failing**: Your environment ❌

## Test Status
- ✅ Tenderly VNet created successfully
- ✅ Agent funded: `0xCC97C9c46451c13c0294871BA1c4bbEC94bb0C5a` (100 ETH)
- ✅ Safe funded: `0x608d976Da1Dd9BC53aeA87Abe74e1306Ab96280c` (100 ETH)
- ✅ Transaction submitted (e.g., `0x7c8ded4041ebbdb84047932d67c0d4e764d02aedad4831cdbc66c9590ac5c2d7`)
- ❌ Ponder shows "realtime" status but only indexes 1 event (initial), never indexes the new request
- ❌ Test fails: `Polling timed out after 20 attempts. Last result: {"data":{"request":null}}`

## Current Configuration

### `.env.test` contents:
```bash
SUPABASE_POSTGRES_URL=postgresql://postgres:zIy2VlQwu4hFDHls@db.clnwgxgvmnrkwqdblqgf.supabase.co:5432/postgres
GITHUB_TOKEN=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
GIT_AUTHOR_NAME=Oaksprout
GIT_AUTHOR_EMAIL=oaksproutthetan@gmail.com
TENDERLY_ACCESS_KEY=yjeswmM9JVQM7JRjg7unfdbT4TuhXj8G
TENDERLY_ACCOUNT_SLUG=tannedoaksprout
TENDERLY_PROJECT_SLUG=project
TEST_GITHUB_REPO=git@github.com/oaksprout/jinn-gemini-test
OPERATE_PROFILE_DIR=tests-next/fixtures/operate-profile
WORKER_PRIVATE_KEY=0xd7fbde76592def28ef84beecc401407bf13cbfcdbe78dc0bd16ea4dbdc05bbaa
MECH_ADDRESS=0xD03d75D3B59Ac252F2e8C7Bf4617cf91a102E613
```

### Ponder behavior:
- Starts at block ~38167782 (current - 100)
- Reaches "realtime" status quickly
- Shows: `MechMarketplace:Marketp… │ 1 │ 123.006 ms`
- Block number stays constant (e.g., 38167968)
- Never indexes the newly created request

### Key differences to check:

1. **Node.js version**: `node --version`
2. **Yarn version**: `yarn --version`  
3. **Ponder version**: Check `package.json`
4. **Supabase table**: Does `node_embeddings_test` table exist?
5. **Ponder database mode**: SQLite vs Postgres
6. **PONDER_DATABASE_URL**: Is it set in colleague's `.env.test`?
7. **RPC URL differences**: Public vs Admin RPC on Tenderly VNet
8. **Ponder polling interval**: Check `ponder/ponder.config.ts` - `pollingInterval: 6_000`

## Quick Diagnostic Commands

```bash
# Check what Ponder sees
cd /Users/gcd/Repositories/main/jinn-cli-agents
LATEST=$(ls -t logs/test-run/ | head -1)
echo "=== Ponder Config ==="
grep "Ponder Config\|Indexing mech\|MECH_ADDRESS" "logs/test-run/$LATEST/ponder.log"

echo "=== Block Progress ==="
grep "Block" "logs/test-run/$LATEST/ponder.log" | tail -10

echo "=== Event Counts ==="
grep "Event\|Count" "logs/test-run/$LATEST/ponder.log" | tail -20

# Check transaction on VNet
curl -X POST [RPC_URL] \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionByHash","params":["0x7c8ded..."],"id":1}'
```

## Questions for Colleague

1. What's in your `.env.test`? (especially MECH_ADDRESS, PONDER_DATABASE_URL)
2. Any local `.env` overrides or workspace settings?
3. Check `ponder/ponder.config.ts` - any local changes?
4. Is Ponder using Postgres or SQLite in tests? (`PONDER_DATABASE_URL` set?)
5. Do you see multiple `MarketplaceRequest` events indexed or just 1?

## Critical Check: RPC URL Mismatch?

**The transaction is submitted to**: Tenderly VNet Admin RPC (e.g., `https://virtual.base.eu.rpc.tenderly.co/2faa0e57-...`)  
**Ponder should be watching**: Same Tenderly VNet RPC

The `process-harness.ts` sets Ponder's `RPC_URL` to the Tenderly VNet. But verify:

```bash
# In your colleague's environment, check Ponder logs for what RPC it's using
grep -i "ponder config\|start block\|rpc" logs/test-run/*/ponder.log | head -20
```

## Fix Applied ✅
1. Changed `ponder/ponder.config.ts` to read `RPC_URL` dynamically via `getRpcUrl()` function
2. Added comprehensive runtime configuration logging to `.ponder-config-debug.txt`

## Your Current Configuration (Verified Working)
Check `ponder/.ponder-config-debug.txt` after running tests. Example output:
```
✅ RPC_URL: https://virtual.base.eu.rpc.tenderly.co/[uuid]
✅ Is Tenderly VNet: true
✅ Finality Block Count: 0
✅ Database Mode: postgres
✅ MECH_ADDRESS: 0xD03d75D3B59Ac252F2e8C7Bf4617cf91a102E613
✅ OPERATE_PROFILE_DIR: tests-next/fixtures/operate-profile
```

**All configuration is correct!** Ponder IS watching the right RPC and has the right MECH_ADDRESS.

## Latest Test Results
- ✅ Transaction successfully created: `0x78a65aa157d8f9842ac699dd363e455ed2b4829dfb199694065defc777d1b56d`
- ✅ Ponder using correct Tenderly VNet RPC
- ✅ MECH_ADDRESS is correct
- ❌ **Ponder indexed 0 events** (should have indexed 1 MarketplaceRequest)
- ❌ Ponder stuck at block 38170906
- ❌ Test times out waiting for request to be indexed

## Next Steps for Colleague
1. **Run the test on your machine** and share your `ponder/.ponder-config-debug.txt`
2. **Check if Ponder indexes events** in your logs: `grep "Count" logs/test-run/*/ponder.log`
3. **Compare Ponder versions**: `grep ponder package.json`
4. **Check database**: Does Supabase `node_embeddings_test` table exist and have correct permissions?

## Remaining Hypothesis
Since configuration is verified correct but Ponder still doesn't index:
1. **Tenderly VNet behavior** - Blocks aren't being produced/detected properly?
2. **Ponder contract filter** - Is Ponder filtering for the right contract addresses?
3. **Database write issue** - Ponder sees events but can't write to Postgres?
4. **Timing issue** - Ponder connects before contracts are deployed/transactions submitted?
5. **Ponder version mismatch** - Different Ponder behavior between environments?

