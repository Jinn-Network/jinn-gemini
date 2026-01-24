/**
 * Redis Client for Nonce Replay Protection
 *
 * Connects via REDIS_URL env var. If not set, nonce checks are skipped
 * (local dev mode) and a warning is logged at startup.
 *
 * Uses SET NX EX for atomic check-and-set with 5-minute TTL.
 */

import Redis from 'ioredis';

const NONCE_TTL_SECONDS = 300; // matches timestamp window
const KEY_PREFIX = 'cred:nonce:';

let redis: Redis | null = null;

function initRedis(): void {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[credential-bridge] REDIS_URL not set — nonce replay protection DISABLED');
    return;
  }

  redis = new Redis(url, { maxRetriesPerRequest: 3 });
  redis.on('error', (err) => console.error('[credential-bridge] Redis error:', err.message));
  redis.on('connect', () => console.log('[credential-bridge] Redis connected — nonce protection ENABLED'));
}

initRedis();

/**
 * Check if a nonce has been used before. If new, stores it atomically.
 *
 * @returns true if nonce is new (request should proceed)
 * @returns false if nonce is a duplicate (request should be rejected)
 * @returns true if Redis is not configured (skip check in dev mode)
 */
export async function checkAndStoreNonce(nonce: string): Promise<boolean> {
  if (!redis) return true; // dev mode — skip check
  try {
    const key = `${KEY_PREFIX}${nonce}`;
    const result = await redis.set(key, '1', 'EX', NONCE_TTL_SECONDS, 'NX');
    return result === 'OK';
  } catch (err) {
    console.error('[credential-bridge] Redis nonce check failed:', err);
    return false; // fail closed
  }
}

/**
 * Gracefully close Redis connection.
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
