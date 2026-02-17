# Phase 1: Clone & Setup

**Prerequisites**: Phase 0 PASS
**Abort on failure**: Abort entire run

## Steps

### 1. Choose branch

Ask the user which branch to test. List available branches:
```bash
git ls-remote --heads git@github.com:Jinn-Network/jinn-node.git | sed 's|.*refs/heads/||'
```

### 2. Clone and install

```bash
CLONE_DIR=$(mktemp -d)/jinn-node
BRANCH=main  # or the branch the user chose
git clone -b "$BRANCH" https://github.com/Jinn-Network/jinn-node.git "$CLONE_DIR"
cd "$CLONE_DIR" && yarn install
cp .env.example .env
```

Save session state to `.env.e2e` (monorepo root):
```bash
echo "CLONE_DIR=$CLONE_DIR" >> .env.e2e
echo "OPERATE_PASSWORD=e2e-test-password-2024" >> .env.e2e
```

### 3. Configure .env

Edit `$CLONE_DIR/.env` — read RPC_URL from `.env.e2e`:
```
RPC_URL=<from .env.e2e>
CHAIN_ID=8453
OPERATE_PASSWORD=e2e-test-password-2024
PONDER_GRAPHQL_URL=http://localhost:42069/graphql
CONTROL_API_URL=http://localhost:4001/graphql
STAKING_CONTRACT=0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139
WORKSTREAM_FILTER=0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac
X402_GATEWAY_URL=https://x402-gateway-production-1b84.up.railway.app
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
- [PASS|FAIL] `.env` configured with VNet RPC
- [PASS|FAIL] `yarn setup` completed (service staked)
- [PASS|FAIL] Docker image built (`jinn-node:e2e`)
