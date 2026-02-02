---
title: Deploying Jinn Worker to Railway
purpose: runbook
scope: [worker, deployment]
last_verified: 2026-01-30
related_code:
  - deploy/worker-default/
  - deploy/control-api/
  - deploy/ponder/
  - worker/mech_worker.ts
keywords: [railway, worker, deployment, control-api, ponder, gemini]
when_to_read: "When deploying or updating the Jinn worker service on Railway"
---

# Deploying Jinn Worker to Railway

This guide explains how to deploy the Jinn worker service to Railway.

## Overview

The worker polls Ponder for unclaimed mech requests, executes jobs via Gemini agent, and delivers results on-chain. It requires:

- Access to the Ponder GraphQL endpoint
- Service credentials (private key, Safe address, mech address)
- RPC access to Base mainnet
- GitHub token for repo cloning
- Gemini API key or OAuth credentials for agent execution

## Architecture

The Railway deployment consists of multiple independent services:

| Service | Config Location | Purpose |
|---------|-----------------|---------|
| **Worker** | `deploy/worker-default/` | Polls for jobs, executes Gemini agent |
| **Control API** | `deploy/control-api/` | Job coordination and status reporting |
| **Ponder** | `deploy/ponder/` | Blockchain indexer |
| **X402 Gateway** | `deploy/x402-gateway/` | Payment gateway (optional) |

Each service has its own Railway service with separate scaling, volumes, and environment variables.

### Worker Start Command

The worker start command in `deploy/worker-default/railway.toml`:
```bash
export NODE_OPTIONS='--disable-warning=DEP0040' && bash deploy/worker-default/init.sh && node dist/worker/worker_launcher.js
```

- `NODE_OPTIONS` suppresses punycode deprecation warnings in child processes
- `init.sh` configures git identity, SSH known_hosts, and credentials
- `worker_launcher.js` provides healthcheck server, multi-process support, and graceful shutdown

## Worker Initialization

The worker runs `deploy/worker-default/init.sh` before starting to configure the environment from Railway env vars:

| Configuration | Source Env Var | Persisted To |
|--------------|----------------|--------------|
| Git identity | `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | `~/.gitconfig` |
| SSH known_hosts | (ssh-keyscan github.com) | `~/.ssh/known_hosts` |
| Git credentials | `GITHUB_TOKEN` | `~/.git-credentials` |
| Directories | `JINN_WORKSPACE_DIR` | `~/.gemini/`, workspace |

Expected logs on startup:
```
[init] Set git user.name to: Jinn
[init] Set git user.email to: worker@jinn.network
[init] Added github.com to known_hosts
[init] Created .git-credentials with GitHub token
[init] Ensured ~/.gemini exists
[init] Worker initialization complete
```

## Prerequisites

1. Railway CLI installed: `npm install -g @railway/cli`
2. Access to the Oaksprout Railway workspace
3. Service credentials (private key, Safe address, mech address)

## Step 1: Extract Credentials

From a machine with the configured `.operate` directory, extract the required values:

```bash
# Navigate to the repo
cd jinn-cli-agents

# Get the agent address
AGENT_ADDR=$(cat olas-operate-middleware/.operate/services/*/config.json | jq -r '.chain_configs.base.chain_data.instances[0]')
echo "Agent Address: $AGENT_ADDR"

# Get the private key (SENSITIVE - don't log this!)
PRIVATE_KEY=$(cat "olas-operate-middleware/.operate/keys/$AGENT_ADDR" | jq -r '.private_key')

# Get the Safe address
SAFE_ADDR=$(cat olas-operate-middleware/.operate/services/*/config.json | jq -r '.chain_configs.base.chain_data.multisig')
echo "Safe Address: $SAFE_ADDR"

# Get the Mech address
MECH_ADDR=$(cat olas-operate-middleware/.operate/services/*/config.json | jq -r '.env_variables.MECH_TO_CONFIG.value' | jq -r 'keys[0]')
echo "Mech Address: $MECH_ADDR"
```

## Step 2: Create Railway Project

```bash
# Login to Railway
railway login

# Create a new project in Oaksprout workspace
railway init

# When prompted:
# - Select "Oaksprout" workspace
# - Create new project: "jinn-worker"
```

## Step 3: Link the Repository

In Railway Dashboard:
1. Go to the new project
2. Click "Add Service" → "GitHub Repo"
3. Select `jinn-cli-agents` repository
4. **Important**: In service settings, set the config file to `deploy/worker-default/railway.toml`

Or via CLI:
```bash
railway link
```

## Step 4: Configure Environment Variables

Set these in Railway Dashboard (Settings → Variables) or via CLI:

### Required Variables

```bash
# Service credentials
railway variables set JINN_SERVICE_PRIVATE_KEY="0x..."
railway variables set JINN_SERVICE_SAFE_ADDRESS="0x..."
railway variables set JINN_SERVICE_MECH_ADDRESS="0x..."

# RPC (use a reliable provider)
railway variables set RPC_URL="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY"

# Ponder GraphQL
railway variables set PONDER_GRAPHQL_URL="https://ponder-production.up.railway.app/graphql"

# Control API
railway variables set CONTROL_API_URL="https://control-api-production.up.railway.app/graphql"

# GitHub (for repo cloning and pushing)
railway variables set GITHUB_TOKEN="ghp_..."

# Git identity (used by init.sh for commits)
railway variables set GIT_AUTHOR_NAME="Jinn Worker"
railway variables set GIT_AUTHOR_EMAIL="worker@jinn.network"

# Gemini (choose one auth method)
# Option A: API Key
railway variables set GEMINI_API_KEY="..."
# Option B: OAuth credentials (supports multi-credential rotation)
railway variables set GEMINI_OAUTH_CREDENTIALS='[{"oauth_creds":{...},"google_accounts":{...}}]'
```

### Optional Variables

```bash
# Worker identification
railway variables set WORKER_ID="worker-community-1"

# Delay between jobs (ms, default: 0)
railway variables set WORKER_JOB_DELAY_MS="120000"

# Workspace directory for git clones
railway variables set JINN_WORKSPACE_DIR="/app/workspace"

# Workstream filter - multiple formats supported:
railway variables set WORKSTREAM_FILTER="0x7b2e..."  # Single
railway variables set WORKSTREAM_FILTER="0x7b2e...,0x87e5..."  # Comma-separated
railway variables set WORKSTREAM_FILTER='["0x7b2e...","0x87e5..."]'  # JSON array

# Worker stuck-cycle watchdog (recommended: 5)
railway variables set WORKER_STUCK_EXIT_CYCLES="5"

# Chain ID (default: 8453 for Base mainnet)
railway variables set CHAIN_ID="8453"

# Disable Gemini sandbox (Railway uses container isolation)
railway variables set GEMINI_SANDBOX="false"

# Blueprint features
railway variables set BLUEPRINT_ENABLE_BEADS="false"
railway variables set BLUEPRINT_ENABLE_CONTEXT_PHASES="false"
```

## Step 5: Add Persistent Volumes

### Home Directory Volume (Recommended)

Mount `/root` to persist all worker state:
- Git config (`~/.gitconfig`) - configured by init.sh
- SSH known_hosts (`~/.ssh/known_hosts`) - configured by init.sh
- Git credentials (`~/.git-credentials`) - configured by init.sh
- Gemini OAuth (`~/.gemini/`) - managed by worker code, preserves refreshed tokens

1. In Railway Dashboard, go to worker service settings
2. Add Volume: mount path `/root`
3. Name it `worker-home-volume`

### Git Clone Cache (Optional)

For faster job startup with cached repos:

1. Add Volume: mount path `/app/workspace`
2. Set `JINN_WORKSPACE_DIR=/app/workspace` in variables

## Step 6: Deploy

```bash
# Deploy from local
railway up

# Or let Railway auto-deploy from GitHub
# (configure in service settings)
```

## Step 7: Verify

```bash
# Check logs
railway logs

# You should see:
# - [init] messages showing git config
# - "Using mech address from JINN_SERVICE_MECH_ADDRESS: 0x..."
# - "Using safe address from JINN_SERVICE_SAFE_ADDRESS: 0x..."
# - Polling for unclaimed requests
```

## Monitoring

### Logs
```bash
railway logs -f  # Follow logs
railway logs --lines 500  # Last 500 lines
```

### Restart
```bash
railway service restart
```

### Redeploy
```bash
railway up
# or
railway deployment redeploy --yes
```

## Troubleshooting

### Git commit identity errors
```
fatal: unable to auto-detect email address
```
- Ensure `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` are set in Railway variables
- Check logs for `[init] Set git user.name` messages
- Volume must be mounted at `/root` to persist config between deploys

### Deprecated model errors (404)
```
ModelNotFoundError: Requested entity was not found (404)
```
- Jobs with deprecated models (e.g., `gemini-2.0-flash-thinking-exp`) now auto-fallback to default
- Check logs for "Deprecated model detected, falling back to default"
- New job dispatches with deprecated models are rejected with helpful error message

### OAuth quota exhausted
```
RESOURCE_EXHAUSTED: Quota exceeded
```
- Set `GEMINI_OAUTH_CREDENTIALS` with multiple credential sets for automatic rotation
- Worker automatically rotates to next credential when quota exhausted
- Check logs for "Selecting credential with available quota"

### "No mech address found"
- Check `JINN_SERVICE_MECH_ADDRESS` is set correctly
- Must be a valid 40-character hex address with `0x` prefix

### Connection errors to Ponder
- Verify `PONDER_GRAPHQL_URL` is accessible
- Check if the Ponder service is healthy in Railway dashboard

### Transaction failures
- Ensure the Safe has sufficient ETH for gas
- Check RPC URL is responsive
- Verify the agent address is a signer on the Safe

### Private repository clone failures
- Ensure `GITHUB_TOKEN` has access to the repository
- Token is automatically configured in `~/.git-credentials` by init.sh
- Check logs for `[init] Created .git-credentials` message

### Worker stuck / not processing jobs
- Set `WORKER_STUCK_EXIT_CYCLES=5` to enable watchdog
- Worker will exit after N consecutive stuck cycles
- Railway restart policy (ON_FAILURE) will recover the service
- Check `WORKSTREAM_FILTER` is set to correct workstream addresses

## Security Notes

1. **Private Key**: Stored encrypted by Railway. Only accessible to project members.
2. **Container Isolation**: Railway containers are isolated. The agent can only access what's explicitly provided.
3. **OAuth Tokens**: Stored in `~/.gemini/` on volume. Refreshed tokens are preserved between jobs.

## Files Reference

| File | Purpose |
|------|---------|
| `deploy/worker-default/railway.toml` | Worker Railway service configuration |
| `deploy/worker-default/nixpacks.toml` | Worker build configuration (Node.js + Gemini CLI) |
| `deploy/worker-default/init.sh` | Worker startup initialization script |
| `deploy/control-api/railway.toml` | Control API service configuration |
| `deploy/ponder/railway.toml` | Ponder indexer service configuration |
| `.railwayignore` | Excludes unnecessary files from build |

## Current Deployment

The `jinn-worker` project is deployed in Railway (Oaksprout workspace):

**Services:**
- Worker running standalone with init.sh
- Control API as separate service
- Ponder indexer as separate service
- Volume mounted at `/root` for persistent state

**Configuration:**
- `WORKSTREAM_FILTER` set to specific workstream addresses
- `WORKER_STUCK_EXIT_CYCLES=5` for automatic recovery
- `GEMINI_OAUTH_CREDENTIALS` for multi-credential quota rotation

**Build:**
- Node.js 22 via Nixpacks
- Gemini CLI installed globally (`npm install -g @google/gemini-cli`)
- Symlink created: `/usr/bin/gemini` → gemini binary

## Recent Fixes

These issues were encountered and fixed:

1. **Private repo cloning** (2ab469e): GITHUB_TOKEN embedded in HTTPS URLs
2. **Child process warnings** (e5ab205): NODE_OPTIONS exported to suppress deprecation
3. **Job status mapping** (193926d): Intermediate statuses properly mapped for DB
4. **Multi-workstream support** (abd0532): WORKSTREAM_FILTER supports arrays
5. **Stuck worker recovery** (ad8da3f): WORKER_STUCK_EXIT_CYCLES watchdog added
6. **Separate services architecture**: Control API now runs as separate Railway service
7. **Worker init script** (32aa933): Git identity and credentials configured on startup
8. **Deprecated model fallback** (f64f47d): Jobs with deprecated models fallback to default
9. **OAuth multi-credential rotation** (69916d5): Automatic failover when quota exhausted
10. **Token preservation on volume** (5af4757): Refreshed OAuth tokens persist between jobs
