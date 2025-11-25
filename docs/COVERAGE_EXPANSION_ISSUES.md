# Memory System Test Coverage Expansion - Linear Issues

## Overview
This document organizes coverage gaps into Linear issues for discussion. The goal is to expand `tests-next/system/memory-system.system.test.ts` to cover all critical requirements without creating new test files.

**Current State:** 71 assertions, 17 requirements  
**Target State:** ~130-135 assertions, 27 requirements  
**Test Flow:** Parent → Child → Grandchild (3-level hierarchy)

---

## Priority 1: Critical Status & Metadata Validation

### Issue 1: Work Protocol Status Validation ⭐ HIGH VALUE
**Category:** Easy Addition (Just Add Assertions)  
**Effort:** ~5-7 assertions  
**Requirements:** WPQ-001, WPQ-002

**What's Missing:**
- Child job dispatches grandchild → should be `DELEGATING`
- Grandchild completes → should be `COMPLETED`
- Status inference logic validation (no expectation that the child flips to `COMPLETED` without a second execution)

**Where to Add:**
- After child delivery (SECTION 4): Validate child status is `DELEGATING`
- After grandchild delivery (SECTION 8): Validate grandchild status is `COMPLETED`

**Implementation Notes:**
```typescript
// After child delivery in SECTION 4
const childDeliveryJson = await fetchJsonWithRetry(childDeliveryUrl);
expect(childDeliveryJson.finalStatus.status).toBe('DELEGATING'); // Child dispatched grandchild
expect(childDeliveryJson.finalStatus.message).toContain('Dispatched'); // Has dispatch message

// After grandchild delivery in SECTION 8
const grandchildDeliveryJson = await fetchJsonWithRetry(grandchildDeliveryUrl);
expect(grandchildDeliveryJson.finalStatus.status).toBe('COMPLETED'); // Grandchild completed
expect(grandchildDeliveryJson.finalStatus.message).toBeTruthy();

```

**Discussion Points:**
- Should we validate status in delivery IPFS content or via Ponder query?
- Document explicitly that child remains `DELEGATING` until it runs again.

---

### Issue 2: Request Metadata Completeness ⭐ HIGH VALUE
**Category:** Easy Addition  
**Effort:** ~9 assertions (3 per request: parent, child, grandchild)  
**Requirements:** IDQ-001, LCQ-001

**What's Missing:**
- Validate all request metadata fields are present and correctly formatted
- IPFS hash format, transaction hash format, block numbers, addresses

**Where to Add:**
- After `waitForRequestIndexed` in SECTIONS 1, 2, 7

**Implementation:**
```typescript
// After each waitForRequestIndexed call
const request = await getRequest(gqlUrl, requestId);
expect(request.ipfsHash).toMatch(/^[0-9a-f]{64}$/); // Valid hex hash
expect(request.transactionHash).toMatch(/^0x[0-9a-f]{64}$/); // Valid tx hash
expect(request.blockNumber).toBeGreaterThan(0);
expect(request.blockTimestamp).toBeGreaterThan(0);
expect(request.mech).toMatch(/^0x[0-9a-fA-F]{40}$/); // Valid address
expect(request.requester).toMatch(/^0x[0-9a-fA-F]{40}$/);
```

---

### Issue 3: Delivery Metadata Validation ⭐ MEDIUM VALUE
**Category:** Easy Addition  
**Effort:** ~6 assertions per delivery (child + grandchild = 12 total)  
**Requirements:** LCQ-005, PER-002

**What's Missing:**
- Validate delivery structure matches request
- Delivery timestamps are after request timestamps
- IPFS hash and transaction hash formats

**Where to Add:**
- After `waitForDelivery` in SECTIONS 4 and 8

**Implementation:**
```typescript
// After waitForDelivery
expect(delivery.requestId).toBe(requestId); // Matches request
expect(delivery.ipfsHash).toMatch(/^[0-9a-f]{64}$/);
expect(delivery.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
expect(delivery.blockTimestamp).toBeGreaterThan(request.blockTimestamp); // Delivered after request
expect(delivery.blockNumber).toBeGreaterThan(request.blockNumber);
```

---

### Issue 4: SITUATION Embedding Validation ⭐ HIGH VALUE
**Category:** Easy Addition  
**Effort:** ~7 assertions  
**Requirements:** MEM-004, MEM-005

**What's Missing:**
- Validate embedding model, dimensions, vector structure
- Vector values are numeric and in valid range

**Where to Add:**
- SECTION 5 (child SITUATION) and SECTION 10 (grandchild SITUATION)

**Implementation:**
```typescript
const embedding = situation.embedding;
expect(embedding.model).toBe('text-embedding-3-small'); // Correct model
expect(embedding.dim).toBe(256); // Correct dimensions
expect(Array.isArray(embedding.vector)).toBe(true);
expect(embedding.vector.length).toBe(256);
expect(embedding.vector.every(v => typeof v === 'number')).toBe(true);
expect(embedding.vector.some(v => v !== 0)).toBe(true); // Not all zeros
expect(embedding.vector[0]).toBeGreaterThanOrEqual(-1);
expect(embedding.vector[0]).toBeLessThanOrEqual(1);
```

**Note:** Some of this is already validated in SECTION 10. Review for completeness.

---

## Priority 2: Execution & Work Protocol

### Issue 5: Execution Trace Tool Validation ⭐ HIGH VALUE
**Category:** Small Changes Needed  
**Effort:** ~12-15 assertions  
**Requirements:** EXQ-007, OBS-001

**What's Missing:**
- Validate execution trace structure and chronology
- Tool calls, timestamps, args, results

**Where to Add:**
- SECTION 10 (grandchild SITUATION validation) - partially exists, needs expansion
- SECTION 5 (child SITUATION) - add trace validation

**Current State:**
- SECTION 10 already validates trace exists and has basic structure (lines 649-660)
- Needs: Chronology validation, result structure validation

**Implementation:**
```typescript
// Expand existing trace validation in SECTION 10
const trace = situation.execution.trace;
expect(Array.isArray(trace)).toBe(true);
expect(trace.length).toBeGreaterThan(0);

// Validate trace entry structure
const firstEntry = trace[0];
expect(firstEntry.tool).toBeTruthy();
expect(firstEntry.timestamp).toBeTruthy();
expect(firstEntry.args).toBeDefined();
expect(firstEntry.result_summary).toBeDefined();

// Validate trace chronology
for (let i = 1; i < trace.length; i++) {
  expect(trace[i].timestamp >= trace[i-1].timestamp).toBe(true);
}

// Validate expected tools were called
const toolNames = trace.map(t => t.tool);
expect(toolNames).toContain('create_artifact'); // Grandchild should call this
```

---

### Issue 6: Parent Auto-Dispatch Validation ⭐⭐ VERY HIGH VALUE
**Category:** Small Changes Needed  
**Effort:** ~10-12 assertions  
**Requirements:** WPQ-001, WPQ-002, WPQ-003

**What's Missing:**
- Validate the grandchild's parent (the original child job) auto-dispatches after the grandchild completes
- Auto-dispatch timing and metadata

**Where to Add:**
- After grandchild delivery completes (after SECTION 8)
- New SECTION 8B: Child Auto-Dispatch Validation

**Implementation:**
```typescript
// After grandchild delivers (SECTION 8)
console.log('\n[TEST] SECTION 8B: Validating child auto-dispatch...');

// Wait for Work Protocol to process grandchild completion
await new Promise(resolve => setTimeout(resolve, 5000)); // Give Work Protocol time

// Query for child auto-dispatch (child is the grandchild's parent)
const childAutoDispatchQuery = `
  query($jobDefId:String!) {
    requests(
      where: { jobDefinitionId: $jobDefId },
      orderBy: "blockTimestamp",
      orderDirection: "desc",
      limit: 2
    ) {
      items { 
        id 
        jobDefinitionId 
        sourceRequestId 
        sourceJobDefinitionId 
        blockTimestamp 
        additionalContext
      }
    }
  }
`;

const response = await fetch(gqlUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ 
    query: childAutoDispatchQuery, 
    variables: { jobDefId: childJob.jobDefId }
  })
});

const autoDispatchData = await response.json();
const requests = autoDispatchData.data.requests.items;

// Find auto-dispatched request (has additionalContext with message)
const autoDispatchRequest = requests.find((r: any) => {
  if (!r.additionalContext) return false;
  // Check if additionalContext has Work Protocol message
  try {
    const ctx = typeof r.additionalContext === 'string' 
      ? JSON.parse(r.additionalContext) 
      : r.additionalContext;
    return ctx.message && typeof ctx.message === 'object';
  } catch {
    return false;
  }
});

expect(autoDispatchRequest).toBeTruthy(); // Parent was auto-dispatched
expect(autoDispatchRequest.jobDefinitionId).toBe(childJob.jobDefId);
expect(autoDispatchRequest.blockTimestamp).toBeGreaterThan(grandchildDelivery.blockTimestamp);

// Validate Work Protocol message structure
const ctx = typeof autoDispatchRequest.additionalContext === 'string'
  ? JSON.parse(autoDispatchRequest.additionalContext)
  : autoDispatchRequest.additionalContext;
expect(ctx.message).toBeDefined();
expect(ctx.message.to).toBe(childJob.jobDefId);
expect(ctx.message.from).toBe(grandchildRequest.id);
expect(ctx.message.content).toContain('COMPLETED');

console.log('[TEST] ✅ Child auto-dispatch validated');
```

**Discussion Points:**
- Should we also validate the root parent auto-dispatch when its child completes?
- What's the expected timing for auto-dispatch? (5s wait sufficient?)
- Should we validate the Work Protocol message format more strictly?

---

## Priority 3: Content & Timing Validation

### Issue 7: Artifact Indexing Timing ⭐ MEDIUM VALUE
**Category:** Easy Addition  
**Effort:** ~6 assertions  
**Requirements:** PER-001, OBS-003

**What's Missing:**
- Validate artifacts are indexed with proper timestamps
- Indexing delay is reasonable

**Where to Add:**
- After fetching artifacts from Ponder (SECTIONS 5, 6, 9)

**Implementation:**
```typescript
// After fetching artifact from Ponder
expect(artifact.blockTimestamp).toBeGreaterThan(0); // Indexed with block time
expect(artifact.createdAt || artifact.blockTimestamp).toBeTruthy(); // Has timestamp

// Validate indexing delay is reasonable (within 60s)
const indexDelay = Date.now() - (artifact.createdAt || artifact.blockTimestamp * 1000);
expect(indexDelay).toBeLessThan(60000); // Indexed within 60s
```

---

### Issue 8: IPFS Content Validation ⭐ MEDIUM VALUE
**Category:** Small Changes Needed  
**Effort:** ~5-8 assertions  
**Requirements:** ARQ-006, PER-003

**What's Missing:**
- Validate CID matches content hash
- Content integrity verification

**Where to Add:**
- After fetching artifact content from IPFS

**Implementation:**
```typescript
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as dagCbor from '@ipld/dag-cbor';

// After fetching artifact content
const artifactContent = JSON.stringify(situationJson);
const bytes = dagCbor.encode(situationJson);
const hash = await sha256.digest(bytes);
const computedCid = CID.create(1, 0x71, hash); // dag-cbor codec

expect(computedCid.toString()).toBe(situationArtifact.cid);
```

**Discussion Points:**
- Is CID validation critical for this test, or is it better in a separate integration test?
- Do we need to validate all artifacts or just SITUATION?

---

### Issue 9: Git Branch Remote Tracking ⭐ MEDIUM VALUE
**Category:** Small Changes Needed  
**Effort:** ~4-6 assertions  
**Requirements:** GWQ-003

**What's Missing:**
- Validate branches track remote correctly
- Remote tracking configuration

**Where to Add:**
- Git metadata sections (1A, 4A, 8A)

**Implementation:**
```typescript
// After validating branch exists locally
const trackingBranch = execSync(`git config branch.${branchName}.remote`, {
  cwd: gitFixture.repoPath,
  encoding: 'utf-8'
}).trim();

expect(trackingBranch).toBe('origin'); // Tracks origin

const remoteBranch = execSync(`git config branch.${branchName}.merge`, {
  cwd: gitFixture.repoPath,
  encoding: 'utf-8'
}).trim();

expect(remoteBranch).toBe(`refs/heads/${branchName}`);
```

**Discussion Points:**
- Is remote tracking validation necessary if we're using local git fixtures?
- Should this be conditional based on test environment?

---

## NOT RECOMMENDED FOR THIS TEST

### Issue 10: Git Commits and Pushes (GWQ-003) ⚠️ NOT FEASIBLE
**Reason:** Current test doesn't enable `write_file` tool, agent doesn't modify files  
**Recommendation:** Keep in separate `tests/git/worker-git-lineage.test.ts`

### Issue 11: Pull Request Creation (GWQ-004) ⚠️ NOT FEASIBLE
**Reason:** Requires GitHub token, network I/O, longer test time  
**Recommendation:** Keep in separate git-lineage test

### Issue 12: Multiple Worker Concurrent Execution ⚠️ NOT FEASIBLE
**Reason:** Requires worker orchestration, race condition handling  
**Recommendation:** Create separate concurrency test

### Issue 13: Error Handling and Failure Scenarios ⚠️ PARTIALLY FEASIBLE
**Reason:** Requires intentionally failing jobs, timeout scenarios  
**Recommendation:** Keep happy path in system test, add failure test separately

---

## Implementation Phases

### Phase 1: Status & Metadata (Week 1)
- Issue 1: Work Protocol Status Validation
- Issue 2: Request Metadata Completeness
- Issue 3: Delivery Metadata Validation

**Estimated:** +20-25 assertions

### Phase 2: Content & Embeddings (Week 1-2)
- Issue 4: SITUATION Embedding Validation
- Issue 7: Artifact Indexing Timing

**Estimated:** +13 assertions

### Phase 3: Execution & Traces (Week 2)
- Issue 5: Execution Trace Tool Validation

**Estimated:** +12-15 assertions

### Phase 4: Work Protocol (Week 2-3)
- Issue 6: Parent Auto-Dispatch Validation ⭐ HIGHEST VALUE

**Estimated:** +10-12 assertions

### Phase 5: Git & Content Integrity (Week 3)
- Issue 8: IPFS Content Validation
- Issue 9: Git Branch Remote Tracking

**Estimated:** +9-14 assertions

**Total Estimated:** +64-79 assertions (bringing total to 135-150 assertions)

---

## Discussion Questions

1. **Status Validation (Issue 1):**
   - Should we validate child status transition from DELEGATING → COMPLETED after grandchild delivers?
   - Do we need to re-fetch child delivery or can we check via Ponder?

2. **Parent Auto-Dispatch (Issue 6):**
   - Should we also validate child re-dispatch after grandchild completes?
   - What's the expected timing? Is 5s wait sufficient?
   - Should we validate Work Protocol message format more strictly?

3. **IPFS Content Validation (Issue 8):**
   - Is CID validation critical for this test, or better in separate integration test?
   - Do we need to validate all artifacts or just SITUATION?

4. **Git Remote Tracking (Issue 9):**
   - Is remote tracking validation necessary for local git fixtures?
   - Should this be conditional based on test environment?

5. **Test Runtime:**
   - Current test: ~168s
   - With additions: Estimated +10-20s (still under 240s timeout)
   - Is this acceptable?

---

## Requirements Coverage After Expansion

**New Requirements Covered:**
- WPQ-001: Work Protocol status inference
- WPQ-002: Work Protocol auto-dispatch
- WPQ-003: Work Protocol message format
- PER-001: Persistence timing
- PER-002: Delivery persistence
- PER-003: Content integrity
- OBS-001: Execution observability
- OBS-003: Temporal metadata
- LCQ-001: Request structure
- LCQ-005: Delivery structure
- IDQ-001: Identity metadata

**Total Coverage:** 27 requirements (up from 17)  
**Coverage Improvement:** +59% requirements

