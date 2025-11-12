# Testing Standards Proposal

**Last Updated**: November 7, 2025
**Purpose**: Comprehensive testing standards for integration into spec.md
**Status**: DRAFT - Awaiting team review and approval

---

## Overview

This document proposes testing standards for the Jinn/Gemini codebase. These standards will be integrated into spec.md and enforced via CI/CD.

**Goals**:
1. Ensure all new code is adequately tested
2. Prevent regressions via automated coverage gates
3. Establish clear testing expectations for contributors
4. Maintain healthy test pyramid (70% unit, 20% integration, 10% system)

---

## 1. Test Pyramid Requirements

### Target Distribution

```
         System (10%)         ← Slow E2E tests (30s-600s)
       /            \
   Integration (20%)          ← Boundary tests (100ms-5s)
  /                  \
Unit (70%)                    ← Pure logic tests (<100ms)
```

### Pyramid Health Metrics

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| Unit Test % | 36% | 70% | Q2 2026 |
| Integration Test % | 44% | 20% | Q2 2026 |
| System Test % | 20% | 10% | Q2 2026 |
| Total Coverage | ~25% | 70% | Q2 2026 |

**Enforcement**: CI checks pyramid ratio quarterly, warns if ratio deviates >10% from target.

---

## 2. Test Categories & Definitions

### 2.1 Unit Tests

**Definition**: Tests of pure functions with all I/O mocked

**Characteristics**:
- ✅ Fast (<100ms per test)
- ✅ Isolated (no network, file system, database)
- ✅ Deterministic (no flakiness)
- ✅ Mocked dependencies (via `vi.mock()`)

**Location**: `tests-next/unit/**/*.test.ts`

**Naming**: `<module-name>.test.ts` (e.g., `payload.test.ts`)

**Example**:
```typescript
// tests-next/unit/worker/delivery/payload.test.ts
import { describe, it, expect, vi } from 'vitest';
import { constructPayload } from '../../../../worker/delivery/payload.js';

vi.mock('../../../../worker/metadata/fetchIpfsMetadata.js', () => ({
  fetchIpfsMetadata: vi.fn(),
}));

describe('constructPayload', () => {
  it('constructs valid IPFS metadata from telemetry', () => {
    const payload = constructPayload({
      requestId: '0xabc',
      output: 'Task completed',
      artifacts: [],
      telemetry: { toolCalls: [] },
    });

    expect(payload.requestId).toBe('0xabc');
    expect(payload.output).toBe('Task completed');
    expect(payload.artifacts).toEqual([]);
  });
});
```

**Coverage Target**: 80% line coverage for pure business logic

---

### 2.2 Integration Tests

**Definition**: Tests of component boundaries with real file system/git but mocked external services

**Characteristics**:
- ✅ Moderate speed (100ms-5s per test)
- ✅ Real file system, git repos OK
- ✅ Mocked external services (IPFS, RPC, databases)
- ✅ Use `tests-next/helpers/` for setup

**Location**: `tests-next/integration/**/*.integration.test.ts`

**Naming**: `<component-name>.integration.test.ts`

**Example**:
```typescript
// tests-next/integration/git/auto-commit.integration.test.ts
import { describe, it, expect } from 'vitest';
import { withGitFixture } from '../../helpers/git-fixture.js';
import { autoCommitIfNeeded } from '../../../worker/git/autoCommit.js';

describe('Git Auto-Commit Integration', () => {
  it('commits changes when working tree dirty', async () => {
    await withGitFixture(async (gitDir) => {
      // Create uncommitted changes
      fs.writeFileSync(path.join(gitDir, 'test.txt'), 'content');

      const result = await autoCommitIfNeeded({
        repoPath: gitDir,
        message: 'Test commit',
      });

      expect(result.committed).toBe(true);
      expect(result.commitHash).toMatch(/^[a-f0-9]{40}$/);
    });
  });
});
```

**Coverage Target**: 60% line coverage for integration boundaries

---

### 2.3 System Tests

**Definition**: Full end-to-end tests with real infrastructure

**Characteristics**:
- ⚠️ Slow (30s-600s per test)
- ✅ Real blockchain (Tenderly VNets)
- ✅ Real Ponder + Control API
- ✅ Real Worker execution
- ✅ Use `withProcessHarness()` for orchestration

**Location**: `tests-next/system/**/*.system.test.ts`

**Naming**: `<scenario-name>.system.test.ts` (e.g., `worker-basic-execution.system.test.ts`)

**Example**:
```typescript
// tests-next/system/worker-basic-execution.system.test.ts
import { describe, it, expect } from 'vitest';
import { withSuiteEnv } from '../helpers/suite-env.js';
import { withTestEnv } from '../helpers/env-controller.js';
import { withTenderlyVNet } from '../helpers/tenderly-runner.js';
import { withProcessHarness } from '../helpers/process-harness.js';

describe('Worker: Basic Execution', () => {
  it('completes job and delivers result', async () => {
    await withSuiteEnv(async () => {
      await withTestEnv(async () => {
        await withTenderlyVNet(async (tenderlyCtx) => {
          await withProcessHarness(
            { rpcUrl: tenderlyCtx.rpcUrl, startWorker: true },
            async (ctx) => {
              // Create job
              const { requestId } = await createTestJob({ /* ... */ });

              // Wait for delivery
              const delivery = await waitForDelivery(ctx.gqlUrl, requestId);

              expect(delivery.delivered).toBe(true);
            }
          );
        });
      });
    });
  }, 600_000); // 10min timeout
});
```

**Coverage Target**: 100% of critical user flows

---

## 3. Coverage Requirements

### 3.1 Minimum Coverage by Priority

| Module Priority | Minimum Line Coverage | Branch Coverage |
|----------------|---------------------|-----------------|
| P0 (Critical) | 80% | 70% |
| P1 (High) | 60% | 50% |
| P2 (Medium) | 50% | 40% |
| P3 (Low) | 30% | 20% |

**Module Priority Assignment**:
- **P0**: Delivery system, transaction queue, contract interactions
- **P1**: Execution, orchestration, status management, MCP core tools
- **P2**: Recognition/reflection, utilities
- **P3**: Integrations (Civitai, Zora), logging

### 3.2 PR Coverage Gates

**All PRs must meet these requirements**:

1. **New Code**: All new functions/modules must have tests
2. **Coverage Delta**: Cannot drop overall coverage >5% without justification
3. **Critical Paths**: P0 modules cannot drop below 80% coverage
4. **Test Types**: New features must include appropriate test level(s):
   - Pure logic → Unit test required
   - Component integration → Integration test required
   - New user flow → System test required

**CI Enforcement**:
```yaml
# .github/workflows/test.yml
- name: Check Coverage
  run: |
    yarn test:coverage
    yarn coverage:check --threshold 70 --critical-threshold 80
```

**Exemptions**: Coverage drops >5% require:
- Justification in PR description
- Approval from 2 maintainers
- GitHub issue tracking coverage restoration

---

## 4. Test Organization

### 4.1 Directory Structure

```
tests-next/
├── unit/                      # Unit tests
│   ├── worker/               # Worker modules
│   │   ├── delivery/         # Mirrors source structure
│   │   │   ├── payload.test.ts
│   │   │   ├── report.test.ts
│   │   │   └── validation.test.ts
│   │   ├── git/
│   │   │   ├── branch.test.ts
│   │   │   └── workingTree.test.ts
│   │   └── ...
│   ├── gemini-agent/         # MCP tools
│   │   └── mcp/
│   │       └── tools/
│   │           ├── dispatch_new_job.test.ts
│   │           └── create_artifact.test.ts
│   └── codespec/             # CodeSpec system
│       └── ledger.test.ts
├── integration/              # Integration tests
│   ├── git/                  # Group by domain
│   │   ├── auto-commit.integration.test.ts
│   │   └── lineage.integration.test.ts
│   ├── mcp/
│   │   └── stdout-clean.integration.test.ts
│   └── recognition/
│       └── situation-workflow.integration.test.ts
├── system/                   # System tests
│   ├── marketplace/          # Group by feature area
│   │   ├── dispatch.system.test.ts
│   │   └── lineage.system.test.ts
│   └── worker/
│       └── basic-execution.system.test.ts
└── helpers/                  # Shared test utilities
    ├── env-controller.ts
    ├── tenderly-runner.ts
    ├── process-harness.ts
    └── ...
```

**Principle**: Unit tests mirror source structure, integration/system tests group by feature.

---

## 5. Naming Conventions

### 5.1 Test File Naming

| Test Type | Pattern | Example |
|-----------|---------|---------|
| Unit | `<module>.test.ts` | `payload.test.ts` |
| Integration | `<component>.integration.test.ts` | `auto-commit.integration.test.ts` |
| System | `<scenario>.system.test.ts` | `worker-basic-execution.system.test.ts` |

### 5.2 Test Suite Naming

```typescript
// Unit test - name matches module
describe('constructPayload', () => { /* ... */ });

// Integration test - includes component name
describe('Git Auto-Commit Integration', () => { /* ... */ });

// System test - describes user scenario
describe('Worker: Basic Execution', () => { /* ... */ });
```

### 5.3 Test Case Naming

**Pattern**: `it('[action] [condition] [expected result]')`

**Examples**:
```typescript
// Unit
it('constructs valid payload from telemetry');
it('rejects empty request ID with error');
it('truncates oversized output to 10KB');

// Integration
it('commits changes when working tree dirty');
it('skips commit when no changes present');

// System
it('completes job and delivers result to marketplace');
it('retries failed delivery with exponential backoff');
```

---

## 6. Test Quality Standards

### 6.1 Test Independence

**Rule**: Tests must be independently runnable and not depend on execution order

❌ **Bad**:
```typescript
let userId: string;

it('creates user', async () => {
  userId = await createUser();
  expect(userId).toBeTruthy();
});

it('updates user', async () => {
  // Depends on previous test!
  await updateUser(userId, { name: 'New Name' });
});
```

✅ **Good**:
```typescript
it('creates user', async () => {
  const userId = await createUser();
  expect(userId).toBeTruthy();
});

it('updates user', async () => {
  const userId = await createUser(); // Independent setup
  await updateUser(userId, { name: 'New Name' });
  expect(await getUser(userId)).toMatchObject({ name: 'New Name' });
});
```

### 6.2 Test Clarity

**Rule**: Test names and assertions should clearly communicate intent

❌ **Bad**:
```typescript
it('works', () => {
  const result = doSomething();
  expect(result).toBeTruthy();
});
```

✅ **Good**:
```typescript
it('validates email format and rejects invalid addresses', () => {
  expect(validateEmail('invalid')).toBe(false);
  expect(validateEmail('valid@example.com')).toBe(true);
});
```

### 6.3 Test Performance

| Test Type | Max Duration | Target Duration |
|-----------|--------------|-----------------|
| Unit | 100ms | 10ms |
| Integration | 5s | 500ms |
| System | 600s | 60s |

**Enforcement**: Tests that exceed max duration fail CI with timeout error.

### 6.4 Test Flakiness

**Tolerance**: 0% - Flaky tests must be fixed or disabled immediately

**Detection**: CI tracks test pass rate over 100 runs. Tests with <99% pass rate flagged as flaky.

**Remediation**:
1. Investigate root cause (timing issues, race conditions, etc.)
2. Fix or add retry logic if appropriate
3. If unfixable, mark as `it.skip()` and create GitHub issue

---

## 7. PR Requirements

### 7.1 New Features

**Required**:
- ✅ Unit tests for all new pure functions
- ✅ Integration tests for new component interactions
- ✅ System test for new user-facing flows (if applicable)
- ✅ Coverage meets minimum threshold for module priority

**Optional**:
- Documentation updates (if complex feature)
- Performance benchmarks (if performance-critical)

### 7.2 Bug Fixes

**Required**:
- ✅ Regression test that reproduces bug
- ✅ Test passes after fix
- ✅ No coverage drop

**Best Practice**: Add regression test BEFORE fix to verify it catches the bug.

### 7.3 Refactoring

**Required**:
- ✅ All existing tests still pass
- ✅ No coverage drop
- ✅ Test updates if public API changed

**Exemption**: If refactoring ADDS tests, coverage drop temporarily acceptable if restoration plan documented.

---

## 8. CI/CD Integration

### 8.1 Test Execution

**PR Checks**:
```yaml
# Run on every PR
- Unit Tests (fast, always run)
- Integration Tests (parallel, run on affected modules)
- System Tests (slowest, run on merge queue)
```

**Merge Queue**:
- All test suites must pass
- Coverage gates must pass
- No flaky tests in recent history

### 8.2 Coverage Reporting

**Tools**:
- `vitest` for test execution
- `c8` / `istanbul` for coverage collection
- `codecov` for coverage tracking and PR comments

**PR Comments**:
```
Coverage: 72.3% (+2.1%) ✅
- Unit: 75.2% (+3.4%)
- Integration: 68.4% (+1.2%)
- System: 100% (no change)

Critical Modules:
- worker/delivery: 82.1% ✅
- worker/queue: 85.3% ✅
```

### 8.3 Failure Handling

**Test Failure**: PR blocked, must fix before merge

**Coverage Drop >5%**: PR blocked unless:
- Justification provided
- Restoration plan documented
- Approved by 2 maintainers

**Flaky Test**: PR passes but warning issued. Flaky test must be fixed within 1 week.

---

## 9. Test Maintenance

### 9.1 Quarterly Health Checks

**Schedule**: End of each quarter (Q1, Q2, Q3, Q4)

**Activities**:
1. **Review test pyramid ratio** - Adjust if >10% off target
2. **Audit flaky tests** - Fix or disable tests with <99% pass rate
3. **Review coverage** - Identify uncovered P0/P1 modules
4. **Update standards** - Refine based on learnings

### 9.2 Test Hygiene

**Weekly**:
- Monitor flaky test dashboard
- Address test failures within 24h
- Review slow tests (>50% of max duration)

**Monthly**:
- Review test performance metrics
- Identify and optimize slow tests
- Update test helpers if patterns emerge

---

## 10. Helper Function Guidelines

### 10.1 Test Helpers

**Location**: `tests-next/helpers/`

**Purpose**: Reusable test setup, fixtures, and utilities

**Standards**:
- ✅ Well-documented (TSDoc comments)
- ✅ Type-safe (full TypeScript types)
- ✅ Composable (can be used together)
- ✅ Error-safe (cleanup on failure)

**Example**:
```typescript
/**
 * Creates isolated git repository for testing.
 * Automatically cleans up on test completion.
 *
 * @example
 * ```typescript
 * await withGitFixture(async (gitDir) => {
 *   // Test logic using gitDir
 * });
 * ```
 */
export async function withGitFixture(
  callback: (gitDir: string) => Promise<void>
): Promise<void> {
  const tempDir = await createTempGitRepo();
  try {
    await callback(tempDir);
  } finally {
    await cleanup(tempDir);
  }
}
```

### 10.2 Assertion Helpers

**Custom Matchers**: Extend Vitest with domain-specific assertions

**Example**:
```typescript
// tests-next/helpers/assertions.ts
export function toBeValidIpfsHash(received: string) {
  const pass = /^Qm[a-zA-Z0-9]{44}$/.test(received);
  return {
    pass,
    message: () => `Expected ${received} to be valid IPFS hash`,
  };
}

// Usage
expect(cid).toBeValidIpfsHash();
```

---

## 11. Integration into spec.md

**Proposed spec.md Section**:

```markdown
## Testing Standards

All code contributions must include appropriate tests following the testing pyramid.

### Test Pyramid
- 70% Unit Tests (fast, isolated, mocked I/O)
- 20% Integration Tests (moderate, real FS/git, mocked services)
- 10% System Tests (slow, full E2E, real infrastructure)

### Coverage Requirements
- **P0 Modules** (delivery, queue): 80% minimum
- **P1 Modules** (execution, orchestration): 60% minimum
- **P2 Modules** (utilities): 50% minimum

### PR Requirements
- New features: Unit + integration tests required
- Bug fixes: Regression test required
- Coverage cannot drop >5% without justification

### Test Organization
- Unit tests: `tests-next/unit/**/*.test.ts` (mirror source structure)
- Integration tests: `tests-next/integration/**/*.integration.test.ts` (group by domain)
- System tests: `tests-next/system/**/*.system.test.ts` (group by scenario)

For detailed testing standards, see [Testing Standards](docs/testing/testing-standards-proposal.md).
```

---

## 12. Rollout Plan

### Phase 1: Immediate (Week 1)
- ✅ Document testing standards (this document)
- ✅ Set up coverage tracking in CI
- ✅ Add coverage gates to PR checks

### Phase 2: Short Term (Month 1)
- ✅ Integrate standards into spec.md
- ✅ Train team on new standards
- ✅ Begin enforcing PR requirements

### Phase 3: Medium Term (Quarter 1)
- ✅ Achieve 50% overall coverage
- ✅ Migrate all legacy tests to new framework
- ✅ Quarterly health check process established

### Phase 4: Long Term (Quarter 2)
- ✅ Achieve 70% overall coverage
- ✅ Achieve target test pyramid ratio (70/20/10)
- ✅ Zero flaky tests

---

## 13. Open Questions for Team Review

1. **Coverage Thresholds**: Are 70% overall / 80% P0 targets reasonable?
2. **PR Blocking**: Should we block PRs for coverage drops >5%, or just warn?
3. **Test Pyramid Enforcement**: Should CI fail if pyramid ratio deviates >10%?
4. **Flaky Test Tolerance**: 0% or 1% acceptable?
5. **System Test Frequency**: Run on every PR or just merge queue?

---

## 14. Approval & Next Steps

**Review Process**:
1. Team reviews this proposal
2. Discuss open questions in team meeting
3. Refine based on feedback
4. Get final approval from tech lead
5. Integrate into spec.md
6. Begin rollout

**Approval Needed From**:
- [ ] Tech Lead
- [ ] Senior Engineers (2+)
- [ ] QA Lead (if applicable)

**Timeline**: Target approval by [DATE]

---

**Status**: DRAFT - Ready for team review
