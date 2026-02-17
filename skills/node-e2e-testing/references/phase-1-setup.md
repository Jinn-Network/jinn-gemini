# Phase 1: Clone & Setup

**Prerequisites**: Phase 0 PASS
**Abort on failure**: Abort entire run

## Steps

### 1. Choose branch

Ask the user which branch to test. List available branches:
```bash
yarn test:e2e:clone --list-branches
```

### 2. Clone and install

```bash
BRANCH=main  # or the branch the user chose
yarn test:e2e:clone --branch "$BRANCH"
```

The clone script automatically:
- Clones to a temp directory and installs dependencies
- Configures `.env` with VNet RPC, passwords, and local stack URLs
- Forwards `GITHUB_TOKEN` from the host env if available
- Saves `CLONE_DIR` and `OPERATE_PASSWORD` to `.env.e2e`

Read `CLONE_DIR` from `.env.e2e` for subsequent steps:
```bash
CLONE_DIR=$(grep CLONE_DIR .env.e2e | cut -d= -f2-)
```

### 4. Run setup (iterative)

Setup pauses when funding is needed, prints exact addresses and amounts. Fund those exact amounts and re-run until it completes:
```bash
cd "$CLONE_DIR" && yarn setup
# Read funding requirements from output, then from monorepo root:
yarn test:e2e:vnet fund <address> --eth <amount> --olas <amount>
cd "$CLONE_DIR" && yarn setup
# Repeat until complete.
```

After setup, record addresses from the output. Save to `.env.e2e`:
```bash
echo "AGENT_EOA_1=<agent-eoa-address>" >> .env.e2e
echo "SERVICE_A_SAFE=<service-safe-address>" >> .env.e2e
```

### 4a. Seed the credential bridge ACL

Seed the gateway's ACL file with umami grants for all agent addresses. The gateway reads the ACL on every request (no restart needed).

```bash
yarn test:e2e:vnet seed-acl "$CLONE_DIR"
```

Verify:
```bash
cat .env.e2e.acl.json
```

Expected: JSON with the agent address under `grants` with `umami` provider.

### 5. Build Docker image

From the monorepo root:
```bash
docker build -f jinn-node/Dockerfile jinn-node/ -t jinn-node:e2e
```

This validates the multi-stage build: TypeScript compilation, Chromium install, Gemini CLI pre-install, production dependency pruning. If the build fails with `ECONNRESET`, retry — earlier layers are cached.

## Expected Output

- Clone: `Cloning into '...'`, `yarn install` completes
- Setup: Multiple rounds of funding requirements, ending with successful staking
- Docker build: `Successfully tagged jinn-node:e2e`

## On Failure

- **Clone fails**: Capture git error. Check branch name exists. Check SSH/HTTPS access.
- **yarn install fails**: Capture npm/yarn error. Check Node version is 22+.
- **Setup fails after funding**: Capture the exact error. Record what funding was requested vs what was provided. Record the `.env` file contents (redact passwords).
- **Docker build fails**: Capture build output. If `ECONNRESET`, note it for retry. If compilation error, capture the TypeScript error.

## CHECKPOINT: Phase 1 — Clone & Setup

- [PASS|FAIL] Clone created and dependencies installed
- [PASS|FAIL] `.env` configured with VNet RPC and `X402_GATEWAY_URL=http://localhost:3001`
- [PASS|FAIL] `yarn setup` completed (service staked)
- [PASS|FAIL] ACL seeded — `cat .env.e2e.acl.json` shows agent address under `grants` with `umami` provider
- [PASS|FAIL] Docker image built (`jinn-node:e2e`)
