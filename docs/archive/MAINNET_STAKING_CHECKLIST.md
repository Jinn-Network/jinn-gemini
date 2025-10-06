# Mainnet Staking Deployment Checklist

## Pre-Flight Checks

- [ ] **Environment configured**
  ```bash
  # Check these are set:
  echo $OPERATE_PASSWORD
  echo $BASE_LEDGER_RPC
  ```

- [ ] **Master Safe funded**
  - [ ] At least 0.005 ETH for gas
  - [ ] At least 50 OLAS for staking deposit
  - [ ] Check balance: `https://basescan.org/address/<master_safe_address>`

- [ ] **Network connectivity**
  ```bash
  curl $BASE_LEDGER_RPC -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
  ```

## Deployment

- [ ] **Run setup command**
  ```bash
  yarn setup:service --chain=base
  ```

- [ ] **During prompts:**
  - [ ] Select option `2` (Custom Staking contract)
  - [ ] Paste: `0x2585e63df7BD9De8e058884D496658a030b5c6ce`
  - [ ] Fund addresses when prompted
  - [ ] Wait for "SETUP COMPLETED SUCCESSFULLY"

## Post-Deployment Verification

- [ ] **Service ID captured**
  ```bash
  # Check logs or result file for service ID
  cat /tmp/jinn-service-setup-*.json | grep token
  ```

- [ ] **Service config exists**
  ```bash
  ls -la olas-operate-middleware/.operate/services/
  cat olas-operate-middleware/.operate/services/sc-*/config.json
  ```

- [ ] **Service Safe created**
  - [ ] New Service Safe address in logs
  - [ ] Different from Master Safe
  - [ ] Has ~0.001 ETH + 50 OLAS balance

- [ ] **Staking confirmed in logs**
  ```bash
  grep -r "Staking service" olas-operate-middleware/.operate/services/
  grep -r "current_staking_program='agents_fun_1'" olas-operate-middleware/.operate/services/
  ```

## On-Chain Verification

- [ ] **Service exists in registry**
  - [ ] Contract: `0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE` (Service Registry)
  - [ ] Method: `getService(serviceId)`
  - [ ] State should be `DEPLOYED` (4)

- [ ] **Service is staked**
  - [ ] Contract: `0x2585e63df7BD9De8e058884D496658a030b5c6ce` (AgentsFun1)
  - [ ] Method: `getServiceIds()`
  - [ ] Your service ID should be in the list
  - [ ] Method: `getStakingState(serviceId)` should return `1` (Staked)

- [ ] **Verify on BaseScan**
  - [ ] Service Registry: https://basescan.org/address/0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE
  - [ ] Staking Contract: https://basescan.org/address/0x2585e63df7BD9De8e058884D496658a030b5c6ce
  - [ ] Look for your service ID in recent transactions

## If Mech Deployed (Optional)

- [ ] **Mech address captured**
  ```bash
  grep -r "mech" olas-operate-middleware/.operate/services/sc-*/config.json
  ```

- [ ] **Mech contract on-chain**
  - [ ] Verify on BaseScan: https://basescan.org/address/<mech_address>
  - [ ] Should have code (not just EOA)

## Success Criteria

✅ Service deployed  
✅ Service Safe created  
✅ Service staked in AgentsFun1  
✅ Service ID recorded  
✅ Service running (Docker containers up)

## What's Next

1. **Monitor service**: Check logs for activity
   ```bash
   docker ps | grep memeooor
   docker logs <container_id>
   ```

2. **Wait for checkpoint**: First rewards after ~24 hours

3. **Check rewards**: After checkpoint, query staking contract
   ```solidity
   getServiceInfo(serviceId) // returns accumulated reward
   ```

4. **Claim rewards**: (Future implementation, separate JINN issue)

## Rollback (If Needed)

If deployment fails and service is in corrupt state:

```bash
# Restart worker - it auto-cleans corrupt services
yarn worker:dev
```

Or manually remove:
```bash
rm -rf olas-operate-middleware/.operate/services/sc-<corrupt-service-id>
```

## Documentation References

- Full guide: `docs/MAINNET_STAKING_DEPLOYMENT.md`
- Architecture: `OLAS_ARCHITECTURE_GUIDE.md`
- Safety: `MAINNET_SAFETY.md`
- Tenderly testing: `AGENT_README.md` (optional cost-free testing)

