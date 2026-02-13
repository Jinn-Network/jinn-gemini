/**
 * Unit Test: Credential Management Types
 * Module: services/x402-gateway/credentials/types.ts
 *
 * Tests trust tier comparison and ordering.
 */

import { describe, expect, it } from 'vitest';
import {
  tierMeetsMinimum,
  TRUST_TIER_ORDER,
  type TrustTier,
} from '../../../../services/x402-gateway/credentials/types.js';

describe('tierMeetsMinimum', () => {
  it('should treat same tier as meeting minimum', () => {
    for (const tier of TRUST_TIER_ORDER) {
      expect(tierMeetsMinimum(tier, tier)).toBe(true);
    }
  });

  it('should allow higher tiers to meet lower minimums', () => {
    expect(tierMeetsMinimum('premium', 'unverified')).toBe(true);
    expect(tierMeetsMinimum('premium', 'staked')).toBe(true);
    expect(tierMeetsMinimum('premium', 'trusted')).toBe(true);
    expect(tierMeetsMinimum('trusted', 'staked')).toBe(true);
    expect(tierMeetsMinimum('trusted', 'unverified')).toBe(true);
    expect(tierMeetsMinimum('staked', 'unverified')).toBe(true);
  });

  it('should deny lower tiers from meeting higher minimums', () => {
    expect(tierMeetsMinimum('unverified', 'staked')).toBe(false);
    expect(tierMeetsMinimum('unverified', 'trusted')).toBe(false);
    expect(tierMeetsMinimum('unverified', 'premium')).toBe(false);
    expect(tierMeetsMinimum('staked', 'trusted')).toBe(false);
    expect(tierMeetsMinimum('staked', 'premium')).toBe(false);
    expect(tierMeetsMinimum('trusted', 'premium')).toBe(false);
  });

  it('should have correct tier ordering', () => {
    expect(TRUST_TIER_ORDER).toEqual(['unverified', 'staked', 'trusted', 'premium']);
  });
});
