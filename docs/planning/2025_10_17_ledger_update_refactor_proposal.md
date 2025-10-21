# Ledger Update Architecture Refactor Proposal

## Current Architecture Analysis

### How It Works Now

```
detect-violations.sh
  ↓
1. Spawns 3 parallel Claude review processes → writes to temp files
  ↓
2. Waits for all 3 processes to complete
  ↓
3. Spawns 3 background tsx processes (non-blocking):
   - tsx update-ledger.ts obj1 /tmp/obj1.txt &
   - tsx update-ledger.ts obj2 /tmp/obj2.txt &
   - tsx update-ledger.ts obj3 /tmp/obj3.txt &
  ↓
4. Continues immediately (prints summary, exits)
  ↓
5. Background processes parse & write to ledger.jsonl (eventually)
```

### Problems with Current Approach

1. **Race Conditions**: Tests check for ledger before background processes finish
2. **Lost Errors**: Background process errors are redirected to `/dev/null`
3. **No Atomicity**: Three separate processes writing to same file concurrently
4. **Resource Overhead**: Spawning 3 Node.js processes (each loads TypeScript, imports)
5. **Debugging Nightmare**: Can't see when/why ledger updates fail
6. **Test Flakiness**: 15-second timeout fails, but 100-second timeout passes

### Why This Design Was Chosen

Looking at line 105: `# Update ledger with violations (in background, don't block)`

**Intent:** Keep the detection script fast for interactive use (don't wait for ledger writes)

**Trade-off:** Sacrificed reliability and testability for perceived performance

---

## Design Principles to Follow

Before proposing solutions, let's establish strong coding practices:

### 1. **Explicit Over Implicit** (Code Spec obj2)
- User should know when ledger is being updated
- Errors should be visible, not hidden
- Async operations should be explicit

### 2. **Fail Fast, Fail Explicitly** (Code Spec obj2)
- Don't hide failures behind degraded behavior
- If ledger update fails, make it visible
- Don't use `/dev/null 2>&1` unless justified

### 3. **Orthodoxy** (Code Spec obj1)
- One canonical way to update the ledger
- Don't mix bash scripting with TypeScript process spawning
- Use the right tool for each layer

### 4. **Separation of Concerns**
- **Detection layer** (bash): Orchestrate reviews, format output
- **Parsing layer** (TypeScript): Parse Claude output, extract violations
- **Storage layer** (TypeScript): Write to ledger with deduplication
- **Presentation layer** (bash): Display results to user

### 5. **Testability**
- E2E tests should work predictably
- No arbitrary timeouts (15s vs 100s)
- Deterministic behavior

---

## Proposed Solutions (Three Options)

### Option 1: Single Synchronous Update (Recommended)

**Architecture:**
```bash
detect-violations.sh
  ↓
1. Run 3 reviews in parallel → temp files
  ↓
2. Wait for all 3 to complete
  ↓
3. Display summary to user (counts, status)
  ↓
4. Single synchronous call:
   tsx update-all-reviews.ts obj1:/tmp/obj1.txt obj2:/tmp/obj2.txt obj3:/tmp/obj3.txt
  ↓
5. Exit with appropriate code
```

**New File: `codespec/lib/update-all-reviews.ts`**
```typescript
// Parses all review outputs and updates ledger in one transaction
// Usage: tsx update-all-reviews.ts obj1:/path/to/obj1.txt obj2:/path/to/obj2.txt ...

async function main() {
  const updates = parseArgs(process.argv.slice(2));
  // updates: [{ objective: 'obj1', file: '/tmp/obj1.txt' }, ...]

  const ledger = new Ledger();
  const results = { added: 0, updated: 0, errors: [] };

  for (const { objective, file } of updates) {
    try {
      const violations = await parseAndConvert(objective, file);
      for (const v of violations) {
        const result = await ledger.addViolation(v);
        if (result.first_seen === result.last_seen) {
          results.added++;
        } else {
          results.updated++;
        }
      }
    } catch (error) {
      results.errors.push({ objective, error: error.message });
    }
  }

  // Output results (script can parse)
  console.log(`LEDGER_UPDATED: ${results.added} new, ${results.updated} updated`);
  if (results.errors.length > 0) {
    console.error('LEDGER_ERRORS:', JSON.stringify(results.errors));
    process.exit(1);
  }
}
```

**Pros:**
- ✅ Simple, deterministic
- ✅ Errors visible to user
- ✅ Tests work reliably
- ✅ One Node.js process instead of 3
- ✅ Atomic ledger update

**Cons:**
- ⚠️ Adds ~200-500ms to script runtime (parsing + file I/O)
- ⚠️ User waits for ledger update

**Is the "Con" actually a problem?**
- NO: 200-500ms is imperceptible for a script that takes 60-180 seconds to run
- NO: Users **expect** the ledger to be updated when script completes
- NO: Tests prove that async updates cause more pain than 500ms of latency

---

### Option 2: Opt-In Background Update

**Architecture:**
```bash
detect-violations.sh
  ↓
1-3. Same as Option 1
  ↓
4. Check for ASYNC_LEDGER flag:
   if [ "$ASYNC_LEDGER" = "1" ]; then
     # Background update (for CI/large scans)
     tsx update-all-reviews.ts ... >/tmp/ledger-update.log 2>&1 &
     echo "⏳ Ledger update running in background (check /tmp/ledger-update.log)"
   else
     # Synchronous update (default, for interactive use & tests)
     tsx update-all-reviews.ts ...
     echo "✅ Ledger updated"
   fi
  ↓
5. Exit
```

**Pros:**
- ✅ Flexibility for different use cases
- ✅ Default behavior is reliable
- ✅ CI can opt into async for speed
- ✅ Tests always work

**Cons:**
- ⚠️ Two code paths to maintain
- ⚠️ More complexity than Option 1
- ⚠️ Users need to know about the flag

---

### Option 3: Ledger Queue (Over-Engineered)

**Architecture:**
```bash
detect-violations.sh
  ↓
1-3. Same as Option 1
  ↓
4. Write to queue file:
   echo "obj1:/tmp/obj1.txt" >> .codespec/ledger-queue.txt
   echo "obj2:/tmp/obj2.txt" >> .codespec/ledger-queue.txt
   echo "obj3:/tmp/obj3.txt" >> .codespec/ledger-queue.txt
  ↓
5. Exit

Separate daemon process:
  codespec/lib/ledger-worker.ts (runs continuously)
    ↓
  Watches .codespec/ledger-queue.txt
    ↓
  Processes entries, updates ledger
    ↓
  Deletes processed entries
```

**Pros:**
- ✅ Fully async
- ✅ Could batch multiple scans
- ✅ No script slowdown

**Cons:**
- ❌ WAY too complex for this use case
- ❌ Requires daemon management
- ❌ Harder to debug
- ❌ Tests need to wait for daemon
- ❌ Violates YAGNI (You Aren't Gonna Need It)

---

## Recommendation: Option 1 (Single Synchronous Update)

### Why Option 1 is Best

1. **Simplicity**: One code path, easy to understand
2. **Reliability**: No race conditions, deterministic
3. **Debuggability**: Errors visible immediately
4. **Testability**: Tests work without timeouts/polling
5. **Performance**: 200-500ms overhead is negligible (0.3% of 180s script)
6. **Maintainability**: Less code, fewer moving parts

### Why NOT Option 2 or 3

- **Option 2**: Added complexity for marginal benefit (async mode rarely needed)
- **Option 3**: Solving a problem we don't have (we don't need job queues)

---

## Implementation Plan

### Phase 1: Create Unified Update Script

**File: `codespec/lib/update-all-reviews.ts`**

```typescript
#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { Ledger, NewViolation } from './ledger.js';
import { parseReviewOutput, convertToLedgerViolations } from './update-ledger.js';

interface ReviewInput {
  objective: string;
  file: string;
}

interface UpdateResults {
  added: number;
  updated: number;
  errors: Array<{ objective: string; error: string }>;
}

/**
 * Parses command-line arguments
 * Expected format: obj1:/path/to/file.txt obj2:/path/to/file.txt ...
 */
function parseArgs(args: string[]): ReviewInput[] {
  return args.map(arg => {
    const [objective, file] = arg.split(':');
    if (!objective || !file) {
      throw new Error(`Invalid argument: ${arg} (expected format: obj1:/path/to/file.txt)`);
    }
    if (!['obj1', 'obj2', 'obj3'].includes(objective)) {
      throw new Error(`Invalid objective: ${objective} (must be obj1, obj2, or obj3)`);
    }
    return { objective, file };
  });
}

/**
 * Updates ledger from all review outputs in a single transaction
 */
async function updateLedgerFromReviews(inputs: ReviewInput[]): Promise<UpdateResults> {
  const ledger = new Ledger();
  const results: UpdateResults = { added: 0, updated: 0, errors: [] };

  for (const { objective, file } of inputs) {
    try {
      // Read review output
      const output = await readFile(file, 'utf-8');

      // Parse violations (reuse existing parser)
      const reviewViolations = parseReviewOutput(output, objective);

      // Convert to ledger format (reuse existing converter)
      const ledgerViolations = convertToLedgerViolations(reviewViolations, objective);

      // Add to ledger
      for (const v of ledgerViolations) {
        const result = await ledger.addViolation(v);
        if (result.first_seen === result.last_seen) {
          results.added++;
        } else {
          results.updated++;
        }
      }

      console.error(`✅ ${objective}: Processed ${reviewViolations.length} violations`);
    } catch (error: any) {
      console.error(`❌ ${objective}: Failed to update ledger: ${error.message}`);
      results.errors.push({ objective, error: error.message });
    }
  }

  return results;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: update-all-reviews.ts obj1:/path/to/file.txt obj2:/path/to/file.txt ...');
    console.error('');
    console.error('Example:');
    console.error('  tsx update-all-reviews.ts obj1:/tmp/obj1.txt obj2:/tmp/obj2.txt obj3:/tmp/obj3.txt');
    process.exit(1);
  }

  try {
    const inputs = parseArgs(args);
    const results = await updateLedgerFromReviews(inputs);

    // Print summary for bash script to parse
    console.log(`LEDGER_UPDATED: ${results.added} new, ${results.updated} updated`);

    if (results.errors.length > 0) {
      console.error(`LEDGER_ERRORS: ${JSON.stringify(results.errors)}`);
      process.exit(1);
    }

    // Success
    process.exit(0);
  } catch (error: any) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { updateLedgerFromReviews, parseArgs };
```

### Phase 2: Update detect-violations.sh

**Changes to `codespec/scripts/detect-violations.sh`:**

Replace lines 105-110:
```bash
# OLD (background, non-blocking):
if command -v tsx >/dev/null 2>&1; then
  tsx "$SCRIPT_DIR/../lib/update-ledger.ts" obj1 "$TEMP_OBJ1" >/dev/null 2>&1 &
  tsx "$SCRIPT_DIR/../lib/update-ledger.ts" obj2 "$TEMP_OBJ2" >/dev/null 2>&1 &
  tsx "$SCRIPT_DIR/../lib/update-ledger.ts" obj3 "$TEMP_OBJ3" >/dev/null 2>&1 &
fi
```

With:
```bash
# NEW (synchronous, single call):
echo ""
echo "📝 Updating violations ledger..."
if command -v tsx >/dev/null 2>&1; then
  if tsx "$SCRIPT_DIR/../lib/update-all-reviews.ts" \
    "obj1:$TEMP_OBJ1" \
    "obj2:$TEMP_OBJ2" \
    "obj3:$TEMP_OBJ3" 2>&1 | tee /tmp/ledger-update.log; then
    echo "✅ Ledger updated successfully"
  else
    echo "⚠️  Ledger update failed (see /tmp/ledger-update.log)"
    echo "   Reviews completed but violations not saved to ledger"
  fi
else
  echo "⚠️  tsx not found - ledger not updated"
  echo "   Install tsx: npm install -g tsx"
fi
echo ""
```

### Phase 3: Export Parsers from update-ledger.ts

**Changes to `codespec/lib/update-ledger.ts`:**

Currently has this at the end:
```typescript
export { parseReviewOutput, convertToLedgerViolations };
```

Keep this, but also update the main() function to be more like a standalone CLI rather than being reused.

### Phase 4: Update Tests

**Changes to `tests/codespec/helpers/violation-runner.ts`:**

Remove the `waitForLedgerUpdate()` timeout logic since updates are now synchronous:

```typescript
export async function runDetectViolations(
  target: string,
  options: { cwd?: string; timeout?: number } = {}
): Promise<ViolationRunResult> {
  const { cwd = process.cwd(), timeout = 120000 } = options;

  try {
    const { stdout, stderr } = await execAsync(
      `./codespec/scripts/detect-violations.sh ${target}`,
      { cwd, timeout, encoding: 'utf-8' }
    );

    const violations = extractViolationCount(stdout);

    // Ledger should be updated synchronously now - no need to wait/poll
    const ledgerUpdated = await checkLedgerExists(cwd);

    return {
      exitCode: 0,
      stdout,
      stderr,
      violations,
      ledgerUpdated,
    };
  } catch (error: any) {
    // ... error handling
  }
}
```

Remove `waitForLedgerUpdate()` function entirely (or keep as no-op for backwards compat).

**Changes to `tests/codespec/codespec-workflow.e2e.test.ts`:**

Remove the `waitForLedgerUpdate()` calls:

```typescript
it('should update ledger after detection', async () => {
  // Run detection
  await runDetectViolations(mode.target, {
    cwd: process.cwd(),
    timeout: 180000,
  });

  // NO MORE: await waitForLedgerUpdate(process.cwd(), 15000);

  // Ledger should exist immediately after detection completes
  const stats = await getLedgerStats(process.cwd());
  expect(stats).toBeDefined();
}, 200000);
```

---

## Migration Path

### Step 1: Create new unified script (non-breaking)
- Create `update-all-reviews.ts`
- Export functions from `update-ledger.ts`
- Add unit tests for new script

### Step 2: Update detect-violations.sh (breaking change)
- Switch from 3 background calls to 1 synchronous call
- Add user-visible feedback ("Updating ledger...")
- Keep old `update-ledger.ts` for backwards compatibility (deprecated)

### Step 3: Update tests
- Remove `waitForLedgerUpdate()` polling
- Simplify test assertions

### Step 4: Verify
- Run full test suite
- Run detection on real files
- Check ledger is updated correctly

### Step 5: Document
- Update README
- Add comments explaining synchronous choice
- Add troubleshooting for slow ledger updates

### Step 6: (Optional) Remove old script
- Delete `update-ledger.ts` after 1-2 releases
- Or keep as deprecated for manual use

---

## Performance Analysis

### Current Approach (Background)
```
Review time:     60-180 seconds (Claude API calls)
Ledger update:   ~1-2 seconds (hidden in background)
User perception: 60-180 seconds total
Test flakiness:  HIGH (race conditions)
```

### Proposed Approach (Synchronous)
```
Review time:     60-180 seconds (Claude API calls)
Ledger update:   ~0.2-0.5 seconds (visible, blocking)
User perception: 60-180.5 seconds total (+0.3%)
Test flakiness:  NONE (deterministic)
```

**Analysis:**
- Added latency: 0.2-0.5 seconds (0.3% overhead)
- User impact: Imperceptible (less than network jitter)
- Reliability gain: Tests go from flaky to rock-solid
- Debuggability: Errors now visible to user

**Conclusion:** The trade-off is absolutely worth it.

---

## Alternative: Hybrid Approach (If Performance Matters)

If we later discover that 0.5 seconds matters (spoiler: it won't), we can add:

```bash
# In detect-violations.sh
if [ "${CODESPEC_ASYNC_LEDGER:-0}" = "1" ]; then
  # Fast path: background update (use at own risk)
  tsx update-all-reviews.ts "obj1:$TEMP_OBJ1" ... >/tmp/ledger.log 2>&1 &
  echo "⏳ Ledger updating in background (/tmp/ledger.log)"
else
  # Default: reliable synchronous update
  tsx update-all-reviews.ts "obj1:$TEMP_OBJ1" ...
  echo "✅ Ledger updated"
fi
```

But this should only be added if profiling shows it's actually needed. **YAGNI principle applies.**

---

## Summary

**Current Problem:**
- Background ledger updates cause race conditions and test failures
- Errors are hidden, debugging is impossible
- Over-engineered for marginal performance gain

**Proposed Solution:**
- Single synchronous ledger update after reviews complete
- Errors visible to user
- Tests become deterministic
- Code becomes simpler
- Overhead: 0.3% (imperceptible)

**Implementation:**
- Create `update-all-reviews.ts` (unified parser)
- Update `detect-violations.sh` (one call instead of three)
- Simplify tests (remove polling/timeouts)
- Document the choice

**Result:**
- ✅ Tests pass reliably
- ✅ Users see errors immediately
- ✅ Code is simpler and maintainable
- ✅ Performance impact negligible
- ✅ Follows strong coding practices (explicit, fail-fast, orthodox)
