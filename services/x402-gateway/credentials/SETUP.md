# Credential Bridge: Local E2E Setup

## 1. Start Nango

```bash
cd services/x402-gateway/credentials
docker compose -f docker-compose.nango.yml up -d
```

Nango dashboard: http://localhost:3003 (admin/admin)

## 2. Configure Twitter OAuth in Nango

### Create Twitter Developer App

1. Go to https://developer.x.com/en/portal/dashboard
2. Create a new project/app
3. Under "User authentication settings", enable OAuth 2.0:
   - Type: Web App
   - Callback URL: `http://localhost:3003/oauth/callback`
   - Website URL: `http://localhost:3003`
4. Note your **Client ID** and **Client Secret**

### Add Twitter Integration to Nango

1. Open Nango dashboard: http://localhost:3003
2. Go to Integrations → Add Integration
3. Select "Twitter" (or add custom with provider `twitter-v2`)
4. Enter your Client ID and Client Secret
5. Scopes: `tweet.read tweet.write users.read offline.access`

### Authorize Your Twitter Account

1. In Nango dashboard → Connections → New Connection
2. Select Twitter integration
3. Connection ID: `test-twitter-connection`
4. Click "Connect" → authorize in Twitter popup
5. Connection should show as "Active"

## 3. Start the Gateway

```bash
# From repo root
cd services/x402-gateway

# Set env vars for local dev
export NANGO_HOST=http://localhost:3003
export NANGO_SECRET_KEY=nango-dev-secret-key
export CREDENTIAL_ACL_PATH=$(pwd)/credentials/test-acl.json

# Start gateway
tsx index.ts
```

## 4. Run E2E Tests

```bash
cd services/x402-gateway/credentials

# Run tests (ACL + signature verification — works without Twitter)
NANGO_HOST=http://localhost:3003 \
NANGO_SECRET_KEY=nango-dev-secret-key \
CREDENTIAL_ACL_PATH=$(pwd)/test-acl.json \
GATEWAY_URL=http://localhost:3001 \
  tsx test-e2e.ts

# Run tests + post a real tweet
NANGO_HOST=http://localhost:3003 \
NANGO_SECRET_KEY=nango-dev-secret-key \
CREDENTIAL_ACL_PATH=$(pwd)/test-acl.json \
GATEWAY_URL=http://localhost:3001 \
  tsx test-e2e.ts --tweet "Hello from the credential bridge! 🤖"
```

## 5. Manual Testing with curl

```bash
# Generate a signed request (use the test script or viem directly)
# The test private key is: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# Its address is: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# After running the test script (which sets up ACL), you can also use:
curl -X POST http://localhost:3001/credentials/twitter \
  -H "Content-Type: application/json" \
  -H "X-Agent-Signature: <signature>" \
  -H "X-Agent-Address: 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" \
  -d '{"timestamp": <unix_seconds>, "nonce": "<uuid>"}'
```

## Cleanup

```bash
docker compose -f docker-compose.nango.yml down -v
rm -f test-acl.json
```
