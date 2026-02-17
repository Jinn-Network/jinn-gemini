/**
 * Unit Test: Operator Trust Tier Calculation
 * Module: services/x402-gateway/credentials/operators.ts
 *
 * Tests the pure calculateTrustTier function.
 * Binary model: untrusted (default) or trusted (whitelisted).
 */

import { describe, expect, it } from 'vitest';
import { calculateTrustTier } from '../../../../services/x402-gateway/credentials/operators.js';

describe('calculateTrustTier', () => {
  it('returns untrusted when no overrides and not whitelisted', () => {
    expect(calculateTrustTier({
      tierOverride: null,
      whitelisted: false,
    })).toBe('untrusted');
  });

  it('returns trusted when whitelisted', () => {
    expect(calculateTrustTier({
      tierOverride: null,
      whitelisted: true,
    })).toBe('trusted');
  });

  it('tier_override takes highest precedence', () => {
    expect(calculateTrustTier({
      tierOverride: 'trusted',
      whitelisted: false,
    })).toBe('trusted');
  });

  it('tier_override can downgrade whitelisted to untrusted', () => {
    expect(calculateTrustTier({
      tierOverride: 'untrusted',
      whitelisted: true,
    })).toBe('untrusted');
  });

  it('empty string tierOverride is treated as null (falls through to whitelisted)', () => {
    const result = calculateTrustTier({
      tierOverride: '' as any,
      whitelisted: true,
    });
    // Empty string is falsy, so tierOverride is skipped → whitelisted check wins
    expect(result).toBe('trusted');
  });

  it('invalid tierOverride is rejected and falls through to whitelisted/default', () => {
    // After hardening: invalid values not in TRUST_TIER_ORDER are ignored
    const result = calculateTrustTier({
      tierOverride: 'admin' as any,
      whitelisted: false,
    });
    // 'admin' is not in TRUST_TIER_ORDER, so it's treated as invalid → default 'untrusted'
    expect(result).toBe('untrusted');
  });

  it('invalid tierOverride with whitelisted=true falls through to trusted', () => {
    const result = calculateTrustTier({
      tierOverride: 'superuser' as any,
      whitelisted: true,
    });
    expect(result).toBe('trusted');
  });
});
