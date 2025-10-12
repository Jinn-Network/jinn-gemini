# Code Spec Rules Audit Plan

## Objective

Perform a meticulous, systematic review of the entire codebase to identify violations of the 3 Code Spec Rules:

1. **Rule 1**: Never commit secrets to the repository
2. **Rule 2**: Always validate on-chain state before financial operations
3. **Rule 3**: Never silently discard errors in financial or blockchain contexts

## Methodology

### Phase 1: Automated Pattern Detection
Use grep/glob to identify potential violations using known patterns.

### Phase 2: Manual Code Review
Deep inspection of flagged files to confirm violations and understand context.

### Phase 3: Documentation
Record all violations with file paths, line numbers, severity, and suggested fixes.

### Phase 4: Remediation Planning
Prioritize violations by risk and create migration plan.

---

## Rule 1: Never Commit Secrets

### Search Patterns

#### Pattern 1.1: Hardcoded Private Keys
```bash
# Search for hex strings that look like private keys (64 hex chars)
grep -rn "0x[0-9a-fA-F]{64}" \
  --include="*.ts" \
  --include="*.js" \
  --include="*.json" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.git
```

**Target files:**
- `worker/*.ts`
- `gemini-agent/**/*.ts`
- `scripts/**/*.ts`
- `*.json` (config files)

**Look for:**
- `const PRIVATE_KEY = '0x...'`
- `privateKey: '0x...'` in JSON configs
- Private keys in comments
- Test fixtures with real keys

#### Pattern 1.2: API Keys and Tokens
```bash
# Search for common API key patterns
grep -rn -E "(API_KEY|SECRET|TOKEN|PASSWORD)\s*[:=]\s*['\"][^'\"]{20,}" \
  --include="*.ts" \
  --include="*.js" \
  --include="*.env*" \
  --exclude="*.example" \
  --exclude-dir=node_modules
```

**Target files:**
- All TypeScript/JavaScript files
- `.env` files (should be in .gitignore)
- Config files

**Look for:**
- `GEMINI_API_KEY = 'sk-abc123...'`
- `SUPABASE_SERVICE_ROLE_KEY = 'eyJ...'`
- `OPERATE_PASSWORD = 'password123'`
- Bearer tokens in fetch calls

#### Pattern 1.3: Committed .env Files
```bash
# Check if .env files are tracked by git
git ls-files | grep -E "\.env$|\.env\."
```

**Expected result:**
- Only `.env.example`, `.env.template` should be tracked
- Actual `.env`, `.env.local` should NOT appear

#### Pattern 1.4: Secrets in Comments
```bash
# Search for secrets in comments
grep -rn "//.*\(key\|password\|secret\|token\).*[:=]" \
  --include="*.ts" \
  --include="*.js"
```

**Look for:**
- `// Test key: 0xabcdef...`
- `// API key: sk-...`
- `/* Password: ... */`

#### Pattern 1.5: Git History Scan
```bash
# Check git history for accidentally committed secrets (use git-secrets or similar)
git log -p | grep -E "(PRIVATE_KEY|API_KEY|SECRET)" | head -50
```

**Manual review needed:**
- Examine any matches in git history
- Check if secrets were later removed (still in history!)

### Files to Review

**High Priority:**
- `worker/config.ts` - Configuration loading
- `scripts/**/*.ts` - Utility scripts often have inline credentials
- `gemini-agent/mcp/tools/**/*.ts` - May contain API keys for external services
- `control-api/server.ts` - Database credentials
- `*.json` - Config files

**Medium Priority:**
- Test files (`**/*.test.ts`, `**/*.spec.ts`)
- Documentation files (may have example credentials)

### Violation Recording Template

```markdown
### Rule 1 Violation: [File:Line]

**File:** `path/to/file.ts:123`
**Severity:** Critical | High | Medium | Low
**Pattern:** Hardcoded private key | API key | Password

**Violation:**
```typescript
const AGENT_KEY = '0x1234567890abcdef...'; // ❌
```

**Fix:**
```typescript
const agentKey = process.env.AGENT_PRIVATE_KEY;
if (!agentKey) throw new Error('AGENT_PRIVATE_KEY required');
```

**Notes:**
- Check if this secret is in git history
- Rotate immediately if real secret
```

---

## Rule 2: Always Validate On-Chain State Before Financial Operations

### Search Patterns

#### Pattern 2.1: Token Transfers Without Balance Checks
```bash
# Find token transfer calls
grep -rn "\.transfer\(" \
  --include="*.ts" \
  -A 5 -B 10
```

**Look for:**
- `olasToken.transfer(to, amount)` without prior `balanceOf()` check
- ETH transfers (`signer.sendTransaction`) without balance validation
- Missing preflight checks

**Files to review:**
- `worker/funding.ts` (if exists)
- `scripts/fund-*.ts`
- `scripts/recover-*.ts`

#### Pattern 2.2: Safe Transactions Without Validation
```bash
# Find Safe transaction executions
grep -rn "executeTransaction\|createTransaction" \
  --include="*.ts" \
  -A 5 -B 10
```

**Look for:**
- `safeSDK.executeTransaction()` without threshold/owner checks
- Missing Safe configuration validation
- No verification of signer permissions

**Files to review:**
- `worker/mech_worker.ts` - Delivery via Safe
- Any file importing from `mech-client-ts`

#### Pattern 2.3: Mech Deliveries Without Undelivered Check
```bash
# Find deliverViaSafe calls
grep -rn "deliverViaSafe\|deliver.*[Rr]esult" \
  --include="*.ts" \
  -A 5 -B 15
```

**Look for:**
- `deliverViaSafe()` called without `isUndeliveredOnChain()` preflight
- Missing validation that request still needs delivery
- Race condition vulnerabilities

**Files to review:**
- `worker/mech_worker.ts:processOnce()` - Main delivery path
- `scripts/deliver_request.ts` - Manual delivery script

#### Pattern 2.4: Staking Operations Without State Checks
```bash
# Find staking contract interactions
grep -rn "\.stake\(|\.unstake\(|deployService" \
  --include="*.ts" \
  -A 5 -B 10
```

**Look for:**
- `stakingContract.stake()` without `isServiceStaked()` check
- Service deployment without state validation
- Missing OLAS balance checks before staking

**Files to review:**
- `worker/OlasStakingManager.ts`
- `worker/OlasServiceManager.ts`
- `scripts/deploy-service.ts`

#### Pattern 2.5: Contract Method Calls (General)
```bash
# Find all contract method calls that could change state
grep -rn "contract\.methods\.\|\.call({|\.send({" \
  --include="*.ts" \
  -A 3 -B 10
```

**Manual review:**
- Check if each state-changing call has preflight validation
- Verify that `view`/`pure` functions are called first where applicable

### Files to Review

**Critical (Must Review):**
- `worker/mech_worker.ts` - Main delivery logic
- `worker/OlasStakingManager.ts` - Staking operations
- `worker/OlasServiceManager.ts` - Service lifecycle
- `scripts/recover-stranded-olas.ts` - Token recovery
- `scripts/recover-from-service-safe.ts` - Safe recovery

**High Priority:**
- `scripts/fund-*.ts` - Funding operations
- `scripts/deploy-*.ts` - Deployment scripts
- Any file using `mech-client-ts` delivery functions

### Violation Recording Template

```markdown
### Rule 2 Violation: [File:Line]

**File:** `path/to/file.ts:123`
**Severity:** Critical | High | Medium
**Operation:** Token transfer | Safe TX | Mech delivery | Staking

**Violation:**
```typescript
// ❌ No preflight validation
await deliverViaSafe({ requestId, ... });
```

**Fix:**
```typescript
// ✅ Preflight check before delivery
const isUndelivered = await isUndeliveredOnChain({ mechAddress, requestIdHex });
if (!isUndelivered) {
  logger.info('Already delivered, skipping');
  return;
}
await deliverViaSafe({ requestId, ... });
```

**Impact:**
- Potential gas waste: ~0.001 ETH per failed TX
- Risk of locked funds
```

---

## Rule 3: Never Silently Discard Errors in Financial Contexts

### Search Patterns

#### Pattern 3.1: Empty Catch Blocks
```bash
# Find empty catch blocks
grep -rn "catch\s*([^)]*)\s*{\s*}" \
  --include="*.ts" \
  --include="*.js"
```

**Look for:**
- `catch (e) { }` - Completely empty
- `catch (error) { }` - No logging or re-throw

**Files to review:**
- All TypeScript files (systematic scan)

#### Pattern 3.2: Catch with Silent Fallback
```bash
# Find catch blocks that might be silent
grep -rn "catch.*{" \
  --include="*.ts" \
  -A 3
```

**Manual review needed:**
- Check if each catch block logs the error
- Verify error is re-thrown or handled explicitly
- Look for patterns like `catch (e) { return null; }`

#### Pattern 3.3: Promise.catch with Fallbacks
```bash
# Find .catch() in promise chains
grep -rn "\.catch\(" \
  --include="*.ts" \
  -A 2 -B 2
```

**Look for:**
- `.catch(() => null)` - Silent null return
- `.catch(() => [])` - Silent empty array
- `.catch(() => false)` - Silent boolean fallback
- Missing logger calls inside `.catch()`

#### Pattern 3.4: Try-Catch in Financial Operations
Identify all try-catch blocks in financial contexts, then review each:

```bash
# Find try-catch in files dealing with finance
grep -rn "try\s*{" \
  worker/mech_worker.ts \
  worker/OlasStakingManager.ts \
  scripts/recover-*.ts \
  scripts/fund-*.ts \
  -A 20
```

**Manual review:**
- Verify every catch block has `logger.error()` or similar
- Check that error includes context (operation, parameters)
- Confirm error is re-thrown unless degraded mode is documented

#### Pattern 3.5: Fetch/RPC Calls Without Error Handling
```bash
# Find fetch calls that might swallow errors
grep -rn "fetch\(|contract\.call\(|contract\.methods\." \
  --include="*.ts" \
  -A 5 -B 5
```

**Look for:**
- `await fetch(url)` without try-catch
- `.catch()` without logging
- Inline `|| null` fallbacks

### Context-Specific Scans

#### Scan 3A: Token Transfer Error Handling
```bash
grep -rn "\.transfer\(" worker/*.ts scripts/*.ts -A 10
```
**Review:** Every token transfer must have explicit error handling with logging

#### Scan 3B: Safe Transaction Error Handling
```bash
grep -rn "executeTransaction\|deliverViaSafe" worker/*.ts -A 10
```
**Review:** Every Safe TX must log failures and surface errors

#### Scan 3C: RPC Call Error Handling
```bash
grep -rn "getUndeliveredRequestIds\|balanceOf\|getService" worker/*.ts -A 10
```
**Review:** RPC calls should log errors (even if best-effort fallback)

#### Scan 3D: IPFS Upload Error Handling
```bash
grep -rn "ipfs\|pushMetadataToIpfs\|uploadTo" gemini-agent/**/*.ts -A 10
```
**Review:** IPFS failures must be logged and surfaced

### Files to Review

**Critical (Financial Operations):**
- `worker/mech_worker.ts` - Delivery error handling
- `worker/OlasStakingManager.ts` - Staking errors
- `worker/OlasServiceManager.ts` - Service errors
- `scripts/recover-stranded-olas.ts` - Recovery errors
- `scripts/recover-from-service-safe.ts` - Safe recovery

**High Priority:**
- `gemini-agent/mcp/tools/dispatch_new_job.ts` - Job posting
- `gemini-agent/mcp/tools/create_artifact.ts` - IPFS uploads
- `control-api/server.ts` - Database writes
- All files importing `mech-client-ts`

**Medium Priority:**
- Other MCP tools (may have non-critical operations)
- Test files (should have explicit error handling)

### Violation Recording Template

```markdown
### Rule 3 Violation: [File:Line]

**File:** `path/to/file.ts:123`
**Severity:** Critical | High | Medium
**Context:** Token transfer | Safe TX | RPC call | IPFS upload

**Violation:**
```typescript
try {
  await deliverViaSafe(payload);
} catch (error) {
  // ❌ Silent catch - no logging
}
```

**Fix:**
```typescript
try {
  await deliverViaSafe(payload);
  logger.info('Delivery succeeded', { requestId, txHash });
} catch (error) {
  logger.error('Delivery failed', {
    requestId,
    error: serializeError(error)
  });
  throw error; // ✅ Re-throw to surface
}
```

**Impact:**
- Debugging impossible without logs
- Stuck jobs in production
```

---

## Execution Plan

### Week 1: Automated Detection

**Day 1: Rule 1 - Secrets Scan**
- [ ] Run all Pattern 1.x searches
- [ ] Check .gitignore for .env files
- [ ] Scan git history for secrets
- [ ] Document findings in `VIOLATIONS.md`

**Day 2: Rule 1 - Manual Review**
- [ ] Review all flagged files from Day 1
- [ ] Check test files for real credentials
- [ ] Verify .env.example has only placeholders
- [ ] Confirm findings and record violations

**Day 3: Rule 2 - Financial Operations Scan**
- [ ] Run all Pattern 2.x searches
- [ ] Focus on `worker/mech_worker.ts` delivery path
- [ ] Review staking and service manager files
- [ ] Document findings in `VIOLATIONS.md`

**Day 4: Rule 2 - Manual Review**
- [ ] Deep review of each flagged operation
- [ ] Trace call paths for preflight checks
- [ ] Verify RPC view calls before state changes
- [ ] Confirm findings and record violations

**Day 5: Rule 3 - Error Handling Scan**
- [ ] Run all Pattern 3.x searches
- [ ] Identify all empty catch blocks
- [ ] Find all `.catch()` fallbacks
- [ ] Document findings in `VIOLATIONS.md`

### Week 2: Manual Review & Documentation

**Day 6: Rule 3 - Context-Specific Review**
- [ ] Review token transfer error handling
- [ ] Review Safe transaction error handling
- [ ] Review RPC call error handling
- [ ] Review IPFS upload error handling

**Day 7: Consolidation**
- [ ] Merge all violation findings into `VIOLATIONS.md`
- [ ] Categorize by severity (Critical/High/Medium/Low)
- [ ] Calculate total violation count per rule
- [ ] Identify most violated files

**Day 8: Remediation Planning**
- [ ] Prioritize violations by risk × frequency
- [ ] Group violations by file for batch fixing
- [ ] Create migration plan for each rule
- [ ] Estimate effort for remediation

**Day 9: Documentation**
- [ ] Write executive summary
- [ ] Create violation heat map (files with most violations)
- [ ] Document patterns observed
- [ ] Suggest preventive measures

**Day 10: Review & Delivery**
- [ ] Peer review of findings
- [ ] Validate sample fixes
- [ ] Present audit results
- [ ] Get approval for remediation plan

---

## Output Documents

### 1. VIOLATIONS.md
Master document containing all violations across all rules.

**Structure:**
```markdown
# Code Spec Audit - Violations Report

## Executive Summary
- Total violations: X
- Critical: Y
- High: Z
- Medium: W

## Rule 1 Violations (Count: N)
[List all Rule 1 violations]

## Rule 2 Violations (Count: N)
[List all Rule 2 violations]

## Rule 3 Violations (Count: N)
[List all Rule 3 violations]

## Violation Heat Map
Files with most violations:
1. worker/mech_worker.ts - 15 violations
2. scripts/recover-stranded-olas.ts - 8 violations
...
```

### 2. REMEDIATION_PLAN.md
Detailed plan for fixing all violations.

**Structure:**
```markdown
# Remediation Plan

## Phase 1: Critical Violations (Week 1)
- Fix Rule 1 violations in production code
- Add preflight checks to main delivery path
- Add error logging to financial operations

## Phase 2: High Priority (Week 2)
[...]

## Phase 3: Medium Priority (Week 3)
[...]
```

### 3. PATTERNS_OBSERVED.md
Common anti-patterns discovered during audit.

**Structure:**
```markdown
# Anti-Patterns Observed

## Pattern: Silent catches in Promise chains
**Frequency:** 12 occurrences
**Example:** `.catch(() => null)`
**Why problematic:** Errors invisible, debugging impossible
**Fix:** `.catch(e => { logger.error(...); throw e; })`
```

---

## Success Criteria

**Audit Complete:**
- [ ] All search patterns executed
- [ ] All high-priority files manually reviewed
- [ ] All violations documented with file:line
- [ ] Severity assigned to each violation
- [ ] Suggested fixes provided
- [ ] Remediation plan created

**Audit Quality:**
- [ ] Zero false positives in Critical violations
- [ ] <10% false positives in High violations
- [ ] All findings have concrete examples
- [ ] All fixes are actionable

---

## Tools & Scripts

### Helper: Run All Searches
```bash
#!/bin/bash
# scripts/audit-code-spec.sh

echo "Running Code Spec Audit..."

echo "=== Rule 1: Secrets Scan ==="
grep -rn "0x[0-9a-fA-F]{64}" --include="*.ts" --exclude-dir=node_modules > audit_rule1_keys.txt
grep -rn -E "(API_KEY|SECRET|TOKEN|PASSWORD)\s*[:=]\s*['\"][^'\"]{20,}" --include="*.ts" --exclude-dir=node_modules > audit_rule1_tokens.txt
git ls-files | grep -E "\.env$" > audit_rule1_envfiles.txt

echo "=== Rule 2: Financial Operations Scan ==="
grep -rn "\.transfer\(" --include="*.ts" worker/ scripts/ > audit_rule2_transfers.txt
grep -rn "deliverViaSafe" --include="*.ts" > audit_rule2_deliveries.txt
grep -rn "\.stake\(" --include="*.ts" > audit_rule2_staking.txt

echo "=== Rule 3: Error Handling Scan ==="
grep -rn "catch\s*([^)]*)\s*{\s*}" --include="*.ts" > audit_rule3_empty_catch.txt
grep -rn "\.catch\(" --include="*.ts" > audit_rule3_promise_catch.txt

echo "Audit scans complete. Review audit_*.txt files."
```

### Helper: Analyze Violations
```bash
#!/bin/bash
# scripts/analyze-violations.sh

echo "=== Violation Statistics ==="
echo "Rule 1 - Secrets:"
wc -l audit_rule1_*.txt

echo "Rule 2 - Financial Operations:"
wc -l audit_rule2_*.txt

echo "Rule 3 - Error Handling:"
wc -l audit_rule3_*.txt

echo "=== Top Violating Files ==="
cat audit_*.txt | cut -d: -f1 | sort | uniq -c | sort -rn | head -10
```

---

## Risk Assessment

### High-Risk Areas (Review First)

1. **worker/mech_worker.ts**
   - Handles real on-chain deliveries
   - Token transfers, Safe transactions
   - Most critical for Rule 2 & 3

2. **worker/OlasStakingManager.ts**
   - Manages OLAS staking
   - Financial operations
   - Critical for Rule 2 & 3

3. **scripts/recover-*.ts**
   - Fund recovery scripts
   - Run manually during incidents
   - Critical for Rule 2 & 3

4. **Config files and .env handling**
   - Potential hardcoded secrets
   - Critical for Rule 1

### Medium-Risk Areas

5. **gemini-agent/mcp/tools/**
   - IPFS uploads, job dispatching
   - API calls, some financial operations
   - Relevant for Rule 3

6. **scripts/deploy-*.ts**
   - Service deployment
   - Contract interactions
   - Relevant for Rule 2

### Low-Risk Areas

7. **Test files**
   - May have mock secrets (acceptable if clearly fake)
   - Error handling less critical
   - Review for leakage into production

8. **Documentation**
   - May have example credentials
   - Should only have placeholders
