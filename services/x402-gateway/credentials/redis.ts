/**
 * Redis Nonce Store for ERC-8128 replay protection
 *
 * Requires REDIS_URL in every environment. Missing or unavailable Redis
 * rejects credential requests; replay checks are never bypassed.
 */

import Redis from 'ioredis';

const DEFAULT_NONCE_TTL_SECONDS = 300;
const KEY_PREFIX = 'cred:erc8128:nonce:';

let redis: Redis | null = null;

/**
 * Get the Redis client instance.
 * Returns null if Redis is not configured or has been closed.
 */
export function getRedis(): Redis | null {
  return redis;
}

function initRedis(): void {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.error('[credential-bridge] REDIS_URL not set — credential requests will be rejected');
    return;
  }

  redis = new Redis(url, { maxRetriesPerRequest: 3 });
  redis.on('error', () => console.error('[credential-bridge] Redis connection error'));
  redis.on('connect', () => console.log('[credential-bridge] Redis connected — nonce protection ENABLED'));
}

initRedis();

/**
 * Atomic consume for ERC-8128 NonceStore.
 * Returns true when key is first seen, false on replay.
 */
export async function consumeNonceKey(key: string, ttlSeconds: number = DEFAULT_NONCE_TTL_SECONDS): Promise<boolean> {
  if (!redis) return false; // fail closed, including after shutdown
  try {
    const redisKey = `${KEY_PREFIX}${key}`;
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.ceil(ttlSeconds) : DEFAULT_NONCE_TTL_SECONDS;
    const result = await redis.set(redisKey, '1', 'EX', ttl, 'NX');
    return result === 'OK';
  } catch {
    console.error('[credential-bridge] Redis nonce consume failed; request rejected');
    return false; // fail closed
  }
}

export function getCredentialNonceStore(): { consume: (key: string, ttlSeconds: number) => Promise<boolean> } {
  return {
    consume: consumeNonceKey,
  };
}

/**
 * Gracefully close Redis connection.
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    const client = redis;
    redis = null;
    await client.quit();
  }
}
