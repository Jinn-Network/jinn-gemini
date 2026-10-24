import { afterEach, describe, expect, it, vi } from 'vitest';
import { requiredPrivateKey } from '../../../scripts/lib/required-private-key.js';

afterEach(() => vi.unstubAllEnvs());
describe('requiredPrivateKey', () => {
  it.each(['', 'not-a-key', '0x1234', '0x' + 'z'.repeat(64)])('rejects missing or malformed keys without exposing the value', (value) => {
    vi.stubEnv('RECOVERY_AGENT_PRIVATE_KEY', value);
    expect(() => requiredPrivateKey('RECOVERY_AGENT_PRIVATE_KEY')).toThrow(
      'RECOVERY_AGENT_PRIVATE_KEY must be set to a 0x-prefixed 32-byte private key',
    );
  });
  it('reads a supplied key without embedding a default', () => {
    const value = '0x' + '1'.repeat(64);
    vi.stubEnv('RECOVERY_AGENT_PRIVATE_KEY', value);
    expect(requiredPrivateKey('RECOVERY_AGENT_PRIVATE_KEY')).toBe(value);
  });
});
