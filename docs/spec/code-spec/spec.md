# Code Spec

## Overview

This specification defines desired code patterns for an AI-generated codebase. It ensures consistency across multiple AI sessions and makes the codebase maintainable by both humans and future AI agents.

**Inspired by:** [OpenAI Model Spec](https://github.com/openai/model_spec)

**Philosophy:** In an AI-generated codebase, different prompts naturally produce different solutions to the same problem. Without explicit guidance, patterns drift and the codebase becomes inconsistent. This spec provides that guidance.

## How to Read This Spec

This specification is organized into three tiers:

1. **Objectives** - High-level goals and guiding philosophies
2. **Rules** - Hard constraints that must never be violated
3. **Default Behaviors** - Standard patterns for common operations

### What is a "clause"?

A **clause** is a single item within the spec—one objective, one rule, or one default behavior. For example:
- "Follow the principle of orthodoxy" is an objective clause
- "Never commit secrets" is a rule clause
- "Use environment variables for configuration" could be a default behavior clause (when we add one)

Each clause has:
- A **title** - What it addresses
- A **description** - What it means and why it matters
- **Footnote references** - Links to example files (e.g., `[^db01]`)

### Example files

The `examples/` directory contains test cases that demonstrate what correct and incorrect code looks like:
- **Naming:** `obj1.md`, `obj2.md` (objectives), `r1.md`, `r2.md` (rules), `db1.md`, `db2.md` (default behaviors)
- **Content:** Each file shows either correct implementation or a specific violation
- **Purpose:** These teach both humans and AI agents what the clause means in practice

---

## Objectives

Objectives are high-level goals that provide directional guidance for all code. They inform the rules and default behaviors.

### Follow the principle of orthodoxy[^obj1]

> "There should be one—and preferably only one—obvious way to do it."
> — PEP 20 (The Zen of Python), Principle #13

**The principle:** For any given problem domain in this codebase, there must be one canonical approach. All code must follow the established approach, even if alternative approaches exist.

**Why this matters for AI-generated code:**
- Different prompts → different solutions
- Different AI models → different idioms
- Different sessions → stylistic drift
- Result: Codebase becomes unlearnable

**Application:** When you encounter code that solves the same problem in multiple ways, this violates orthodoxy. Identify the canonical approach, document it as a default behavior, and migrate all code to follow it.

[^obj1]: See examples/obj1.md

### Code for the next agent[^obj2]

> "Explicit is better than implicit."
> — PEP 20 (The Zen of Python), Principle #2

**The principle:** AI agents are the primary developers and maintainers of this codebase. Every line of code should be written with the next AI session in mind—optimized for machine discoverability, readability, and comprehension.

**Why this matters for AI-generated code:**
- AI agents learn by reading existing code
- AI agents navigate codebases by pattern matching and search
- Implicit behavior, clever tricks, and hidden context confuse AI
- The ratio of code-reading to code-writing is extreme in AI development

**What this means in practice:**
- **Explicit over implicit:** Make intentions clear through naming, types, and structure
- **Discoverable patterns:** Use consistent, greppable patterns that AI can find
- **Self-documenting:** Code should explain what it does without requiring external context
- **Minimal cleverness:** Favor clarity over conciseness when they conflict
- **Fail fast, fail explicitly:** Prefer throwing errors over silent fallbacks. If something is broken, make it visible—don't hide failures behind degraded behavior

**Application:** When writing code, ask: "Will the next AI agent understand this?" If it requires human intuition, domain knowledge not in the codebase, or clever inference, it violates this objective.

[^obj2]: See examples/obj2.md

### Minimize harm[^obj3]

> "First, do no harm."
> — Adapted from the Hippocratic Oath

**The principle:** Prevent code from causing harm to users, systems, or data. Security, safety, and privacy are not optional features—they are foundational requirements.

**Why this matters for AI-generated code:**
- AI agents may not understand all security implications
- AI agents learn from examples that might include insecure patterns
- Security vulnerabilities compound across AI sessions
- A single compromised secret or SQL injection can cascade through the system

**What this means in practice:**
- **Security by default:** Choose secure patterns over convenient ones
- **Validate all inputs:** External data is untrusted until proven safe
- **Fail securely:** When errors occur, fail closed (deny access) not open
- **Guard secrets:** Never commit credentials, API keys, or sensitive data to the repository
- **Principle of least privilege:** Grant minimum necessary permissions

**Application:** When generating code, ask: "Could this be exploited? Could this leak data? Could this cause damage?" If the answer is possibly yes, redesign before implementing.

**Relationship to Rules:** This objective informs future Rules like "Never commit secrets" and "Always validate external input." The objective is the "why," Rules are the "must never."

[^obj3]: See examples/obj3.md

---

## Rules

Rules are hard constraints that must never be violated. Unlike objectives (which are directional) and default behaviors (which can have rare exceptions), rules are absolute.

### Never commit secrets to the repository[^r1]

**The rule:** Secrets (private keys, API keys, passwords, tokens) must never be committed to git. All sensitive configuration must be loaded from environment variables or secure secret management systems.

**Why this matters for AI-generated code:**
- Secrets in git history are permanently exposed
- A single leaked agent key can drain all funds from its Safe
- AI may generate example code with placeholder secrets
- Git history is immutable—deletion doesn't remove committed secrets

**What qualifies as a secret:**
- **Private keys**: Agent keys, Safe signers, wallet mnemonics
- **API keys**: Gemini, Supabase, RPC providers, service credentials
- **Passwords**: OLAS middleware password, database credentials
- **Tokens**: Authentication tokens, session tokens

**Application:** All secrets must be read from environment variables at runtime. Use `.env.example` with placeholder values for documentation. Never hardcode credentials in source code, comments, or documentation.

[^r1]: See examples/r1.md

### Enforce automated secret guardrails[^r4]

**The rule:** Every automated git workflow—workers, bots, CI jobs, and test harnesses—must invoke the canonical secret guard before staging, committing, or pushing code. The guard enforces a shared denylist for secret-bearing paths (e.g., `.operate/`, `.operate-test/`, `*private_key*`, wallet exports) and fails closed if any appear in the staged tree.

**Why this matters for AI-generated code:**
- Automation is trusted to keep history clean; if the guard is skipped, leaked credentials become permanent.
- AI agents reuse commit helpers; one insecure path propagates to every call site.
- Preventing secret commits at the source is cheaper than rotating wallets and remediating public leaks.

**Application:** Any flow that runs `git commit` or `git push` must call the guard immediately beforehand. If the guard flags a violation, surface the error and abort rather than attempting a partial commit or silent skip.

[^r4]: See examples/r4.md

### Always validate on-chain state before financial operations[^r2]

**The rule:** Before submitting any transaction that transfers tokens, executes a Safe transaction, or modifies on-chain state, verify that the operation is valid by querying current on-chain state.

**Why this matters for AI-generated code:**
- Blockchain transactions are immutable and irreversible
- Failed transactions waste gas fees (non-recoverable)
- Invalid operations can lock funds in contracts
- Network delays can make local state stale

**What requires preflight validation:**
- **Mech deliveries**: Check if request is still undelivered
- **Token transfers**: Verify sender has sufficient balance
- **Safe transactions**: Validate Safe configuration and ownership
- **Staking operations**: Confirm service state and eligibility

**Application:** Use `view`/`pure` functions (zero gas cost) to query on-chain state before constructing transactions. If preflight check fails, log the reason and skip the operation. Best-effort: if RPC is unavailable, log warning and allow operation to proceed.

[^r2]: See examples/r2.md

### Never silently discard errors in financial or blockchain contexts[^r3]

**The rule:** Errors in financial operations, blockchain transactions, or on-chain job processing must be logged with full context and propagated to the caller. Empty catch blocks and silent fallbacks are prohibited.

**Why this matters for AI-generated code:**
- Silent failures hide critical issues (lost funds, stuck jobs)
- Debugging is impossible without error logs
- AI may generate convenient but unsafe error handling patterns
- Incident response requires clear audit trails

**What contexts require explicit error handling:**
- **Token transfers**: OLAS, ETH transfers
- **Safe transactions**: Deliveries, mech operations
- **RPC calls**: Blockchain state queries
- **IPFS uploads**: Content storage for on-chain deliveries
- **Database writes**: On-chain job tracking

**Application:** Always log errors with structured context before handling. Use `logger.error()` with operation details, parameters, and error message. Re-throw errors unless there's a legitimate degraded mode (must be documented). Non-critical background tasks (telemetry) may degrade gracefully with warning logs.

[^r3]: See examples/r3.md

---

## Default Behaviors

Default behaviors define the standard way to handle common operations. They are consistent with objectives and rules. In rare cases, deviations may be justified (e.g., third-party library constraints), but must be explicitly documented.

### Centralize configuration access

**Behavior:** All runtime code reads configuration through a single, validated config module. That module loads environment variables once, validates them (e.g., with Zod or another schema library), and exports explicit getters (`getRequiredRpcUrl()`, `getOptionalChainId()`, etc.). Runtime code never touches `process.env` directly.

**Why this matters:**
- Orthodoxy (obj1): There is one obvious way to access configuration, so readers don’t have to understand multiple fallback chains or hidden defaults.
- Code for the next agent (obj2): Named getters make configuration discoverable by search; validation errors explain what is missing.
- Minimize harm (obj3): Schema validation catches missing or malformed secrets before deployment; secrets stay out of logs and source.

**How to follow it:**
1. Use the shared configuration module (`config/index.ts`) to access environment variables via its exported helpers (e.g., `getRequiredRpcUrl()`, `getSupabaseUrl()`).
2. When you introduce a new variable, extend the schema inside `config/index.ts` so validation and documentation stay centralized.
3. Keep any legacy aliases or fallbacks inside the config module; callers always consume the canonical getter.
4. Never access `process.env` directly in runtime code—import the helper you need from `config/index.ts` (or its domain-specific re-export).

**Allowed exceptions:**
- One-off scripts or tests may read `process.env` directly if they document the deviation and do not introduce new canonical configuration.
- Transitional compatibility layers may live only inside the config module (e.g., honoring legacy env names) so that callers still see a single getter.

**Examples:**
- ✅ `const rpcUrl = getRequiredRpcUrl();`
- ❌ `const rpcUrl = process.env.RPC_URL || process.env.MECHX_CHAIN_RPC;`

### Keep ephemeral secret fixtures out of tracked repos[^db7]

**Behavior:** Tests, fixtures, and local tooling write generated wallets or other secrets only to the canonical temp secret workspace (outside git worktrees) and clean it up afterward. Directories such as `.operate-test/` must never be created beneath a tracked repository.

**Why this matters:**
- Automation that stages "everything" cannot accidentally pick up secret fixtures.
- IDEs and commit UIs never surface sensitive files inside tracked trees.
- Reusable patterns keep every suite aligned with the rule without rediscovering it.

**How to follow it:**
1. Allocate the secret workspace via the shared helper so the path lands under the OS temp directory (or another untracked location).
2. Inject that absolute path through environment variables (e.g., `OPERATE_HOME`) instead of deriving it from `process.cwd()`.
3. Use the helper's cleanup to remove residual secrets once the test completes.

**Examples:** See examples/db7.md.

[^db7]: See examples/db7.md

### Canonical HTTP client with timeout & retry

**Behavior:** All runtime HTTP calls (REST, GraphQL, IPFS, RPC over HTTP) use a shared client module that enforces timeouts, structured errors, and retry/backoff semantics. Callers import typed helpers (e.g., `postJson`, `graphQLRequest`) instead of calling `fetch` directly.

**Why this matters:**
- Orthodoxy (obj1): One obvious pattern for HTTP keeps headers, logging, and error handling consistent.
- Code for the next agent (obj2): Named helpers are discoverable; behavior lives in one module.
- Minimize harm (obj3): Timeouts prevent hangs, retries smooth transient failures, and centralized logging prevents secrets from leaking.

**How to follow it:**
1. Use the shared HTTP client in `http/client.ts` (`postJson`, `getJson`, `graphQLRequest`, etc.), which wraps `fetch` with a 10 s default timeout and exponential backoff (3 attempts).
2. Let the client handle structured logging and normalized errors; surface additional context through the helper’s options (`requestId`, `headers`, `timeoutMs`, `retries`).
3. When you need new behavior (e.g., streaming), extend `http/client.ts` so the canonical protections apply everywhere instead of re-implementing them.
4. Avoid calling `fetch` directly in runtime code. If you must, document the exception and add the missing capability to the shared client promptly.

**Allowed exceptions:**
- Browser-only code may keep using browser APIs if it provides equivalent safeguards.
- Unit tests and simple mocks can call `fetch` directly when running in controlled environments and the deviation is documented.
- One-off scripts may bypass the client if they explain why (e.g., interactive streaming) and do not introduce new canonical patterns.

**Examples:**
- ✅ `const data = await graphQLRequest<ClaimResponse>({ query, variables, context: { requestId } });`
- ❌ `const res = await fetch(url, { method: 'POST', body: JSON.stringify(query) }); // no timeout`

### Validate staged content before auto-commit[^db8]

**Behavior:** Auto-commit or auto-push helpers must call the canonical staged-tree validator immediately before committing, ensuring the denylist is enforced uniformly. If forbidden paths are staged, the helper throws a descriptive error and halts the workflow.

**Why this matters:**
- Auto-commit paths bypass human review; the guard is the only line of defense.
- Centralized checks keep denylist updates synchronized across workers, bots, and scripts.
- Failures clearly identify the offending path, making mitigation straightforward.

**How to follow it:**
1. Invoke the staged-tree validator right after staging changes and before committing.
2. Propagate the guard's error to abort the workflow with context when violations occur.
3. Update the shared denylist through the guard when new secret patterns emerge; callers never maintain private overrides.

**Examples:** See examples/db8.md.

[^db8]: See examples/db8.md

### Structured logging only

**Behavior:** All runtime code logs through the shared Pino logger (`logging/index.ts`). Components create child loggers with a `component` tag and record structured metadata for every message. Direct `console.*` usage is reserved for exceptional, documented cases (e.g., human-facing CLI prompts).

**Why this matters:**
- Orthodoxy (obj1): One logging pipeline keeps formatting, redaction, and routing consistent.
- Code for the next agent (obj2): Structured fields (`requestId`, `jobId`, etc.) make it easy to search and correlate logs.
- Minimize harm (obj3): Centralized logging prevents accidental leakage of secrets or stack traces at the wrong level.

**How to follow it:**
1. Import the shared logger from `logging/index.ts` and create a child logger for your component (`const workerLogger = logger.child({ component: 'WORKER' });`).
2. Log structured objects (`workerLogger.info({ requestId, status }, 'Delivering job');`) instead of concatenated strings.
3. Keep sensitive values (private keys, tokens) out of log fields; rely on the logger’s redaction config where appropriate.
4. Avoid `console.*` in runtime paths. For CLI tools that need human-readable output, use the provided `scriptLogger` adapter, which wraps the shared logger while pretty-printing to stdout.

**Allowed exceptions:**
- Tests asserting specific console output may continue using `console.*`, but production code should not.
- Browser-facing code (when applicable) can use browser devtools logging, provided the output never reaches production telemetry.
- Third-party libraries that emit directly to stdout/stderr may remain unchanged, but wrap them when feasible.

**Examples:**
- ✅ `workerLogger.warn({ requestId, error: serializeError(err) }, 'Safe delivery failed');`
- ❌ `console.error('Safe delivery failed', err); // unstructured, misses metadata`

### No silent catch

**Behavior:** Every `catch` block surfaces the error. Optional flows log a warning with structured context; critical flows log and rethrow. Empty `catch {}` blocks and `.catch(() => …)` patterns that suppress errors are prohibited.

**Why this matters:**
- Orthodoxy (obj1): Establishes a single, discoverable error-handling idiom.
- Code for the next agent (obj2): Logs provide the breadcrumbs future agents need to diagnose issues.
- Minimize harm (obj3): Prevents silent data loss or hidden operational failures.

**How to follow it:**
1. Log errors with the appropriate child logger (`workerLogger`, `mcpLogger`, etc.) and include relevant identifiers (request ID, job ID, CID, etc.).
2. For non-critical paths, log at `warn` and continue. For critical paths, log at `error` (or higher) and rethrow or return a structured failure.
3. Use `serializeError()` (or equivalent) so the log carries readable error details without leaking sensitive data.
4. Avoid `.catch(() => …)` helpers that hide the cause. If suppressing an error is intentional, include a comment explaining why and what alternative signal is being emitted.

**Allowed exceptions:**
- Test helpers that deliberately swallow errors while resetting environment or cleaning up child processes. These must stay confined to test utilities and document the intent.
- Temporary suppressions in third-party integrations when logging would leak secrets; redact instead of silencing.
- Inline parse guards where the fallback is explicit (e.g., `try { JSON.parse(...) } catch { return null; }`) may be tolerated if documented, but logging is still encouraged.

**Examples:**
- ✅
  ```ts
  try {
    await apiCreateArtifact(requestId, payload);
  } catch (error) {
    workerLogger.warn({ requestId, cid, error: serializeError(error) }, 'Failed to persist artifact; continuing');
  }
  ```
- ❌
  ```ts
  try {
    await apiCreateArtifact(requestId, payload);
  } catch {}
  ```

When we define additional default behaviors, include:
- The canonical approach with code examples
- Rationale for why this approach is preferred
- Links to example files demonstrating correct usage and violations
- Guidance on rare exceptions

---

## Enforcement

This spec is enforced through multiple verification layers, ensuring code quality without blocking developer productivity.

### Current Enforcement Methods

#### 1. Pre-commit Git Hooks (Strict Mode)

**Status:** ✅ Implemented

Automatically reviews staged TypeScript files before each commit:

```bash
# Install once
yarn setup:hooks

# Commits are now automatically reviewed
git commit -m "feat: new feature"  # Review runs (strict)
git commit -m "wip: experimenting" # Skipped (WIP prefix)
git commit --no-verify             # Bypassed (emergency)
```

**How it works:**
- Runs `claude -p "/review-code-spec --diff"` via `codespec/scripts/detect-violations.sh`
- Analyzes only staged changes (fast, focused)
- Blocks commit if violations found (strict enforcement)
- WIP commits (`wip:` prefix) skip review for developer flow
- Emergency bypass available via `--no-verify`

**Timing:** 30-120 seconds depending on code size

#### 2. Manual Review (Interactive & Headless)

**Status:** ✅ Implemented

Developers can manually trigger reviews at any time:

```bash
# Interactive mode (within Claude Code session)
/review-code-spec worker/mech_worker.ts
/review-code-spec --diff
/review-code-spec worker/

# Headless mode (anywhere, via scripts)
yarn lint:spec              # Review staged changes
yarn lint:spec:all          # Review all worker files
./codespec/scripts/detect-violations.sh worker/file.ts
```

**Use cases:**
- Pre-commit validation before staging
- Exploratory review during refactoring
- Batch review of existing code

#### 3. Deliberative Alignment

**Concept:** Claude Code "deliberates" on the spec before generating code.

**How it works:**
1. Developer requests code changes
2. Claude reads `spec.md` and `examples/` files
3. Claude reasons about how to satisfy both the request and the spec
4. Claude generates code that follows canonical patterns by default

**Implementation:** The `/review-code-spec` slash command embeds this concept by requiring Claude to read the spec files before analyzing code.

**Inspiration:** OpenAI's Model Spec uses a similar approach where the model reasons about its specification before responding to user queries.

### Enforcement Philosophy

**Strict but flexible:**
- Default: Block violations before they enter the codebase
- Escape hatches: WIP commits, `--no-verify` for legitimate exceptions
- Transparency: Clear messaging about violations and how to fix them

**Educational, not punitive:**
- Violations include suggested fixes with exact code
- Pattern references explain the "why"
- Exceptions are documented, not hidden

---

## Pattern Evolution

Default behaviors are not immutable. They evolve as the codebase grows and we discover better approaches.

### Evolution process:

1. **Discovery** - During development, you find a better approach or discover the current pattern doesn't cover a use case
2. **Proposal** - Open GitHub Discussion proposing the change with rationale and examples
3. **Amendment** - Update this spec with the new approach and migration plan
4. **Migration** - Use AI-assisted migration to update existing code
5. **Enforcement** - The updated pattern becomes canonical

### When to create a new default behavior:

If you encounter code that:
- Solves the same problem in multiple different ways (violates orthodoxy)
- Is a common operation that lacks guidance
- Has multiple "obvious" approaches and needs a canonical one

Then:
1. Identify the best approach based on observability, maintainability, consistency
2. Add a new default behavior to this spec
3. Create example files demonstrating correct and incorrect usage
4. Plan migration of existing code

### Changelog format:

When updating default behaviors, add an entry:

```markdown
### 2025-01-15: Added error serialization requirement
**Change:** Require `instanceof Error` check before accessing `.message`
**Reason:** Error objects from third-party code may not have expected shape
**Migration PR:** #123
**Examples:** Updated db01.md, db04.md
```

---

## Relationship to OpenAI Model Spec

This code spec is directly inspired by OpenAI's Model Spec and the concept of "deliberative alignment."

| OpenAI Model Spec | Our Code Spec |
|-------------------|---------------|
| Defines desired model behavior | Defines desired code patterns |
| Objectives: "Assist users" | Objectives: "Follow orthodoxy" |
| Rules: "Comply with laws" (6 rules) | Rules: "Never commit secrets" (3 rules) |
| Default Behaviors: "Express uncertainty" | Default Behaviors: (Future) |
| Examples: 114 test case files | Examples: Test cases per clause |
| Enforcement: Grader model + RLHF | Enforcement: Claude review + git hooks |
| Evolution: Public feedback | Evolution: Developer discovery |

**Key insight from Sean's talk:**
> "Code is a lossy projection of a spec. The spec is the source of truth."

For an AI-generated codebase:
- The prompts were the true source code
- The generated code is the binary artifact
- The spec preserves intent across AI sessions

---

## References

- [OpenAI Model Spec](https://github.com/openai/model_spec)
- [OpenAI: Shaping Desired Model Behavior](https://openai.com/index/introducing-the-model-spec/)
- [PEP 20 - The Zen of Python](https://peps.python.org/pep-0020/)
- [OpenAI: Deliberative Alignment](https://openai.com/index/deliberative-alignment/)
- Sean's Talk: "The New 'Code': Specifications" (see project files)
