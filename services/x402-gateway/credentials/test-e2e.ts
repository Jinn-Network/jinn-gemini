/**
 * E2E Test: Credential Bridge
 *
 * Tests the full flow: agent signs request → gateway verifies → Nango returns token.
 *
 * Prerequisites:
 *   1. Nango running: docker compose -f docker-compose.nango.yml up -d
 *   2. Gateway running: cd services/x402-gateway && tsx index.ts
 *   3. (Optional) Twitter connection configured in Nango dashboard
 *
 * Usage:
 *   tsx test-e2e.ts                    # Run all tests (skip Twitter if no connection)
 *   tsx test-e2e.ts --tweet "hello"    # Post a real tweet at the end
 *
 * Environment:
 *   GATEWAY_URL=http://localhost:3001  (default)
 *   NANGO_HOST=http://localhost:3003   (default)
 *   NANGO_SECRET_KEY=nango-dev-secret-key (default for local dev)
 */

import 'dotenv/config';
import { privateKeyToAccount } from 'viem/accounts';
import { setGrant, setConnection, revokeGrant } from './acl.js';
import { createTestPaymentHeader } from './x402-verify.js';

// ============================================
// Config
// ============================================

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const NANGO_HOST = process.env.NANGO_HOST || 'http://localhost:3003';
const NANGO_SECRET_KEY = process.env.NANGO_SECRET_KEY || 'nango-dev-secret-key';

// Test private key (DO NOT use in production — this is a well-known test key)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_ADDRESS = TEST_ACCOUNT.address.toLowerCase();

// Second test key (unauthorized agent)
const UNAUTH_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const UNAUTH_ACCOUNT = privateKeyToAccount(UNAUTH_PRIVATE_KEY);

const TWITTER_CONNECTION_ID = 'test-twitter-connection';

// ============================================
// Helpers
// ============================================

let passed = 0;
let failed = 0;

function log(status: '✓' | '✗' | '⊘', message: string) {
  const prefix = status === '✓' ? '\x1b[32m✓\x1b[0m' : status === '✗' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⊘\x1b[0m';
  console.log(`  ${prefix} ${message}`);
  if (status === '✓') passed++;
  if (status === '✗') failed++;
}

async function signRequest(account: typeof TEST_ACCOUNT, body: object): Promise<{ signature: string; address: string }> {
  const message = JSON.stringify(body);
  const signature = await account.signMessage({ message });
  return { signature, address: account.address.toLowerCase() };
}

async function credentialRequest(
  provider: string,
  account: typeof TEST_ACCOUNT,
  opts?: { paymentHeader?: string }
): Promise<{ status: number; body: any }> {
  const requestBody = {
    timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  };

  const { signature, address } = await signRequest(account, requestBody);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Agent-Signature': signature,
    'X-Agent-Address': address,
  };

  if (opts?.paymentHeader) {
    headers['X-402-Payment'] = opts.paymentHeader;
  }

  const response = await fetch(`${GATEWAY_URL}/credentials/${provider}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

// ============================================
// Tests
// ============================================

async function testNangoHealth() {
  console.log('\n--- Nango Health ---');
  try {
    const res = await fetch(`${NANGO_HOST}/health`);
    if (res.ok) {
      log('✓', `Nango reachable at ${NANGO_HOST}`);
      return true;
    } else {
      log('✗', `Nango returned ${res.status}`);
      return false;
    }
  } catch (err) {
    log('✗', `Nango unreachable at ${NANGO_HOST}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function testGatewayHealth() {
  console.log('\n--- Gateway Health ---');
  try {
    const res = await fetch(`${GATEWAY_URL}/templates`);
    if (res.ok || res.status === 404) {
      log('✓', `Gateway reachable at ${GATEWAY_URL}`);
      return true;
    } else {
      log('✗', `Gateway returned ${res.status}`);
      return false;
    }
  } catch (err) {
    log('✗', `Gateway unreachable at ${GATEWAY_URL}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function testInvalidSignature() {
  console.log('\n--- Invalid Signature ---');

  // Send request with mismatched signature (sign with one key, claim another address)
  const requestBody = {
    timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  };

  const { signature } = await signRequest(TEST_ACCOUNT, requestBody);

  const res = await fetch(`${GATEWAY_URL}/credentials/twitter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Signature': signature,
      'X-Agent-Address': UNAUTH_ACCOUNT.address, // Wrong address!
    },
    body: JSON.stringify(requestBody),
  });

  if (res.status === 401) {
    log('✓', 'Rejected mismatched signature (401)');
  } else {
    log('✗', `Expected 401, got ${res.status}`);
  }
}

async function testStaleTimestamp() {
  console.log('\n--- Stale Timestamp ---');

  const requestBody = {
    timestamp: Math.floor(Date.now() / 1000) - 600, // 10 minutes ago
    nonce: crypto.randomUUID(),
  };

  const { signature, address } = await signRequest(TEST_ACCOUNT, requestBody);

  const res = await fetch(`${GATEWAY_URL}/credentials/twitter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Signature': signature,
      'X-Agent-Address': address,
    },
    body: JSON.stringify(requestBody),
  });

  if (res.status === 401) {
    log('✓', 'Rejected stale timestamp (401)');
  } else {
    log('✗', `Expected 401, got ${res.status}`);
  }
}

async function testNonceReplay() {
  console.log('\n--- Nonce Replay ---');

  if (!process.env.REDIS_URL) {
    log('⊘', 'Skipped — REDIS_URL not set (nonce replay protection disabled)');
    return;
  }

  // Build a request with a fixed nonce
  const requestBody = {
    timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  };

  const { signature, address } = await signRequest(TEST_ACCOUNT, requestBody);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Agent-Signature': signature,
    'X-Agent-Address': address,
  };

  // First request — should pass nonce check (may fail on ACL etc., that's fine)
  const res1 = await fetch(`${GATEWAY_URL}/credentials/twitter`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });
  const body1 = await res1.json().catch(() => null);

  if (body1?.code === 'NONCE_REUSED') {
    log('✗', 'First request rejected as duplicate nonce — unexpected');
    return;
  }
  log('✓', `First request passed nonce check (status: ${res1.status})`);

  // Second request with SAME body + signature — should be rejected
  const res2 = await fetch(`${GATEWAY_URL}/credentials/twitter`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });
  const body2 = await res2.json().catch(() => null);

  if (res2.status === 401 && body2?.code === 'NONCE_REUSED') {
    log('✓', 'Duplicate nonce rejected (401 NONCE_REUSED)');
  } else {
    log('✗', `Expected 401 NONCE_REUSED, got ${res2.status}: ${JSON.stringify(body2)}`);
  }
}

async function testUnauthorizedAgent() {
  console.log('\n--- Unauthorized Agent ---');

  const { status } = await credentialRequest('twitter', UNAUTH_ACCOUNT);

  if (status === 403) {
    log('✓', 'Rejected unauthorized agent (403)');
  } else {
    log('✗', `Expected 403, got ${status}`);
  }
}

async function testUnknownProvider() {
  console.log('\n--- Unknown Provider ---');

  // Grant access to twitter but request gmail
  const { status } = await credentialRequest('nonexistent-provider', TEST_ACCOUNT);

  if (status === 403) {
    log('✓', 'Rejected unknown provider (403)');
  } else {
    log('✗', `Expected 403, got ${status}`);
  }
}

async function testPaymentRequired() {
  console.log('\n--- Payment Required ---');

  // Set up a paid grant
  await setGrant(TEST_ADDRESS, 'paid-provider', {
    nangoConnectionId: 'conn-paid',
    pricePerAccess: '1000',
    expiresAt: null,
    active: true,
  });

  // Request without payment
  const { status, body } = await credentialRequest('paid-provider', TEST_ACCOUNT);

  if (status === 402) {
    log('✓', `Payment required (402): ${body?.error}`);
  } else {
    log('✗', `Expected 402, got ${status}`);
  }

  // Request with valid payment header (should pass payment check in dev mode, may fail on Nango)
  const validHeader = createTestPaymentHeader({
    from: TEST_ADDRESS,
    to: process.env.GATEWAY_PAYMENT_ADDRESS || '0x1234567890123456789012345678901234567890',
    value: '1000', // Matches pricePerAccess
    network: process.env.X402_NETWORK || 'base',
  });

  const { status: paidStatus } = await credentialRequest('paid-provider', TEST_ACCOUNT, {
    paymentHeader: validHeader,
  });

  if (paidStatus !== 402) {
    log('✓', `Payment accepted (got ${paidStatus} — expected Nango error since connection is fake)`);
  } else {
    log('✗', `Still got 402 even with valid payment header`);
  }
}

async function testExpiredGrant() {
  console.log('\n--- Expired Grant ---');

  await setGrant(TEST_ADDRESS, 'expired-provider', {
    nangoConnectionId: 'conn-expired',
    pricePerAccess: '0',
    expiresAt: '2020-01-01T00:00:00Z', // Already expired
    active: true,
  });

  const { status } = await credentialRequest('expired-provider', TEST_ACCOUNT);

  if (status === 403) {
    log('✓', 'Rejected expired grant (403)');
  } else {
    log('✗', `Expected 403, got ${status}`);
  }
}

async function testRevokedGrant() {
  console.log('\n--- Revoked Grant ---');

  await setGrant(TEST_ADDRESS, 'revoke-test', {
    nangoConnectionId: 'conn-revoke',
    pricePerAccess: '0',
    expiresAt: null,
    active: true,
  });

  // Revoke it
  await revokeGrant(TEST_ADDRESS, 'revoke-test');

  const { status } = await credentialRequest('revoke-test', TEST_ACCOUNT);

  if (status === 403) {
    log('✓', 'Rejected revoked grant (403)');
  } else {
    log('✗', `Expected 403, got ${status}`);
  }
}

async function testSuccessfulTokenFetch(nangoAvailable: boolean) {
  console.log('\n--- Token Fetch (Nango) ---');

  if (!nangoAvailable) {
    log('⊘', 'Skipped — Nango not available');
    return false;
  }

  // Check if the test connection exists in Nango
  try {
    const res = await fetch(`${NANGO_HOST}/connection/${TWITTER_CONNECTION_ID}?provider_config_key=twitter`, {
      headers: { 'Authorization': `Bearer ${NANGO_SECRET_KEY}` },
    });

    if (!res.ok) {
      log('⊘', `Skipped — No Twitter connection "${TWITTER_CONNECTION_ID}" in Nango (configure via dashboard)`);
      return false;
    }
  } catch {
    log('⊘', 'Skipped — Could not reach Nango');
    return false;
  }

  // Set up grant pointing to real Nango connection
  await setGrant(TEST_ADDRESS, 'twitter', {
    nangoConnectionId: TWITTER_CONNECTION_ID,
    pricePerAccess: '0',
    expiresAt: null,
    active: true,
  });
  await setConnection(TWITTER_CONNECTION_ID, {
    provider: 'twitter',
    metadata: { handle: '@test' },
  });

  const { status, body } = await credentialRequest('twitter', TEST_ACCOUNT);

  if (status === 200 && body?.access_token) {
    log('✓', `Got real token (expires_in: ${body.expires_in}s)`);
    return true;
  } else {
    log('✗', `Expected 200 with access_token, got ${status}: ${JSON.stringify(body)}`);
    return false;
  }
}

async function testRealTweet(tweetText: string) {
  console.log('\n--- Real Tweet ---');

  const { status, body } = await credentialRequest('twitter', TEST_ACCOUNT);

  if (status !== 200 || !body?.access_token) {
    log('✗', 'Cannot tweet — no valid token');
    return;
  }

  const tweetRes = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${body.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: tweetText }),
  });

  if (tweetRes.ok) {
    const data = await tweetRes.json() as { data: { id: string; text: string } };
    log('✓', `Posted tweet: "${data.data.text}" (id: ${data.data.id})`);
  } else {
    const error = await tweetRes.text();
    log('✗', `Tweet failed (${tweetRes.status}): ${error}`);
  }
}

// ============================================
// x402 Payment Verification Tests
// ============================================

const GATEWAY_PAYMENT_ADDRESS = process.env.GATEWAY_PAYMENT_ADDRESS || '0x1234567890123456789012345678901234567890';
const X402_NETWORK = process.env.X402_NETWORK || 'base';

async function testPaymentInvalidFormat() {
  console.log('\n--- Payment Invalid Format ---');

  await setGrant(TEST_ADDRESS, 'payment-format-test', {
    nangoConnectionId: 'conn-format',
    pricePerAccess: '1000000',
    expiresAt: null,
    active: true,
  });

  // Send malformed base64
  const { status, body } = await credentialRequest('payment-format-test', TEST_ACCOUNT, {
    paymentHeader: 'not-valid-base64!!!',
  });

  if (status === 402 && body?.paymentError === 'INVALID_PAYMENT_FORMAT') {
    log('✓', 'Rejected invalid payment format');
  } else {
    log('✗', `Expected 402 INVALID_PAYMENT_FORMAT, got ${status}: ${JSON.stringify(body)}`);
  }
}

async function testPaymentAmountInsufficient() {
  console.log('\n--- Payment Amount Insufficient ---');

  await setGrant(TEST_ADDRESS, 'payment-amount-test', {
    nangoConnectionId: 'conn-amount',
    pricePerAccess: '1000000', // 1 USDC
    expiresAt: null,
    active: true,
  });

  // Payment with insufficient amount (0.5 USDC)
  const header = createTestPaymentHeader({
    from: TEST_ADDRESS,
    to: GATEWAY_PAYMENT_ADDRESS,
    value: '500000', // 0.5 USDC - insufficient
    network: X402_NETWORK,
  });

  const { status, body } = await credentialRequest('payment-amount-test', TEST_ACCOUNT, {
    paymentHeader: header,
  });

  if (status === 402 && body?.paymentError === 'PAYMENT_AMOUNT_INSUFFICIENT') {
    log('✓', 'Rejected insufficient payment amount');
  } else {
    log('✗', `Expected 402 PAYMENT_AMOUNT_INSUFFICIENT, got ${status}: ${JSON.stringify(body)}`);
  }
}

async function testPaymentWrongRecipient() {
  console.log('\n--- Payment Wrong Recipient ---');

  await setGrant(TEST_ADDRESS, 'payment-recipient-test', {
    nangoConnectionId: 'conn-recipient',
    pricePerAccess: '1000000',
    expiresAt: null,
    active: true,
  });

  // Payment to wrong address
  const header = createTestPaymentHeader({
    from: TEST_ADDRESS,
    to: '0x' + '99'.repeat(20), // Wrong recipient
    value: '1000000',
    network: X402_NETWORK,
  });

  const { status, body } = await credentialRequest('payment-recipient-test', TEST_ACCOUNT, {
    paymentHeader: header,
  });

  if (status === 402 && body?.paymentError === 'PAYMENT_RECIPIENT_MISMATCH') {
    log('✓', 'Rejected payment to wrong recipient');
  } else {
    log('✗', `Expected 402 PAYMENT_RECIPIENT_MISMATCH, got ${status}: ${JSON.stringify(body)}`);
  }
}

async function testPaymentExpired() {
  console.log('\n--- Payment Expired ---');

  await setGrant(TEST_ADDRESS, 'payment-expiry-test', {
    nangoConnectionId: 'conn-expiry',
    pricePerAccess: '1000000',
    expiresAt: null,
    active: true,
  });

  // Expired payment (validBefore in the past)
  const header = createTestPaymentHeader({
    from: TEST_ADDRESS,
    to: GATEWAY_PAYMENT_ADDRESS,
    value: '1000000',
    network: X402_NETWORK,
    validBefore: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
  });

  const { status, body } = await credentialRequest('payment-expiry-test', TEST_ACCOUNT, {
    paymentHeader: header,
  });

  if (status === 402 && body?.paymentError === 'PAYMENT_EXPIRED') {
    log('✓', 'Rejected expired payment');
  } else {
    log('✗', `Expected 402 PAYMENT_EXPIRED, got ${status}: ${JSON.stringify(body)}`);
  }
}

async function testPaymentNetworkMismatch() {
  console.log('\n--- Payment Network Mismatch ---');

  await setGrant(TEST_ADDRESS, 'payment-network-test', {
    nangoConnectionId: 'conn-network',
    pricePerAccess: '1000000',
    expiresAt: null,
    active: true,
  });

  // Payment on wrong network
  const header = createTestPaymentHeader({
    from: TEST_ADDRESS,
    to: GATEWAY_PAYMENT_ADDRESS,
    value: '1000000',
    network: X402_NETWORK === 'base' ? 'base-sepolia' : 'base', // Wrong network
  });

  const { status, body } = await credentialRequest('payment-network-test', TEST_ACCOUNT, {
    paymentHeader: header,
  });

  if (status === 402 && body?.paymentError === 'PAYMENT_NETWORK_MISMATCH') {
    log('✓', 'Rejected payment on wrong network');
  } else {
    log('✗', `Expected 402 PAYMENT_NETWORK_MISMATCH, got ${status}: ${JSON.stringify(body)}`);
  }
}

async function testPaymentValidInDevMode() {
  console.log('\n--- Payment Valid (Dev Mode) ---');

  if (process.env.X402_DEV_MODE !== 'true') {
    log('⊘', 'Skipped — X402_DEV_MODE not enabled');
    return;
  }

  await setGrant(TEST_ADDRESS, 'payment-valid-test', {
    nangoConnectionId: 'conn-valid',
    pricePerAccess: '1000000',
    expiresAt: null,
    active: true,
  });

  // Valid payment (in dev mode, signature verification is skipped)
  const header = createTestPaymentHeader({
    from: TEST_ADDRESS,
    to: GATEWAY_PAYMENT_ADDRESS,
    value: '1000000',
    network: X402_NETWORK,
  });

  const { status, body } = await credentialRequest('payment-valid-test', TEST_ACCOUNT, {
    paymentHeader: header,
  });

  // Should pass payment verification (may fail on Nango since connection is fake)
  if (status !== 402) {
    log('✓', `Payment accepted in dev mode (got ${status} — expected Nango error since connection is fake)`);
  } else {
    log('✗', `Expected non-402, got ${status}: ${JSON.stringify(body)}`);
  }
}

// ============================================
// Rate Limiting Tests
// ============================================

async function testRateLimitExceeded() {
  console.log('\n--- Rate Limit Exceeded ---');

  if (!process.env.REDIS_URL) {
    log('⊘', 'Skipped — REDIS_URL not set (rate limiting disabled)');
    return;
  }

  // Use a unique provider for this test to avoid interference
  const provider = 'ratelimit-test-' + Date.now();
  await setGrant(TEST_ADDRESS, provider, {
    nangoConnectionId: 'conn-ratelimit',
    pricePerAccess: '0',
    expiresAt: null,
    active: true,
  });

  // Make 10 requests (should all succeed or fail on Nango, but not rate limit)
  let hitRateLimit = false;
  for (let i = 0; i < 10; i++) {
    const { status, body } = await credentialRequest(provider, TEST_ACCOUNT);
    if (status === 429) {
      hitRateLimit = true;
      log('✗', `Request ${i + 1} hit rate limit unexpectedly`);
      break;
    }
    // Expect 502 (Nango error since connection is fake) - that's fine
  }

  if (!hitRateLimit) {
    log('✓', 'First 10 requests passed rate limit check');
  }

  // 11th request should hit rate limit
  const { status: status11, body: body11 } = await credentialRequest(provider, TEST_ACCOUNT);
  if (status11 === 429 && body11?.code === 'RATE_LIMITED') {
    log('✓', 'Request 11 rate limited (429 RATE_LIMITED)');
  } else {
    log('✗', `Expected 429 RATE_LIMITED on request 11, got ${status11}: ${JSON.stringify(body11)}`);
  }
}

async function testRateLimitSeparateProviders() {
  console.log('\n--- Rate Limit Separate Providers ---');

  if (!process.env.REDIS_URL) {
    log('⊘', 'Skipped — REDIS_URL not set (rate limiting disabled)');
    return;
  }

  // Set up two unique providers
  const providerA = 'ratelimit-provA-' + Date.now();
  const providerB = 'ratelimit-provB-' + Date.now();

  await setGrant(TEST_ADDRESS, providerA, {
    nangoConnectionId: 'conn-ratelimitA',
    pricePerAccess: '0',
    expiresAt: null,
    active: true,
  });
  await setGrant(TEST_ADDRESS, providerB, {
    nangoConnectionId: 'conn-ratelimitB',
    pricePerAccess: '0',
    expiresAt: null,
    active: true,
  });

  // Use up rate limit on provider A (10 requests)
  for (let i = 0; i < 10; i++) {
    await credentialRequest(providerA, TEST_ACCOUNT);
  }

  // Provider A should be rate limited
  const { status: statusA } = await credentialRequest(providerA, TEST_ACCOUNT);
  if (statusA !== 429) {
    log('✗', `Expected 429 on provider A after 11 requests, got ${statusA}`);
    return;
  }
  log('✓', 'Provider A is rate limited');

  // Provider B should NOT be rate limited (separate counter)
  const { status: statusB, body: bodyB } = await credentialRequest(providerB, TEST_ACCOUNT);
  if (statusB !== 429) {
    log('✓', `Provider B is NOT rate limited (got ${statusB})`);
  } else {
    log('✗', `Provider B should not be rate limited, got 429: ${JSON.stringify(bodyB)}`);
  }
}

async function testRateLimitHeaders() {
  console.log('\n--- Rate Limit Headers ---');

  if (!process.env.REDIS_URL) {
    log('⊘', 'Skipped — REDIS_URL not set (rate limiting disabled)');
    return;
  }

  // Use a unique provider
  const provider = 'ratelimit-headers-' + Date.now();
  await setGrant(TEST_ADDRESS, provider, {
    nangoConnectionId: 'conn-headers',
    pricePerAccess: '0',
    expiresAt: null,
    active: true,
  });

  // Make a request and check headers
  const requestBody = {
    timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  };
  const { signature, address } = await signRequest(TEST_ACCOUNT, requestBody);

  const res = await fetch(`${GATEWAY_URL}/credentials/${provider}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Signature': signature,
      'X-Agent-Address': address,
    },
    body: JSON.stringify(requestBody),
  });

  const limit = res.headers.get('X-RateLimit-Limit');
  const remaining = res.headers.get('X-RateLimit-Remaining');
  const reset = res.headers.get('X-RateLimit-Reset');

  if (limit && remaining && reset) {
    log('✓', `Rate limit headers present: limit=${limit}, remaining=${remaining}, reset=${reset}`);
  } else {
    log('✗', `Missing rate limit headers: limit=${limit}, remaining=${remaining}, reset=${reset}`);
  }
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('=== Credential Bridge E2E Tests ===');
  console.log(`Gateway: ${GATEWAY_URL}`);
  console.log(`Nango:   ${NANGO_HOST}`);
  console.log(`Agent:   ${TEST_ADDRESS}`);

  // Parse args
  const args = process.argv.slice(2);
  const tweetIdx = args.indexOf('--tweet');
  const tweetText = tweetIdx >= 0 ? args[tweetIdx + 1] : null;

  // Health checks
  const nangoOk = await testNangoHealth();
  const gatewayOk = await testGatewayHealth();

  if (!gatewayOk) {
    console.error('\n\x1b[31mGateway not running. Start with: cd services/x402-gateway && tsx index.ts\x1b[0m');
    process.exit(1);
  }

  // ACL + Signature tests (no Nango needed)
  await testInvalidSignature();
  await testStaleTimestamp();
  await testNonceReplay();
  await testUnauthorizedAgent();
  await testUnknownProvider();
  await testPaymentRequired();
  await testExpiredGrant();
  await testRevokedGrant();

  // x402 Payment verification tests
  await testPaymentInvalidFormat();
  await testPaymentAmountInsufficient();
  await testPaymentWrongRecipient();
  await testPaymentExpired();
  await testPaymentNetworkMismatch();
  await testPaymentValidInDevMode();

  // Rate limiting tests
  await testRateLimitExceeded();
  await testRateLimitSeparateProviders();
  await testRateLimitHeaders();

  // Nango integration tests
  const tokenOk = await testSuccessfulTokenFetch(nangoOk);

  // Optional: real tweet
  if (tweetText && tokenOk) {
    await testRealTweet(tweetText);
  } else if (tweetText && !tokenOk) {
    console.log('\n\x1b[33m⊘ Skipping tweet — no valid token available\x1b[0m');
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
