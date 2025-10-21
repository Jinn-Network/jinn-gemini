# Code Spec Violations Report

**Audit Date:** 2025-01-10
**Auditor:** Automated + Manual Review
**Scope:** Entire codebase (worker/, scripts/, gemini-agent/)

---

## Executive Summary

### Overall Health: ⚠️ **CRITICAL SECRETS FOUND** | ✅ Financial Logic Sound

**The Good News:**
- ✅ Production financial code follows best practices (preflight validation, error logging)
- ✅ Main delivery path in `worker/mech_worker.ts` is compliant with all rules
- ✅ Error handling in critical paths is comprehensive

**The Critical News:**
- 🔴 **19 CRITICAL SECRET VIOLATIONS** - Agent private keys and .env files committed to git
- 🔴 If this repo is or becomes public, all funds in exposed Safes are at immediate risk

**The Improvements Needed:**
- ⚠️ 2 medium-priority validations missing in recovery scripts
- ⚠️ 3 medium-priority logging gaps in artifact storage
- ⚠️ Git history cleanup required to remove secrets

---

## Violations Summary

### Rules Violations (Security & Financial)

| Rule | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| **Rule 1: Never Commit Secrets** | 19 | 0 | 0 | 0 | **19** |
| **Rule 2: Validate On-Chain State** | 0 | 0 | 2 | 0 | **2** |
| **Rule 3: Never Silent Errors** | 0 | 0 | 3 | ~15* | **3** |
| **TOTAL** | **19** | **0** | **5** | **~15*** | **24** |

\* Low-severity violations are in test files and non-financial scraping code (acceptable)

### Orthodoxy Violations (Patterns & Consistency)

13 unresolved pattern violations tracked separately (see "Orthodoxy Violations" section below)

---

# Part I: Rules Violations (Security & Financial)

---

## Rule 1: Never Commit Secrets (19 Critical)

### 🔴 Critical Risk: Agent Keys in Repository

**Files Affected:** 19 files
**Impact:** If repo is public, immediate fund loss
**Status:** 🚨 **URGENT ACTION REQUIRED**

### Critical Violations (19)

#### V1.1: Agent Private Keys in Service Backups (7 files)

**Severity:** CRITICAL
**Impact:** These are real agent keys that control Safes with OLAS + ETH

**Files:**
1. `./service-backups/sc-531d7991-7d28-4cfd-aab6-e58ed50105a6/keys.json:5`
2. `./service-backups/sc-f93d13c6-4e1d-48a7-9eff-fc41d993e199/keys.json:5`
3. `./service-backups/service-164-20251003-123156/keys.json:5`
4. `./service-backups/sc-2de951a6-42ef-45f8-991f-c1be47b4b438/keys.json:5`
5. `./service-backups/sc-0e0cdc9c-a7ae-4af8-bb94-a84f5b0b71fd/keys.json:5`
6. `./service-backups/sc-d11bfd74-bf02-4249-8643-98b47f0164e8/keys.json:5`
7. `./service-backups/sc-d31271dd-72c4-48bd-9c5d-3d6366795e64-20251001-175619/keys.json:5`

**Violation:**
```json
{
  "address": "0x...",
  "private_key": "0x324697dbfdd9eb02150dd263995ec88487d0024da3f7eb641a62ddceb2470ac5"
}
```

**Fix:**
```bash
# 1. Move service-backups/ to .gitignore
echo "service-backups/" >> .gitignore

# 2. Remove from git history (DANGEROUS - coordinate with team)
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch service-backups/**/keys.json' \
  --prune-empty --tag-name-filter cat -- --all

# 3. Store keys securely
# - Use 1Password/AWS Secrets Manager for backup storage
# - Never commit keys.json files
```

**Recovery Plan:**
1. Check if any of these Safes still have funds (use `scripts/check-all-safes-comprehensive.ts`)
2. If funds exist, transfer to Master Safe immediately
3. Rotate all agent keys (deploy new services with new keys)
4. Update documentation to never backup keys.json

---

#### V1.2: Agent Private Keys in Recovery Scripts (7 files)

**Severity:** CRITICAL
**Impact:** Hardcoded keys in production scripts

**Files:**
1. `./scripts/recover-from-service-safe.ts:18`
2. `./scripts/archive/recover-service-150-safe-eth.ts:15`
3. `./scripts/archive/recover-service-150-all-olas.ts:21`
4. `./scripts/archive/recover-service-150-eth.ts:14`
5. `./scripts/recover-default-service-with-safe-sdk.ts:15`
6. `./scripts/recover-default-service-olas.ts:15`
7. `./scripts/recover-stranded-olas.ts:19`

**Violation:**
```typescript
// scripts/recover-from-service-safe.ts:18
const AGENT_KEY_PRIVATE_KEY = '0x<REDACTED_PRIVATE_KEY_1>';
```

**Fix:**
```typescript
// ✅ Read from environment variable
const agentKeyPrivateKey = process.env.AGENT_KEY_PRIVATE_KEY;
if (!agentKeyPrivateKey) {
  throw new Error('AGENT_KEY_PRIVATE_KEY environment variable is required');
}
const wallet = new ethers.Wallet(agentKeyPrivateKey, provider);
```

---

#### V1.3: Test Password Hardcoded

**Severity:** CRITICAL (Production context)
**File:** `./scripts/CORE_DO_NOT_DELETE_olas_service_lifecycle_validation.ts:321`

**Violation:**
```typescript
OPERATE_PASSWORD: "test-password-12345678",
```

**Context:** This is used in production validation scripts. While labeled "test", the password may be reused in actual deployments.

**Fix:**
```typescript
// ✅ Read from environment
OPERATE_PASSWORD: process.env.OPERATE_PASSWORD || (() => {
  throw new Error('OPERATE_PASSWORD environment variable required');
})(),
```

---

#### V1.4: Committed .env Files (7 files)

**Severity:** CRITICAL
**Files:**
1. `.env.mainnet`
2. `service-backups/sc-0e0cdc9c-a7ae-4af8-bb94-a84f5b0b71fd/deployment/agent_0.env`
3. `service-backups/sc-531d7991-7d28-4cfd-aab6-e58ed50105a6/deployment/agent_0.env`
4. `service-backups/sc-d11bfd74-bf02-4249-8643-98b47f0164e8/deployment/agent_0.env`
5. `service-backups/sc-d31271dd-72c4-48bd-9c5d-3d6366795e64-20251001-175619/deployment/agent_0.env`
6. `service-backups/sc-f93d13c6-4e1d-48a7-9eff-fc41d993e199/deployment/agent_0.env`
7. `service-backups/service-164-20251003-123156/deployment/agent_0.env`

**Violation:**
`.env` files contain secrets but are tracked by git (despite .gitignore patterns)

**Fix:**
```bash
# 1. Check if files contain secrets
cat .env.mainnet  # Review contents

# 2. Remove from git (keep local copy if needed)
git rm --cached .env.mainnet
git rm --cached service-backups/**/deployment/agent_0.env

# 3. Commit the removal
git commit -m "security: remove committed .env files"

# 4. Remove from git history
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch .env.mainnet service-backups/**/deployment/agent_0.env' \
  --prune-empty --tag-name-filter cat -- --all
```

**Note:** `.gitignore` already has correct patterns, but these files were committed before the patterns were added.

---

### Rule 1 Remediation Plan

#### Phase 1: Immediate Actions (TODAY)

**Step 1: Verify Repository Privacy**
```bash
# Check if repo is public
gh repo view --json visibility

# If public: IMMEDIATELY make private
gh repo edit --visibility private
```

**Step 2: Assess Exposure Risk**
```bash
# Check which agent keys are in git
grep -r "private_key" service-backups/*/keys.json | \
  jq -r '.address' | \
  while read addr; do
    echo "Checking Safe for agent: $addr"
    # Use check-all-safes-comprehensive.ts
  done
```

**Step 3: Emergency Fund Transfer (if needed)**
If any Safes controlled by exposed keys have funds:
```bash
# Use existing recovery scripts with ENV vars
export AGENT_KEY_PRIVATE_KEY="<key-from-keys.json>"
yarn tsx scripts/recover-from-service-safe.ts
```

#### Phase 2: Code Fixes (Week 1)

**Fix 1: Update Recovery Scripts**
```bash
# List of scripts to fix
scripts/recover-from-service-safe.ts
scripts/recover-default-service-with-safe-sdk.ts
scripts/recover-default-service-olas.ts
scripts/recover-stranded-olas.ts
scripts/archive/recover-service-150-*.ts
```

**Template Fix:**
```typescript
// Before
const AGENT_KEY_PRIVATE_KEY = '0x...';

// After
const agentKeyPrivateKey = process.env.AGENT_KEY_PRIVATE_KEY;
if (!agentKeyPrivateKey) {
  throw new Error('AGENT_KEY_PRIVATE_KEY environment variable required');
}
```

**Fix 2: Remove Hardcoded Password**
```bash
# File: scripts/CORE_DO_NOT_DELETE_olas_service_lifecycle_validation.ts
# Replace hardcoded password with env var
```

**Fix 3: Remove Committed Files**
```bash
# Remove .env files from git
git rm --cached .env.mainnet
git rm --cached service-backups/**/deployment/agent_0.env
git rm --cached service-backups/**/keys.json
git commit -m "security: remove committed secrets"
```

#### Phase 3: Git History Cleanup (Week 2)

**WARNING:** This rewrites git history and requires force push. Coordinate with team.

```bash
# Backup current state
git clone <repo-url> jinn-backup

# Remove secrets from history
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch \
    .env.mainnet \
    service-backups/**/deployment/agent_0.env \
    service-backups/**/keys.json' \
  --prune-empty --tag-name-filter cat -- --all

# Force push (DANGEROUS)
git push origin --force --all
git push origin --force --tags
```

#### Phase 4: Preventive Measures

**1. Pre-commit Hook**
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Detect private keys
if git diff --cached | grep -E "private_key.*0x[0-9a-fA-F]{64}"; then
  echo "❌ Private key detected in staged changes"
  exit 1
fi

# Detect .env files
if git diff --cached --name-only | grep -E "\.env$|\.env\."; then
  if ! echo "$file" | grep -E "\.env\.example|\.env\.template"; then
    echo "❌ .env file staged: $file"
    exit 1
  fi
fi
```

**2. Update .gitignore**
```bash
# Add to .gitignore
service-backups/**/keys.json
service-backups/**/deployment/*.env
.env.mainnet
```

**3. Documentation**
Create `docs/SECURITY.md`:
```markdown
# Security Guidelines

## Never Commit:
- Private keys (agent keys, wallet keys)
- .env files (except .env.example)
- API keys or passwords
- Service backup files containing keys

## Secure Storage:
- Use 1Password for backup keys
- Use environment variables in scripts
- Rotate keys if exposed
```

---

## Rule 2: Validate On-Chain State (2 Medium)

### ⚠️ Missing Preflight Checks in Scripts

**Files Affected:** 3 scripts
**Impact:** Wasted gas on failed transactions
**Status:** ✅ **Production code compliant**, scripts need improvement

### ✅ Compliant Code (Good Examples)

#### Example 1: Mech Delivery with Preflight Check
**File:** `worker/mech_worker.ts:702-708`
**Status:** ✅ **COMPLIANT**

```typescript
// Preflight: ensure request is still undelivered on-chain before constructing Safe tx
const requestIdHex = String(target.id).startsWith('0x')
  ? String(target.id)
  : '0x' + BigInt(String(target.id)).toString(16);

const ok = await isUndeliveredOnChain({
  mechAddress: targetMechAddress,
  requestIdHex,
  rpcHttpUrl
});

if (!ok) {
  workerLogger.info(
    { jobName: metadata?.jobName, requestId: target.id },
    'Preflight: request already delivered or not eligible; skipping Safe delivery'
  );
  return;
}

await deliverViaSafe(payload);
```

**Why This Is Good:**
- Queries on-chain state before constructing Safe TX
- Uses view function (`getUndeliveredRequestIds`) - zero gas cost
- Logs the skip reason for observability
- Prevents wasted gas on already-delivered requests

---

### Medium Priority Violations (2)

#### V2.1: No Preflight Check in Tenderly Test Script
**Severity:** Medium (Test/Development only)
**File:** `scripts/fund-master-safe-tenderly.ts:28`

**Violation:**
```typescript
// ❌ No balance check or preflight validation
const amount = ethers.parseEther('50');
console.log('💰 Transferring 50 OLAS to Master Safe...');

const tx = await olas.transfer(MASTER_SAFE, amount);
```

**Fix:**
```typescript
// ✅ Add balance check
const amount = ethers.parseEther('50');

// Preflight: Check sender has sufficient balance
const balance = await olas.balanceOf(await wallet.getAddress());
if (balance < amount) {
  throw new Error(
    `Insufficient OLAS: have ${ethers.formatEther(balance)}, ` +
    `need ${ethers.formatEther(amount)}`
  );
}

console.log(`💰 Transferring 50 OLAS to Master Safe...`);
const tx = await olas.transfer(MASTER_SAFE, amount);
```

**Impact:**
- **Low risk** - Only used in Tenderly Virtual TestNet (not production)
- If balance insufficient, TX reverts and wastes virtual ETH
- Could confuse testing if failure reason is unclear

**Remediation Priority:** Medium (good practice, not urgent)

---

#### V2.2: Recovery Scripts with Minimal Safe Validation
**Severity:** Medium
**Files:**
- `scripts/archive/recover-service-150-all-olas.ts:109-121`
- `scripts/recover-default-service-with-safe-sdk.ts:57-71`

**Violation:**
```typescript
// ❌ Creates Safe TX without validating Safe configuration
const safeTransaction = await protocolKit.createTransaction({
  transactions: [{
    to: OLAS_TOKEN,
    value: '0',
    data: data,
  }]
});

const signedTx = await protocolKit.signTransaction(safeTransaction);
const executeTxResponse = await protocolKit.executeTransaction(signedTx);
```

**Missing Validations:**
- No check that Safe threshold is satisfied
- No check that signer is an owner of the Safe
- No check that Safe has sufficient OLAS balance

**Fix:**
```typescript
// ✅ Validate Safe configuration before creating TX
const threshold = await protocolKit.getThreshold();
const owners = await protocolKit.getOwners();

if (threshold > owners.length) {
  throw new Error(
    `Safe has invalid configuration: ` +
    `threshold=${threshold} but only ${owners.length} owners`
  );
}

// Validate signer is an owner
const signerAddress = await signer.getAddress();
const isOwner = owners
  .map(addr => addr.toLowerCase())
  .includes(signerAddress.toLowerCase());

if (!isOwner) {
  throw new Error(
    `Signer ${signerAddress} is not an owner of Safe ${safeAddress}`
  );
}

// Validate Safe has sufficient OLAS
const safeBalance = await olasToken.balanceOf(safeAddress);
if (safeBalance < balance) {
  throw new Error(
    `Safe has insufficient OLAS: ` +
    `have ${ethers.formatEther(safeBalance)}, ` +
    `need ${ethers.formatEther(balance)}`
  );
}

// Now safe to create transaction
const safeTransaction = await protocolKit.createTransaction({...});
```

**Impact:**
- **Medium risk** - Scripts run manually during recovery operations
- Failed TXs waste real gas on Base mainnet
- Unclear failure messages make debugging harder
- Safe SDK may throw opaque errors

**Remediation Priority:** Medium (used infrequently, but high cost when wrong)

---

### Rule 2 Remediation Plan

#### Phase 1: Medium Priority (Week 2)

**Fix 1: Add Balance Check to Tenderly Test Script**
**File:** `scripts/fund-master-safe-tenderly.ts`
**Effort:** 5 minutes
**Priority:** Low (test script)

```bash
# Add preflight balance check before transfer
# Follow pattern from recover-default-service-olas.ts
```

**Fix 2: Add Safe Validation to Recovery Scripts**
**Files:**
- `scripts/archive/recover-service-150-all-olas.ts`
- `scripts/recover-default-service-with-safe-sdk.ts`

**Effort:** 30 minutes each
**Priority:** Medium (manual recovery scripts)

**Template:**
```typescript
// Add before createTransaction
const threshold = await protocolKit.getThreshold();
const owners = await protocolKit.getOwners();
const signerAddress = await signer.getAddress();

// Validate
if (threshold > owners.length) throw new Error('Invalid threshold');
if (!owners.includes(signerAddress)) throw new Error('Signer not owner');

// Check balance
const safeBalance = await token.balanceOf(safeAddress);
if (safeBalance < amount) throw new Error('Insufficient balance');
```

---

## Rule 3: Never Silent Errors (3 Medium)

### ⚠️ Empty Catch Blocks in Artifact Storage

**Files Affected:** 1 file (`worker/mech_worker.ts`)
**Impact:** Invisible artifact failures, debugging impossible
**Status:** ⚠️ **Non-critical operations**, but should log

### Medium Priority Violations (3)

#### V3.1: Silent Failure in Artifact Storage Function
**Severity:** Medium
**File:** `worker/mech_worker.ts:440`
**Context:** Non-critical artifact metadata storage

**Violation:**
```typescript
async function storeOnchainArtifact(
  request: UnclaimedRequest,
  workerAddress: string,
  cid: string,
  topic: string,
  content?: string
): Promise<void> {
  try {
    const data = { cid, topic, content: content || null };
    await apiCreateArtifact(request.id, data);
  } catch {}  // ❌ Empty catch - no logging
}
```

**Fix:**
```typescript
async function storeOnchainArtifact(
  request: UnclaimedRequest,
  workerAddress: string,
  cid: string,
  topic: string,
  content?: string
): Promise<void> {
  try {
    const data = { cid, topic, content: content || null };
    await apiCreateArtifact(request.id, data);
  } catch (error) {
    // ✅ Log as warning (non-critical operation)
    workerLogger.warn(
      {
        requestId: request.id,
        cid,
        topic,
        error: serializeError(error)
      },
      'Failed to store artifact (non-critical)'
    );
    // Don't re-throw - this is optional metadata
  }
}
```

**Impact:**
- **Medium** - Artifact storage failures are invisible
- No way to debug why artifacts aren't appearing in database
- Could indicate broader issues with Control API or network
- Not financial - artifacts are metadata, not fund transfers

**Remediation Priority:** Medium (improves observability)

---

#### V3.2: Silent Inline Catch in Artifact Loop
**Severity:** Medium
**File:** `worker/mech_worker.ts:667`
**Context:** Optional artifact persistence

**Violation:**
```typescript
const artifacts = [
  ...extractArtifactsFromOutput(result?.output || ''),
  ...extractArtifactsFromTelemetry(result?.telemetry || {})
];

if (artifacts.length > 0) {
  (result as any).artifacts = artifacts;
  // Persist via Control API for queryability immediately (optional)
  for (const a of artifacts) {
    try {
      await apiCreateArtifact(target.id, {
        cid: a.cid,
        topic: a.topic,
        content: null
      });
    } catch {}  // ❌ Empty catch - no logging
  }
}
```

**Fix:**
```typescript
if (artifacts.length > 0) {
  (result as any).artifacts = artifacts;

  // Persist via Control API for queryability immediately (optional)
  for (const a of artifacts) {
    try {
      await apiCreateArtifact(target.id, {
        cid: a.cid,
        topic: a.topic,
        content: null
      });
    } catch (error) {
      // ✅ Log failure but continue processing other artifacts
      workerLogger.warn(
        {
          requestId: target.id,
          cid: a.cid,
          topic: a.topic,
          error: serializeError(error)
        },
        'Failed to persist artifact (continuing)'
      );
      // Don't re-throw - partial success is acceptable
    }
  }
}
```

**Impact:**
- **Medium** - Multiple artifacts may fail silently
- Can't track partial failures (some artifacts stored, others not)
- Makes debugging artifact issues difficult

**Remediation Priority:** Medium (batch operation needs visibility)

---

#### V3.3: Silent Failure After Result Storage
**Severity:** Medium
**File:** `worker/mech_worker.ts:690`
**Context:** Optional result artifact storage

**Violation:**
```typescript
// Persist output as artifact (optional, topic=result.output)
try {
  const outputStr = typeof result?.output === 'string'
    ? result.output
    : JSON.stringify(result?.output ?? '');

  await storeOnchainArtifact(
    target,
    workerAddress,
    'inline',
    'result.output',
    outputStr
  );
} catch {}  // ❌ Empty catch - no logging
```

**Fix:**
```typescript
// Persist output as artifact (optional, topic=result.output)
try {
  const outputStr = typeof result?.output === 'string'
    ? result.output
    : JSON.stringify(result?.output ?? '');

  await storeOnchainArtifact(
    target,
    workerAddress,
    'inline',
    'result.output',
    outputStr
  );
} catch (error) {
  // ✅ Log warning (non-critical operation)
  workerLogger.warn(
    {
      requestId: target.id,
      error: serializeError(error)
    },
    'Failed to store result artifact (non-critical)'
  );
  // Don't re-throw - this is optional metadata
}
```

**Impact:**
- **Medium** - Result artifact failures invisible
- Could indicate systemic issues with artifact storage
- Hard to debug when result artifacts missing from database

**Remediation Priority:** Medium (completes the artifact storage observability)

---

### ✅ Good Error Handling Examples

#### Example 1: Delivery Failure Logging
**File:** `worker/mech_worker.ts:729-745`
**Status:** ✅ **COMPLIANT**

```typescript
try {
  const delivery = await (deliverViaSafe as any)(payload);
  workerLogger.info(
    {
      jobName: metadata?.jobName,
      requestId: target.id,
      tx: delivery?.tx_hash,
      status: delivery?.status
    },
    'Delivered via Safe'
  );
} catch (e: any) {
  // ✅ Logs error with full context
  workerLogger.warn(
    {
      jobName: metadata?.jobName,
      requestId: target.id,
      error: serializeError(e)
    },
    'Safe delivery failed'
  );

  // ✅ Records FAILED status so job doesn't get stuck
  try {
    await apiCreateJobReport(target.id, {
      status: 'FAILED',
      error_message: e?.message || String(e),
      error_type: 'DELIVERY_ERROR',
      // ... other fields
    });
  } catch (reportErr: any) {
    // ✅ Even the error reporting failure is logged
    workerLogger.warn(
      {
        requestId: target.id,
        error: reportErr?.message || String(reportErr)
      },
      'Failed to record FAILED status'
    );
  }
}
```

**Why This Is Good:**
- Logs original error with context
- Records FAILED status to prevent stuck jobs
- Handles nested errors gracefully
- Even error logging failures are logged

---

### Rule 3 Remediation Plan

#### Phase 1: High Priority (Week 1)

**Fix All 3 Artifact Storage Violations**
**Files:**
- `worker/mech_worker.ts:440` - Add logging to `storeOnchainArtifact`
- `worker/mech_worker.ts:667` - Add logging to inline artifact loop
- `worker/mech_worker.ts:690` - Add logging to result artifact storage

**Effort:** 15 minutes total
**Priority:** Medium (improves observability, not critical)

**Template:**
```typescript
// Replace empty catch:
} catch {}

// With logged catch:
} catch (error) {
  workerLogger.warn(
    {
      requestId: target.id,
      error: serializeError(error),
      // ... other context
    },
    'Failed to store artifact (non-critical)'
  );
}
```

---

# Part II: Objective Violations

These violations relate to the three core objectives (One Obvious Way, Code for the Next Agent, Minimize Harm). Unlike Rules violations (hard constraints), objective violations represent patterns that work against the code spec's guiding principles.

---

# Orthodoxy Violations (Objective 1: One Obvious Way)

These violations relate to the "one obvious way" principle - pattern inconsistencies that make the codebase harder for AI agents to learn and maintain.

**Status Guide:**
- 🔴 **Unresolved** - No canonical approach established
- 🟡 **In Progress** - Canonical approach being researched/discussed
- 🟢 **Resolved** - Documented in spec.md with examples

---

## 1. Configuration Management 🔴

**Status:** Unresolved

**Current approaches:** 5 different patterns
1. **Zod schema with validation** (`worker/config.ts`)
   - Type-safe, validated at startup, centralized
   - Exits process on validation failure
2. **Class-based with JSON + env overrides** (`mech-client-ts/src/config.ts`)
   - Hybrid: JSON file + env var overrides
   - Multiple fallback chains (`MECHX_CHAIN_RPC || RPC_URL`)
   - No validation
3. **Inline with fallbacks** (everywhere)
   - `process.env.X || 'default'` scattered throughout codebase
   - No validation, no centralization
4. **Helper functions** (`worker/config.ts`)
   - `getRequiredString()`, `getOptionalString()`
   - Not widely adopted
5. **Multiple fallback chains** (scripts)
   - `RPC_URL || MECHX_CHAIN_RPC || MECH_RPC_HTTP_URL || ...`
   - No single source of truth for env var names

**Key problems:**
- 5+ different env var names for same concept (RPC URL, Mech address, etc.)
- No canonical approach to reading config
- Validation inconsistent or absent
- Hard to know which env var to set

**Canonical approach:** TBD

---

## 2. Error Handling 🔴

**Status:** Unresolved

**Current approaches:** Context-dependent patterns
1. **MCP tools:** Return errors as data
   - `{ data: null, meta: { ok: false, code: 'ERROR_CODE', message: '...' } }`
   - AI-readable, never throws
2. **Worker orchestration:** Graceful degradation
   - Return fallback values (`[]`, `null`, `false`)
   - Log errors but keep system running
3. **API clients:** Throw and retry
   - `fetchWithRetry()` with exponential backoff
   - Let caller decide how to handle
4. **Scripts:** Mixed approaches
   - Some use try/catch, some use inline `||` fallbacks

**Key insight:** Different contexts need different error handling strategies

**Canonical approach:** TBD (may need context-specific default behaviors)

---

## 3. Logging 🔴

**Status:** Unresolved

**Current approaches:** 4 different patterns
1. **Pino-based loggers** (`worker/logger.ts`)
   - `logger` (base)
   - `walletLogger`, `workerLogger`, `agentLogger`, `jobLogger`, `mcpLogger`, `configLogger` (specialized)
   - Structured, child loggers with component tags
2. **console.*** (15+ files)
   - `console.log()`, `console.error()`, `console.warn()`, `console.info()`
   - Unstructured, no context
3. **Mixed usage in MCP tools**
   - Some use `console.warn()` for non-critical warnings
   - No clear rule on when to use which
4. **Special cases**
   - `agentLogger.output()` uses `console.log()` with ANSI colors
   - Direct `console.*` for certain UI purposes

**Key problems:**
- No clear guideline on when to use structured vs console logging
- Some files use `logger`, others use `console.*`
- MCP tools mix approaches

**Canonical approach:** TBD

---

## 4. Data Validation 🔴

**Status:** Unresolved

**Current approaches:** Inconsistent adoption
1. **Zod schemas** (15+ files)
   - `.safeParse()` returns result object (doesn't throw)
   - `.parse()` throws on validation failure
   - Used in MCP tools, worker config, some utilities
2. **Manual validation** (many files)
   - `if (!value)` checks
   - No structured error messages
3. **No validation** (some files)
   - Direct `process.env` access
   - Assumes correct types

**Key problems:**
- Some files validate extensively, others not at all
- Mix of `.safeParse()` (preferred for MCP tools) vs `.parse()` (preferred for startup config)

**Canonical approach:** TBD

---

## 5. HTTP/Fetch Usage 🔴

**Status:** Unresolved

**Current approaches:** No shared wrapper
1. **Direct fetch** with inline error handling
2. **fetchWithRetry** utility in `control_api_client.ts`
   - Has retry logic, timeout, exponential backoff
   - Not reused elsewhere
3. **No timeout standardization**
   - Some use timeouts, some don't
   - Different timeout values

**Key problems:**
- No canonical HTTP client
- Retry logic not standardized
- Timeout handling inconsistent

**Canonical approach:** TBD

---

## 6. Null/Undefined Checking 🔴

**Status:** Unresolved

**Current approaches:** 5 patterns identified
1. **Truthy/falsy checks**
   - `if (!value)`, `if (value)`
   - Simple but can hide bugs (e.g., `0`, `""`, `false` are falsy)
2. **Explicit null/undefined checks**
   - `if (value === null)`, `if (value === undefined)`
   - Verbose but precise
3. **Loose equality**
   - `if (value == null)` (checks both null and undefined)
   - Concise but uses `==` (generally discouraged)
4. **Optional chaining**
   - `value?.property`
   - Safe navigation, widely used (15+ files)
5. **Nullish coalescing**
   - `value ?? defaultValue`
   - Only defaults on null/undefined, not other falsy values

**Key problems:**
- Mix of approaches makes intent unclear
- Truthy checks can cause bugs when `0`, `""`, or `false` are valid values
- No guideline on when to use which approach

**Canonical approach:** TBD

---

## 7. Type Definitions 🔴

**Status:** Unresolved

**Current approaches:** Mixed patterns
1. **Interface declarations**
   - `interface JobBoard { ... }`
   - Used for object shapes, can be extended
2. **Type aliases**
   - `type ExecutionStrategy = 'EOA' | 'SAFE'`
   - Used for unions, primitives, computed types
3. **Zod-inferred types**
   - `type WorkerConfig = z.infer<typeof workerConfigSchema>`
   - Derives TypeScript type from runtime validation schema

**Key problems:**
- No clear guideline on interface vs type
- Some types duplicated (e.g., `TransactionPayload` in `types.ts` and `queue/types.ts`)
- Unclear when to use Zod schema vs raw TypeScript type

**Canonical approach:** TBD

---

## 8. Function Declarations 🔴

**Status:** Unresolved

**Current approaches:** Multiple styles
1. **Function declarations**
   - `function serializeError(e: any): string { ... }`
   - Hoisted, named in stack traces
   - Used in `mech_worker.ts` (10+ functions)
2. **Const arrow functions**
   - `const handler = async () => { ... }`
   - Not hoisted, concise syntax
3. **Async function declarations**
   - `async function fetchRecentRequests() { ... }`
   - Used for top-level async operations

**Key problems:**
- Mix of styles within same file
- No guideline on when to use which

**Canonical approach:** TBD

---

## 9. Export Patterns 🔴

**Status:** Unresolved

**Current approaches:** Mixed patterns
1. **Named exports** (dominant)
   - `export { LocalTransactionQueue }`
   - `export function claimRequest() { ... }`
   - `export interface SafePrediction { ... }`
2. **Default exports** (rare, 2 files)
   - `export default MechMarketplace`
   - `export default { ... }` (contract interfaces)
3. **Re-exports**
   - `queue/index.ts` re-exports from sub-modules

**Key problems:**
- Default exports uncommon but present
- No clear pattern for when to use default vs named

**Canonical approach:** TBD

---

## 10. Number Parsing 🔴

**Status:** Unresolved

**Current approaches:** 4 approaches
1. **parseInt()**
   - `parseInt(process.env.CHAIN_ID || '8453', 10)`
   - Used in 10+ files, always with radix parameter
2. **Number()**
   - `Number(value)`
   - Type coercion, can return NaN
3. **parseFloat()**
   - For decimal numbers
4. **Unary +**
   - `+value`
   - Concise but less readable

**Key problems:**
- No clear guideline on which to use
- No consistent NaN handling

**Canonical approach:** TBD

---

## 11. Async/Promise Patterns 🔴

**Status:** Unresolved

**Current approaches:** Mixed usage
1. **async/await** (dominant, modern)
   - Clear, synchronous-looking code
   - Used throughout most of codebase
2. **.then()/.catch() chains** (legacy, 2 files)
   - `mech_worker.ts`, `OlasServiceManager.test.ts`
   - Older pattern, less readable
3. **Promise.all** (multiple files)
   - Concurrent execution, all-or-nothing
4. **Promise.allSettled** (rare)
   - Concurrent execution, continue on partial failure

**Key problems:**
- Mix of `.then()` and `async/await` in same codebase
- No guideline on when to use `Promise.all` vs `Promise.allSettled`

**Canonical approach:** TBD

---

## 12. String Building 🔴

**Status:** Unresolved (Low Priority)

**Current approaches:** Mostly consistent
1. **Template literals** (dominant)
   - `` `Error: ${message}` ``
   - Modern, readable
2. **String concatenation with +** (rare, 6 occurrences)
   - `'0x' + BigInt(value).toString(16)`
   - Used for specific hex conversions
   - `stderr + '\n' + error.message`

**Key problems:**
- Rare use of `+` operator for concatenation
- Mostly fixed with hex ID conversions

**Canonical approach:** TBD

---

## 13. Date/Time Handling 🔴

**Status:** Unresolved

**Current approaches:** Multiple approaches in 10+ files
1. **new Date()**
   - Creates Date object
2. **Date.now()**
   - Returns Unix timestamp (ms)
3. **.getTime()**
   - Converts Date to Unix timestamp
4. **.toISOString()**
   - Formats as ISO 8601 string

**Key problems:**
- No clear guideline on Unix timestamp vs Date object vs ISO string
- Used in 10+ files with different approaches

**Canonical approach:** TBD

---

# Appendices

## Complete Remediation Roadmap

### 🚨 WEEK 1: Critical Security (Rule 1)

**Tasks:**
- [ ] Verify repository privacy status
- [ ] Check if exposed keys control Safes with funds
- [ ] Fix all 7 recovery scripts (remove hardcoded keys)
- [ ] Remove committed .env files from git
- [ ] Remove hardcoded test password

**Effort:** ~4 hours
**Priority:** CRITICAL

---

### 📅 WEEK 2: Validation & Logging (Rules 2 & 3)

**Tasks:**
- [ ] Add balance check to Tenderly test script
- [ ] Add Safe validation to 2 recovery scripts
- [ ] Add logging to 3 artifact storage locations

**Effort:** ~2 hours
**Priority:** Medium

---

### 📅 WEEK 3-4: Git History Cleanup (Rule 1 Follow-up)

**Tasks:**
- [ ] Coordinate with team on git history rewrite
- [ ] Backup repository
- [ ] Run git filter-branch to remove secrets
- [ ] Force push cleaned history
- [ ] Install pre-commit hooks

**Effort:** ~3 hours + coordination time
**Priority:** High (after immediate fixes)

---

### 📅 ONGOING: Orthodoxy Pattern Resolution

**Process:**
1. Select 1-2 unresolved pattern violations per sprint
2. Research canonical approach
3. Document as Default Behavior in spec.md
4. Create example files
5. Migrate existing code
6. Enforce in future code reviews

---

## Summary Statistics

### Rules Violations

| Category | Count |
|----------|-------|
| **Critical Violations** | 19 |
| **Medium Violations** | 5 |
| **Low/Acceptable** | ~15 |
| **Files with Secrets** | 19 |
| **Agent Keys Exposed** | 8 unique keys |
| **Committed .env Files** | 7 |

### Orthodoxy Violations

| Category | Count |
|----------|-------|
| **Unresolved Pattern Violations** | 13 |
| **In Progress** | 0 |
| **Resolved** | 0 |

---

# Security Violations (Objective 3: Minimize Harm)

These violations directly violate the "Minimize Harm" objective and pose security, safety, or privacy risks.

---

## S1. Hardcoded Private Keys 🔴

**Status:** Unresolved (CRITICAL SECURITY ISSUE)

**Severity:** Critical

**Locations:**
1. `scripts/recover-stranded-olas.ts:19`
   - Hardcoded private key: `0x<REDACTED_PRIVATE_KEY_1>`
   - Associated address: `0x879f73A2F355BD1d1bB299D21d9B621Ce6C4c285`
2. `scripts/recover-default-service-olas.ts:15`
   - Same hardcoded private key as above
   - Used for "default-service" agent key recovery
3. `scripts/recover-from-service-safe.ts:18`
   - Same hardcoded private key
4. `scripts/recover-default-service-with-safe-sdk.ts:15`
   - Same hardcoded private key
5. `scripts/archive/recover-service-150-all-olas.ts:21`
   - Different hardcoded key: `0x<REDACTED_PRIVATE_KEY_2>`
6. `scripts/archive/recover-service-150-safe-eth.ts:15`
   - Same service-150 key
7. `scripts/archive/recover-service-150-eth.ts:14`
   - Same service-150 key

**Security Risk:**
- Private keys committed to version control history are permanently compromised
- Anyone with repository access can access these wallets
- Keys remain in git history even if removed from current codebase
- Potential for fund theft or unauthorized transactions

**Impact:**
- Compromised wallet can be drained by anyone with read access to repository
- Transaction signing authority exposed
- Violates "Guard secrets" principle from obj3

**Secure Alternative:**
```typescript
// ✅ Load from environment variable or secure key file
const AGENT_KEY_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
if (!AGENT_KEY_PRIVATE_KEY) {
  throw new Error('AGENT_PRIVATE_KEY environment variable required');
}

// ✅ For local development, load from gitignored file
const keyPath = process.env.KEY_PATH || './keys/agent.key';
const AGENT_KEY_PRIVATE_KEY = await fs.readFile(keyPath, 'utf-8');
```

**Remediation Steps:**
1. Immediately rotate compromised keys if they control any funds
2. Remove hardcoded keys and use environment variables
3. Add `*.key` and `keys/` to `.gitignore`
4. Run `git filter-branch` or similar to remove from history
5. Audit all existing wallets for unauthorized access

---

## S2. Private Key Logging in Scripts 🔴

**Status:** Unresolved (HIGH SECURITY ISSUE)

**Severity:** High

**Location:**
- `scripts/check-agent-balances.ts:111`
  - Logs private keys to console: `console.log('privateKey: '${agent.privateKey}',');`

**Security Risk:**
- Private keys exposed in terminal output
- Keys may be logged to CI/CD systems, terminal history, or log aggregators
- Screenshot or screen recording may capture keys
- Violates "Guard secrets" principle

**Impact:**
- Private keys exposed in logs can be used to steal funds
- Keys may persist in logging systems indefinitely
- Difficult to audit who has seen the keys

**Secure Alternative:**
```typescript
// ✅ Never log private keys
console.log(`    address: '${agent.address}',`);
console.log(`    // Balance: ${agent.olasBalance} OLAS, ${agent.ethBalance} ETH`);
// Do not include privateKey in output

// ✅ If debugging key issues, log only last 4 chars
console.log(`    keyHint: '...${agent.privateKey.slice(-4)}',`);
```

**Remediation Steps:**
1. Remove all private key logging from scripts
2. Add linting rule to prevent logging of sensitive data
3. Review all console.log statements for sensitive data exposure

---

## S3. Stack Trace Exposure in Error Handlers 🔴

**Status:** Unresolved (MEDIUM SECURITY ISSUE)

**Severity:** Medium

**Location:**
- `worker/EoaExecutor.ts:97`
  - Logs error stack traces: `eoaLogger.error({ error: error.message, stack: error.stack })`

**Security Risk:**
- Stack traces expose internal implementation details
- Reveals file paths, function names, and code structure
- May expose sensitive data in variable values
- Aids attackers in understanding system internals
- Violates "Fail securely" principle

**Impact:**
- Information disclosure aids targeted attacks
- May reveal configuration paths, database schemas, or internal APIs
- Reduces security through obscurity

**Current Pattern:**
```typescript
// ❌ Exposes stack trace in logs
eoaLogger.error({
  requestId: request.id,
  error: error.message,
  stack: error.stack  // ← Exposes internal implementation
}, 'EOA transaction execution failed');
```

**Secure Alternative:**
```typescript
// ✅ Log stack traces only in development
eoaLogger.error({
  requestId: request.id,
  error: error.message,
  ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
}, 'EOA transaction execution failed');

// ✅ Or use a different log level for stack traces
eoaLogger.error({ requestId: request.id, error: error.message }, 'EOA transaction execution failed');
eoaLogger.debug({ stack: error.stack }, 'Stack trace'); // Only logged at debug level
```

**Remediation Steps:**
1. Audit all error logging to remove stack traces from production logs
2. Create logging guidelines that separate user-facing errors from debug info
3. Use structured logging with appropriate log levels

---

## S4. Missing Timeout on HTTP Requests 🔴

**Status:** Unresolved (MEDIUM SECURITY ISSUE)

**Severity:** Medium

**Locations:**
- `worker/mech_worker.ts:210,313,501,580` - GraphQL fetch without timeout
- `worker/OlasOperateWrapper.ts:620,629,652,698,762` - API fetch without consistent timeout

**Security Risk:**
- Requests can hang indefinitely
- Resource exhaustion (open connections, memory)
- Denial of Service vulnerability
- Violates "Security by default" principle

**Impact:**
- Worker process may hang waiting for unresponsive services
- Can be exploited to exhaust connection pools
- Unpredictable system behavior under network failures

**Current Pattern:**
```typescript
// ❌ No timeout protection
const res = await fetch(PONDER_GRAPHQL_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
});
```

**Secure Alternative:**
```typescript
// ✅ Always use AbortController with timeout
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

try {
  const res = await fetch(PONDER_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: controller.signal
  });
  // ... handle response
} finally {
  clearTimeout(timeout);
}
```

**Note:** `worker/control_api_client.ts:40` implements this correctly with `fetchWithRetry()` - this pattern should be standardized.

**Remediation Steps:**
1. Create a canonical HTTP client utility that includes timeout by default
2. Migrate all fetch() calls to use the canonical client
3. Add timeout configuration to worker config

---

## S5. Unvalidated File Path Operations 🔴

**Status:** Unresolved (MEDIUM SECURITY ISSUE)

**Severity:** Medium

**Locations:**
- `worker/ServiceStateTracker.ts:58,95` - Reads/writes state file without path validation
- `worker/MechMarketplaceRequester.ts:286` - Reads private key from file path without validation
- `worker/OlasServiceManager.ts:508,520,538,891` - Reads/writes config files without validation

**Security Risk:**
- Path traversal vulnerability (e.g., `../../etc/passwd`)
- Arbitrary file read/write
- Directory traversal attacks
- Violates "Validate all inputs" principle

**Impact:**
- Attacker could read sensitive files outside intended directories
- Attacker could overwrite critical system files
- Data exfiltration or corruption

**Current Pattern:**
```typescript
// ❌ No path validation
const keyContent = await fs.readFile(keyPath, 'utf-8');

// ❌ User-controlled path written directly
await writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
```

**Secure Alternative:**
```typescript
import path from 'path';

// ✅ Validate path is within allowed directory
function validatePath(filePath: string, allowedDir: string): string {
  const resolved = path.resolve(filePath);
  const allowedResolved = path.resolve(allowedDir);

  if (!resolved.startsWith(allowedResolved)) {
    throw new Error(`Path ${filePath} is outside allowed directory ${allowedDir}`);
  }

  return resolved;
}

// Usage
const safePath = validatePath(keyPath, ALLOWED_KEYS_DIR);
const keyContent = await fs.readFile(safePath, 'utf-8');
```

**Remediation Steps:**
1. Create path validation utility
2. Define allowed directories for each file operation type
3. Audit all fs operations and add validation
4. Add unit tests for path traversal attempts

---

## S6. Inconsistent Environment Variable Validation ✅

**Status:** Resolved (PR JINN-234)

**Resolution Date:** 2025-01-17

**What Was Fixed:**
- ✅ Created `config/index.ts` with comprehensive Zod validation for all canonical env vars
- ✅ Migrated `worker/config.ts` to re-export from shared config module
- ✅ Updated `gemini-agent/mcp/tools/shared/env.ts` to re-export config getters
- ✅ Created enforcement script `scripts/check-config-violations.sh` to detect violations
- ✅ Updated code spec documentation with actual implementation paths

**Canonical Approach Established:**
All runtime code now imports typed getters from `config/index.ts`:

```typescript
// ✅ Canonical pattern - Centralized validation
import { getRequiredRpcUrl, getRequiredChainId } from '../config/index.js';

const rpcUrl = getRequiredRpcUrl();    // Validated, fails fast if missing/invalid
const chainId = getRequiredChainId();  // Type-safe, handles legacy aliases
```

**Legacy Alias Handling:**
The config module internally maps legacy env var names:
- `MECHX_CHAIN_RPC`, `MECH_RPC_HTTP_URL`, `BASE_RPC_URL` → `RPC_URL`
- `MECH_WORKER_ADDRESS` → `MECH_ADDRESS`
- `.operate` profile values → `MECH_ADDRESS`, `MECH_SAFE_ADDRESS`, `WORKER_PRIVATE_KEY`

Callers never see these aliases - they only use canonical getters.

**Security Benefits:**
- ✅ All env vars validated with Zod schemas at runtime
- ✅ Fail fast at startup if required config missing or invalid
- ✅ Type safety prevents type confusion vulnerabilities
- ✅ Centralized validation ensures "Security by default"
- ✅ Enforcement script prevents new violations

**Remaining Work:**
- Runtime code migration ongoing (worker, scripts, MCP tools)
- Intentionally deferred areas marked with `TODO(JINN-234)` comments
- One-off scripts and tests allowed to access `process.env` directly per spec

**References:**
- Implementation: `config/index.ts`
- Enforcement: `scripts/check-config-violations.sh`
- Spec: `docs/spec/code-spec/spec.md` "Centralize configuration access"
- Example: `docs/spec/code-spec/examples/db1.md`

---

## Summary Statistics

**Total Security Violations Found:** 6

**By Severity:**
- 🔴 Critical: 1 (Hardcoded private keys)
- 🟠 High: 1 (Private key logging)
- 🟡 Medium: 4 (Stack traces, timeouts, file paths, env validation)
- 🟢 Low: 0

**By Principle Violated:**
- Guard secrets: 2 violations (S1, S2)
- Fail securely: 1 violation (S3)
- Security by default: 1 violation (S4)
- Validate all inputs: 2 violations (S5, S6)

**Positive Security Findings:**
- ✅ No `eval()` or `Function()` usage detected
- ✅ No SQL injection patterns (no direct SQL queries found)
- ✅ Good use of Zod validation in worker config
- ✅ MCP tools use `.safeParse()` appropriately
- ✅ Control API client implements timeout correctly

---

## S7. Committed Kubernetes Secrets with Private Keys 🔴

**Status:** Unresolved (CRITICAL SECURITY ISSUE)

**Severity:** Critical

**Locations:**
1. **6 Kubernetes Secret YAML files** in `service-backups/*/deployment/abci_build_k8s/agent_keys/agent_0_private_key.yaml`:
   - `sc-0e0cdc9c`: `0x<REDACTED_PRIVATE_KEY_1>`
   - `sc-531d7991`: `0x324697dbfdd9eb02150dd263995ec88487d0024da3f7eb641a62ddceb2470ac5`
   - `sc-d11bfd74`: `0xa13e97235487957bbeb8087058fc1f9a4ccec551a42c4d37986da43eb040cba0`
   - `sc-d31271dd`: `0x8a5e9ad780ff2211cacb8a07d14a21dc79e8b3770267f80b7069ae8ebe310c1a`
   - `sc-f93d13c6`: `0x26bb18d62451fdac14d497a2cac3fc3eb6807b40278ee801c4e415a4a4d202b3`
   - `service-164`: (needs verification)

2. `.env.mainnet` - Tracked in git with weak password:
   - `OPERATE_PASSWORD=12345678`
   - Staking contract addresses (non-sensitive)

3. `service-backups/*/deployment/agent_0.env` - 6 files tracked in git
   - Contains service configuration

**Note:** `.env` file with API keys exists in working directory but is **NOT** committed to git (properly gitignored).

**Security Risk:**
- **5 different private keys** committed as Kubernetes Secrets
- Anyone with repository access can access these wallets
- Keys remain in git history permanently
- Kubernetes Secret manifests are meant to be encrypted at rest, not committed to source control
- These appear to be agent validator keys for OLAS services

**Impact:**
- All 5 blockchain wallets are permanently compromised
- Potential fund theft from any of these addresses
- Service compromise if these keys are still in use
- Violates "Guard secrets" principle
- Violates Kubernetes security best practices

**Root Cause:**
- `service-backups/` directory committed to git for backup purposes
- Kubernetes secret manifests included in backups
- No gitignore rule to exclude sensitive files from service-backups

**Secure Alternative:**
```bash
# ✅ Remove from git tracking
git rm --cached .env .env.mainnet
git rm --cached service-backups/*/deployment/agent_0.env

# ✅ Ensure gitignore is comprehensive
echo ".env*" >> .gitignore
echo "service-backups/" >> .gitignore
echo "!.env.template" >> .gitignore

# ✅ Use example files instead
cp .env .env.example
# Remove all sensitive values from .env.example
git add .env.example
```

**Remediation Steps:**
1. **IMMEDIATELY** check if these 5 wallets hold any funds:
   ```bash
   # Check each address for balances
   cast balance <address> --rpc-url <rpc>
   ```
2. **If funds exist**, transfer them to secure wallets IMMEDIATELY
3. Generate 5 new private keys for replacement
4. Update all services to use new keys
5. Remove Kubernetes secret files from git:
   ```bash
   git rm service-backups/*/deployment/abci_build_k8s/agent_keys/*.yaml
   git commit -m "Remove committed Kubernetes secrets"
   ```
6. Purge from git history:
   ```bash
   git filter-repo --path-glob 'service-backups/*/deployment/abci_build_k8s/agent_keys/*.yaml' --invert-paths
   ```
7. Update .gitignore:
   ```
   service-backups/
   *.yaml
   *_private_key*
   ```
8. Use proper secret management:
   - Kubernetes Secrets should be created via kubectl, not committed
   - Use external secrets operator or sealed-secrets
   - Store private keys in vault/secrets manager

---

## S8. Weak Randomness for UUID Generation 🔴

**Status:** Unresolved (LOW SECURITY ISSUE)

**Severity:** Low

**Location:**
- `worker/test-worker.ts:31` - Falls back to `Math.random()` for UUID generation

**Security Risk:**
- `Math.random()` is not cryptographically secure
- Predictable UUIDs could lead to resource enumeration
- Math.random() uses a pseudo-random number generator that can be predicted
- While this is a fallback, it could be triggered if crypto.randomUUID is unavailable

**Current Pattern:**
```typescript
// ❌ Weak fallback
function getRandomUUID() {
  try {
    const crypto = require('crypto');
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  // Fallback simple UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;  // ← Not cryptographically secure
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

**Secure Alternative:**
```typescript
// ✅ Always use crypto
import { randomUUID } from 'crypto';

function getRandomUUID(): string {
  return randomUUID(); // Will throw if not available - fail fast
}

// ✅ Or for Node.js < 14.17
import { randomBytes } from 'crypto';

function getRandomUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
  return bytes.toString('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}
```

**Remediation Steps:**
1. Remove Math.random() fallback
2. Require Node.js version that supports crypto.randomUUID (>= 14.17.0)
3. Fail fast if crypto module unavailable
4. Document minimum Node.js version requirement

---

## S9. Worker ID Uses Weak Randomness 🔴

**Status:** Unresolved (LOW SECURITY ISSUE)

**Severity:** Low

**Location:**
- `worker/worker.ts:61` - Uses `Math.random()` for worker ID generation

**Security Risk:**
- Worker IDs could be predicted
- Potential worker impersonation if IDs are used for authorization
- Not a critical issue if worker IDs are only for identification, not authentication

**Current Pattern:**
```typescript
// ❌ Weak randomness for worker ID
const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
```

**Secure Alternative:**
```typescript
// ✅ Use crypto for random component
import { randomBytes } from 'crypto';

const workerId = `worker-${Date.now()}-${randomBytes(4).toString('hex')}`;
```

**Remediation Steps:**
1. Use `crypto.randomBytes()` for worker ID generation
2. Audit if worker IDs are used for authorization (if so, this becomes HIGH severity)

---

## Summary Statistics (Updated)

**Total Security Violations Found:** 9 (was 6)

**By Severity:**
- 🔴 Critical: 3 (+2) - Hardcoded private keys, Private key logging, Committed .env with API keys
- 🟠 High: 0 (moved to Critical)
- 🟡 Medium: 4 (Stack traces, timeouts, file paths, env validation)
- 🟢 Low: 2 (+2) - Weak randomness (UUID, Worker ID)

**By Principle Violated:**
- Guard secrets: 4 violations (+2) - S1, S2, S7, S8
- Fail securely: 1 violation (S3)
- Security by default: 2 violations (+1) - S4, S9
- Validate all inputs: 2 violations (S5, S6)

**New Findings from Ultra-Meticulous Review:**
- S7: Committed Kubernetes Secret YAML files with 5 private keys (CRITICAL)
- S8: Math.random() fallback in UUID generation (LOW)
- S9: Math.random() in worker ID generation (LOW)
- Updated S1 with 7 total hardcoded key locations (was 2)

**Corrected Finding:**
- `.env` file is NOT committed (user correctly identified this error)
- Real issue: 6 Kubernetes Secret manifests with 5 unique private keys ARE committed

**Positive Security Findings:**
- ✅ No `eval()` or `Function()` usage detected
- ✅ No SQL injection patterns (no direct SQL queries found)
- ✅ Good use of Zod validation in worker config
- ✅ MCP tools use `.safeParse()` appropriately
- ✅ Control API client implements timeout correctly
- ✅ No shell injection (no `shell: true` in spawn/exec)
- ✅ No prototype pollution patterns detected
- ✅ No XSS vulnerabilities (no dangerouslySetInnerHTML or innerHTML)
- ✅ Hardhat test key in Tenderly script is acceptable (clearly documented as test account)

**Immediate Actions Required (Updated Priority):**
1. **CRITICAL**: Check balances and drain 5 compromised wallets from Kubernetes secrets (S7)
2. **CRITICAL**: Rotate 7 hardcoded private keys in scripts (S1)
3. **CRITICAL**: Remove Kubernetes secret YAML files from git and history (S7)
4. **HIGH**: Remove private key logging (S2)
5. **MEDIUM**: Fix weak password in .env.mainnet (S7)
6. Standardize timeout handling across all HTTP requests (S4)
7. Fix weak randomness in UUID and worker ID generation (S8, S9)

**Note on .env file:** The .env file with API keys is NOT committed to git (properly gitignored). However, it should not exist in the working directory on production systems or be shared via other means.

---

# Discoverability Violations (Objective 2: Code for the Next Agent)

These violations make code harder for AI agents to understand, navigate, and maintain.

---

## 14. Code for the Next Agent (obj2) Violations 🟣

**Status:** Objective Violation

**Violations found:** Multiple patterns that violate the "Code for the Next Agent" objective

### 14.1 Multiple Environment Variable Fallback Chains 🟣

**Files affected:** 90+ occurrences across the codebase

**Problem:** Code uses multiple fallback chains making it unclear which env var to set:
- `process.env.RPC_URL || process.env.MECHX_CHAIN_RPC || process.env.MECH_RPC_HTTP_URL`
- `process.env.MECH_ADDRESS || process.env.MECH_WORKER_ADDRESS`
- `process.env.CIVITAI_API_TOKEN || process.env.CIVITAI_API_KEY`

**Examples:**
- `worker/mech_worker.ts:253` - RPC URL has 3 fallbacks
- `worker/mech_worker.ts:616` - Worker address has 2 fallbacks
- `worker/ServiceConfigLoader.ts:55` - Mech address has 4 fallbacks
- `scripts/deliver_request.ts:97` - RPC URL has 3 fallbacks
- `gemini-agent/mcp/tools/shared/civitai.ts:5` - API key has 2 fallbacks

**Impact on AI comprehension:**
- AI cannot determine which env var is canonical
- Unclear which env var should be set in documentation
- Forces AI to check all fallback locations

**Suggested fix:**
- Normalize at application boundary (see obj1.md example)
- Create helper functions like `getRequiredRpcUrl()`, `getMechWorkerAddress()`
- Document canonical env var names in one place

### 14.2 Silent Error Handling 🟣

**Files affected:** 20+ occurrences

**Problem:** Errors are caught and suppressed without logging or indication

**Examples:**
- `worker/OlasServiceManager.test.ts:50` - `.catch(() => false)` - returns false on any error
- `worker/mech_worker.ts:768` - `main().catch(() => process.exit(1))` - silent exit
- `scripts/civitai-read-buzz.ts:57,68,70,76,85,87,103,153,154` - Multiple `.catch(() => false)` and `.catch(() => {})`
- `gemini-agent/mcp/tools/civitai-publish-post.ts:173,176,177,184,187` - Multiple `.catch(() => false)` patterns

**Impact on AI comprehension:**
- Failures are hidden, making debugging impossible
- AI cannot understand what went wrong
- Violates "fail fast, fail explicitly" principle

**Suggested fix:**
- Log errors before suppressing: `.catch((err) => { logger.warn('Operation failed', { error: err }); return false; })`
- Use explicit error handling with structured logging
- Add comments explaining why errors are suppressed if intentional

### 14.3 'any' Type Usage 🟣

**Files affected:** 50+ files

**Problem:** Widespread use of `: any` type annotation loses type safety

**Examples:**
- `worker/validation.ts`
- `worker/worker.ts`
- `worker/mech_worker.ts`
- `worker/queue/LocalTransactionQueue.ts`
- `worker/EoaExecutor.ts:96` - `catch (error: any)`
- And 45+ more files

**Impact on AI comprehension:**
- AI cannot infer types from context
- Loses IDE autocomplete and type checking
- Makes refactoring dangerous

**Suggested fix:**
- Use specific types or union types instead of `any`
- For errors: use `unknown` and type guard: `catch (error: unknown)`
- Create proper type definitions for external APIs

### 14.4 Abbreviated Variable Names 🟣

**Files affected:** 30+ occurrences

**Problem:** Single or two-letter variable names are not greppable and unclear

**Examples:**
- `worker/MechMarketplaceRequester.ts:210-212` - `r`, `s`, `v` (signature components)
- `worker/test-worker.ts:31-32` - `r`, `v` (random values)
- `worker/artifacts.ts:23` - `ch` (character)
- `scripts/test_onchain_e2e.ts:65,72` - `q`, `a` (query, answer)
- `scripts/submit-marketplace-request.ts:212-214` - `r`, `s`, `v` (signature)
- Multiple files use `tx` instead of `transaction`
- Multiple files use `e` instead of `error`

**Impact on AI comprehension:**
- Cannot grep for variable usage
- Unclear intent without reading surrounding code
- Forces AI to maintain context across distance

**Suggested fix:**
- Use descriptive names: `signatureR`, `signatureS`, `signatureV`
- Use `transaction` instead of `tx`
- Use `error` instead of `e`
- Use `character` instead of `ch`
- Use `query` instead of `q`, `answer` instead of `a`

### 14.5 Truthy/Falsy Checks 🟣

**Files affected:** 30+ files

**Problem:** Implicit truthy/falsy checks like `if (!value)` can hide bugs

**Examples:**
- Found in: worker/validation.ts, worker/worker.ts, worker/mech_worker.ts, and 27+ more files

**Impact on AI comprehension:**
- Unclear if checking for null, undefined, false, 0, or ""
- Can cause bugs when `0`, `""`, or `false` are valid values
- Implicit behavior requires understanding JavaScript coercion rules

**Suggested fix:**
- Use explicit checks: `if (value === null)`, `if (value === undefined)`
- Use nullish coalescing: `value ?? defaultValue` (only null/undefined)
- Use optional chaining: `value?.property`
- Document when falsy checks are intentional

### 14.6 Direct process.env Access 🟣

**Files affected:** 100+ occurrences

**Problem:** Direct access to `process.env.*` without validation or centralization

**Examples:**
- `worker/EoaExecutor.ts:50-51` - Direct access to `RPC_URL`, `WORKER_PRIVATE_KEY`
- `worker/worker.ts:305-310` - Direct access to `JINN_*` variables
- Many more throughout the codebase

**Impact on AI comprehension:**
- No single source of truth for env vars
- No validation of required vs optional
- Unclear what happens when env var is missing
- Forces AI to search entire codebase to understand config

**Suggested fix:**
- Use centralized config with Zod validation (like `worker/config.ts`)
- Create helper functions: `getRequiredString()`, `getOptionalString()`
- Fail fast on startup if required env vars are missing
- Document all env vars in one place

**Canonical approach:** TBD

---

## 15. Additional Code for the Next Agent (obj2) Violations 🟣

**Status:** Objective Violation (Second Scan)

**Additional violations found:** More patterns discovered in deeper analysis

### 15.1 Type Assertions (as any) 🟣

**Files affected:** 20+ occurrences

**Problem:** Using `as any` type assertions hides type information and defeats TypeScript's purpose

**Examples:**
- `ponder/src/index.ts:39-40` - `(event.args as any).requestIds`, `(event.args as any).requestDatas`
- `ponder/src/index.ts:45-47` - Multiple `(context as any).db` and `(context as any).entities` casts
- `ponder/src/index.ts:87-88` - `(content as any).sourceJobDefinitionId`, `(content as any).additionalContext`
- `ponder/src/index.ts:343,366` - `(req as any)` casts
- `worker/worker.ts:282` - `(context.result?.telemetry?.raw as any)?.partialOutput`

**Impact on AI comprehension:**
- AI cannot understand actual types being used
- Type safety completely bypassed
- Forces AI to guess structure from usage

**Suggested fix:**
- Create proper type definitions for event.args
- Define proper interfaces for context.db and context.entities
- Use proper type guards instead of casting

### 15.2 Magic Numbers Without Explanation 🟣

**Files affected:** 15+ occurrences

**Problem:** Hardcoded numbers without explanation of what they represent

**Examples:**
- `8453` - Base mainnet chain ID (appears 15+ times)
- `42069` - Ponder GraphQL port (appears 15+ times)
- `4001` - Control API port
- `5242880` - 5MB max stdout size
- `102400` - 100KB max chunk size

**Impact on AI comprehension:**
- AI cannot understand significance of numbers
- Cannot grep for "Base chain ID" or "Ponder port"
- Changing values requires finding all occurrences

**Suggested fix:**
- Define named constants: `const BASE_CHAIN_ID = 8453`
- Add comments explaining significance
- Centralize in config file

### 15.3 Deep Optional Chaining 🟣

**Files affected:** 20+ occurrences

**Problem:** Chains of 4+ optional property accesses are hard to understand and debug

**Examples:**
- `worker/worker.ts:290` - `context.result?.telemetry?.raw?.stderrWarnings`
- `worker/OlasServiceManager.ts:184-185` - `deployResult.serviceData?.chain_configs?.base?.chain_data?.token`
- `worker/OlasServiceManager.ts:185` - `deployResult.serviceData?.chain_configs?.base?.chain_data?.user_params?.staking_program_id`
- `scripts/test-on-tenderly.ts:211` - `config.chain_configs?.base?.ledger_config?.rpc`
- `frontend/explorer/src/components/job-report-detail-view.tsx:84` - `candidates?.[0]?.content?.parts?.[0]?.text`

**Impact on AI comprehension:**
- Difficult to track which property might be undefined
- Hard to debug when value is unexpectedly null
- Unclear what the actual expected structure is

**Suggested fix:**
- Define proper types for nested objects
- Create intermediate variables for clarity
- Consider using helper functions to unwrap nested data

### 15.4 Console Logging Instead of Structured Logging 🟣

**Files affected:** 40+ files

**Problem:** Using `console.log/warn/error` instead of structured logging

**Examples:**
- Found in 40+ files including: worker/worker.ts, scripts/*.ts, etc.
- Violation already documented in VIOLATIONS.md section #3

**Impact on AI comprehension:**
- Unstructured logs are hard to parse
- No context about where logs came from
- Cannot filter or search logs effectively

**Suggested fix:**
- Use pino-based loggers (workerLogger, agentLogger, etc.)
- Add structured context: `logger.info({ requestId, jobId }, 'Processing request')`
- Phase out all console.* usage

### 15.5 Missing Return Type Annotations 🟣

**Files affected:** 30+ functions

**Problem:** Many functions lack explicit return type annotations

**Examples:**
- `worker/worker.ts:1338` - `async function main() {` - no return type
- `worker/logger.ts:9` - `function createLogger() {` - no return type
- `frontend/explorer/src/lib/utils.ts:5` - `export function cn(...inputs: ClassValue[]) {` - no return type
- And 25+ more `main()` functions across scripts

**Impact on AI comprehension:**
- AI cannot understand what function returns without reading implementation
- Makes refactoring dangerous (return type might change silently)
- Harder to generate correct calling code

**Suggested fix:**
- Add explicit return types: `async function main(): Promise<void> {`
- Use `: void`, `: Promise<void>`, or specific return types
- Enable TypeScript strict mode to enforce this

### 15.6 Chained Array/Property Access Without Type Safety 🟣

**Files affected:** 15+ occurrences

**Problem:** Accessing array indices directly without type checking

**Examples:**
- `worker/mech_worker.ts:217` - `json?.data?.requests?.items || []` then accessed with `[0]`
- `scripts/test-get-details.ts:13` - `json?.data?.requests?.items?.[0]`
- `frontend/explorer/src/components/job-report-detail-view.tsx:84,97,131` - Multiple `?.[0]` accesses

**Impact on AI comprehension:**
- Unclear if array might be empty
- Silent failures if index doesn't exist
- Forces AI to trace array population

**Suggested fix:**
- Check array length before accessing: `if (items.length > 0)`
- Use optional chaining: `items?.[0]`
- Add type guards and explicit null checks

### 15.7 Abbreviated Generic Names 🟣

**Files affected:** Multiple occurrences

**Problem:** Function/variable names that are too generic or abbreviated

**Examples:**
- `scripts/test_onchain_e2e.ts:18` - `function gql()` - not clear this is "graphql query"
- `frontend/explorer/src/lib/utils.ts:5` - `function cn()` - not clear this is "classnames"

**Impact on AI comprehension:**
- Cannot grep for "classnames" or "graphql"
- Unclear purpose without reading implementation
- Violates "self-documenting" principle

**Suggested fix:**
- Use full names: `executeGraphqlQuery()` instead of `gql()`
- Use `classNames()` or `combineClassNames()` instead of `cn()`
- Avoid cryptic abbreviations

**Canonical approach:** TBD

---

## References

- [AUDIT_PLAN.md](./AUDIT_PLAN.md) - Original audit methodology
- [spec.md](./spec.md) - Code Spec with Objectives, Rules, and Default Behaviors
