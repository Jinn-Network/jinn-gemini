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

Default blueprint (`blueprints/e2e-infrastructure-test.json`): Six invariants exercising 6 tools across 4 credential types:
- `google_web_search` — Gemini CLI OAuth (file mount)
- `create_artifact` — Agent private key (on-chain IPFS)
- `create_measurement` — Internal measurement system
- `venture_query` — Supabase credentials (env var)
- `dispatch_new_job` — Agent private key + mech address (on-chain delegation)

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

Wait a few seconds for Ponder to index the marketplace request. Clear telemetry and run in **single mode** (`--single`) so the worker exits after processing one job, leaving the child dispatch for Phase 4:
```bash
rm -rf /tmp/jinn-telemetry
yarn test:e2e:docker-run --cwd "$CLONE_DIR" --single \
  --workstream 0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac \
  --env SUPABASE_URL=$SUPABASE_URL \
  --env SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
```

The `--single` flag makes the worker exit after processing one request, preserving the child job for Phase 4's rotation test.
The `--workstream` flag sets `WORKSTREAM_FILTER` to only process requests in this workstream.
The `--env` flags pass Supabase credentials for `venture_query`.
`WORKER_MECH_FILTER_MODE=any` is set automatically (cross-mech job pickup).

### 5. Save telemetry location

```bash
echo "TELEMETRY_DIR_WORKER=/tmp/jinn-telemetry" >> .env.e2e
# Copy telemetry to a named location before Phase 4 clears it
cp -r /tmp/jinn-telemetry /tmp/jinn-telemetry-worker
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

## Expected Output

- Dispatch: `Dispatched successfully!` with request IDs and `enabledTools: google_web_search, web_fetch, create_artifact, ...`
- Docker worker: Container starts, worker polls Ponder, finds request, claims it
- Look for: `Multi-service rotation active` with `activeService` and `reason`
- Agent executes: tool calls visible in output:
  - `google_web_search` — agent searched the web
  - `create_artifact` — agent created an artifact with results
  - `create_measurement` — agent measured GOAL-001 invariant
  - `venture_query` — agent queried the venture registry (may return empty list — that's OK, the tool call is what matters)
  - `dispatch_new_job` — agent dispatched a child job (look for child request ID in output)
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

- [PASS|FAIL] Job dispatched (request ID returned, 6 enabled tools listed)
- [PASS|FAIL] Docker container started without crash
- [PASS|FAIL] Worker initialized multi-service rotation (logged "Multi-service rotation active")
- [PASS|FAIL] Worker found and claimed the dispatched request
- [PASS|FAIL] Agent executed (non-empty output)
- [PASS|FAIL] `google_web_search` called (web search tool)
- [PASS|FAIL] `create_artifact` called (IPFS artifact)
- [PASS|FAIL] `create_measurement` called (measurement system)
- [PASS|FAIL] `venture_query` called (credential-dependent tool)
- [PASS|FAIL] `dispatch_new_job` called (delegation — child request ID visible)
- [PASS|FAIL] On-chain delivery attempted (success or quota error OK)
- [PASS|FAIL] `service:status` showed epoch info and per-service activity
