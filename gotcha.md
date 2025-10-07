# Gotchas & Issues to Fix

## 1. Service Setup with Tenderly - Missing TENDERLY_RPC_URL

**Issue**: `setup:service` script requires `TENDERLY_RPC_URL` env var when `TENDERLY_ENABLED=true`, but doesn't clearly document this.

**Symptoms**:
```
❌ Error: TENDERLY_RPC_URL required when TENDERLY_ENABLED=true
```

**Root Cause**:
- Script loads `.env.mainnet` which overrides main `.env`
- When `TENDERLY_ENABLED=true`, it expects `TENDERLY_RPC_URL` (not `RPC_URL` or `BASE_LEDGER_RPC`)
- The variable name mismatch is confusing

**Solution**:
In `.env.mainnet`, set:
```bash
TENDERLY_ENABLED=true
TENDERLY_RPC_URL=<your-tenderly-rpc>
BASE_LEDGER_RPC=<your-tenderly-rpc>
```

**To Fix**:
1. Update [scripts/interactive-service-setup.ts](scripts/interactive-service-setup.ts#L154-161) to:
   - Fall back to `RPC_URL` if `TENDERLY_RPC_URL` not set
   - Provide clearer error message showing which env vars are checked
   - Document the precedence order in help text

2. Consider consolidating to single `RPC_URL` env var across all modes

**Related Files**:
- `scripts/interactive-service-setup.ts` - Setup CLI
- `.env.mainnet` - Mainnet mode config
- `env.tenderly` - Tenderly mode template

---

## 2. Mech Deployment on Base - Missing Factory Addresses

**Issue**: Middleware mech deployment crashes with `KeyError: <Chain.BASE: 'base'>` when trying to deploy mech on Base chain.

**Symptoms**:
```python
KeyError: <Chain.BASE: 'base'>
  File "olas-operate-middleware/operate/services/utils/mech.py", line 66
    if mech_marketplace_address not in MECH_FACTORY_ADDRESS[chain]:
```

**Root Cause**:
- `MECH_FACTORY_ADDRESS` dictionary in middleware only has `Chain.GNOSIS` entries
- No Base chain factory addresses configured
- Service deployment succeeds, staking succeeds, but mech deployment fails at the final step

**Solution (Applied)**:
Added Base chain factory addresses to `olas-operate-middleware/operate/services/utils/mech.py`:
```python
Chain.BASE: {
    "0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020": {
        "Native": "0x2E008211f34b25A7d7c102403c6C2C3B665a1abe",
        "Token": "0x97371B1C0cDA1D04dFc43DFb50a04645b7Bc9BEe",
        "Nevermined": "0x847bBE8b474e0820215f818858e23F5f5591855A",
    },
}
```

**Source**: These addresses are from `ai-registry-mech globals_base_mainnet.json` and are already present in our `worker/contracts/MechMarketplace.ts:87-94`.

**To Report Upstream**:
- This should be fixed in `valory-xyz/olas-operate-middleware`
- Base is a primary deployment target and should be supported out of the box
- The middleware should sync these addresses from the same source as the TS worker code

**Related Files**:
- `olas-operate-middleware/operate/services/utils/mech.py` - Mech deployment logic (line 35-54, FIXED)
- `worker/contracts/MechMarketplace.ts` - Already has correct addresses (line 87-94)

**Verified Factory Addresses** (from ai-registry-mech globals):
- MechMarketplace: `0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020`
- Native Factory: `0x2E008211f34b25A7d7c102403c6C2C3B665a1abe`
- Token Factory: `0x97371B1C0cDA1D04dFc43DFb50a04645b7Bc9BEe`
- Nevermined Factory: `0x847bBE8b474e0820215f818858e23F5f5591855A`

---

## 3. Misleading Error: Missing DEFAULT_PRIORITY_MECH for Base

**Issue**: During service setup, you see a scary-looking error about the MechMarketplace contract that makes it seem like something is broken.

**Symptoms**:
```python
[ERROR] '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020': Traceback...
web3.exceptions.ContractLogicError: ('execution reverted', '0x')

During handling of the above exception, another exception occurred:

KeyError: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020'

[WARNING] Cannot determine type of activity checker contract. Using default parameters.
```

**What's Actually Happening**:
1. Middleware successfully queries your staking contract (`0x2585e63df7BD9De8e058884D496658a030b5c6ce`)
2. Staking contract correctly returns the MechMarketplace address (`0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020`)
3. Middleware tries to look up this address in `DEFAULT_PRIORITY_MECH` dictionary
4. ❌ Base marketplace isn't in the hardcoded dict → KeyError
5. Logs scary error trace, then continues with safe defaults

**Root Cause**:
- `DEFAULT_PRIORITY_MECH` in `operate/services/manage.py:593` only has Gnosis entries
- The error message is misleading - the contract call **succeeded**, only the lookup failed
- This is purely a configuration issue, not a blockchain/contract issue

**Impact**:
✅ **None** - Setup continues successfully. The middleware just can't determine optimal activity checker parameters, so it uses defaults.

**Solution**:
The middleware should either:
1. Add Base to `DEFAULT_PRIORITY_MECH` dictionary, OR
2. Handle missing entries gracefully without the scary error trace

**Related Files**:
- `olas-operate-middleware/operate/services/manage.py` - Line 593 (DEFAULT_PRIORITY_MECH lookup)
- `olas-operate-middleware/operate/services/manage.py` - Line 583-590 (mechMarketplace query)

**To Report Upstream**:
- This creates confusion for users deploying on Base
- The error message should be less alarming or the dict should include Base

---

## 4. Docker Required for Middleware Service Deployment

**Issue**: After successfully deploying service on-chain and staking, the middleware crashes trying to build Docker containers for local agent runtime.

**Symptoms**:
```
docker.errors.DockerException: Error while fetching server API version:
('Connection aborted.', ConnectionRefusedError(61, 'Connection refused'))
```

**What Succeeded Before This Error**:
- ✅ Service minted and deployed on-chain
- ✅ Staked in staking contract (AgentsFun1)
- ✅ Agent EOA and Service Safe funded with ETH + OLAS
- ✅ SSL certificates generated

**Root Cause**:
- The middleware (`operate` CLI) tries to build and run the agent service in Docker containers
- Docker daemon is not running or not installed
- The `setup:service` script expects to complete the full flow: deploy on-chain → build Docker → run agent locally

**Impact**:
- ❌ Blocks completion of `setup:service` script
- ❌ Cannot deploy mech contract (last step of setup)
- ✅ On-chain deployment is complete and functional
- ✅ Can deploy mech and run worker manually without middleware

**Solution - Option A (Complete Middleware Flow)**:
1. Start Docker Desktop:
   ```bash
   open -a Docker
   ```
2. Verify Docker is running:
   ```bash
   docker ps
   ```
3. Re-run setup (will skip completed on-chain steps):
   ```bash
   yarn setup:service --chain=base --with-mech
   ```

**Solution - Option B (Manual Worker, Skip Middleware)**:
The middleware is optional - you can run the mech worker directly:
1. Use existing service deployment (on-chain parts are done)
2. Deploy mech contract manually or use existing mech address
3. Run worker stack directly:
   ```bash
   yarn dev:stack  # Starts Ponder + Control API + Worker
   ```

**Key Insight**:
- The middleware combines on-chain deployment + local Docker runtime
- Your on-chain service (ID 168) is fully deployed and staked
- The mech worker (`yarn dev:mech`) doesn't need the middleware's Docker setup
- Mech deployment can be done via middleware (needs Docker) OR manually via your TypeScript worker

**Related Files**:
- `olas-operate-middleware/operate/services/service.py` - Docker build logic (line 424-642)
- `package.json` - `dev:stack` and `dev:mech` scripts for manual worker
- `worker/mech_worker.ts` - The actual worker that processes jobs

**For Your Use Case**:
Since you want to run `yarn dev:mech` (the mech worker), you don't strictly need Docker. The middleware is for deploying the OLAS Operate app's full stack. Your worker can run independently once you have a mech contract address.

---

## 5. Marketplace Dispatch - Wrong Private Key & RPC Configuration

**Issue**: Job dispatch via MCP `dispatch_new_job` fails with "insufficient funds" despite wallet having 400+ ETH on Tenderly VNet.

**Symptoms**:
```
{"meta":{"ok":false,"code":"EXECUTION_ERROR","message":"Returned error: insufficient funds for gas * price + value"}}
```

**Root Causes**:
1. **Private Key File Auto-Overwrite**: The `getPrivateKeyPath()` function in `packages/mech-client-ts/src/config.ts` automatically overwrites `ethereum_private_key.txt` with whatever is in `MECH_PRIVATE_KEY` env var (lines 207-211)
2. **RPC Override Not Working**: Even with `RPC_URL` set, the marketplace_interact uses `mechs.json` config which defaults to public Base mainnet RPC, not Tenderly VNet
3. **File vs Env Var Priority**: Code reads from `ethereum_private_key.txt` file, but env var overwrites it on every run

**Investigation Steps That Revealed The Issue**:
```bash
# Check what address is being used
cat ethereum_private_key.txt
node -e "const { Web3 } = require('web3'); const web3 = new Web3(); const account = web3.eth.accounts.privateKeyToAccount('$(cat ethereum_private_key.txt)'); console.log(account.address);"

# Check balance on Tenderly VNet
curl -s https://virtual.base.eu.rpc.tenderly.co/YOUR_VNET_ID -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'
```

**Solution**:
1. Set `MECH_PRIVATE_KEY` in `.env` to match funded wallet:
```bash
MECH_PRIVATE_KEY=0x49f6339b84601918ae9f729c478fdb5fb4c3b2822e1931708f960478bbf91e19
```

2. Ensure `RPC_URL` points to your Tenderly VNet:
```bash
RPC_URL=https://virtual.base.eu.rpc.tenderly.co/YOUR_VNET_ID
```
Note: The key fix was setting `MECH_PRIVATE_KEY` - the RPC was likely being read correctly from `RPC_URL`.

3. Update `ethereum_private_key.txt` to match:
```bash
echo "0x49f6339b84601918ae9f729c478fdb5fb4c3b2822e1931708f960478bbf91e19" > ethereum_private_key.txt
```

4. Restart MCP server to pick up environment changes (restart Claude Code session)

**Key Configuration Variables**:
- `MECH_PRIVATE_KEY` - Used by mech-client-ts, auto-writes to `ethereum_private_key.txt` (REQUIRED)
- `WORKER_PRIVATE_KEY` - Used by worker, but NOT by mech-client-ts
- `RPC_URL` - RPC endpoint URL (fallback if `MECHX_CHAIN_RPC` not set)
- `MECHX_CHAIN_RPC` - Optional override with priority over `RPC_URL`

**Files Involved**:
- `packages/mech-client-ts/src/config.ts` - Lines 201-234 (private key file management)
- `packages/mech-client-ts/src/marketplace_interact.ts` - Line 585 (RPC connection)
- `packages/mech-client-ts/src/configs/mechs.json` - Base chain config with default RPC
- `ethereum_private_key.txt` - Auto-generated from `MECH_PRIVATE_KEY`

**Why This Is Confusing**:
- Two separate private key env vars (`MECH_PRIVATE_KEY` vs `WORKER_PRIVATE_KEY`) for different parts of system
- Auto-overwriting of file makes manual edits useless
- `RPC_URL` doesn't override without also setting `MECHX_CHAIN_RPC`
- Tenderly VNet addresses look valid but connect to public mainnet if RPC wrong
