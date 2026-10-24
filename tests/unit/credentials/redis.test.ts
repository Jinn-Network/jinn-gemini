import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  set: vi.fn(), on: vi.fn(), quit: vi.fn(), constructor: vi.fn(),
}));
vi.mock('ioredis', () => ({
  default: class {
    constructor(...args: unknown[]) { mocks.constructor(...args); }
    set = mocks.set;
    on = mocks.on;
    quit = mocks.quit;
  },
}));

async function loadStore() {
  vi.resetModules();
  return import('../../../services/x402-gateway/credentials/redis.js');
}

describe('credential nonce replay protection', () => {
  beforeEach(() => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.clearAllMocks();
    mocks.quit.mockResolvedValue('OK');
    const consumed = new Set<string>();
    mocks.set.mockImplementation(async (key: string) => {
      if (consumed.has(key)) return null;
      consumed.add(key);
      return 'OK';
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each(['production', 'development', 'test'])('rejects missing Redis in %s', async (mode) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('REDIS_URL', '');
    const store = await loadStore();
    expect(await store.getCredentialNonceStore().consume('nonce', 300)).toBe(false);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it('atomically consumes a nonce once, including concurrent attempts', async () => {
    const store = await loadStore();
    expect(await Promise.all([store.consumeNonceKey('nonce'), store.consumeNonceKey('nonce')]))
      .toEqual([true, false]);
    expect(mocks.set).toHaveBeenCalledWith('cred:erc8128:nonce:nonce', '1', 'EX', 300, 'NX');
    expect(await store.consumeNonceKey('different')).toBe(true);
  });

  it.each([[1.2, 2], [NaN, 300], [Infinity, 300], [0, 300], [-1, 300]])(
    'uses a safe TTL for %s', async (ttl, expected) => {
      const store = await loadStore();
      expect(await store.consumeNonceKey('nonce', ttl)).toBe(true);
      expect(mocks.set).toHaveBeenCalledWith('cred:erc8128:nonce:nonce', '1', 'EX', expected, 'NX');
    },
  );

  it('rejects a Redis error without logging error contents', async () => {
    mocks.set.mockRejectedValue(new Error('sensitive connection details'));
    const store = await loadStore();
    expect(await store.consumeNonceKey('nonce')).toBe(false);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive connection details');
  });

  it('rejects unexpected Redis replies', async () => {
    mocks.set.mockResolvedValue(undefined);
    expect(await (await loadStore()).consumeNonceKey('nonce')).toBe(false);
  });

  it('rejects requests while closing and after closing Redis', async () => {
    const store = await loadStore();
    let finish!: (value: string) => void;
    mocks.quit.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    const closing = store.closeRedis();
    expect(store.getRedis()).toBeNull();
    expect(await store.consumeNonceKey('nonce')).toBe(false);
    finish('OK');
    await closing;
    expect(await store.consumeNonceKey('nonce')).toBe(false);
  });

  it('stays closed if shutdown fails', async () => {
    mocks.quit.mockRejectedValue(new Error('connection closed'));
    const store = await loadStore();
    await expect(store.closeRedis()).rejects.toThrow('connection closed');
    expect(await store.consumeNonceKey('nonce')).toBe(false);
  });
});
