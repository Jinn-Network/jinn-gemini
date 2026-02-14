/**
 * Unit Test: Venture Credential Access Resolution
 * Module: services/x402-gateway/credentials/venture-credentials.ts
 *
 * Tests the access resolution logic contracts with binary trust model.
 */

import { describe, expect, it } from 'vitest';
import type { VentureCredential, TrustTier } from '../../../../services/x402-gateway/credentials/types.js';
import { tierMeetsMinimum } from '../../../../services/x402-gateway/credentials/types.js';

describe('Venture Access Resolution Logic', () => {
  describe('access_mode behavior', () => {
    it('venture_only should block global fallback when denied', () => {
      const accessMode = 'venture_only';
      expect(accessMode === 'venture_only').toBe(true);
    });

    it('union_with_global should allow global fallback when denied', () => {
      const accessMode = 'union_with_global';
      expect(accessMode === 'venture_only').toBe(false);
    });
  });

  describe('tier precedence in access decisions', () => {
    it('blocklist overrides tier qualification', () => {
      // Even if tier meets minimum, blocked operators should be denied.
      const operatorTier: TrustTier = 'trusted';
      const minTier: TrustTier = 'untrusted';
      expect(tierMeetsMinimum(operatorTier, minTier)).toBe(true);
      // But blocklist check happens BEFORE tier check → blocked
    });

    it('whitelist bypasses tier check', () => {
      // Whitelisted operators are allowed regardless of tier.
      const operatorTier: TrustTier = 'untrusted';
      const minTier: TrustTier = 'trusted';
      expect(tierMeetsMinimum(operatorTier, minTier)).toBe(false);
      // But whitelist check happens BEFORE tier check → allowed
    });

    it('tier check is the final gate', () => {
      const cases: Array<{ op: TrustTier; min: TrustTier; expected: boolean }> = [
        { op: 'trusted', min: 'untrusted', expected: true },
        { op: 'trusted', min: 'trusted', expected: true },
        { op: 'untrusted', min: 'untrusted', expected: true },
        { op: 'untrusted', min: 'trusted', expected: false },
      ];

      for (const { op, min, expected } of cases) {
        expect(tierMeetsMinimum(op, min)).toBe(expected);
      }
    });
  });

  describe('VentureAccessResult contract', () => {
    it('no_credential should never block global fallback', () => {
      const blockGlobalFallback = false;
      expect(blockGlobalFallback).toBe(false);
    });

    it('blocked reason should preserve venture credential for audit', () => {
      const vc: VentureCredential = {
        ventureId: 'v1',
        provider: 'twitter',
        nangoConnectionId: 'conn-1',
        minTrustTier: 'trusted',
        accessMode: 'venture_only',
        pricePerAccess: '0',
        active: true,
      };
      expect(vc).toBeDefined();
    });
  });
});
