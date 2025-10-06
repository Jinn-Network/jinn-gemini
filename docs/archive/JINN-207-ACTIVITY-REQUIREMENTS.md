# JINN-207: Service #164 Activity Requirements

**Date:** October 2, 2025  
**Service ID:** 164  
**Service Safe:** `0xdB225C794218b1f5054dffF3462c84A30349B182`

---

## 🎯 Key Findings

### Activity Checker Requirements

**Formula:** `requiredRequests = ceil((effectivePeriod * livenessRatio) / 1e18) + SAFETY_MARGIN`

**Parameters:**
- **Liveness Period:** 86,400 seconds (24 hours)
- **Liveness Ratio:** `11574074074074` (0.000011574074074074 in 1e18 format)
- **Safety Margin:** 1 request
- **Last Checkpoint:** October 2, 2025, 15:22:21 UTC (staking start time)

### Current Status

```
Current Requests: 0
Required Requests: 2
Status: ❌ NOT ELIGIBLE for rewards
Needed: 2 more requests
```

### Activity Projections

**Daily Requirements:**
- **1 request per day** (average) to maintain eligibility
- **7 requests per week** (average)

**Time Until Next Checkpoint:**
- **~22.7 hours** remaining (from query time)
- **Rate needed:** 1 request every 11.35 hours
- **To be eligible:** Submit 2 requests before next checkpoint

---

## 📊 On-Chain State (Query Results)

### Service Info
```
Multisig: 0xdB225C794218b1f5054dffF3462c84A30349B182
Owner: 0x15aDF0eD29b6D76DB365670DfEeD8F9C5dAD4645
Nonces: [0, 0]
  - Safe Nonce: 0 (no Safe transactions yet)
  - Request Count: 0 (no marketplace requests yet)
Staking Start: 1759418541 (October 2, 2025, 15:22:21 UTC)
Reward: 0.0 OLAS (no rewards accrued yet)
Inactivity: 0 (no inactivity strikes)
```

### Staking Contract: AgentsFun1
```
Address: 0x2585e63df7BD9De8e058884D496658a030b5c6ce
Liveness Period: 86,400 seconds (24 hours)
Last Checkpoint: 1759418541 (October 2, 2025, 15:22:21 UTC)
```

### Activity Checker: RequesterActivityChecker
```
Address: 0x87C9922A099467E5A80367553e7003349FE50106
Liveness Ratio: 11574074074074 (0.000011574074074074)
Type: Requester (counts marketplace requests from Service Safe)
```

### Mech Marketplace
```
Address: 0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020
Current Request Count (Service Safe): 0
```

---

## 🔍 How Activity Checker Works

### RequesterActivityChecker Logic

The AgentsFun1 staking contract uses `RequesterActivityChecker` which:

1. **Tracks marketplace requests** made FROM the Service Safe
2. **Counts via `mapRequestCounts[serviceSafe]`** on the MechMarketplace contract
3. **Formula:** `eligibleRequests = currentRequests - baselineRequests`
4. **Eligibility:** `eligibleRequests >= requiredRequests`

### Critical Requirements

- **Requests must come FROM Service Safe** (not agent EOA)
- **Must use MechMarketplace contract** (`0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020`)
- **Increments `mapRequestCounts` counter** when requests are submitted
- **Activity checker queries this counter** to determine eligibility

### Baseline vs Current

```
Baseline (at staking time):
  Safe Nonce: 0
  Request Count: 0

Current (query time: 1.3 hours after staking):
  Safe Nonce: 0
  Request Count: 0

Eligible Requests: 0 - 0 = 0
Required Requests: 2
Status: NOT ELIGIBLE (need 2 more)
```

---

## 💰 Next Steps: Cost Estimation

### Questions to Answer

1. **What is the cost per marketplace request?**
   - ETH for gas (transaction fees)
   - Mech fees (payment to mech contract)
   - Total cost per request

2. **Service Safe Balance Check**
   - Current ETH balance: 0.0005 ETH (~$1.25 at $2500/ETH)
   - Is this sufficient for 2+ requests?
   - If not, how much ETH needed?

3. **Mech Request Format**
   - What parameters are required?
   - What is the minimum payment amount?
   - How to encode the request data?

### Service Safe Funding

**Current State:**
- ETH: 0.0005 ETH (from deployment)
- OLAS: 50 OLAS (locked in staking)

**Master Safe (if more funding needed):**
- Address: `0x15aDF0eD29b6D76DB365670DfEeD8F9C5dAD4645`
- Balance: 314 OLAS, 0.019 ETH

---

## 🛠️ Implementation Plan

### Phase 1: Research ✅ COMPLETE
- [x] Query liveness ratio
- [x] Query liveness period
- [x] Query checkpoint timestamp
- [x] Calculate required requests
- [x] Check current request count

**Result:** Need **2 requests** before next checkpoint (~22 hours remaining)

### Phase 2: Cost Estimation 🔄 IN PROGRESS
- [ ] Query mech marketplace for request pricing
- [ ] Estimate gas costs for Safe transactions
- [ ] Check Service Safe ETH balance sufficiency
- [ ] Calculate total cost for 2 requests

### Phase 3: Request Submission Script (NEXT)
- [ ] Create script to submit marketplace requests from Safe
- [ ] Use agent key to sign Safe transactions
- [ ] Encode request data properly
- [ ] Handle payment/gas fees

### Phase 4: Execution & Verification
- [ ] Submit first test request
- [ ] Verify request is recorded on-chain
- [ ] Check activity checker recognizes it
- [ ] Submit second request (total: 2)
- [ ] Verify eligibility status changes

### Phase 5: Ongoing Monitoring
- [ ] Monitor checkpoint timing
- [ ] Track reward accumulation
- [ ] Maintain 1 request/day average
- [ ] Set up automation (optional)

---

## 📝 Key Insights

### Why 2 Requests?

Formula breakdown:
```
effectivePeriod = max(livenessPeriod, timeSinceCheckpoint)
                = max(86400, current_time - 1759418541)
                = 86400 seconds (24 hours, since we're < 24h since staking)

requiredRequests = ceil((86400 * 11574074074074) / 1e18) + 1
                 = ceil(0.999999999999936) + 1
                 = 1 + 1
                 = 2 requests
```

The safety margin of +1 ensures services are not penalized for rounding errors or timing issues.

### Activity Rate

**Liveness Ratio: 0.000011574074074074**

This means:
- **1 second = 0.000011574074074074 requests required**
- **1 day (86,400 sec) = ~1 request required**
- **1 week = ~7 requests required**

**Practical interpretation:** Service needs ~1 marketplace request per day to maintain eligibility for rewards.

### Time Sensitivity

- **Staked:** October 2, 2025, 15:22:21 UTC
- **Query Time:** ~1.3 hours after staking
- **Next Checkpoint:** ~22.7 hours remaining
- **Deadline:** October 3, 2025, 15:22:21 UTC (approx)

**Action Required:** Submit 2 requests within next ~22 hours to earn rewards for this epoch.

---

## 🔗 Contract Addresses Reference

```
Service #164:
  Service Safe:     0xdB225C794218b1f5054dffF3462c84A30349B182
  Agent EOA:        0x3944aB4EbAe6F9CA96430CaE97B71FB878E1e100
  Mech Contract:    0xE403cd520cfC2C3580D6C1C9302b74723Ef48B8E

Staking & Activity:
  AgentsFun1:       0x2585e63df7BD9De8e058884D496658a030b5c6ce
  Activity Checker: 0x87C9922A099467E5A80367553e7003349FE50106
  Mech Marketplace: 0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020

Master Safe:        0x15aDF0eD29b6D76DB365670DfEeD8F9C5dAD4645
```

---

## 📚 References

**Query Script:** `scripts/query-service-164-activity-requirements.ts`

**Activity Checker Source:** `code-resources/autonolas-staking-programmes/contracts/mech_usage/RequesterActivityChecker.sol`

**Staking Logic:** `code-resources/olas-operate-app/frontend/service/agents/shared-services/AgentsFun.ts`

---

**Status:** Research phase complete. Moving to cost estimation phase.

