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
});
