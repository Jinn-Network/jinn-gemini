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
cd "$CLONE_DIR" && AGENT_ADDR=$(node -e "
const fs = require('fs');
const keys = fs.readdirSync('.operate/keys');
if (keys.length === 0) process.exit(1);
// Key directory names already include '0x' prefix
const addr = keys[0].startsWith('0x') ? keys[0] : '0x' + keys[0];
console.log(addr);
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
cd "$CLONE_DIR"
echo "CREDENTIAL_BRIDGE_URL=http://localhost:3001" >> .env
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

Use the standard dispatch, but the key verification is in the worker logs, not the agent's tool use:

```bash
yarn test:e2e:dispatch \
  --workstream 0x9470f6f2bec6940c93fedebc0ea74bccaf270916f4693e96e8ccc586f26a89ac \
  --cwd "$CLONE_DIR"
```

## 5. Fund and Run the Worker

```bash
yarn test:e2e:vnet fund <agent-eoa-address> --eth 0.01
cd "$CLONE_DIR" && yarn worker --single
```

## 6. Verify Credential Bridge

### 6a. Check worker credential probe

In the worker output, look for credential discovery logs:

```
Worker credential capabilities discovered via bridge
```

Or the debug-level probe log:
```
probeCredentialBridge
```

If you see `No service private key available` or `providers: []`, the probe failed — check that `CREDENTIAL_BRIDGE_URL` is set in the clone's `.env` and the gateway is running.

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

Expected: all ACL tests pass (8/8), Nango tests skip (no Nango running), payment validation tests fail (no `GATEWAY_PAYMENT_ADDRESS` set — these test x402 payment, not credential ACL).

### 6d. Manual credential request (optional)

To verify the signing proxy → gateway flow manually:

```bash
# From the jinn-node clone, use the credential client directly
cd "$CLONE_DIR"
node -e "
const { getCredential } = require('./dist/agent/shared/credential-client.js');
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

- **Gateway test Nango errors**: Expected — no Nango running locally. Static provider tests should pass.
- **Payment validation tests fail**: Expected — `GATEWAY_PAYMENT_ADDRESS` not set. These test x402 payment infrastructure, not credential ACL.
- **Rate limit tests skip**: Expected — no Redis running. Rate limiting is disabled.
- **Nonce replay tests skip**: Expected — no Redis running.
- **Manual credential fetch fails without signing proxy**: Expected — the proxy only runs during agent execution.
- **Worker credential probe not shown**: Expected on branches without the credential bridge feature (e.g., `codex/railway-ssh-init-flow`). The probe requires `CREDENTIAL_BRIDGE_URL` support in the worker code.

## Success Criteria

- [ ] Gateway started as part of E2E stack (healthy on :3001)
- [ ] ACL file seeded with agent address and github grant
- [ ] Worker probed credential bridge and discovered `github` provider (requires branch with credential bridge support)
- [ ] Gateway `test-e2e.ts` ACL tests pass (8/8: signature, unauthorized, expired, revoked, etc.)
- [ ] Static provider returned token for `github` (visible in test-e2e.ts or audit logs)

**Note**: The credential probe (step 3) and static token fetch (step 5) require the jinn-node branch to have the credential bridge integration (signing proxy, `CREDENTIAL_BRIDGE_URL` handling). Branches without this feature can still validate steps 1, 2, and 4.
