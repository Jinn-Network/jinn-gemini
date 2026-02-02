---
title: Environment Variables Reference
purpose: reference
scope: [worker, gemini-agent, frontend, deployment]
last_verified: 2026-02-02
related_code:
  - config/index.ts
  - worker/mech_worker.ts
  - env/operate-profile.ts
  - control-api/server.ts
keywords: [environment, config, env vars, secrets, configuration]
when_to_read: "When configuring services or looking up environment variable names"
---

# Environment Variables Reference

## Core Blockchain

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RPC_URL` | URL | - | Primary RPC endpoint. Aliases: `MECHX_CHAIN_RPC`, `MECH_RPC_HTTP_URL`, `BASE_RPC_URL` |
| `CHAIN_ID` | number | - | Network ID (8453=Base mainnet, 84532=Base Sepolia) |
| `WORKER_PRIVATE_KEY` | hex | - | Agent EOA key. Falls back to `.operate` profile |

## Service Profile (OLAS Operate)

Priority: env var > `.operate/services/*/config.json`

| Variable | Type | Description |
|----------|------|-------------|
| `JINN_SERVICE_MECH_ADDRESS` | address | Mech contract (overrides `.operate`) |
| `JINN_SERVICE_SAFE_ADDRESS` | address | Gnosis Safe (overrides `.operate`) |
| `JINN_SERVICE_PRIVATE_KEY` | hex | Agent key (overrides `.operate`) |
| `OPERATE_PROFILE_DIR` | path | Override `.operate` directory location |
| `OPERATE_PASSWORD` | string | Middleware keystore password |

## Mech Service

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MECH_MARKETPLACE_ADDRESS_BASE` | address | - | Marketplace contract on Base |
| `MECH_MODEL` | string | - | Default AI model |
| `MECH_RECLAIM_AFTER_MINUTES` | number | - | Reclaim undelivered requests after N min |
| `MECH_TARGET_REQUEST_ID` | string | - | Target specific request (testing) |

## Ponder Indexer

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PONDER_PORT` | number | 42069 | GraphQL server port |
| `PONDER_GRAPHQL_URL` | URL | Railway prod | Explicit GraphQL URL |
| `PONDER_START_BLOCK` | number | - | Start indexing block |
| `PONDER_END_BLOCK` | number | - | End indexing block (testing) |

## Control API

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CONTROL_API_URL` | URL | localhost:4001 | GraphQL endpoint |
| `CONTROL_API_PORT` | number | 4001 | Server port |
| `CONTROL_API_SERVICE_KEY` | string | - | Authentication key |
| `USE_CONTROL_API` | boolean | true | Enable Control API |

## Supabase

| Variable | Type | Description |
|----------|------|-------------|
| `SUPABASE_URL` | URL | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | string | Full access key |
| `SUPABASE_SERVICE_ANON_KEY` | string | Limited access key |

## IPFS

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `IPFS_GATEWAY_URL` | URL | gateway.autonolas.tech | Gateway for fetch/upload |
| `IPFS_FETCH_TIMEOUT_MS` | number | 30000 | Fetch timeout |

## LLM APIs

| Variable | Type | Description |
|----------|------|-------------|
| `GEMINI_API_KEY` | string | Google Gemini API key |
| `GEMINI_QUOTA_CHECK_MODEL` | string | Model for quota pings |
| `GEMINI_QUOTA_CHECK_TIMEOUT_MS` | number | Quota check timeout |
| `GEMINI_QUOTA_BACKOFF_MS` | number | Base backoff for quota polling |
| `GEMINI_QUOTA_MAX_BACKOFF_MS` | number | Max backoff for quota polling |
| `OPENAI_API_KEY` | string | OpenAI API key |

## External Services

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub PAT for MCP server |
| `CIVITAI_API_KEY` | Civitai API key |
| `ZORA_API_KEY` | Zora API key |
| `TENDERLY_ACCESS_KEY` | Tenderly VNet testing |

## Job Context (Runtime)

Set by worker during job execution. See [Worker Environment](../context/worker-environment.md) for the injection flow.

| Variable | Type | Description |
|----------|------|-------------|
| `JINN_REQUEST_ID` | string | Mech request ID |
| `JINN_MECH_ADDRESS` | address | Mech contract address for this job |
| `JINN_JOB_DEFINITION_ID` | uuid | Job definition ID |
| `JINN_WORKSTREAM_ID` | string | Workstream context |
| `JINN_PARENT_REQUEST_ID` | string | Parent job's request ID (empty if root) |
| `JINN_BASE_BRANCH` | string | Git base branch for job |
| `JINN_BRANCH_NAME` | string | Git branch created for this job |
| `JINN_COMPLETED_CHILDREN` | JSON | Array of completed child request IDs |
| `JINN_CHILD_WORK_REVIEWED` | boolean | Whether child work has been reviewed |
| `JINN_REQUIRED_TOOLS` | JSON | Array of required tools from template policy |
| `JINN_AVAILABLE_TOOLS` | JSON | Array of available tools from template policy |
| `JINN_BLUEPRINT_INVARIANT_IDS` | JSON | Array of blueprint invariant IDs |
| `JINN_INHERITED_ENV` | JSON | Inherited env vars from parent job |

## Git Workflow

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `JINN_WORKSPACE_DIR` | path | ~/jinn-repos | Venture repo clone directory |
| `CODE_METADATA_REPO_ROOT` | path | - | Repository root override |
| `CODE_METADATA_DEFAULT_BASE_BRANCH` | string | main | Default base branch |
| `CODE_METADATA_REMOTE_NAME` | string | origin | Git remote name |
| `GITHUB_API_URL` | URL | api.github.com | GitHub API URL |
| `GITHUB_REPOSITORY` | string | - | Repo in "owner/repo" format |
| `GIT_AUTHOR_NAME` | string | - | Commit author name |
| `GIT_AUTHOR_EMAIL` | email | - | Commit author email |

## Worker Polling

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `WORKER_POLL_BASE_MS` | number | 30000 | Base polling interval |
| `WORKER_POLL_MAX_MS` | number | 300000 | Max idle polling interval |
| `WORKER_POLL_BACKOFF_FACTOR` | number | 1.5 | Exponential backoff multiplier |
| `WORKER_STOP_FILE` | path | auto | Stop signal file path |
| `WORKER_STUCK_EXIT_CYCLES` | number | - | Exit after N stuck cycles |
| `WORKER_TX_CONFIRMATIONS` | number | 3 | Tx confirmations to wait |
| `WORKER_JOB_DELAY_MS` | number | 0 | Delay after each job |

## Worker Filtering

| Variable | Type | Description |
|----------|------|-------------|
| `WORKSTREAM_FILTER` | string | Workstream IDs (comma/JSON array) |
| `WORKER_MECH_FILTER_LIST` | string | Mech addresses ("any", comma-separated, or single) |

## Worker Dependencies

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `WORKER_DEPENDENCY_STALE_MS` | number | 7200000 | Stale dep threshold (2h) |
| `WORKER_DEPENDENCY_REDISPATCH_COOLDOWN_MS` | number | 3600000 | Redispatch cooldown (1h) |
| `WORKER_DEPENDENCY_MISSING_FAIL_MS` | number | 7200000 | Auto-cancel threshold (2h) |
| `WORKER_DEPENDENCY_REDISPATCH` | boolean | 0 | Enable auto-redispatch |
| `WORKER_DEPENDENCY_AUTOFAIL` | boolean | 1 | Auto-cancel missing deps |

## Agent Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GEMINI_SANDBOX` | enum | sandbox-exec | Sandbox: `sandbox-exec`, `docker`, `podman`, `false` |
| `AGENT_MAX_STDOUT_SIZE` | number | 5242880 | Max stdout (5MB) |
| `AGENT_REPETITION_THRESHOLD` | number | 10 | Loop detection threshold |
| `USE_TSX_MCP` | boolean | false | TSX mode for MCP dev |

## Blueprint Builder

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BLUEPRINT_BUILDER_DEBUG` | boolean | false | Debug logging |
| `BLUEPRINT_ENABLE_SYSTEM` | boolean | true | Static system assertions |
| `BLUEPRINT_ENABLE_RECOGNITION` | boolean | true | Similar job learnings |
| `BLUEPRINT_ENABLE_JOB_CONTEXT` | boolean | true | Job hierarchy context |
| `BLUEPRINT_ENABLE_BEADS` | boolean | true | Beads issue tracking |
| `BLUEPRINT_ENABLE_CONTEXT_PHASES` | boolean | true | Recognition/Reflection/Progress phases |

## Blog Analytics

| Variable | Description |
|----------|-------------|
| `UMAMI_HOST` | Umami server URL |
| `UMAMI_WEBSITE_ID` | Website identifier |
| `UMAMI_USERNAME` | Login username |
| `UMAMI_PASSWORD` | Login password |

## Development & Testing

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | enum | development | `development`, `production`, `test` |
| `RUNTIME_ENVIRONMENT` | enum | default | `default`, `test`, `review` |
| `DRY_RUN` | boolean | false | Log-only mode |
| `DISABLE_STS_CHECKS` | boolean | false | Skip Safe TX Service checks |
| `TEST_RPC_URL` | URL | - | Override RPC for testing |
| `MCP_LOG_LEVEL` | enum | - | `error`, `warn`, `info`, `debug` |
| `ENABLE_AUTO_REPOST` | boolean | false | Auto-repost completed chains |
