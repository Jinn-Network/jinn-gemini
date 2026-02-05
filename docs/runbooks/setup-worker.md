---
title: Mech Worker Setup
purpose: runbook
scope: [worker, deployment]
last_verified: 2026-01-30
related_code:
  - worker/mech_worker.ts
  - worker/config.ts
  - worker/orchestration/jobRunner.ts
  - worker/control_api_client.ts
  - config/index.ts
  - env/operate-profile.ts
  - control-api/server.ts
  - package.json
keywords: [worker setup, mech worker, installation, configuration, Railway, deployment]
when_to_read: "Use when setting up a new worker, configuring environment variables, or troubleshooting worker startup"
---

# Mech Worker Setup Runbook

This runbook provides step-by-step instructions for setting up and running a Jinn mech worker. The worker polls Ponder for unclaimed on-chain mech requests, executes jobs via a Gemini agent, and delivers results on-chain via a Gnosis Safe.

## Overview

The mech worker is the core execution component that:

1. Connects to Ponder GraphQL to discover unclaimed requests
2. Claims requests via the Control API
3. Executes jobs using the Gemini CLI agent
4. Delivers results on-chain via Safe transactions
5. Reports telemetry and artifacts to the Control API

## Prerequisites

Before starting, ensure you have:

- [ ] Node.js v22.0.0 or higher installed
- [ ] Yarn package manager (v1.22.x)
- [ ] Access to an RPC endpoint for Base mainnet (8453) or Base Sepolia (84532)
- [ ] A configured `.operate` directory with service credentials, OR environment variables for Railway deployment
- [ ] Gemini API key for agent execution
- [ ] GitHub token for repository operations (if working with code-based jobs)
- [ ] Supabase project credentials (for Control API backend)

## Step 1: Install Dependencies

```bash
# Clone the repository if not already done
git clone <repository-url>
cd jinn-gemini-3

# Install all dependencies
yarn install

# Build the worker and MCP server
yarn build
```

## Step 2: Configure Environment Variables

Copy the template and configure your environment:

```bash
cp .env.template .env
```

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `RPC_URL` | HTTP RPC endpoint for the target blockchain | `https://mainnet.base.org` |
| `CHAIN_ID` | Network identifier (8453 = Base mainnet, 84532 = Base Sepolia) | `8453` |
| `GEMINI_API_KEY` | Google Gemini API key for agent execution | `AIza...` |
| `PONDER_GRAPHQL_URL` | Ponder GraphQL endpoint (defaults to Railway production) | `https://ponder-production-6d16.up.railway.app/graphql` |
| `CONTROL_API_URL` | Control API GraphQL endpoint | `http://localhost:4001/graphql` |

### Service Credentials

Service credentials can come from two sources:

**Option A: `.operate` Directory (Local Development)**

The worker reads credentials from `olas-operate-middleware/.operate/services/*/config.json`:

- Mech address from `env_variables.MECH_TO_CONFIG`
- Safe address from `chain_configs.<chain>.chain_data.multisig`
- Private key from `keys/<agent_address>`

**Option B: Environment Variables (Railway/Production)**

| Variable | Description |
|----------|-------------|
| `JINN_SERVICE_MECH_ADDRESS` | Mech contract address (0x...) |
| `JINN_SERVICE_SAFE_ADDRESS` | Gnosis Safe multisig address (0x...) |
| `JINN_SERVICE_PRIVATE_KEY` | Agent EOA private key (0x...) |

### Optional Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKSTREAM_FILTER` | Filter to specific workstream(s). Supports single, comma-separated, or JSON array | None (all workstreams) |
| `WORKER_STUCK_EXIT_CYCLES` | Exit after N consecutive stuck cycles (for auto-recovery) | None |
| `WORKER_JOB_DELAY_MS` | Delay (ms) after each job before next poll | `0` |
| `WORKER_POLL_BASE_MS` | Base polling interval | `30000` |
| `WORKER_POLL_MAX_MS` | Maximum polling interval (adaptive backoff) | `300000` |
| `JINN_WORKSPACE_DIR` | Directory for cloning venture repositories | `~/jinn-repos` |
| `GITHUB_TOKEN` | GitHub PAT for repository operations | None |
| `GIT_AUTHOR_NAME` | Git author name for agent commits | None |
| `GIT_AUTHOR_EMAIL` | Git author email for agent commits | None |
| `GEMINI_SANDBOX` | Sandbox mode: `sandbox-exec`, `docker`, `podman`, `false` | `sandbox-exec` |

## Step 3: Set Up Control API

```bash
# Add to .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Start
yarn control:dev
```

Verify: `curl -X POST http://localhost:4001/graphql -H "Content-Type: application/json" -d '{"query": "{ __typename }"}'`

## Step 4: Set Up Ponder

**Production:** Use default `PONDER_GRAPHQL_URL=https://ponder-production-6d16.up.railway.app/graphql`

**Local:** `yarn ponder:dev` (port 42069)

## Step 5: Start the Worker

### Development Mode

```bash
# With pretty-printed logs (recommended for development)
yarn dev:mech

# Raw logs (no formatting)
yarn dev:mech:raw

# Single job execution (process one request then exit)
yarn dev:mech --single

# Limited runs
yarn dev:mech --runs=10
```

### Production Mode

```bash
# Build first
yarn build

# Start the worker
yarn worker:start
```

### Parallel Workers

For processing multiple workstreams simultaneously:

```bash
# Run 3 parallel workers for a specific workstream
yarn dev:mech:parallel --workers=3 --workstream=0x...

# With limited runs per worker
yarn dev:mech:parallel -w 3 -s 0x... --runs=10
```

## Step 6: Verify Worker Operation

### Check Logs

A healthy worker will show:

```
Using mech address from JINN_SERVICE_MECH_ADDRESS: 0x...
Using safe address from JINN_SERVICE_SAFE_ADDRESS: 0x...
Control API health check passed
Mech worker starting
Fetching requests from Ponder
```

### Monitor Job Processing

When the worker claims and processes a job:

```
Processing request
├── jobName: "example-job"
├── requestId: "0x..."
└── workstreamId: "0x..."

Execution completed - status inferred
├── status: "COMPLETED"
└── message: "Job completed successfully"

Delivered via Safe
├── txHash: "0x..."
└── status: "executed"
```

## CLI Flags Reference

| Flag | Description |
|------|-------------|
| `--single` | Process one request then exit |
| `--runs=<N>` | Process up to N requests then exit |
| `--max-cycles=<N>` | Maximum cycles for cyclic workstreams |
| `--stuck-exit-cycles=<N>` | Exit after N consecutive idle cycles |
| `--workstream=<id>` | Filter to specific workstream address |

## Troubleshooting

| Problem | Possible Cause | Solution |
|---------|---------------|----------|
| "Missing service mech address" | Credentials not configured | Set `JINN_SERVICE_*` env vars or configure `.operate` directory |
| "Control API health check failed" | Control API not running | Start with `yarn control:dev` |
| "No unclaimed on-chain requests found" | No pending work | Normal when idle; check `WORKSTREAM_FILTER` if expecting work |
| "Ponder GraphQL not reachable" | Incorrect URL or Ponder down | Verify `PONDER_GRAPHQL_URL` and Ponder status |
| "Claim failed: already claimed" | Another worker claimed first | Normal in multi-worker setups; worker will try next request |
| "Safe delivery failed" | Insufficient gas or incorrect signer | Verify Safe has ETH and agent is a signer |
| "Git push failed" | Missing GitHub token or permissions | Set `GITHUB_TOKEN` with repo access |
| Worker stuck in loop | Agent execution issues | Set `WORKER_STUCK_EXIT_CYCLES` for auto-recovery |

## Key Files

| File | Purpose |
|------|---------|
| `worker/mech_worker.ts` | Main worker loop |
| `worker/orchestration/jobRunner.ts` | Job execution |
| `config/index.ts` | Configuration with Zod validation |

See `docs/context/system-overview.md` for full architecture.
