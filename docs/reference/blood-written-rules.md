---
title: Blood Written Rules
purpose: reference
scope: [worker, gemini-agent, deployment]
last_verified: 2026-02-16
related_code:
  - worker/mech_worker.ts
  - gemini-agent/agent.ts
keywords: [blood-written-rules, pitfalls, errors, troubleshooting, RPC, IPFS, git]
when_to_read: "When encountering unexpected behavior or debugging issues"
---

# Blood Written Rules

> Common pitfalls and solutions learned through experience.

---

## RPC & Network

### 1. RPC Rate Limits
**QuickNode Free Tier:** 15 req/sec
**Solution:** Add 70ms delay between calls, use exponential backoff

### 2. IPFS Timeouts
**Issue:** Gateway timeouts, content-type mismatches
**Solution:** Multi-gateway failover (Autonolas → Cloudflare → IPFS.io → DWeb)
**Verification:** Always test CID fetches after upload

### 3. Transaction "Not Found"
**Issue:** RPC transient errors during delivery/dispatch
**Solution:** Built-in retry logic (3 attempts, exponential backoff)
**Debugging:** Check BaseScan for actual transaction status

### 4. Undelivered Set RPC Reverts
**Issue:** Worker logs "Failed to get undelivered set; returning null" with contract execution error
**Impact:** `filterUnclaimed()` falls back to trusting Ponder, which can cause repeated polling
**Prevention:** Verify Base RPC health and marketplace contract calls before assuming worker logic is broken

---

## Marketplace & Jobs

### 5. Marketplace Timeout
**Hard Limit:** 300 seconds (5 minutes) enforced on-chain
**Solution:** Break complex jobs into smaller sub-jobs
**Planning:** Max ~10-15 tool calls per job (~5-30s each)

### 6. Agent Polling Loops
**Issue:** Agents check child status repeatedly after dispatching
**Solution:** FINALIZE IMMEDIATELY after `dispatch_new_job`. System auto-redispatches parent when children complete.
**Cost:** Each iteration = 2-5K tokens wasted

### 7. Circular Dependencies
**Issue:** Agent dispatched child jobs with dependencies set to the parent job ID, creating deadlock
**Root Cause:** System blueprint was ambiguous about dependency targets; no tool-level validation
**Solution:** Tool now rejects dependencies that include `context.jobDefinitionId` (the parent)
**Key Insight:** Parent-child coordination is automatic (status inference). Dependencies exist solely to order sibling execution.

### 8. Job Status from Ponder
**Architecture:** Job status comes from `job_definition.lastStatus` field in Ponder (extracted from delivery payloads)
**Never Infer:** Don't check individual requests to guess status - Ponder already has the correct value
**Status Flow:** `lastStatus` (Ponder) → `job-context-utils` (lowercase) → `JobContextProvider.mapJobStatus()` (uppercase) → `ChildWorkAssertionProvider` (CTX assertions)

### 9. Stale Hierarchy in Status Inference (FIXED)
**Issue:** Jobs cycle through WAITING status multiple times instead of COMPLETED after children finish
**Root Cause:** `inferJobStatus()` used `metadata.additionalContext.hierarchy` which is a frozen snapshot from dispatch time
**Solution:** Query live child delivery status from Ponder during `inferJobStatus()` instead of trusting hierarchy snapshot
**Prevention:** Never rely on `hierarchy.status` for terminal state decisions. Always query Ponder directly.

### 10. Double Execution via Ponder Latency (FIXED)
**Issue:** Worker claims same job twice because Ponder indexer lags behind chain delivery
**Root Cause:** Ponder says `delivered: false` while chain has 0 undelivered requests
**Solution:** `filterUnclaimed` now trusts empty on-chain sets over Ponder's stale data

### 11. Stale Claim Blocking (FIXED)
**Issue:** Worker skips jobs stuck IN_PROGRESS for hours, never re-attempts them
**Root Cause:** Control API returned existing IN_PROGRESS claims indefinitely
**Solution:** Control API now detects stale claims (>5 minutes) and allows re-claiming with fresh timestamp

---

## Agent Behavior

### 12. Recognition Learning Mimicry
**Issue:** Agents mimicking delegation narratives without executing tool calls
**Root Cause:** Recognition learnings framed as imperative instructions ("Use dispatch_new_job") instead of historical observations ("Called dispatch_new_job 3 times")
**Symptom:** Execution summary claims "Dispatched child jobs" but telemetry shows zero dispatch_new_job calls
**Prevention:** Recognition learnings must describe WHAT PAST JOBS DID (tool sequences), not WHAT CURRENT JOB SHOULD DO

### 13. Agent Ignores STRAT-DELEGATE (FIXED)
**Issue:** Agent received `STRAT-DELEGATE` invariant saying "DELEGATION REQUIRED" but executed work directly
**Root Cause:** `STRAT-DELEGATE` was a "directive" (advisory) not a "constraint" (mandatory)
**Solution:** Changed to `form: 'constraint'` with blocking language and measurement field

### 14. Blueprint Date Scope vs Execution Date Confusion
**Issue:** Research job dispatched for Dec 1st data but agent researched Dec 3rd instead
**Root Cause:** Agent used "today" from environment, overriding blueprint instruction
**Solution:** Blueprint must explicitly instruct: "Parse context field for exact date, NOT 'today'"
**Prevention:** All web searches must include date string: "Ethereum metrics YYYY-MM-DD"

### 15. Gemini CLI Token Overflow from node_modules
**Issue:** Job failed with "input token count exceeds maximum" despite 26KB prompt
**Root Cause:** Job ran `npm install` creating 652MB of `node_modules/` but no `.gitignore`. CLI scanned entire workspace.
**Solution:** Always create `.gitignore` FIRST before running `npm install`

---

## Branch & Git Operations

### 16. Branch Creation Auto-Detection
**Behavior:** `dispatch_new_job` auto-skips branch creation when `CODE_METADATA_REPO_ROOT` not set
**Logic:**
1. If `CODE_METADATA_REPO_ROOT` unset AND no parent branch context → Skip branches (artifact-only)
2. If inside job with parent branch context → Inherit context, create child branches
3. If `skipBranch: true` explicitly set → Always skip (override)

**Use Cases:**
- Research/analysis jobs with no code changes → artifact-only mode (no repo needed)
- Code-changing jobs inside ventures → set `CODE_METADATA_REPO_ROOT` via worker
- Child jobs inherit parent's repo context automatically

### 17. Custom SSH Aliases Break Worker Clones
**Issue:** `codeMetadata.repo.remoteUrl` may carry SSH host aliases (e.g., `git@ritsukai:`) not resolvable on other machines
**Prevention:** Normalize SSH URLs to `git@github.com:` at dispatch time, or omit code metadata for artifact-only jobs

### 18. SSH Publickey Failures Need HTTPS Fallback
**Issue:** `git@github.com:` clone fails with "Permission denied (publickey)" on machines without SSH keys
**Prevention:** Attempt HTTPS clone using `GITHUB_TOKEN` when SSH auth fails

### 19. HTTPS Clone 403 Indicates Token Lacks Repo Access
**Issue:** HTTPS clone fails with `403` despite `GITHUB_TOKEN`
**Prevention:** Ensure token has access to the private repo (fine-grained token with repo read)

### 20. Beads Lock File Blocks Branch Checkout
**Issue:** `git checkout` fails if a worker repo has a dirty `.beads/daemon.lock`
**Solution:** Remove stray lock files in worker clones or disable beads/hooks for the repo

### 21. Base Branch May Exist Only on Origin
**Issue:** Fresh worker clones can fail `git checkout -b <job-branch> <baseBranch>` if base branch exists only as `origin/<baseBranch>`
**Prevention:** Resolve base branches with a local fallback to `origin/<baseBranch>` before creating job branches

---

## Dispatch & Workstream

### 22. Workstream Repo Must Be Explicit in Input Config
**Issue:** Workstreams launched without `repoUrl` in input config default to creating or using unintended repos
**Prevention:** Set `repoUrl` in the input config so launcher resolves the correct repo

### 23. launch:workstream Needs HTTPS Fallback
**Issue:** `launch:workstream` clones via `git@github.com` and fails without SSH keys
**Prevention:** Use HTTPS clone fallback with `GITHUB_TOKEN` when SSH auth fails

### 24. Verification Dispatch Loses WorkstreamId (FIXED)
**Issue:** Jobs dispatched for verification lose their workstreamId, causing them to fall outside `--workstream` filter
**Root Causes:** `dispatchForVerification` didn't query or pass workstreamId; type omitted `workstreamId` field
**Solution:** Query workstreamId from Ponder before dispatch, pass to both `withJobContext` and `dispatchExistingJob`

### 25. Auto-Dispatch sourceRequestId Null (FIXED)
**Issue:** Auto-dispatched child requests had `sourceRequestId: null` instead of parent's request ID
**Root Cause:** `dispatch_existing_job.ts` conditionally skipped setting `sourceRequestId` when `workstreamId` provided
**Solution:** Always set `sourceRequestId`/`sourceJobDefinitionId` when available in context

### 26. Re-Dispatched Jobs Missing codeMetadata.repo.remoteUrl (FIXED)
**Issue:** Verification/parent jobs looked for files in wrong directory
**Root Cause:** `dispatchExistingJob` re-collected git metadata instead of reusing stored `codeMetadata`
**Solution:** Query `codeMetadata` from job definition via GraphQL, reuse instead of re-collecting

### 27. x402-Builder Dispatched Without codeMetadata (FIXED)
**Issue:** All jobs failed with "process_branch tool not found" despite being a coding workstream
**Root Cause:** Service created GitHub repo but did NOT include `codeMetadata` in IPFS payload
**Prevention:** Any service that creates a repo MUST include `codeMetadata` in the dispatch payload

### 28. dispatch_existing_job Missing Env Var Inheritance (FIXED)
**Issue:** Jobs via `dispatch_existing_job` failed with "Missing required environment variables"
**Root Cause:** Manual IPFS payload building without inheriting `JINN_INHERITED_ENV`
**Solution:** Added `JINN_INHERITED_ENV` inheritance logic matching `dispatch_new_job`

---

## Ponder & Indexing

### 29. Ponder Indexing Failures
**Issue:** IPFS content-type `application/octet-stream` instead of `application/json`
**Solution:** Applied fix in `ponder/src/index.ts`
**Verification:** Check Railway logs for "Indexed MarketplaceRequest"

### 30. Ponder Global vs Single-Tenant Architecture
**Issue:** Original design filtered requests by mech address, treating system as single-tenant
**Solution:** Removed mech filtering - ALL Jinn requests indexed. Added `MarketplaceDelivery` handler as source of truth for `delivered` status
**Key Insight:** Ponder is a **global Jinn explorer** (all requests/deliveries), not single-mech view

### 31. NetworkId Filtering Bug (FIXED)
**Issue:** Non-Jinn requests appearing in frontend despite networkId filtering
**Root Cause:** Code tried to read `networkId` from `event.args.networkId` but event ABI has NO such field - it only exists in IPFS metadata
**Solution:** Moved IPFS fetch before DB writes, extract networkId from IPFS content

### 32. Job Definitions and Workstream Queries
**Issue:** Querying `job_definition.workstreamId` returns incomplete results
**Root Cause:** Job definitions can be reused across workstreams, so `workstreamId` only stores the FIRST workstream
**Solution:** Query `requests` table by `workstreamId`, extract unique `jobDefinitionId` values, then batch-fetch definitions

### 33. Ponder Artifact Content Missing
**Issue:** `getDependencyBranchInfo` failed with "Cannot query field 'content'"
**Root Cause:** Ponder intentionally excludes full artifact content to prevent DB bloat
**Solution:** Use regex on `contentPreview` or fetch full JSON from IPFS using `cid`

### 34. Tenderly VNet Factory Pattern Indexing (FIXED)
**Issue:** Integration tests timeout waiting for Ponder to index `Deliver` events
**Root Causes:** Factory pattern scanning from wrong block; child start block evaluated at module-load time
**Solution:** Bypass factory pattern in test mode, use lazy evaluation of child start block

---

## Worker & Execution

### 35. Workers Are Network Nodes
**CRITICAL:** Workers are nodes on a network, coordinated via the on-chain marketplace.
- Production workers are deployed on Railway (see `docs/runbooks/deploy-railway-worker.md`)
- `yarn dev:mech` runs a local worker for development only
- To inject updated blueprints/configs into a live workstream, use `redispatch-job.ts`:
  ```bash
  tsx scripts/redispatch-job.ts --jobName "<name>" --input configs/<config>.json --template blueprints/<blueprint>.json --cyclic
  ```
- This redispatches the root job with new invariants, env vars, and tools — no need to start a fresh workstream

### 36. Verification Run Incorrectly Blocked Parent Dispatch (REFIXED)
**Issue:** Jobs with children enter infinite loop: parent run → verification run → parent run...
**Original Fix (WRONG):** Added early return when `isVerificationRun: true` to block parent dispatch
**Correct Fix:** Removed early return. `shouldRequireVerification()` already returns `requiresVerification: false` for verification runs

### 37. Infinite Re-Execution Loop on Delivery Nonce Failure
**Issue:** Job completed but delivery failed with "nonce too low". Worker re-claimed and re-executed infinitely.
**Root Cause:** Mech-client caches agent wallet nonce; delivery fails but Control API allows re-claiming
**Solution:** Added `executedJobsThisSession` Set to track executed jobs, skip re-execution

### 38. Lingering Processes Block Worker Clone Cleanup
**Issue:** Workers spawn Gemini CLI → MCP servers → Chrome browsers. On exit, these become orphaned and hold file handles.
**Prevention:** Before deleting worker clone directories, use `lsof +D <dir>` to find and kill all processes

### 39. Parallel Auto-Dispatch Can Double-Dispatch Parent Jobs
**Issue:** Multiple workers can reach "verification → parent dispatch" path for same parent around same time
**Prevention:** Add cross-worker idempotency guard around parent dispatch

### 40. Transport Error Should Not Auto-Complete Jobs
**Issue:** Jobs marked COMPLETED when Gemini CLI crashes, because status inference sees old children delivered
**Fix:** Only accept COMPLETED if there's evidence of execution (output, tool calls, or partial output)

### 41. Workstream Overrides Must Be Explicit in IPFS Payloads
**Issue:** Redispatch scripts attempted to preserve `workstreamId`, but payload builder dropped value outside agent context
**Fix:** Accept `workstreamId` in `buildIpfsPayload` and include when provided

---

## Tools & MCP

### 42. get_details and search_jobs Schema Mismatch (FIXED)
**Issue:** Agents calling `get_details` received "Cannot query field 'promptContent'"
**Root Cause:** GraphQL queries used old field name `promptContent` instead of `blueprint`
**Solution:** Updated queries to use `blueprint`

### 43. Invalid Tool Name `web_search`
**Issue:** Default tool lists referenced `web_search`, but registry expects `google_web_search`
**Prevention:** Use `google_web_search` for web research tools; validate enabledTools against registry

### 44. Universal Tools Must Have a Single Source
**Issue:** Different "universal tools" lists caused drift and confusion
**Prevention:** Define universal tools in one module (`toolPolicy.ts`), import from there

### 45. list_tools Must Be Policy-Scoped
**Issue:** `list_tools` returned full catalog, leading agents to attempt unavailable tools
**Prevention:** Scope to `JINN_AVAILABLE_TOOLS` or `JINN_REQUIRED_TOOLS` plus universal tools

### 46. Browser Automation Conflict
**Issue:** Browser automation tools failed with "browser is already running" in parallel workers
**Root Cause:** Global extension launched Chrome without `--isolated=true`
**Solution:** Migrated to extension-based architecture with `--isolated=true` (creates temp user-data-dir per instance)

---

## OLAS & Wallets

### 47. Wallet/Safe Architecture
**CRITICAL:** Each service deployment creates NEW Safe (even with same Master Wallet)
**Recovery:** Agent keys in `/.operate/keys/` survive service deletion
**Details:** See OLAS integration docs

### 48. Conflicting Operate Service Configs
**Issue:** `dispatch_new_job` fails with "Service target mech address not configured"
**Root Cause:** `.operate/services/` contained extra service dir without `config.json`; loader picked it first
**Solution:** Remove stale service dirs, keep only intended service with valid `config.json`

---

## Blueprint & Templates

### 49. Phantom Blueprint Assertion
**Issue:** Request referenced `SYS-PARENT-ROLE-001` even though blueprint lacked that assertion
**Prevention:** Audit blueprint-to-assertion injection to prevent non-existent assertions

### 50. Template Tool Policy
**Issue:** Templates mixed universal tools with template-specific tools, children requested out-of-scope tools
**Prevention:** Keep universal tools in `toolPolicy.ts`, templates declare `requiredTools` and `availableTools` whitelist

### 51. dispatch_existing_job Supports Blueprint Override
**Feature:** `dispatch_existing_job` accepts `blueprint` parameter to override job definition blueprint
**Behavior:** Validated like `dispatch_new_job`; Ponder updates definition on next request

### 52. Cyclic Re-dispatch Requires Script Support
**Issue:** `dispatch_existing_job` does not accept a `cyclic` flag
**Prevention:** Use `scripts/redispatch-job.ts --cyclic` for cyclic re-dispatches

---

## IPFS Delivery

### 53. IPFS Delivery Architecture
**Critical Understanding:**
1. **Upload:** Worker uploads to Autonolas registry with `wrap-with-directory: true`
2. **On-Chain:** Only 32-byte SHA256 digest stored in `Deliver` event
3. **Ponder:** Reconstructs directory CID, fetches: `{dir-CID}/{requestId}`

**Common Mistake:**
- ❌ Testing `https://gateway.autonolas.tech/ipfs/f01551220{digest}` (returns binary)
- ✅ Testing `https://gateway.autonolas.tech/ipfs/{dir-CID}/{requestId}` (returns JSON)

---

## Miscellaneous

### 54. Beads Runtime Files Should Be Ignored
**Issue:** `.beads/daemon.lock` and `.beads/metadata.json` are local runtime artifacts
**Prevention:** Add to `.gitignore`, keep untracked

### 55. Worker Auto-Adds Beads Files
**Issue:** Worker repo setup can auto-add `.beads/beads.db` to `.gitignore` on job branches
**Prevention:** Disable beads-related repo setup for workstreams that must remain bead-free

### 56. Limit Cyclic Runs with --max-cycles
**Issue:** Cyclic workstreams keep redispatching, making template testing hard
**Prevention:** Run worker with `--max-cycles=1` to stop after full cycle completes

### 57. Hackathon Direction: Job Templates as x402 Services
**Decision:** Productize reusable workflows as x402-paid callable templates
**Key Points:**
- Templates need an OutputSpec (schema + mapping) for deterministic response fields
- Derive price from historical run cost; support budget caps
- Public templates expand attack surface; enforce tool restrictions

### 58. Gemini CLI Hangs in Git Repository Directories
**Issue:** CLI v0.11.2 handles positional prompts differently depending on `cwd`
**Root Cause:** Directory WITH `.git`: positional prompt IGNORED, expects `-p` flag
**Solution:** Changed from `args.push(prompt)` to `args.push('-p', prompt)` to explicitly use `-p` flag

### 59. Gemini CLI Hangs + File Path Issues in Test Environments (FIXED)
**Issue 1:** Tests timeout after 300 seconds - CLI hangs when spawned with `cwd` pointing to ephemeral directories
**Issue 2:** Agent creates files in `gemini-agent/` instead of workspace when using stable `cwd`
**Solution:** Use stable `cwd` + expose workspace via `JINN_WORKSPACE_DIR` env var + require absolute paths

---

## OLAS Middleware Setup

### 60. Service Setup with Tenderly (RESOLVED)
**Previous Issue:** Required `TENDERLY_ENABLED` flag and separate environment files.
**Resolution:** Now using `--testnet` flag with explicit env file loading:
- Mainnet: `yarn setup:service --chain=base` (uses `.env`)
- Testnet: `yarn setup:service --testnet --chain=base` (uses `.env.test`)

### 61. Mech Deployment on Base - Missing Factory Addresses
**Issue:** Middleware mech deployment crashes with `KeyError: <Chain.BASE: 'base'>`
**Root Cause:** `MECH_FACTORY_ADDRESS` dictionary in middleware only has `Chain.GNOSIS` entries
**Solution:** Added Base chain factory addresses to `olas-operate-middleware/operate/services/utils/mech.py`
**Verified Addresses:**
- MechMarketplace: `0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020`
- Native Factory: `0x2E008211f34b25A7d7c102403c6C2C3B665a1abe`
- Token Factory: `0x97371B1C0cDA1D04dFc43DFb50a04645b7Bc9BEe`

### 62. Misleading Error: Missing DEFAULT_PRIORITY_MECH for Base
**Issue:** Scary error during setup: `KeyError: '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020'`
**What's Actually Happening:** Middleware can't find Base marketplace in `DEFAULT_PRIORITY_MECH` dict, uses defaults
**Impact:** None - setup continues successfully. Just a misleading error message.

### 63. Docker Required for Middleware Service Deployment
**Issue:** Middleware crashes trying to build Docker containers after on-chain deployment
**What Succeeded:** Service minted, staked, funded - all on-chain parts complete
**Solution A:** Start Docker Desktop, then re-run setup
**Solution B:** Run worker directly with `yarn dev:stack` - middleware Docker is optional for worker

### 64. Marketplace Dispatch - Wrong Private Key & RPC Configuration
**Issue:** Job dispatch fails with "insufficient funds" despite wallet having ETH
**Root Causes:**
1. `getPrivateKeyPath()` auto-overwrites `ethereum_private_key.txt` with `MECH_PRIVATE_KEY` env var
2. Two separate private key env vars: `MECH_PRIVATE_KEY` (mech-client) vs `WORKER_PRIVATE_KEY` (worker)
**Solution:** Set `MECH_PRIVATE_KEY` to match funded wallet, ensure `RPC_URL` points to correct endpoint

### 65. Unbound Pino Logger Methods Crash Execution Before Agent Spawn
**Issue:** Worker crashes during job initialization with `Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')`.
**Root Cause:** `workerLogger.warn` / `workerLogger.info` were captured into a variable and invoked unbound, losing `this` context required by Pino internals.
**Solution:** Call logger methods directly on `workerLogger` (or bind explicitly) instead of storing method references.
**Prevention:** Avoid destructuring or assigning Pino logger methods before invocation in worker execution paths.

### 66. x402 Gateway Crashes Without CDP Credentials
**Issue:** Setting `PAYMENT_WALLET_ADDRESS` without `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` causes the gateway to crash at startup with `RouteConfigurationError: Facilitator does not support scheme "exact"`
**Root Cause:** `@x402/core`'s `HTTPFacilitatorClient` calls the CDP facilitator API to validate supported schemes. Without CDP credentials, the API returns 401 Unauthorized, and the library throws an unrecoverable error.
**Solution:** Only initialize `x402ResourceServer` when ALL three env vars are present: `PAYMENT_WALLET_ADDRESS`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`. Without CDP keys, run in "discovery-only" mode (payTo visible in `/.well-known/x402` but payment enforcement disabled).
**Prevention:** Always set CDP credentials before or alongside `PAYMENT_WALLET_ADDRESS`.

### 67. OLAS AgentRegistry Only Exists on Ethereum Mainnet
**Issue:** Sending `AgentRegistry.create()` transactions on Base silently succeeds (status=1, 0 logs) but does nothing — the contract doesn't exist on Base.
**Root Cause:** The OLAS AgentRegistry (`0x2F1f7D38e4772884b88f3eCd8B6b9faCdC319112`) is deployed ONLY on Ethereum mainnet (chainId 1). On L2s like Base, the `ServiceRegistryL2` uses an "optimistic" approach — agent IDs reference mainnet-registered agents without local validation. There is no AgentRegistry or ComponentRegistry on Base.
**Solution:** Mint agents on Ethereum mainnet using `ETH_RPC_URL` (not `BASE_RPC_URL`). Reference the resulting `agentId` in Base's `ServiceRegistryL2` using the optimistic approach.
**Prevention:** Always verify contract deployment chain. Use `code = await provider.getCode(address)` — if `code === '0x'`, the contract doesn't exist on that chain.

### 68. OLAS Agent Minting Requires Component Dependencies
**Issue:** `AgentRegistry.create(owner, hash)` with the ABI in OlasContractInterfaces.ts reverts because the actual function signature is `create(address owner, bytes32 hash, uint32[] dependencies)`.
**Root Cause:** The OLAS architecture requires agents to list component dependencies. The full registration flow is: (1) Register component in ComponentRegistry, (2) Register agent in AgentRegistry with component IDs as dependencies. An agent cannot be created with an empty dependencies array.
**Solution:** Either use the `autonomy mint` CLI which handles the full flow, or first register a component, then create the agent with that component ID as a dependency. The ABI in `OlasContractInterfaces.ts` also needs the third `uint32[]` parameter added.
**Prevention:** Check the actual contract ABI on Etherscan before writing registry interaction code. The OLAS contracts have strict hierarchical dependencies: Components → Agents → Services.

### 69. OLAS Registry Must Go Through RegistriesManager
**Issue:** Direct calls to `ComponentRegistry.create()` or `AgentRegistry.create()` revert with `ManagerOnly`.
**Root Cause:** The OLAS registry contracts delegate creation authority to the `RegistriesManager` at `0x9eC9156dEF5C613B2a7D4c46C383F9B58DfcD6fE`. Only the manager can call `create()` on the underlying registries. The manager's `create()` takes `(uint8 unitType, address owner, bytes32 hash, uint32[] dependencies)` where unitType=0 is Component, unitType=1 is Agent.
**Solution:** Call `RegistriesManager.create()` instead of the individual registry contracts. The `REGISTRIES_MANAGER_ABI` is now in `OlasContractInterfaces.ts`. Use `OlasContractHelpers.encodeComponentCreation()` and `OlasContractHelpers.encodeAgentCreationViaManager()`.
**Prevention:** Always check if a registry contract has a manager/owner guard before calling create directly. The OLAS Jinn component is ID 314 on Ethereum mainnet.

### 70. OLAS unitHash is SHA-256 Digest, NOT keccak256
**Issue:** Agents and components registered on OLAS showed no metadata on marketplace — "unpinned from IPFS".
**Root Cause:** The on-chain `unitHash` (bytes32) must be the raw SHA-256 digest from the IPFS CID, NOT `keccak256(toUtf8Bytes("ipfs://"+cid))`. The contract's `tokenURI()` reconstructs the IPFS URL by prepending `f01701220` to the stored hash. If you store a keccak256 hash, the reconstructed CID points to nothing.
**Solution:** Use `bs58.decode(cid).slice(2)` to extract the 32-byte SHA-256 digest from a CIDv0 (Qm...). The first 2 bytes (0x12=sha2-256, 0x20=32 bytes) are the multihash prefix.
**Prevention:** See `skills/olas-registry/SKILL.md`. The function `cidToBytes32()` in `mint-olas-agent.ts` does this correctly. Three rounds of minting (IDs 88-92, 93-97) were wasted before this was discovered. Component 315, Agents 98-102, Service 365 are the correct entries.

### 71. OLAS Metadata Must Include image, code_uri, attributes
**Issue:** Even with correct hashes, OLAS marketplace showed blank metadata fields.
**Root Cause:** The OLAS marketplace frontend (`autonolas-frontend-mono`) expects specific JSON fields: `name` (org/slug:version format), `description`, `image` (ipfs://...), `code_uri`, `attributes` ([{trait_type,value}]). Custom-only schemas are ignored.
**Solution:** Include all 5 required fields in metadata JSON. Additional custom fields are allowed and harmlessly ignored by the marketplace.
**Prevention:** Check `skills/olas-registry/SKILL.md` for the expected schema before minting.

### 72. ServiceManager.create() on Base: Token, Bond, and Threshold Requirements
**Issue:** Multiple reverts when trying to create services on Base: `ZeroValue` (0x7c946ed7), `WrongThreshold`, `TokenRejected`.
**Root Cause:** (1) Bond must be >= 1 wei even if not activating. (2) Threshold must be >= ceil(2/3 * totalSlots). (3) Must use ETH sentinel address `0xEeee...eEEeE` for the token param, not zero address or OLAS token.
**Solution:** Set bond=1n per agent, threshold=ceil(2/3*numAgents), token=`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`. Must go through ServiceManagerToken, not ServiceRegistryL2 directly (ManagerOnly error).
**Prevention:** See `skills/olas-registry/SKILL.md` for full service creation reference.

### 73. Embedded Git Credentials in IPFS Job Metadata Expire
**Issue:** Manager jobs (Site Manager, Content Manager, Distribution & Analytics Manager) failing with "Invalid username or token" or "Repository not found" at clone time.
**Root Cause:** Job payloads baked into IPFS contain `codeMetadata.repo.remoteUrl` with embedded PATs (e.g., `https://x-access-token:ghp_xxx@github.com/org/repo`). When these tokens expire, every subsequent re-dispatch of that job fails at clone. The `buildGithubHttpsUrl()` function didn't recognize URLs with embedded credentials as GitHub URLs, so the worker's own `GITHUB_TOKEN` was never applied.
**Solution:** (1) `buildGithubHttpsUrl()` now strips embedded credentials before URL matching, allowing the worker's `GITHUB_TOKEN` to be used. (2) Clone failures are now non-fatal — the agent runs without a local repo if clone fails, which is fine for research/coordination jobs.
**Prevention:** When dispatching jobs, use clean repo URLs without embedded tokens. The worker will apply its own `GITHUB_TOKEN` at clone time.

### 74. Jinn Staking mapServiceInfo Returns 5 Fields (Not 6)
**Issue:** viem ABI decoding error "Position out of bounds" when reading `mapServiceInfo` on the Jinn staking contract (`0x0dfaFbf...`).
**Root Cause:** The Jinn contract's `mapServiceInfo` returns `(address multisig, address owner, uint256 tsStart, uint256 reward, uint256 nonces)` — 5 static fields (160 bytes). Other OLAS staking contracts (e.g., AgentsFun1) return 6 fields with `uint256[] nonces` (dynamic) and `uint256 inactivity`. Using the wrong ABI causes the decoder to misinterpret field offsets.
**Solution:** Use the correct 5-field ABI for Jinn. Always verify the raw return data length first: `client.call()` → check byte count before writing ABI definitions.
**Prevention:** Don't assume all OLAS staking contracts share the same ABI. Check basescan or do a raw call to determine the actual return layout.

### 75. OLAS Staking Requires NFT Approval Before stake()
**Issue:** Safe `execTransaction` reverts with GS013 when calling `stake(serviceId)` on the staking contract.
**Root Cause:** The staking contract calls `safeTransferFrom(msg.sender, address(this), serviceId)` to take ownership of the service NFT. This requires the caller (Safe) to have approved the staking contract as an operator for that specific token ID. Without approval, the inner transfer reverts.
**Solution:** Before calling `stake()`, execute `approve(stakingContract, serviceId)` on the ServiceRegistry (`0x3C1fF68f5...`) via the Safe. Then call `stake()`.
**Prevention:** Always approve NFT transfer before staking. The migration script now includes this step.

### 76. OLAS Staking Contract Takes Ownership of Service NFT
**Issue:** Agent wasted time investigating why `ownerOf(serviceId)` returned the staking contract address, incorrectly concluding the service was "evicted" or in an abnormal state.
**Root Cause:** When a service is staked, the staking contract **takes ownership of the service NFT** via `transferFrom`. This is the normal, expected state for any staked service. `ownerOf()` returning a staking contract address simply means "this service is staked in that contract."
**Solution:** To check staking status, call `getServiceIds()` on the staking contract — if the service ID is in the returned array, it's actively staked. If `ownerOf()` returns the staking contract but `getServiceIds()` does NOT include the service, it was evicted (contract holds the NFT but service is inactive). Use `getStakingState(serviceId)` for the authoritative state (0=Unstaked, 1=Staked, 2=Evicted).
**Prevention:** Never interpret `ownerOf()` returning a staking contract as an error. This is how OLAS staking works by design.

### 77. Frontend RPC Rate Limiting: Use Tenderly, Not Public Base RPC
**Issue:** Staking dashboard showed "Request count unavailable" intermittently. Service 165 would load briefly, then all 3 service cards would fail. Issue was transient — sometimes worked, sometimes didn't.
**Root Cause:** The staking page renders 3 service cards, each making 2 API calls (epoch + service-status), each creating a **fresh** `createPublicClient` instance making 2 RPC calls each. That's 12 parallel RPC calls to the rate-limited public `mainnet.base.org` endpoint, which throttles after ~4-6 calls. The subgraph data (epoch timing, staking state) loaded fine, but the RPC calls for `mapRequestCounts` and `calculateStakingReward` failed silently, falling through to the "unavailable" state.
**Solution:** (1) Created a singleton RPC client module (`lib/staking/rpc.ts`) with viem's `batch: { multicall: true }` — this batches concurrent `readContract` calls into a single `eth_call` via Multicall3. (2) Used `loadEnvConfig()` in `next.config.js` to load the root `.env` which contains the Tenderly paid RPC URL. (3) Subgraph-primary architecture means RPC failures are non-fatal — page still renders with subgraph data.
**Prevention:** Never use the public `mainnet.base.org` endpoint for production frontend reads. Always use the paid Tenderly RPC (`RPC_URL` in root `.env`). For new frontend apps in the monorepo, add `loadEnvConfig()` to `next.config.js` to inherit root env vars.

### 78. Keystore IV Too Short — Invalid Initialization Vector
**Issue:** `decryptKeystoreV3` throws `Invalid initialization vector` when decrypting agent keystores
**Root Cause:** Some Python AEA-generated keystores produce IVs shorter than 16 bytes (e.g., 15 bytes / 30 hex chars). Node.js `createDecipheriv('aes-128-ctr', ...)` requires exactly 16 bytes.
**Solution:** Left-pad the IV hex string to 32 characters before creating the Buffer: `iv.padStart(32, '0')`
**Prevention:** Always normalize IV length in `keystore-decrypt.ts` before passing to `createDecipheriv`

### 79. Credential Bridge Job Verification Must Fail Closed
**Issue:** Credential requests could be accepted when Control API verification failed, allowing unbound credential access during outages
**Root Cause:** Bridge job verification logic previously treated Control API errors as success ("fail open")
**Solution:** Require ERC-8128 signed bridge->Control API `getRequestClaim` checks and return explicit `valid | invalid | unavailable` states; deny issuance on `invalid` and `unavailable` when `REQUIRE_JOB_CONTEXT=true`
**Prevention:** Keep claim ownership source-of-truth in Control API, compare requester signer EOA to claim owner EOA, and never issue credentials on verification unavailability in job-bound mode

---

*Keep this file updated with new blood written rules as they're discovered.*
