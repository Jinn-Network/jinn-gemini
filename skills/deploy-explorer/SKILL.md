---
name: deploy-explorer
description: Deploy the Jinn Explorer frontend to Vercel. Use when deploying frontend changes, debugging staking page issues, configuring Vercel environment variables, or troubleshooting the explorer UI showing missing data.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Deploy Jinn Explorer to Vercel

Deploy the Next.js explorer frontend (`frontend/explorer/`) to Vercel. The explorer is the public-facing UI for browsing workstreams, jobs, staking state, and agent activity.

## Quick Deploy

```bash
cd frontend/explorer
npx vercel --prod
```

This deploys to the `jinn-explorer` project under the `jinn-a6b5fa9d` Vercel org.

To preview without promoting to production:

```bash
cd frontend/explorer
npx vercel
```

## Environment Variables Reference

### Public Variables (set in vercel.json)

These are non-secret values baked into the client bundle at build time. They live in `frontend/explorer/vercel.json`:

| Variable | Value | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUBGRAPH_URL` | `https://indexer.jinn.network/graphql` | Ponder indexer endpoint for all GraphQL reads |
| `NEXT_PUBLIC_X402_GATEWAY_URL` | `https://x402-gateway-production.up.railway.app` | x402 payment gateway |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://clnwgxgvmnrkwqdblqgf.supabase.co` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (in vercel.json) | Supabase anon key (safe to expose) |

### Secret Variables (set via `vercel env`)

These are server-side secrets that must NOT go in `vercel.json`:

| Variable | Purpose | Set Via |
|----------|---------|---------|
| `RPC_URL` | Tenderly Base RPC for on-chain reads (staking state, request counts) | `npx vercel env add RPC_URL production` |

**CRITICAL:** `RPC_URL` must be a Tenderly endpoint. NEVER use public RPCs (`mainnet.base.org`, `publicnode.com`, etc.). The codebase must throw if `RPC_URL` is missing, not silently degrade.

### Managing Vercel Env Vars

```bash
# List all env vars
npx vercel env ls

# Add a secret
npx vercel env add RPC_URL production
# (prompts for value interactively)

# Remove a secret
npx vercel env rm RPC_URL production
```

## Ponder URL Migration

The Ponder indexer URL has been migrated to a stable domain. Old Railway URLs are dead and must not be used anywhere.

| Status | URL |
|--------|-----|
| **Current** | `https://indexer.jinn.network/graphql` |
| Dead | `https://ponder-production-6d16.up.railway.app/graphql` |
| Dead | `https://ponder-production-6d16.up.railway.app` |

If you see any reference to the old Railway Ponder URLs in the explorer code, `vercel.json`, or Vercel env vars, update them to `https://indexer.jinn.network/graphql`.

The `NEXT_PUBLIC_SUBGRAPH_URL` must match in three places:
1. `frontend/explorer/vercel.json` (production builds)
2. `frontend/explorer/package.json` `dev` script (local dev)
3. Vercel project env vars (if set as a Vercel secret override)

## RPC_URL and On-Chain Reads

The explorer makes server-side on-chain reads for:
- Staking contract state (`getStakingState()`, `getServiceIds()`)
- Request counts per mech
- Service registry lookups

These reads require `RPC_URL` to be set as a Vercel secret pointing to the Tenderly Base RPC. Without it:
- The staking page shows wrong status (e.g., "Unstaked" when actually staked)
- Request counts show "Request count unavailable"
- Any server component or API route that calls `viem` will fail

The `next.config.js` loads env vars from the monorepo root via `loadEnvConfig()` for local dev, but on Vercel the env var must be set through the Vercel dashboard or CLI.

## Local Dev Setup

```bash
# From monorepo root
cd frontend/explorer

# Standard dev (points to production Ponder + x402 gateway)
yarn dev

# Dev with local Ponder instance
yarn dev:local

# Dev with Ponder co-started
yarn dev:with-ponder
```

The `yarn dev` script sets `NEXT_PUBLIC_SUBGRAPH_URL` inline to the production indexer. For `RPC_URL`, the `next.config.js` calls `loadEnvConfig()` on the monorepo root, so it reads from the root `.env` file.

Ensure the root `.env` has:
```bash
RPC_URL=https://virtual.base.rpc.tenderly.co/...  # Tenderly Base RPC
```

## Project Structure

| File | Purpose |
|------|---------|
| `frontend/explorer/vercel.json` | Vercel config: build/install commands, public env vars |
| `frontend/explorer/next.config.js` | Next.js config, loads root `.env` via `loadEnvConfig()` |
| `frontend/explorer/package.json` | Scripts, dependencies |

## Troubleshooting

### Staking page shows wrong status / "Request count unavailable"

**Cause:** `RPC_URL` is missing, set to a public RPC, or has trailing characters.

**Fix:**
```bash
# CRITICAL: Use heredoc (<<<) to avoid trailing newline/chars in the value.
# Do NOT pipe via echo or printf — they add trailing characters that corrupt the URL.
npx vercel env add RPC_URL production <<< 'https://base.gateway.tenderly.co/YOUR_KEY'

# Redeploy to pick up the new env var
npx vercel redeploy https://explorer.jinn.network
```

**Gotcha:** `echo "$VAR" | npx vercel env add` appends a newline to the value. `printf '%s' "$VAR" | npx vercel env add` can append an `n` character (from `\n` being interpreted). Always use `<<<` heredoc syntax. If unsure, check the debug endpoint or Vercel function logs for `Failed to parse URL` or `Status: 401` errors.

### CLI deploys fail with path doubling

**Cause:** The Vercel project has `rootDirectory: frontend/explorer` set. Running `npx vercel --prod` from the monorepo root doubles the path to `frontend/explorer/frontend/explorer`.

**Fix:** Don't use `vercel --prod` from the monorepo root. Instead:
- Push to git and let Vercel auto-deploy, OR
- Use `npx vercel redeploy https://explorer.jinn.network` to redeploy the latest production deployment with fresh env vars

### GraphQL queries return empty data or errors

**Cause:** `NEXT_PUBLIC_SUBGRAPH_URL` points to a dead Ponder URL.

**Fix:** Verify the URL in `frontend/explorer/vercel.json` is `https://indexer.jinn.network/graphql`. Check the Vercel env vars for any override:
```bash
npx vercel env ls
```

If there is a Vercel-level `NEXT_PUBLIC_SUBGRAPH_URL` override pointing to an old URL, remove it:
```bash
npx vercel env rm NEXT_PUBLIC_SUBGRAPH_URL production
```

### Build fails with missing dependencies

The explorer depends on `@jinn/shared-ui` from the monorepo workspace. Vercel must install from the monorepo root to resolve workspace dependencies. The `vercel.json` sets `installCommand: "yarn install"` which handles this.

If builds fail with unresolved workspace packages, check that the Vercel project root directory is set to `frontend/explorer` (not the monorepo root).

### Preview deploys show stale data

Preview deploys use the same env vars as production unless overridden. If a preview deploy needs different env vars (e.g., pointing to a staging Ponder), set them for the `preview` environment:
```bash
npx vercel env add NEXT_PUBLIC_SUBGRAPH_URL preview
```

### Local dev shows "RPC_URL not configured"

Ensure the monorepo root `.env` file contains `RPC_URL`. The `next.config.js` loads it via:
```js
loadEnvConfig(path.resolve(__dirname, '..', '..'));
```

This resolves to the monorepo root, not `frontend/explorer/`.
