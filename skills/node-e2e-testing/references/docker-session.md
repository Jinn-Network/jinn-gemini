# Docker Session

Tests: Setup (bare) → Docker build → Docker worker execution with tool use → Healthcheck → IPFS upload → On-chain delivery.

**Prerequisite**: Complete the shared steps (Infrastructure + Setup) from SKILL.md first. Setup runs bare — the Docker image doesn't include Python/Poetry.

**Shell variables**: Commands below use `$CLONE_DIR`. Resolve to the absolute path before running — shell state does not persist between separate bash calls.

## Build the Docker Image

From the monorepo root:
```bash
docker build -f jinn-node/Dockerfile jinn-node/ -t jinn-node:e2e
```

This validates the multi-stage build: TypeScript compilation, Chromium install, Gemini CLI pre-install, production dependency pruning.

If the build fails with `ECONNRESET` on the Gemini CLI install, retry — earlier layers are cached.

## Dispatch a Job

Same as the worker session — from the monorepo root:
```bash
yarn test:e2e:dispatch \
  --workstream 0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac \
  --cwd "$CLONE_DIR"
```

## Fund the Agent EOA

```bash
yarn test:e2e:vnet fund <agent-eoa-address> --eth 0.01
```

## Run the Worker via Docker

Wait a few seconds for Ponder to index the marketplace request, then:

```bash
yarn test:e2e:docker-run --cwd "$CLONE_DIR" --single
```

The wrapper script handles:
- macOS detection (`host.docker.internal` vs `localhost`)
- Individual auth file mounts (avoids host extension symlinks crashing the CLI)
- All fixed env vars (`GEMINI_SANDBOX`, `OPERATE_PROFILE_DIR`, etc.)
- `--shm-size=2g` for Chromium

## Verify Healthcheck (optional)

```bash
yarn test:e2e:docker-run --cwd "$CLONE_DIR" --healthcheck
```

Wait ~60s for startup, then:
```bash
curl http://localhost:8080/health
# Should return JSON with status, nodeId, uptime, processedJobs

docker stop jinn-e2e-healthcheck && docker rm jinn-e2e-healthcheck
```

## Verify Tool Use

Run with telemetry capture:
```bash
yarn test:e2e:docker-run --cwd "$CLONE_DIR" --telemetry
```

The `--telemetry` flag mounts `/tmp/jinn-telemetry:/tmp` so telemetry files are accessible on the host after the container exits.

Then parse telemetry using the streaming parser from [worker-session.md](worker-session.md#step-1-parse-telemetry-and-check-tool-configuration).

## Expected Flow

1. **Build** — Docker image compiles TypeScript, installs Chromium + Gemini CLI
2. **Poll** — Containerized worker queries Ponder, finds 1 undelivered request
3. **Claim** — Worker claims the job via Control API
4. **Execute** — Spawns Gemini CLI agent with MCP tools (uses pre-installed CLI)
5. **Tool use** — Agent calls `google_web_search` and `create_artifact`
6. **Upload** — Result uploaded to IPFS
7. **Deliver** — On-chain delivery via Safe transaction

## Debugging Sources

Always report these paths at session end for investigation:

- **Docker worker output**: stdout from `yarn test:e2e:docker-run`
- **Telemetry file**: `/tmp/jinn-telemetry/telemetry-*.json` (when `--telemetry` used)
- **Docker logs**: `docker logs jinn-e2e-worker` (if container still running)
- **Ponder logs**: Background stack output (task output file)
- **Clone directory**: `$CLONE_DIR` — contains `.env`, `.operate/`, service config
- **VNet config**: `.env.e2e` — VNet RPC URL and session state

## Acceptable Failures

- **Delivery fails with 403 (quota exhausted)**: OK — the key validation is Docker execution with tool use + IPFS upload.
- **Chromium sandbox warning**: Expected — `GEMINI_SANDBOX=false` disables macOS sandbox (unavailable in Linux containers).

## Success Criteria

- [ ] Docker image builds successfully
- [ ] Container starts without crash
- [ ] Worker found and claimed the dispatched request
- [ ] Agent called `google_web_search` at least once
- [ ] Agent called `create_artifact` at least once
- [ ] Result was uploaded to IPFS
- [ ] On-chain delivery attempted (success or quota error)
- [ ] Healthcheck returns valid JSON (if tested)
