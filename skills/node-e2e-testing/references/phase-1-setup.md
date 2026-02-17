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

### 2a. Ensure GITHUB_TOKEN for operator credential

GitHub is an operator-level credential — the agent reads `GITHUB_TOKEN` directly from env (not via the credential bridge). A dummy token validates the env passthrough — the tool call matters, not GitHub API success.

```bash
grep GITHUB_TOKEN .env.test
# If not present:
echo "GITHUB_TOKEN=ghp_test_dummy_for_e2e" >> .env.test
```

**Restart the stack** so the gateway inherits the token:
```bash
# Ctrl+C the running stack, then:
yarn test:e2e:stack
```

### 2b. Ensure Umami env vars for credential bridge test

The `blog_get_stats` tool exercises the full credential bridge pipeline. The gateway needs Umami credentials to log in and serve JWTs. Add to `.env.test` (gateway inherits from the stack env):

```bash
# Umami analytics (credential bridge E2E — values from configs/the-lamp.json)
echo "UMAMI_HOST=https://umami-production-ae2b.up.railway.app" >> .env.test
echo "UMAMI_USERNAME=admin" >> .env.test
echo "UMAMI_PASSWORD=<password from .env or Railway>" >> .env.test
echo "UMAMI_WEBSITE_ID=0d8e685a-d498-445d-99c6-671bf3d63b1d" >> .env.test
```

`UMAMI_HOST` and `UMAMI_WEBSITE_ID` are also needed by the agent (on the env allowlist in `agent.ts`). `UMAMI_USERNAME`/`UMAMI_PASSWORD` are gateway-side secrets only.

**Restart the stack** if already running so the gateway picks up the new env vars.

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
X402_GATEWAY_URL=http://localhost:3001
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

Seed the gateway's ACL file with a `github` grant for the agent address. The gateway reads the ACL on every request (no restart needed).

```bash
AGENT_ADDR=$(node -e "
const fs = require('fs');
const keys = fs.readdirSync('$CLONE_DIR/.operate/keys');
if (keys.length === 0) process.exit(1);
const addr = keys[0].startsWith('0x') ? keys[0] : '0x' + keys[0];
console.log(addr.toLowerCase());
")
echo "Agent address: $AGENT_ADDR"

cat > .env.e2e.acl.json << ACLEOF
{
  "grants": {
    "$AGENT_ADDR": {
      "umami": {
        "nangoConnectionId": "e2e-umami",
        "pricePerAccess": "0",
        "expiresAt": null,
        "active": true
      }
    }
  },
  "connections": {
    "e2e-umami": {
      "provider": "umami",
      "metadata": { "scope": "e2e-test" }
    }
  }
}
ACLEOF
echo "ACL seeded for: $AGENT_ADDR"
```

Verify:
```bash
cat .env.e2e.acl.json
```

Expected: JSON with the agent address under `grants`.

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
- [PASS|FAIL] Umami env vars set (`UMAMI_HOST`, `UMAMI_WEBSITE_ID` in `.env.test`)
- [PASS|FAIL] `yarn setup` completed (service staked)
- [PASS|FAIL] ACL seeded — `cat .env.e2e.acl.json` shows agent address under `grants` with `umami` provider
- [PASS|FAIL] Docker image built (`jinn-node:e2e`)
