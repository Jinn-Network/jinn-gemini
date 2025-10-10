# Known Violations

This document tracks areas where the codebase currently has violations that need to be addressed. This includes:
- Multiple competing patterns (violates "one obvious way" principle)
- Missing patterns (no established approach)
- Security or quality issues
- Inconsistencies that impact AI code comprehension

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
