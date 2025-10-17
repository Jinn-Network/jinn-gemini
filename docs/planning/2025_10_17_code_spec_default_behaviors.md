## Code Spec Default Behaviors Tracker (DB1–DB15)

Purpose: Track proposed Default Behaviors derived from our code-spec and violations for adoption decisions and rollout.

References:
- Spec: docs/spec/code-spec/spec.md
- Violations: docs/spec/code-spec/VIOLATIONS.md
- Usage: docs/spec/code-spec/USAGE.md

Status key: Proposed | Adopted | Deferred | Needs-Revision

---

### DB1 — Canonical configuration access (Zod, single source)
- Summary: Centralize all `process.env` reads in a Zod-validated module; consume via explicit getters.
- Rationale: obj1/obj2/obj3; removes fallback chains and direct env access.
- Enforcement: Disallow direct `process.env` outside config modules; allowlist `env/` and `config/`.
- Related: VIOLATIONS §14.1, §14.6, S6
- Decision: Proposed
- Next step: Identify canonical env var names and add shared schema.

### DB2 — HTTP client with timeout + retry
- Summary: Use one wrapper (AbortController timeout, retries with backoff, structured errors).
- Rationale: obj3; prevents hangs; unifies error handling.
- Enforcement: Ban raw `fetch(` outside the client; prefer `control_api_client` pattern.
- Related: S4
- Decision: Proposed
- Next step: Extract client to shared module; codemod usages.

### DB3 — Structured logging only (no console in runtime paths)
- Summary: Use pino-based child loggers; never log secrets; stack traces only in dev or debug.
- Rationale: obj1/obj2/obj3; improves observability and safety.
- Enforcement: Ban `console.*` in `worker/` and `scripts/` (except whitelisted CLIs).
- Related: §3, §15.4, S2, S3
- Decision: Proposed
- Next step: Replace remaining `console.*`; add redaction helpers.

### DB4 — No silent catch
- Summary: Never `catch {}`; non-critical: warn and continue; critical: log and rethrow.
- Rationale: obj1/obj2/obj3; fixes invisible failures.
- Enforcement: Flag `catch {}` and `.catch(() =>` without logging.
- Related: Rule 3 section, §14.2
- Decision: Proposed
- Next step: Update artifact storage paths in `worker/mech_worker.ts`.

### DB5 — Secret handling and redaction
- Summary: Secrets only via env/secret manager; never logged; if debugging, log last 4 chars.
- Rationale: obj3; complements Rule “Never Commit Secrets”.
- Enforcement: Content checks for key patterns; lint for logging sensitive fields.
- Related: Rule 1, S1, S2, S7
- Decision: Proposed
- Next step: Add redaction util; audit logs for sensitive fields.

### DB6 — File path safety at boundaries
- Summary: Validate/resolve paths within allowed directories; reject traversal.
- Rationale: obj3; mitigates path traversal.
- Enforcement: Ban direct `fs.*(path` in sensitive modules without prior validation call.
- Related: S5
- Decision: Proposed
- Next step: Implement `validatePathWithin(baseDir, path)` and adopt.

### DB7 — Data validation at inputs
- Summary: Zod schemas on all external inputs. `.parse()` for startup config; `.safeParse()` for runtime.
- Rationale: obj1/obj2/obj3; consistent hygiene.
- Enforcement: Require schemas in boundary modules; discourage `any`.
- Related: S6
- Decision: Proposed
- Next step: Create shared schemas for common shapes (RPC_URL, CHAIN_ID, addresses).

### DB8 — Type discipline for errors and returns
- Summary: `catch (error: unknown)` with type guards; explicit return types for exported and `main()`.
- Rationale: obj2; improves readability and safety.
- Enforcement: Lint for `no-explicit-any`; require return types on exported funcs.
- Related: §14.3, §15.5
- Decision: Proposed
- Next step: Update tsconfig/eslint to enforce; batch-fix hotspots.

### DB9 — Randomness and IDs
- Summary: Use `crypto.randomUUID()`/`randomBytes()`; never `Math.random()` for identifiers.
- Rationale: obj3; prevents weak identifiers.
- Enforcement: Ban `Math.random()` in worker/security-relevant code.
- Related: S8, S9
- Decision: Proposed
- Next step: Replace in `worker/worker.ts` and test utils.

### DB10 — Nullish handling
- Summary: Prefer `??` and explicit null/undefined checks; avoid bare truthy checks for data fields.
- Rationale: obj1/obj2; clearer intent and fewer bugs.
- Enforcement: Flag `if (!value)` for non-boolean values in selected dirs.
- Related: §14.5
- Decision: Proposed
- Next step: Add lint rule with allowlist for booleans.

### DB11 — Number parsing
- Summary: Use `z.coerce.number()` for config; `parseInt(str, 10)` for ints with NaN checks; avoid unary `+`.
- Rationale: obj1/obj2; predictable parsing.
- Enforcement: Ban unary `+`; require radix on `parseInt`.
- Related: §10
- Decision: Proposed
- Next step: Centralize parse helpers; codemod common sites.

### DB12 — Concurrency patterns
- Summary: Prefer `async/await`; `Promise.all` for all-or-nothing; `Promise.allSettled` for best-effort with per-item logging.
- Rationale: obj1/obj2; normalize asynchronous style.
- Enforcement: Flag `.then().catch()` chains in `worker/` outside small utilities.
- Related: §11, Rule 3 fixes (artifact fan-out)
- Decision: Proposed
- Next step: Migrate remaining chains; add helper for logged `allSettled`.

### DB13 — Export and declaration style
- Summary: Named exports only; exported functions as `function` declarations; arrows for locals/closures.
- Rationale: obj1/obj2; consistent module interfaces.
- Enforcement: Ban default exports; lint rule.
- Related: §9, §8
- Decision: Proposed
- Next step: Lint config; refactor default exports.

### DB14 — Date/time and constants
- Summary: Centralize chain IDs/ports/sizes in `constants.ts`; log ISO 8601; internal timing in ms.
- Rationale: obj1/obj2; eliminates magic numbers.
- Enforcement: Scan for common magic literals; require imports from constants.
- Related: §12, §13, §15.2
- Decision: Proposed
- Next step: Create shared constants; replace literals in hotspots.

### DB15 — Safe SDK preflight for on-chain tx
- Summary: Validate Safe owners/threshold/balance before tx; explicit failure reasons; fail fast.
- Rationale: obj3; reduces wasted gas and opaque errors.
- Enforcement: Require presence of `getThreshold()/getOwners()/balance` checks in recovery scripts.
- Related: Rule 2 (V2.2)
- Decision: Proposed
- Next step: Add validation snippet to recovery scripts; tests.

---

Review plan:
1) Triage DBs for impact vs effort; pick 3 for immediate adoption.
2) For each adopted DB: finalize wording in `spec.md`, add example file, wire checks in review scripts.
3) Track rollout PRs and close items as Adopted.


