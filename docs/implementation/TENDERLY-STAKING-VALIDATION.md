# JINN-204: Tenderly Staking Validation Results

**Date:** October 2, 2025  
**Status:** Implementation Complete - Ready for Testing  
**Validation Script:** `scripts/validate-staking-tenderly.ts`

---

## Objective

Validate OLAS service staking on Tenderly Virtual TestNet using a four-phase approach to isolate and test each integration component.

**Context:** Services #149 and #150 already validated staking successfully on Base mainnet. This test reproduces known-working behavior on Tenderly and adds mech integration testing.

---

## Test Strategy

### Four-Phase Approach

**Phase 0: Baseline (No Staking, No Mech)**
- **Goal:** Confirm Tenderly + SimplifiedServiceBootstrap works
- **Config:** `staking_program_id: "no_staking"`, `deployMech: false`
- **Test both:** ATTENDED=true and ATTENDED=false
- **Success criteria:** Service deploys to DEPLOYED state

**Phase 1: Add Staking**
- **Goal:** Reproduce mainnet success (Services #149, #150)
- **Config:** `staking_program_id: "agents_fun_1"`, `deployMech: false`
- **Validation:** On-chain staking state = `Staked`
- **Success criteria:** Service reaches DEPLOYED_AND_STAKED

**Phase 2: Add Mech (No Staking)**
- **Goal:** Isolate mech deployment issues
- **Config:** `staking_program_id: "no_staking"`, `deployMech: true`
- **Validation:** Mech contract address returned
- **Success criteria:** Service deploys with mech

**Phase 3: Full Integration (Staking + Mech)**
- **Goal:** Test unknown combination
- **Config:** `staking_program_id: "agents_fun_1"`, `deployMech: true`
- **Validation:** Both staking and mech work together
- **Success criteria:** Service reaches DEPLOYED_AND_STAKED with mech deployed

---

## ATTENDED Mode Hypothesis

### The Question
Should Tenderly tests use ATTENDED=true or ATTENDED=false?

### Hypothesis 1: ATTENDED=false (Programmatic)
**Rationale:** Tenderly VNet provides unlimited ETH, addresses auto-funded, no actual transfers needed.

**Expected behavior:**
- Middleware checks balances → finds sufficient funds → proceeds
- No prompts needed
- Faster execution

**Risk:** Middleware may still wait for explicit funding transactions (not just balance checks).

### Hypothesis 2: ATTENDED=true (Native Prompts)
**Rationale:** Native prompts may auto-continue when balance checks pass.

**Expected behavior:**
- Middleware shows funding prompts
- Balance check immediately passes (VNet has unlimited ETH)
- Auto-continues without manual intervention
- Provides better visibility into funding flow

**Risk:** Prompts may block unnecessarily if middleware expects actual transactions.

### Testing Approach
**Phase 0 tests both modes** - results determine which mode to use for subsequent phases.

**Recommendation based on results:**
- If ATTENDED=true auto-continues → use for better visibility
- If ATTENDED=false is faster/cleaner → use for remaining phases
- Document findings for future Tenderly testing

---

## On-Chain Verification

### Staking Contract Interface

**Address:** `0x2585e63df7BD9De8e058884D496658a030b5c6ce` (AgentsFun1 on Base)

**Key methods:**
```solidity
enum StakingState { Unstaked, Staked, Evicted }

function getStakingState(uint256 serviceId) external view returns (StakingState);
function getServiceIds() external view returns (uint256[]);
function getServiceInfo(uint256 serviceId) external view returns (
  address multisig,
  address owner,
  uint256[] nonces,
  uint256 tsStart,
  uint256 reward,
  uint256 inactivity
);
```

### Verification Steps

1. **Find service token ID:**
   ```typescript
   const serviceIds = await stakingContract.getServiceIds();
   for (const id of serviceIds) {
     const info = await stakingContract.getServiceInfo(id);
     if (info.multisig === serviceSafeAddress) {
       serviceTokenId = id;
       break;
     }
   }
   ```

2. **Verify staking state:**
   ```typescript
   const state = await stakingContract.getStakingState(serviceTokenId);
   // Expected: 1 (Staked)
   ```

3. **Verify service info:**
   ```typescript
   const info = await stakingContract.getServiceInfo(serviceTokenId);
   // info.tsStart should be non-zero (staking started)
   // info.multisig should match Service Safe address
   // info.owner should match Master Safe address
   ```

---

## Known Constraints

### Tenderly Limitations

1. **Fork point must be recent:**
   - Staking contracts must exist at fork block
   - Use `fork_config.block_number: "latest"` ✅ Implemented

2. **Time manipulation limited:**
   - Can advance block.timestamp
   - Cannot easily simulate service activity (nonce increments)
   - **Checkpoint testing deferred to JINN-205**

3. **RPC URL propagation:**
   - Must set both service config RPC and environment variable
   - ✅ Already handled in `SimplifiedServiceBootstrap`

### Middleware Constraints

1. **Mech marketplace validation:**
   - Address `0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020` may trigger validation error
   - This is the **unknown variable** being tested

2. **State persistence:**
   - Service state stored in `.operate/services/sc-{uuid}/config.json`
   - Corrupt state auto-cleaned by `OlasServiceManager.cleanupCorruptServices()`

---

## Success Criteria

### Must Have
- [ ] Phase 0: Baseline deployment works on Tenderly
- [ ] ATTENDED mode recommendation documented (true vs false)
- [ ] Phase 1: Staking verified on-chain (`StakingState.Staked`)
- [ ] Phase 2: Mech deployment succeeds OR clear diagnosis of failure
- [ ] All transactions visible in Tenderly dashboard
- [ ] Validation report generated with findings

### Should Have
- [ ] Phase 3: Full integration (staking + mech) passes
- [ ] Service state transitions tracked throughout
- [ ] Error messages captured and documented
- [ ] VNet cleanup successful

### Nice to Have
- [ ] Performance metrics (time per phase)
- [ ] Gas usage analysis from Tenderly
- [ ] Screenshot evidence of Tenderly dashboard
- [ ] Comparison with mainnet Services #149/#150

---

## Running the Validation

### Prerequisites

```bash
# 1. Setup Tenderly credentials
cp env.tenderly.template env.tenderly
# Edit env.tenderly with your credentials

# 2. Source Tenderly environment
source env.tenderly

# 3. Verify required variables
echo $TENDERLY_ACCESS_KEY
echo $TENDERLY_ACCOUNT_SLUG
echo $TENDERLY_PROJECT_SLUG
echo $OPERATE_PASSWORD
```

### Execute Validation

```bash
# Run full four-phase validation
yarn tsx scripts/validate-staking-tenderly.ts
```

**Expected output:**
```
🔨 Creating Tenderly Virtual TestNet...
   Account: your-account
   Project: your-project

✅ Virtual TestNet created!
   ID: abc123...
   RPC: https://virtual.base.rpc.tenderly.co/abc123...

Phase 0a: Baseline (ATTENDED=false)
   Testing attended mode hypothesis...
   [Middleware output streams here]
   ✅ Phase completed successfully

Phase 0b: Baseline (ATTENDED=true)
   Testing attended mode hypothesis...
   [Middleware output streams here]
   ✅ Phase completed successfully

📋 Recommendation: Use ATTENDED=true for Tenderly (native prompts auto-continue)

Phase 1: Staking Only
   [Verification output]
   ✅ Staking state: Staked

Phase 2: Mech Only
   [Mech deployment output]
   ✅ Mech deployed: 0x1234...

Phase 3: Staking + Mech
   [Combined output]
   ✅ Full integration successful

================================================================================
JINN-204: Staking Validation Report
================================================================================
Summary:
   Total Phases: 5
   Passed: 5
   Failed: 0

📄 Full report saved to: jinn-204-validation-report-1234567890.json
```

### Manual Verification

**Check Tenderly Dashboard:**
1. Go to https://dashboard.tenderly.co/
2. Navigate to your project
3. Find the Virtual TestNet (abc123...)
4. Review transaction list:
   - Service token mint
   - Agent registration
   - Service Safe deployment
   - Staking transaction
   - (Optional) Mech deployment

**Verify on-chain state:**
```bash
# Query staking contract directly
yarn tsx scripts/check-staking-state.ts \
  --vnet-rpc="https://virtual.base.rpc.tenderly.co/abc123..." \
  --service-safe="0x..."
```

---

## Troubleshooting

### Issue: VNet Creation Fails

**Symptom:** `Failed to create Virtual TestNet: 401 Unauthorized`

**Solution:**
1. Verify `TENDERLY_ACCESS_KEY` is valid
2. Check API key has not expired
3. Confirm account/project slugs are correct

### Issue: Service Creation Hangs

**Symptom:** Bootstrap process blocks indefinitely

**Possible causes:**
1. ATTENDED=false expecting actual funding transactions
2. Middleware validation failing silently
3. RPC connectivity issues

**Solutions:**
1. Try opposite ATTENDED mode
2. Check middleware logs for validation errors
3. Verify VNet RPC URL is accessible

### Issue: Staking State Shows "Unstaked"

**Symptom:** Service deploys but on-chain state is Unstaked

**Possible causes:**
1. Staking transaction failed silently
2. Service token ID not found in staking contract
3. Fork point before staking contract deployment

**Solutions:**
1. Check Tenderly dashboard for failed transactions
2. Verify staking contract address exists at fork point
3. Ensure `use_staking: true` in service config

### Issue: Mech Deployment Fails

**Symptom:** Phase 2 or 3 fails with mech-related error

**Expected outcome:** This is the **unknown variable** being tested!

**Actions:**
1. Capture full error message
2. Check if error is middleware validation or on-chain revert
3. Document findings for JINN-186 resolution
4. Try Phase 1 (staking without mech) to isolate issue

---

## Deferred Testing: Checkpoints (JINN-205)

### Why Deferred
Checkpoint testing requires:
- Simulating service activity (Safe transaction nonces)
- Advancing time AND proving liveness
- Possibly mocking mech request/response flow

**Too complex for JINN-204 scope.**

### Future Work
Create JINN-205 ticket for:
- Checkpoint submission validation
- Reward accumulation testing
- Reward claiming flow
- Service eviction scenarios
- Long-running service simulation

**Dependencies:** JINN-204 must pass first.

---

## Expected Outcomes

### Best Case: All Phases Pass
- ✅ Staking works on Tenderly (reproduces mainnet Services #149/#150)
- ✅ Mech deployment works on Tenderly
- ✅ Full integration (staking + mech) works
- ✅ JINN-186 blocker identified as mainnet-specific
- ✅ Ready for mainnet deployment with confidence

### Likely Case: Phase 3 Fails
- ✅ Staking works (Phase 1)
- ✅ Mech works independently (Phase 2)
- ❌ Combined fails (Phase 3)
- 📋 Clear diagnosis: Mech config triggers middleware bug
- 📋 Isolate issue for upstream fix
- 📋 Deploy staking OR mech separately on mainnet

### Worst Case: Phase 1 Fails
- ✅ Baseline works (Phase 0)
- ❌ Staking fails (Phase 1)
- 📋 Unexpected: Staking already validated on mainnet
- 📋 Investigate Tenderly-specific issue
- 📋 May indicate fork point or VNet config problem

---

## Deliverables

### Code
- ✅ `scripts/validate-staking-tenderly.ts` (comprehensive validation)
- ✅ Phase-based testing approach
- ✅ On-chain verification logic
- ✅ ATTENDED mode hypothesis testing

### Documentation
- ✅ `TENDERLY-STAKING-VALIDATION.md` (this file)
- ✅ `MIDDLEWARE-HTTP-API-WORKAROUND.md` (context)
- ✅ Test strategy and success criteria
- ✅ Troubleshooting guide

### Reports (Generated)
- ⏳ `jinn-204-validation-report-{timestamp}.json` (after test run)
- ⏳ ATTENDED mode recommendation
- ⏳ Phase-by-phase results
- ⏳ On-chain verification data
- ⏳ Tenderly dashboard links

---

## Next Steps

1. **Run validation:**
   ```bash
   yarn tsx scripts/validate-staking-tenderly.ts
   ```

2. **Review results:**
   - Check generated report JSON
   - Verify Tenderly dashboard transactions
   - Document ATTENDED mode recommendation

3. **Update JINN-186:**
   - Report findings
   - If mech deployment fails, document error details
   - If all passes, prepare for mainnet deployment

4. **Update JINN-204:**
   - Mark ticket complete with validation evidence
   - Link to generated report
   - Document any surprises or gotchas

5. **Future work:**
   - Create JINN-205 for checkpoint testing
   - File upstream issue if mech integration bug confirmed
   - Consider Tenderly as standard testing environment

---

## Related Documentation

- **JINN-186:** Parent ticket (full validation)
- **JINN-202:** Simplified bootstrap implementation
- **AGENT_README.md:** Architecture and wallet management
- **MIDDLEWARE-HTTP-API-WORKAROUND.md:** CLI approach context
- **env.tenderly.template:** Tenderly configuration

