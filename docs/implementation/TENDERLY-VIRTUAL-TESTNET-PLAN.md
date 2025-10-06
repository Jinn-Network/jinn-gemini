# Tenderly Virtual TestNet Integration Plan

**Date:** 2025-10-02  
**Goal:** Switch from Base mainnet to Tenderly Virtual TestNet for safe, cost-free testing of full service deployment with mech

---

## Why Tenderly Now Works

**Previously blocked (JINN-186 early testing):**
- Custom wizard logic conflicted with middleware expectations
- Manual orchestration of funding/deployment steps
- Couldn't simulate middleware's internal Safe transactions

**Now unblocked (JINN-202 implementation):**
- ✅ Using `quickstart` directly with `--attended=true`
- ✅ Middleware handles all Safe transactions internally
- ✅ No custom orchestration that could bypass Tenderly simulation
- ✅ Can simulate the entire flow: mint → mech deploy → agent register → Safe deploy → stake

---

## What Tenderly Virtual TestNet Provides

1. **Full EVM simulation** on forked Base mainnet state
2. **Unlimited ETH** for testing (no real funds needed)
3. **Instant** transaction confirmation (no waiting)
4. **Transaction inspection** via Tenderly dashboard
5. **State persistence** across test runs
6. **Custom RPC endpoint** that works exactly like mainnet

---

## Architecture Changes Needed

### 1. **Environment Configuration**

**Add Tenderly-specific env vars:**
```bash
# .env.tenderly (new file)
TENDERLY_ENABLED=true
TENDERLY_ACCESS_KEY=your-access-key
TENDERLY_PROJECT=your-project
TENDERLY_VNET_ID=your-vnet-id
TENDERLY_RPC_URL=https://virtual.base.rpc.tenderly.co/your-vnet-id

# Use this RPC for BASE_LEDGER_RPC when testing
BASE_LEDGER_RPC=${TENDERLY_RPC_URL}
```

**Update existing env loading:**
- `env/index.ts` - Add Tenderly variables
- Check for `TENDERLY_ENABLED` flag to switch modes

### 2. **RPC Configuration in SimplifiedServiceBootstrap**

**Current:**
```typescript
const config = {
  configurations: {
    base: {
      rpc: this.config.rpcUrl, // ← Uses mainnet RPC
      // ...
    }
  }
}
```

**Updated:**
```typescript
const config = {
  configurations: {
    base: {
      rpc: this.getTenderlyRpcOrDefault(), // ← Auto-switch based on TENDERLY_ENABLED
      // ...
    }
  }
}

private getTenderlyRpcOrDefault(): string {
  if (process.env.TENDERLY_ENABLED === 'true') {
    const vnetRpc = process.env.TENDERLY_RPC_URL;
    if (!vnetRpc) {
      throw new Error('TENDERLY_RPC_URL required when TENDERLY_ENABLED=true');
    }
    bootstrapLogger.info('Using Tenderly Virtual TestNet', { rpc: vnetRpc });
    return vnetRpc;
  }
  return this.config.rpcUrl;
}
```

### 3. **Tenderly Virtual TestNet Setup Script**

**New file:** `scripts/setup-tenderly-vnet.ts`

```typescript
/**
 * Creates and configures a Tenderly Virtual TestNet for OLAS service testing
 * 
 * - Forks Base mainnet at current block
 * - Funds Master EOA with ETH
 * - Verifies OLAS token contract is accessible
 * - Outputs TENDERLY_RPC_URL and TENDERLY_VNET_ID for .env.tenderly
 */
```

**Steps:**
1. Create Virtual TestNet via Tenderly API
2. Fork Base mainnet (latest block)
3. Fund Master EOA with 10 ETH using Tenderly's `tenderly_setBalance`
4. Verify OLAS token at `0x54330d28ca3357F294334BDC454a032e7f353416` is accessible
5. Output config for `.env.tenderly`

### 4. **Test Helper: Mock Funding**

**Since Tenderly has unlimited ETH, we can:**
- Pre-fund Master Safe with ETH via `tenderly_setBalance`
- Pre-fund Master Safe with OLAS by simulating a transfer from a whale address

**New file:** `scripts/tenderly-fund-accounts.ts`

```typescript
/**
 * Funds accounts on Tenderly Virtual TestNet
 * 
 * Bypasses interactive funding prompts by pre-funding addresses
 * before running quickstart.
 */

async function fundForTenderly(addresses: {
  masterEoa: string;
  masterSafe: string;
}) {
  const rpc = process.env.TENDERLY_RPC_URL;
  const accessKey = process.env.TENDERLY_ACCESS_KEY;
  
  // Use Tenderly Admin API to set balances
  await setBalance(addresses.masterEoa, ethers.parseEther('10'));
  await setBalance(addresses.masterSafe, ethers.parseEther('1'));
  
  // Transfer OLAS from a known whale address
  await impersonateAndTransfer({
    from: '0xOLAS_WHALE_ADDRESS',
    to: addresses.masterSafe,
    amount: ethers.parseEther('500'), // 500 OLAS
  });
}
```

### 5. **Update Interactive Setup Script**

**`scripts/interactive-service-setup.ts` changes:**

```typescript
// At the top
const TENDERLY_MODE = process.env.TENDERLY_ENABLED === 'true';

// Before bootstrap
if (TENDERLY_MODE) {
  console.log('\n🧪 TENDERLY VIRTUAL TESTNET MODE\n');
  console.log('⚡ Using simulated Base mainnet fork');
  console.log('💰 Funding will be instant (no real ETH needed)');
  console.log('🔍 View transactions: https://dashboard.tenderly.co/...\n');
}

// After bootstrap (if successful)
if (TENDERLY_MODE && result.success) {
  console.log('\n✅ Virtual TestNet deployment successful!');
  console.log('🔗 View in Tenderly Dashboard:');
  console.log(`   https://dashboard.tenderly.co/${TENDERLY_PROJECT}/${TENDERLY_VNET_ID}`);
}
```

### 6. **Documentation Updates**

**`AGENT_README.md` - Add Tenderly section:**

```markdown
### Testing with Tenderly Virtual TestNet

For safe, cost-free testing without mainnet risk:

1. **Setup Tenderly Virtual TestNet:**
   ```bash
   yarn setup:tenderly-vnet
   ```

2. **Configure environment:**
   ```bash
   cp .env.tenderly.template .env.tenderly
   # Edit .env.tenderly with your Tenderly credentials
   ```

3. **Run interactive setup on Tenderly:**
   ```bash
   source .env.tenderly
   yarn setup:service --chain=base --with-mech
   ```

4. **View results:**
   - Tenderly Dashboard: https://dashboard.tenderly.co/...
   - All transactions are simulated (instant, free)
   - Full mech deployment + service staking tested

5. **Switch back to mainnet:**
   ```bash
   unset TENDERLY_ENABLED
   ```
```

---

## Implementation Steps

1. ✅ **Create `.env.tenderly.template`** with required vars
2. ✅ **Add Tenderly env loading to `env/index.ts`**
3. ✅ **Create `scripts/setup-tenderly-vnet.ts`** (Virtual TestNet setup)
4. ✅ **Create `scripts/tenderly-fund-accounts.ts`** (Pre-fund accounts)
5. ✅ **Update `SimplifiedServiceBootstrap.ts`** (RPC switching logic)
6. ✅ **Update `scripts/interactive-service-setup.ts`** (Tenderly mode UI)
7. ✅ **Add Tenderly section to `AGENT_README.md`**
8. ✅ **Test end-to-end:** Setup → Fund → Deploy → Verify

---

## Testing Checklist

**On Tenderly Virtual TestNet:**
- [ ] Virtual TestNet created successfully
- [ ] Master EOA funded with 10 ETH
- [ ] Master Safe funded with 1 ETH + 500 OLAS
- [ ] Service mints successfully (token ID assigned)
- [ ] Mech deploys on-chain (contract address returned)
- [ ] Agent registers (instance address assigned)
- [ ] Service Safe deploys (multisig address returned)
- [ ] Service stakes in staking contract
- [ ] All transactions visible in Tenderly dashboard
- [ ] Config updated with mech address and agent ID
- [ ] No errors during entire flow

**Switch back to mainnet:**
- [ ] `unset TENDERLY_ENABLED` disables Tenderly mode
- [ ] Mainnet RPC used when Tenderly disabled
- [ ] No breaking changes to mainnet flow

---

## Benefits

1. **Zero cost:** No mainnet ETH/OLAS required
2. **Instant feedback:** No waiting for block confirmations
3. **Full visibility:** Inspect every transaction in Tenderly UI
4. **Safe testing:** Can't lose real funds
5. **Repeatable:** Delete vnet, create new one, test again
6. **Debugging:** Tenderly shows exact revert reasons, gas usage, state changes

---

## Risks & Mitigations

**Risk:** Tenderly simulation differs from mainnet behavior
- **Mitigation:** Tenderly forks real mainnet state, highly accurate
- **Final test:** Always do one mainnet deploy after Tenderly validation

**Risk:** Tenderly API rate limits
- **Mitigation:** Virtual TestNet has higher limits than public RPC
- **Fallback:** Can still use mainnet if Tenderly unavailable

**Risk:** Cost of Tenderly subscription
- **Mitigation:** Free tier supports Virtual TestNets
- **Alternative:** Use Tenderly only for initial testing, then mainnet

---

## Next Actions

1. Get Tenderly credentials (access key, project name)
2. Implement steps 1-7 above
3. Test on Virtual TestNet
4. Document any edge cases discovered
5. Merge to main after successful Virtual TestNet deploy
6. Do final mainnet test to confirm parity

---

## Success Criteria

✅ **Complete service deployment with mech on Tenderly Virtual TestNet**
✅ **Zero real ETH/OLAS spent**
✅ **All transactions inspectable in dashboard**
✅ **Documentation for switching between Tenderly/mainnet**
✅ **No changes required to core `quickstart` flow**

