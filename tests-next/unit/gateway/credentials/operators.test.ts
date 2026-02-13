/**
 * Unit Test: Operator Trust Tier Calculation
 * Module: services/x402-gateway/credentials/operators.ts
 *
 * Tests the pure calculateTrustTier function.
 */

import { describe, expect, it } from 'vitest';
import {
  calculateTrustTier,
  checkTierStaleness,
  STAKE_VERIFY_MAX_AGE_MS,
} from '../../../../services/x402-gateway/credentials/operators.js';
import type { Operator } from '../../../../services/x402-gateway/credentials/types.js';

describe('calculateTrustTier', () => {
  it('returns unverified when no overrides, not whitelisted, no staking', () => {
    expect(calculateTrustTier({
      tierOverride: null,
      whitelisted: false,
      stakingContract: null,
    })).toBe('unverified');
  });

  it('returns staked when staking contract is present', () => {
    expect(calculateTrustTier({
      tierOverride: null,
      whitelisted: false,
      stakingContract: '0xabc',
    })).toBe('staked');
  });

  it('returns trusted when whitelisted', () => {
    expect(calculateTrustTier({
      tierOverride: null,
      whitelisted: true,
      stakingContract: null,
    })).toBe('trusted');
  });

  it('whitelisted overrides staked', () => {
    expect(calculateTrustTier({
      tierOverride: null,
      whitelisted: true,
      stakingContract: '0xabc',
    })).toBe('trusted');
  });

  it('tier_override takes highest precedence', () => {
    expect(calculateTrustTier({
      tierOverride: 'premium',
      whitelisted: false,
      stakingContract: null,
    })).toBe('premium');
  });

  it('tier_override overrides whitelisted', () => {
    expect(calculateTrustTier({
      tierOverride: 'staked',
      whitelisted: true,
      stakingContract: '0xabc',
    })).toBe('staked');
  });

  it('tier_override can downgrade to unverified', () => {
    expect(calculateTrustTier({
      tierOverride: 'unverified',
      whitelisted: true,
      stakingContract: '0xabc',
    })).toBe('unverified');
  });
});

function makeOperator(overrides: Partial<Operator> = {}): Operator {
  return {
    address: '0xtest',
    serviceId: 165,
    trustTier: 'staked',
    tierOverride: null,
    whitelisted: false,
    whitelistedBy: null,
    whitelistedAt: null,
    stakingContract: '0xabc',
    stakeVerifiedAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('checkTierStaleness', () => {
  it('returns not_registered for null operator', () => {
    const result = checkTierStaleness(null);
    expect(result.valid).toBe(false);
    expect(result.effectiveTier).toBe('unverified');
    expect(result.reason).toBe('not_registered');
  });

  it('is always valid for tier_override operators', () => {
    const op = makeOperator({
      tierOverride: 'premium',
      trustTier: 'premium',
      stakeVerifiedAt: new Date(Date.now() - STAKE_VERIFY_MAX_AGE_MS * 2).toISOString(),
    });
    const result = checkTierStaleness(op);
    expect(result.valid).toBe(true);
    expect(result.effectiveTier).toBe('premium');
  });

  it('is always valid for whitelisted operators', () => {
    const op = makeOperator({
      whitelisted: true,
      trustTier: 'trusted',
      stakeVerifiedAt: new Date(Date.now() - STAKE_VERIFY_MAX_AGE_MS * 2).toISOString(),
    });
    const result = checkTierStaleness(op);
    expect(result.valid).toBe(true);
    expect(result.effectiveTier).toBe('trusted');
  });

  it('is valid for recently verified staking', () => {
    const op = makeOperator({
      stakeVerifiedAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
    });
    const result = checkTierStaleness(op);
    expect(result.valid).toBe(true);
    expect(result.effectiveTier).toBe('staked');
  });

  it('is stale when stake_verified_at exceeds max age', () => {
    const op = makeOperator({
      stakeVerifiedAt: new Date(Date.now() - STAKE_VERIFY_MAX_AGE_MS - 1000).toISOString(),
    });
    const result = checkTierStaleness(op);
    expect(result.valid).toBe(false);
    expect(result.effectiveTier).toBe('unverified');
    expect(result.reason).toBe('stale_stake');
  });

  it('is valid for operators with no staking contract (unverified)', () => {
    const op = makeOperator({
      stakingContract: null,
      stakeVerifiedAt: null,
      trustTier: 'unverified',
    });
    const result = checkTierStaleness(op);
    expect(result.valid).toBe(true);
    expect(result.effectiveTier).toBe('unverified');
  });

  it('STAKE_VERIFY_MAX_AGE_MS defaults to 24 hours', () => {
    expect(STAKE_VERIFY_MAX_AGE_MS).toBe(86400000);
  });
});
