# Phase 3: Worker Execution (Docker)

**Prerequisites**: Phase 2 PASS (2 services exist), Phase 1 PASS (Docker image built)
**Abort on failure**: Skip Phases 4, 5

Dispatch a full-infrastructure test job and run the worker via Docker. The blueprint exercises web search, artifact creation, measurements, credential-dependent tools (Supabase), and delegation (`dispatch_new_job`). With 2 services provisioned and no activity manipulation, the rotator picks naturally. Cross-mech job pickup is enabled (`WORKER_MECH_FILTER_MODE=any`).

## Steps

### 1. Dispatch job

From the monorepo root:
```bash
yarn test:e2e:dispatch \
  --workstream 0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac \
  --cwd "$CLONE_DIR"
```

Default blueprint (`blueprints/e2e-infrastructure-test.json`): Eight invariants exercising 8 tools across 5 credential types:
- `google_web_search` — Gemini CLI OAuth (file mount)
- `get_file_contents` — GitHub operator credential (GITHUB_TOKEN from env)
- `create_artifact` — Agent private key (on-chain IPFS)
- `create_measurement` — Internal measurement system
- `venture_query` — Supabase credentials (env var)
- `dispatch_new_job` — Agent private key + mech address (on-chain delegation)
- `blog_get_stats` — Credential bridge (agent → signing proxy → ERC-8128 → gateway → Umami JWT)

**CRITICAL**: The worker reads ONLY `metadata.blueprint` — there is no `prompt` field.

### 2. Fund agent EOAs

Both agents need ETH for gas:
```bash
yarn test:e2e:vnet fund <agent-eoa-1> --eth 0.05
yarn test:e2e:vnet fund <agent-eoa-2> --eth 0.05
```

### 3. Read Supabase credentials

The `venture_query` tool requires Supabase credentials. Read them from the monorepo's `.env`:
```bash
source .env
echo "SUPABASE_URL: ${SUPABASE_URL:0:30}..."
echo "SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:0:10}..."
```

Both must be non-empty. If missing, `venture_query` will use a mock client and the TOOL-REGISTRY invariant will fail (document this but continue).

### 4. Run worker via Docker

Wait a few seconds for Ponder to index the marketplace request, then run in **single mode** (`--single`) so the worker exits after processing one job, leaving the child dispatch for Phase 4:
```bash
yarn test:e2e:docker-run --cwd "$CLONE_DIR" --single \
  --workstream 0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac \
  --env SUPABASE_URL=$SUPABASE_URL \
  --env SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
  --env X402_GATEWAY_URL=http://host.docker.internal:3001 \
  --env UMAMI_HOST=$UMAMI_HOST \
  --env UMAMI_WEBSITE_ID=$UMAMI_WEBSITE_ID
```

The `--single` flag makes the worker exit after processing one request, preserving the child job for Phase 4's rotation test.
The `--workstream` flag sets `WORKSTREAM_FILTER` to only process requests in this workstream.
The `--env` flags pass Supabase credentials for `venture_query`, the credential bridge URL (using `host.docker.internal` because `localhost` inside Docker on macOS doesn't reach the host), and Umami config for `blog_get_stats` (the agent needs `UMAMI_HOST` and `UMAMI_WEBSITE_ID`; the JWT is fetched via the credential bridge at runtime).
`WORKER_MECH_FILTER_MODE=any` and `GITHUB_TOKEN` are set automatically by the docker-run script.
Stale telemetry files are cleaned automatically before the container starts.

### 5. Save telemetry location

```bash
mkdir -p /tmp/jinn-telemetry-worker
cp /tmp/jinn-telemetry/telemetry-*.json /tmp/jinn-telemetry-worker/
echo "TELEMETRY_DIR_WORKER=/tmp/jinn-telemetry-worker" >> .env.e2e
```

### 6. Verify: service:status

After the worker completes, run the status dashboard to verify it shows real activity data:

```bash
cd "$CLONE_DIR" && yarn service:status
```

Expected:
- Epoch info (epoch number, progress bar, time remaining)
- At least one service shows increased request count (from job execution)
- Staking health (slots used, APY, deposit amount)
- Wallet balances (non-zero for funded safes)

### 7. Verify credential bridge probe

In the Docker worker output, look for the credential bridge probe result logged at startup:

```
Worker credential capabilities discovered via bridge
```

Or search for a non-empty providers list (e.g., `providers: ['umami']`).
Note: GitHub is an operator-level credential — it won't appear in bridge capabilities.

If you see `providers: []`, the probe failed — document and continue. Common causes:
- `X402_GATEWAY_URL` not passed via `--env` to Docker (check Step 4 command)
- Gateway not running on :3001 (check Phase 0 gateway checkpoint)
- ACL not seeded with the correct agent address (check Phase 1 Step 4a)
- `No service private key available` — the worker couldn't read the agent key; check `.operate` mount

### 8. Run gateway test suite

After the worker completes, validate the credential bridge independently. From the monorepo root:

```bash
CREDENTIAL_ACL_PATH=.env.e2e.acl.json \
  npx tsx services/x402-gateway/credentials/test-e2e.ts
```

This script spawns its own isolated gateway instances (it does not connect to the running gateway on :3001). `CREDENTIAL_ACL_PATH` is needed because the test imports the ACL module directly.

Expected results:
- ACL tests: All pass (signature, unauthorized, expired, revoked, etc.)
- Static provider test: Pass (venture tokens served from env)
- Payment basic validation: Pass (amount, recipient, expiry, network checks)
- CDP facilitator: `FACILITATOR_REJECTED` for test dummy signatures — this is correct production behavior, not a failure
- Nango tests: Skip (no Nango running locally)
- Rate limit / replay tests: Skip (no Redis running locally)

## Expected Output

- Dispatch: `Dispatched successfully!` with request IDs and `enabledTools: google_web_search, get_file_contents, web_fetch, create_artifact, ...` (8 tools)
- Docker worker: Container starts, worker polls Ponder, finds request, claims it
- Look for: `Multi-service rotation active` with `activeService` and `reason`
- Agent executes: tool calls visible in output:
  - `google_web_search` — agent searched the web
  - `get_file_contents` — agent fetched from GitHub via operator GITHUB_TOKEN (API 401 with dummy token is acceptable)
  - `create_artifact` — agent created an artifact with results
  - `create_measurement` — agent measured GOAL-001 invariant
  - `venture_query` — agent queried the venture registry (may return empty list — that's OK, the tool call is what matters)
  - `dispatch_new_job` — agent dispatched a child job (look for child request ID in output)
  - `blog_get_stats` — agent fetched analytics via credential bridge (Umami JWT from gateway)
- IPFS upload: `Uploaded to IPFS` or similar
- Delivery: On-chain delivery attempted (success or quota error is OK)
- `service:status`: Shows real epoch info and per-service activity data

## On Failure

- **Dispatch fails**: Capture error. Check `OPERATE_PASSWORD`, mech address, RPC quota. Run `yarn test:e2e:vnet status`.
- **Container crashes**: Capture Docker output. Run `docker logs jinn-e2e-worker`. Check if `.operate` mount is correct.
- **Worker finds 0 requests**: Capture Ponder query output. Check `WORKSTREAM_FILTER` matches the dispatch `--workstream`. Check Ponder is indexing (background task output).
- **Agent fails without tool calls**: Capture telemetry. Check `core_tools_enabled` in telemetry config event.
- **venture_query fails with mock client**: Supabase credentials not reaching Docker container. Check `--env` flags in Docker command output. Verify `SUPABASE_URL` is set in host env.
- **dispatch_new_job fails**: Capture error. Agent EOA may need more ETH for the child dispatch transaction.
- **Delivery fails (non-quota)**: Capture error. Check agent private key format (encrypted vs hex). Check agent EOA has ETH.

## CHECKPOINT: Phase 3 — Worker Execution (Docker)

- [PASS|FAIL] Job dispatched (request ID returned, 7 enabled tools listed)
- [PASS|FAIL] Docker container started without crash
- [PASS|FAIL] Worker initialized multi-service rotation (logged "Multi-service rotation active")
- [PASS|FAIL] Worker found and claimed the dispatched request
- [PASS|FAIL] Credential bridge probed at startup — non-empty providers in worker logs (if FAIL, document reason and continue)
- [PASS|FAIL] Agent executed (non-empty output)
- [PASS|FAIL] `google_web_search` succeeded (search results returned, not EXECUTION_ERROR)
- [PASS|FAIL] `get_file_contents` succeeded (GitHub API response returned; 401/403 with dummy token is acceptable, EXECUTION_ERROR is not)
- [PASS|FAIL] `create_artifact` succeeded (IPFS CID returned in output)
- [PASS|FAIL] `create_measurement` succeeded (measurement recorded, not EXECUTION_ERROR)
- [PASS|FAIL] `venture_query` succeeded (query result returned — empty list is OK, EXECUTION_ERROR is FAIL)
- [PASS|FAIL] `dispatch_new_job` succeeded (child request ID visible in output — "Dispatched" confirmation, not error)
- [PASS|FAIL] `blog_get_stats` succeeded (Umami stats returned via credential bridge — bridge error or EXECUTION_ERROR is FAIL)
- [PASS|FAIL] On-chain delivery succeeded (IPFS upload + Safe tx confirmed; Safe GS013 or signature error is FAIL, Tenderly quota error is acceptable)
- [PASS|FAIL] `service:status` showed epoch info and per-service activity
- [PASS|FAIL] Gateway test suite (Step 8): ACL + static provider tests pass

**Grading rule:** A tool returning EXECUTION_ERROR, a credential error, or a bridge failure is FAIL — not PASS. The tool being *called* is necessary but not sufficient. Only mark PASS if the tool returned a usable result.
