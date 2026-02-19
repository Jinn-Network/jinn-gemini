---
name: ponder-deploy
description: Safely deploy Ponder indexer changes to Railway. Use when updating Ponder schema, indexing logic, or config. Covers sandbox-first workflow, schema versioning, backfill monitoring, and rollback.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Safe Ponder Deployment

Deploy Ponder indexer changes without breaking production. Every code or config change triggers a full re-index (hours of downtime if done in-place), so all deployments go through a sandbox-first pattern.

## Why This Matters

Ponder computes a `build_id` = SHA-256 hash of:
```
BUILD_ID_VERSION + config.contentHash + schema.contentHash + indexingFunctions.contentHash
```

ANY change to config, schema, or `index.ts` produces a new build_id. If the build_id doesn't match the existing schema, Ponder drops all data and re-indexes from scratch. During backfill it serves no data. Production goes dark.

---

## 1. Safe Update Workflow

### Step 1: Create Sandbox Project

```bash
# Create a new Railway project for the sandbox
railway project create "ponder-sandbox"

# Add Postgres (use Railway's template or add a plugin)
# Then create a Ponder service in the project
```

### Step 2: Configure Environment Variables

Set all required env vars on the sandbox Ponder service. Use Railway variable references for Postgres:

```bash
railway variables set \
  PONDER_DATABASE_URL='${{Postgres.DATABASE_URL}}' \
  PONDER_SCHEMA_VERSION='jinn_sandbox_v1' \
  PONDER_VIEWS_SCHEMA='jinn_sandbox_public' \
  PONDER_FACTORY_START_BLOCK='36000000' \
  PONDER_START_BLOCK='36000000' \
  PONDER_PORT='42069' \
  PONDER_RPC_URL='<tenderly-gateway-url>' \
  RPC_URL='<tenderly-gateway-url>' \
  BASE_LEDGER_RPC='<tenderly-gateway-url>' \
  MECH_ADDRESS='0x8c083Dfe9bee719a05Ba3c75A9B16BE4ba52c299' \
  -s ponder
```

### Step 3: Set Deploy Trigger to Feature Branch

Do NOT use `railway up` -- the monorepo is too large. Use GitHub branch deploy triggers instead:

```bash
# Get the trigger ID first
railway triggers list -s ponder

# Then set branch via GraphQL (see Section 8)
```

### Step 4: Deploy and Wait for Backfill

```bash
# Generate a public domain
railway domain -s ponder

# Watch logs for backfill progress
railway logs -s ponder --lines 200
```

Wait for the `/ready` endpoint to return 200. This means backfill is complete. Backfill from block 36M typically takes 30-60 minutes depending on RPC speed.

### Step 5: Verify Data Quality

Query the sandbox GraphQL endpoint and compare against production:

- Workstream count matches (or exceeds) production
- `jobName` fields are populated (not null)
- Recent deliveries are indexed
- `ventureId` / `templateId` fields populated where expected

### Step 6: Swap Frontend to Sandbox

Update the frontend's `PONDER_GRAPHQL_URL` (or equivalent) to point at the sandbox URL. Verify the UI loads correctly.

### Step 7: Decommission Old Deployment

- Stop (do NOT delete) the old production Ponder service
- Keep it available for 48 hours as a rollback target
- After confirming stability, delete the old service and rename sandbox to production

---

## 2. Schema Version Rules

| Env Var | Controls | Naming Convention |
|---------|----------|-------------------|
| `PONDER_SCHEMA_VERSION` | Postgres schema for indexed data | `jinn_shared_v{N}` (prod), `jinn_sandbox_v{N}` (sandbox) |
| `PONDER_VIEWS_SCHEMA` | Postgres schema for client-facing views | `jinn_shared_public` (prod), `jinn_sandbox_public` (sandbox) |

**Rules:**
- ALWAYS set `PONDER_SCHEMA_VERSION`. Without it, each deploy creates an orphaned schema with a random name.
- ALWAYS bump the version number when deploying new code. Even a one-line change to `index.ts` changes the build_id.
- Two Ponder instances must NEVER share the same `PONDER_VIEWS_SCHEMA` -- they will overwrite each other's views.
- Env var changes (like `PONDER_START_BLOCK`) also change the build_id via config hash.

**Current production:** `jinn_shared_v7`

---

## 3. Environment Variable Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `PONDER_DATABASE_URL` | Postgres connection string | `${{Postgres.DATABASE_URL}}` |
| `PONDER_SCHEMA_VERSION` | Schema name for indexed data | `jinn_sandbox_v1` |
| `PONDER_VIEWS_SCHEMA` | Schema name for client views | `jinn_sandbox_public` |
| `PONDER_FACTORY_START_BLOCK` | Block to start factory indexing | `36000000` |
| `PONDER_START_BLOCK` | Block to start event indexing | `36000000` |
| `PONDER_PORT` | HTTP server port | `42069` |
| `PONDER_RPC_URL` | Base chain RPC URL | Tenderly gateway |
| `RPC_URL` | Alias used by some code paths | Same as `PONDER_RPC_URL` |
| `BASE_LEDGER_RPC` | Another RPC alias | Same as `PONDER_RPC_URL` |
| `MECH_ADDRESS` | Mech contract to index | `0x8c083Dfe9bee719a05Ba3c75A9B16BE4ba52c299` |

---

## 4. Monitoring Checklist

**During backfill:**
- [ ] `/ready` endpoint returns 200 when backfill complete (503 during backfill)
- [ ] Build logs show "nixpacks" builder (NOT railpack)
- [ ] Deploy logs: no IPFS timeouts (cloudflare-ipfs.com is dead -- must use ipfs.io)
- [ ] Deploy logs: no RPC rate-limit errors
- [ ] Block numbers in logs are advancing toward chain head

**After backfill:**
- [ ] GraphQL endpoint responds
- [ ] Workstream count matches production
- [ ] `jobName` fields populated (not null) on recent requests
- [ ] `ventureId` / `templateId` populated where expected
- [ ] `lastStatus` / `latestStatusUpdate` populated on workstreams

---

## 5. Rollback Procedure

**If sandbox fails verification:**
1. Frontend stays pointed at old production -- no action needed
2. Fix issues in sandbox, redeploy, re-verify

**If new production crashes after swap:**
1. Point frontend back to old production URL
2. Stop the new (broken) service
3. Restart old production service
4. Investigate and fix before retrying

**Key:** Never delete the old production service until the new one has been stable for 48+ hours.

---

## 6. Gotchas

- **build_id = full re-index**: ANY change to config, schema, or indexing code means the entire index rebuilds from scratch. There is no incremental migration. You cannot `ALTER TABLE` to avoid it.
- **cloudflare-ipfs.com is DEAD**: Returns ENOTFOUND. Use `ipfs.io` for IPFS gateway. This was causing 5-10s delays per request during backfill.
- **Railway auto-migrates to RAILPACK**: Services may silently switch from NIXPACKS to RAILPACK, breaking the build. Fix with the `serviceInstanceUpdate` GraphQL mutation (set `builder: NIXPACKS`).
- **`railway up` is too slow for monorepo**: The upload is too large and times out. Use GitHub branch deploy triggers instead.
- **Views-schema collision**: If two Ponder instances share the same `PONDER_VIEWS_SCHEMA`, they overwrite each other's views. Always use distinct values.
- **Orphaned schemas accumulate**: Without `PONDER_SCHEMA_VERSION`, each deploy creates a new schema with a generated name. These pile up in Postgres and waste storage.
- **Ponder filter syntax is flat**: Use `where: { field: $var, field_gte: $val }`, NOT nested `{ field: { equals: $var } }`. Ponder is not standard GraphQL filter syntax.
- **Build optimization**: `rm -rf frontend packages` before `yarn install` in the build phase to skip workspace deps unused by Ponder. Cuts build from 16min to ~97s. Configured in `deploy/ponder/nixpacks.toml`.
- **Old schemas cleanup**: Run periodic cleanup of orphaned schemas. 190 were cleaned in Feb 2026.

---

## 7. Railway Commands Reference

```bash
# Create project
railway project create "ponder-sandbox"

# List services
railway service list

# Set env vars on a service
railway variables set KEY=VALUE -s ponder

# Generate public domain
railway domain -s ponder

# Check logs
railway logs -s ponder --lines 100

# List deploy triggers
railway triggers list -s ponder
```

---

## 8. Deploy Trigger Configuration

Use the Railway GraphQL API to set the deploy trigger to a specific branch and config file:

```bash
# Set deploy trigger to feature branch
curl -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { deploymentTriggerUpdate(id: \"<TRIGGER_ID>\", input: { branch: \"feat/my-branch\", rootDirectory: \"/\" }) { id branch } }"
  }'
```

**To force NIXPACKS builder** (if Railway auto-migrated to RAILPACK):

```bash
curl -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { serviceInstanceUpdate(serviceId: \"<SERVICE_ID>\", environmentId: \"<ENV_ID>\", input: { builder: NIXPACKS }) { id } }"
  }'
```

**After merge to main:** Remember to update the deploy trigger back to `main`:

```bash
curl -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { deploymentTriggerUpdate(id: \"<TRIGGER_ID>\", input: { branch: \"main\" }) { id branch } }"
  }'
```

---

## Key File Locations

| File | Purpose |
|------|---------|
| `ponder/src/index.ts` | Indexing functions (changes trigger re-index) |
| `ponder/ponder.schema.ts` | Schema definition (changes trigger re-index) |
| `ponder/ponder.config.ts` | Config: contracts, start blocks, RPC (changes trigger re-index) |
| `deploy/ponder/nixpacks.toml` | Build configuration for Railway |
| `deploy/ponder/railway.toml` | Railway service configuration |
