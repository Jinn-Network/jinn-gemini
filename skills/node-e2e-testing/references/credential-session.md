# Credential Session

Tests: Setup → Gateway ACL seed → Worker credential probe → Agent credential fetch → Verification.

**Prerequisite**: Complete the shared steps (Infrastructure + Setup) from SKILL.md first.

## How It Works

The credential bridge (x402-gateway) runs locally as part of the E2E stack. It uses a JSON ACL file to control which agent addresses can access which credential providers. The worker probes the bridge at startup to discover available providers, and the agent fetches credentials on-demand during job execution via the signing proxy.

```
Agent → Signing Proxy → x402-Gateway → Static Provider (env var)
                              ↑
                        JSON ACL check
```

## 1. Seed the ACL

After setup, get the agent EOA address from the setup output (or from `yarn wallet:info`). Then seed the gateway's ACL file with a grant for that address:

```bash
AGENT_ADDR=$(node -e "
const fs = require('fs');
const keys = fs.readdirSync('$CLONE_DIR/.operate/keys');
if (keys.length === 0) process.exit(1);
const addr = keys[0].startsWith('0x') ? keys[0] : '0x' + keys[0];
console.log(addr.toLowerCase());
")
echo "Agent address: $AGENT_ADDR"
```

From the monorepo root, write the ACL:
```bash
cat > .env.e2e.acl.json << ACLEOF
{
  "grants": {
    "$AGENT_ADDR": {
      "github": {
        "nangoConnectionId": "e2e-github",
        "pricePerAccess": "0",
        "expiresAt": null,
        "active": true
      }
    }
  },
  "connections": {
    "e2e-github": {
      "provider": "github",
      "metadata": { "scope": "e2e-test" }
    }
  }
}
ACLEOF
```

**Note**: The gateway reads the ACL file on every request (no restart needed).

## 2. Configure the Clone

Add the credential bridge URL to the jinn-node clone's `.env`:

```bash
echo "CREDENTIAL_BRIDGE_URL=http://localhost:3001" >> "$CLONE_DIR/.env"
```

## 3. Set a Static Provider Token

The gateway serves static credentials from its own env vars. The `start-e2e-stack.ts` script inherits `process.env`, so set a GitHub token in `.env.test` before starting the stack:

```bash
# In monorepo root .env.test (already loaded by the stack script)
echo "GITHUB_TOKEN=ghp_test_token_for_e2e_validation" >> .env.test
```

If you have a real GitHub PAT, use it — the agent can then make actual GitHub API calls. A dummy token works for verifying the credential bridge flow (the token is returned, but API calls will fail with 401).

Then **restart the stack** so the gateway picks up the token:
```bash
# Ctrl+C the running stack, then:
yarn test:e2e:stack
```

## 4. Dispatch a Job

Dispatch with `get_file_contents` enabled AND a blueprint that **instructs the agent to use it**. This maps to the `github` credential provider in `TOOL_CREDENTIAL_MAP` (`credentialFilter.ts`), triggering the full credential flow: agent → signing proxy → credential bridge → GitHub API.

```bash
yarn test:e2e:dispatch \
  --workstream 0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac \
  --cwd "$CLONE_DIR" \
  --enabled-tools "get_file_contents,google_web_search,web_fetch,create_artifact" \
  --blueprint '{"invariants":[{"id":"GOAL-001","type":"BOOLEAN","condition":"Fetch the README.md file from the Jinn-Network/jinn-node GitHub repository using the get_file_contents tool. Report the first 3 lines of the file.","assessment":"Agent used get_file_contents to retrieve README.md and reported its contents"},{"id":"TOOL-001","type":"BOOLEAN","condition":"Must use the get_file_contents tool to fetch from GitHub","assessment":"get_file_contents was called at least once"},{"id":"TOOL-002","type":"BOOLEAN","condition":"Must use create_artifact to store the result","assessment":"create_artifact was called at least once"}]}'
```

**CRITICAL**: The blueprint GOAL must explicitly instruct the agent to use `get_file_contents`. Without this, the agent will answer using web search alone and never trigger the credential flow.

## 5. Fund and Run the Worker

```bash
yarn test:e2e:vnet fund <agent-eoa-address> --eth 0.01
yarn --cwd "$CLONE_DIR" worker --single
```

## 6. Verify Credential Bridge

### 6a. Check worker credential probe

With `get_file_contents` in the enabled tools, the worker should probe the credential bridge during job filtering. Look for:

```
probeCredentialBridge → providers: ['github']
```

Or:
```
Worker credential capabilities discovered via bridge
```

If you see `providers: []`, the probe failed — check that `CREDENTIAL_BRIDGE_URL` is set in the clone's `.env` and the gateway is running. If you see `No service private key available`, the signing proxy couldn't access the agent's private key.

### 6b. Check gateway audit logs

The gateway logs every credential request with audit context:

```
[x402] Payment verified: ...
```

Or for the capabilities probe:
```
[capabilities] ...
```

### 6c. Test credential fetch directly

You can also test the credential bridge independently using the gateway's built-in E2E tests. From the monorepo root:

```bash
GATEWAY_URL=http://localhost:3001 \
  CREDENTIAL_ACL_PATH=.env.e2e.acl.json \
  npx tsx services/x402-gateway/credentials/test-e2e.ts
```

This runs the full ACL/signature/payment test suite against the local gateway. `CREDENTIAL_ACL_PATH` is required because `test-e2e.ts` imports the ACL module directly.

Expected results:
- **ACL tests**: All pass (8/8 — signature, unauthorized, expired, revoked, etc.)
- **Static provider test**: Pass (returns GITHUB_TOKEN from env)
- **Payment validation tests**: Basic checks pass (amount, recipient, expiry, network). CDP facilitator correctly rejects dummy test signatures (FACILITATOR_REJECTED — this is correct production behavior).
- **Nango tests**: Skip (no Nango running)
- **Rate limit tests**: Skip (no Redis running)

### 6d. Manual credential request (optional)

To verify the signing proxy → gateway flow manually:

```bash
# From the jinn-node clone, use the credential client directly
node -e "
const { getCredential } = require('$CLONE_DIR/dist/agent/shared/credential-client.js');
getCredential('github')
  .then(token => console.log('Token received:', token.substring(0, 10) + '...'))
  .catch(err => console.error('Error:', err.message));
"
```

**Note**: This only works if the signing proxy is running (it's started by the worker during agent execution). For standalone testing, use the `test-e2e.ts` script instead.

## Expected Flow

1. **Stack starts** — Gateway listens on :3001 with JSON ACL backend
2. **ACL seeded** — Agent address granted access to `github` provider
3. **Worker starts** — Probes `CREDENTIAL_BRIDGE_URL/credentials/capabilities`, discovers `github`
4. **Agent executes** — Standard job (web search + artifact). Credential bridge is available but not used by the default blueprint's tools
5. **Bridge verified** — Worker logs confirm credential discovery; gateway tests confirm ACL/auth

## Debugging Sources

- **Gateway output**: `[gateway]` prefix in stack output
- **ACL file**: `.env.e2e.acl.json` in monorepo root
- **Worker probe logs**: Look for `credential` or `bridge` in worker output
- **Gateway test results**: Output of `test-e2e.ts` run

## Acceptable Failures

- **Gateway test Nango errors**: Expected — no Nango running locally.
- **CDP FACILITATOR_REJECTED on payment tests**: Expected — `createTestPaymentHeader()` uses dummy signatures. The facilitator correctly rejects them. This proves the production payment path works.
- **Rate limit tests skip**: Expected — no Redis running.
- **Nonce replay tests skip**: Expected — no Redis running.
- **Manual credential fetch fails without signing proxy**: Expected — the proxy only runs during agent execution.

## Prerequisites

In addition to the shared prerequisites (SKILL.md), the credential session requires:
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` in monorepo `.env` (for production-mode x402 payment verification)
- `GATEWAY_PAYMENT_ADDRESS` in monorepo `.env` (or defaults to hardhat account #0)
- `GITHUB_TOKEN` in `.env.test` (for static provider test — a real PAT or dummy token)

## Success Criteria

- [ ] Gateway started as part of E2E stack (healthy on :3001, CDP enabled)
- [ ] ACL file seeded with agent address and github grant
- [ ] `get_file_contents` NOT dropped by tool policy (no `Dropping unknown tool` warning)
- [ ] Worker probed credential bridge and discovered `github` provider
- [ ] Agent called `get_file_contents` → triggered `getCredential('github')` via signing proxy
- [ ] Gateway `test-e2e.ts` ACL tests pass (8/8: signature, unauthorized, expired, revoked, etc.)
- [ ] Static provider test passes (GITHUB_TOKEN served from env)
- [ ] Payment basic validation tests pass (amount, recipient, expiry, network)
- [ ] CDP facilitator correctly processes payment signatures (FACILITATOR_REJECTED for test dummies)
