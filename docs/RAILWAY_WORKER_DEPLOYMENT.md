# Deploying Jinn Worker to Railway

This guide explains how to deploy the Jinn worker service to Railway.

## Overview

The worker polls Ponder for unclaimed mech requests, executes jobs via Gemini agent, and delivers results on-chain. It requires:

- Access to the Ponder GraphQL endpoint (already on Railway)
- Service credentials (private key, Safe address, mech address)
- RPC access to Base mainnet
- GitHub token for repo cloning (embedded in HTTPS URLs for private repos)
- Gemini API key for agent execution

## Architecture

The Railway deployment runs two services in the same container:
1. **Control API** - Starts first, handles job coordination and status reporting
2. **Worker** - Starts after 3-second delay, polls for jobs and executes them

The start command in `worker/railway.toml`:
```bash
export NODE_OPTIONS='--disable-warning=DEP0040' && npx tsx control-api/server.ts & sleep 3 && node dist/worker/mech_worker.js
```

Key features:
- `NODE_OPTIONS` export suppresses punycode deprecation warnings in child processes
- Control API runs in background, worker runs in foreground
- Railway restart policy (ON_FAILURE, max 10 retries) handles crashes

## Prerequisites

1. Railway CLI installed: `npm install -g @railway/cli`
2. Access to the Oaksprout Railway workspace
3. Access to a configured `.operate` directory with service credentials

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
4. **Important**: In service settings, set the config file to `worker/railway.toml`

Or via CLI:
```bash
railway link
```

## Step 4: Configure Environment Variables

Set these secrets in Railway Dashboard (Settings → Variables) or via CLI:

### Required Variables

```bash
# Service credentials (from Step 1)
railway variables set JINN_SERVICE_PRIVATE_KEY="0x..."
railway variables set JINN_SERVICE_SAFE_ADDRESS="0x..."
railway variables set JINN_SERVICE_MECH_ADDRESS="0x..."

# RPC (use a reliable provider)
railway variables set RPC_URL="https://mainnet.base.org"
# Or use Alchemy/Infura for better reliability:
# railway variables set RPC_URL="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY"

# Ponder GraphQL (reference the existing Ponder service)
# If Ponder is in same project:
railway variables set PONDER_GRAPHQL_URL='${{ponder.RAILWAY_PUBLIC_DOMAIN}}/graphql'
# Or use the production URL directly:
railway variables set PONDER_GRAPHQL_URL="https://jinn-gemini-production.up.railway.app/graphql"

# GitHub (for repo cloning during job execution)
railway variables set GITHUB_TOKEN="ghp_..."

# Gemini API (for agent execution)
railway variables set GEMINI_API_KEY="..."

# Git identity (required for commits)
railway variables set GIT_AUTHOR_NAME="Jinn Worker"
railway variables set GIT_AUTHOR_EMAIL="worker@jinn.network"
```

### Optional Variables

```bash
# Workspace directory for git clones (uses Railway volume)
railway variables set JINN_WORKSPACE_DIR="/app/workspace"

# Control API (runs alongside worker in same container)
# Defaults to http://localhost:4001/graphql when running together
railway variables set USE_CONTROL_API="true"

# Supabase (for Control API backend - job status persistence)
railway variables set SUPABASE_URL="https://..."
railway variables set SUPABASE_SERVICE_ROLE_KEY="..."

# Chain ID (default: 8453 for Base mainnet)
railway variables set CHAIN_ID="8453"

# Workstream filter - multiple formats supported:
# Single address:
railway variables set WORKSTREAM_FILTER="0x7b2e6b9630b621b9773a4afe110c184e6bf052df"
# Comma-separated:
railway variables set WORKSTREAM_FILTER="0x7b2e...,0x87e5..."
# JSON array:
railway variables set WORKSTREAM_FILTER='["0x7b2e...","0x87e5..."]'

# Worker stuck-cycle watchdog (recommended: 5)
# Exit worker after N consecutive cycles with no new work
# Railway restart policy will recover the service
railway variables set WORKER_STUCK_EXIT_CYCLES="5"

# Disable sandbox (Railway uses container isolation)
railway variables set GEMINI_SANDBOX="false"

# Suppress Node.js deprecation warnings (already in start command)
railway variables set NODE_OPTIONS="--disable-warning=DEP0040"
```

## Step 5: Add Persistent Volumes

### Gemini CLI State (Required)

The Gemini CLI stores OAuth credentials in `~/.gemini`. Without a volume, you'd need to re-authenticate after every deploy.

1. In Railway Dashboard, go to service settings
2. Add Volume: mount path `/root/.gemini`
3. Name it `jinn-worker-volume` or similar

### Git Clone Cache (Optional)

For caching git clones across deployments:

1. Add another Volume: mount path `/app/workspace`
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
# - "Using mech address from JINN_SERVICE_MECH_ADDRESS: 0x..."
# - "Using safe address from JINN_SERVICE_SAFE_ADDRESS: 0x..."
# - "Using private key from JINN_SERVICE_PRIVATE_KEY"
# - Polling for unclaimed requests
```

## Monitoring

### Logs
```bash
railway logs -f  # Follow logs
```

### Restart
```bash
railway service restart
```

### Redeploy
```bash
railway up
```

## Troubleshooting

### "No mech address found"
- Check `JINN_SERVICE_MECH_ADDRESS` is set correctly
- Must be a valid 40-character hex address with `0x` prefix

### "Unable to locate repository root"
- This warning is expected when using env var credentials
- The worker falls back to `JINN_SERVICE_*` variables
- Warnings are suppressed when all `JINN_SERVICE_*` env vars are set

### Connection errors to Ponder
- Verify `PONDER_GRAPHQL_URL` is accessible
- Check if the Ponder service is healthy

### Transaction failures
- Ensure the Safe has sufficient ETH for gas
- Check RPC URL is responsive
- Verify the agent address is a signer on the Safe

### Private repository clone failures
- Ensure `GITHUB_TOKEN` has access to the repository
- Token is automatically embedded in HTTPS clone URLs
- Check logs for "GITHUB_TOKEN clone" messages
- SSH URLs are not modified (use standard git auth)

### Worker stuck / not processing jobs
- Set `WORKER_STUCK_EXIT_CYCLES=5` to enable watchdog
- Worker will exit after N consecutive stuck cycles
- Railway restart policy (ON_FAILURE) will recover the service
- Check `WORKSTREAM_FILTER` is set to correct workstream addresses

### Punycode deprecation warnings flooding logs
- `NODE_OPTIONS="--disable-warning=DEP0040"` should be set
- This is already in the start command, but can be added as env var
- Warnings come from dependencies, not Jinn code

### Job status not updating in Control API
- Ensure `USE_CONTROL_API=true` is set
- Check Supabase credentials are correct
- Intermediate statuses (DELEGATING, WAITING) are mapped to valid values

## Security Notes

1. **Private Key**: Stored encrypted by Railway. Only accessible to project members.
2. **Container Isolation**: Railway containers are isolated. The agent can only access what's explicitly provided.
3. **No Additional Sandbox**: The macOS `sandbox-exec` doesn't work on Linux. Railway's container isolation is sufficient for a dedicated project.

## Files Reference

- `worker/railway.toml` - Railway service configuration
- `worker/nixpacks.toml` - Build configuration (Node.js + Python + Gemini CLI)
- `.railwayignore` - Excludes unnecessary files from build
- `env/operate-profile.ts` - Credential loading logic (supports env var fallback)

## Current Deployment

The `jinn-worker` project is already deployed in Railway (Oaksprout workspace):

**Services:**
- Worker + Control API running in same container
- Volume mounted at `/root/.gemini` for Gemini CLI OAuth state

**Configuration:**
- `WORKSTREAM_FILTER` set to specific workstream addresses
- `WORKER_STUCK_EXIT_CYCLES=5` for automatic recovery
- `USE_CONTROL_API=true` for job status tracking
- Supabase backend for Control API persistence

**Build:**
- Node.js 22 via Nixpacks
- Python 3 for OLAS middleware operations
- Gemini CLI installed globally (`npm install -g @google/gemini-cli`)
- Symlink created: `/usr/bin/gemini` → gemini binary

## Recent Fixes (for context)

These issues were encountered and fixed during initial deployment:

1. **Private repo cloning** (2ab469e): GITHUB_TOKEN now embedded in HTTPS URLs
2. **Child process warnings** (e5ab205): NODE_OPTIONS exported to suppress deprecation
3. **Job status mapping** (193926d): Intermediate statuses properly mapped for DB
4. **Multi-workstream support** (abd0532): WORKSTREAM_FILTER supports arrays
5. **Stuck worker recovery** (ad8da3f): WORKER_STUCK_EXIT_CYCLES watchdog added
