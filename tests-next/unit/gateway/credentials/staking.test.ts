/**
 * Unit Test: Staking Verification
 * Module: services/x402-gateway/credentials/staking.ts
 *
 * Tests APPROVED_STAKING_CONTRACTS config and verifyServiceStaking logic
 * with mocked Ponder responses.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  APPROVED_STAKING_CONTRACTS,
  verifyServiceStaking,
  getMechForService,
} from '../../../../services/x402-gateway/credentials/staking.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ponderResponse(data: Record<string, unknown>) {
  return {
    ok: true,
    json: () => Promise.resolve({ data }),
  };
}

describe('APPROVED_STAKING_CONTRACTS', () => {
  it('includes jinn contract at known address', () => {
    const jinnAddr = '0x0dfafbf570e9e813507aae18aa08dfba0abc5139';
    expect(APPROVED_STAKING_CONTRACTS[jinnAddr]).toBeDefined();
    expect(APPROVED_STAKING_CONTRACTS[jinnAddr].name).toBe('jinn');
    expect(APPROVED_STAKING_CONTRACTS[jinnAddr].minStakeOlas).toBe(5000);
  });

  it('stores addresses in lowercase', () => {
    for (const addr of Object.keys(APPROVED_STAKING_CONTRACTS)) {
      expect(addr).toBe(addr.toLowerCase());
    }
  });
});

describe('verifyServiceStaking', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns verified when signer is owner and contract is approved', async () => {
    mockFetch.mockResolvedValueOnce(ponderResponse({
      stakedServices: {
        items: [{
          id: '1',
          serviceId: '165',
          stakingContract: '0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139',
          owner: '0xAAA',
          multisig: '0xBBB',
          stakedAt: '2024-01-01',
        }],
      },
    }));

    const result = await verifyServiceStaking('0xaaa', 165);

    expect(result.verified).toBe(true);
    expect(result.stakingContract).toBe('0x0dfafbf570e9e813507aae18aa08dfba0abc5139');
    expect(result.contractName).toBe('jinn');
    expect(result.owner).toBe('0xAAA');
  });

  it('returns verified when signer is multisig (fallback)', async () => {
    mockFetch.mockResolvedValueOnce(ponderResponse({
      stakedServices: {
        items: [{
          id: '1',
          serviceId: '165',
          stakingContract: '0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139',
          owner: '0xOTHER',
          multisig: '0xBBB',
          stakedAt: '2024-01-01',
        }],
      },
    }));

    const result = await verifyServiceStaking('0xBBB', 165);

    expect(result.verified).toBe(true);
    expect(result.multisig).toBe('0xBBB');
  });

  it('returns not verified when signer is neither owner nor multisig', async () => {
    mockFetch.mockResolvedValueOnce(ponderResponse({
      stakedServices: {
        items: [{
          id: '1',
          serviceId: '165',
          stakingContract: '0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139',
          owner: '0xOTHER',
          multisig: '0xYETANOTHER',
          stakedAt: '2024-01-01',
        }],
      },
    }));

    const result = await verifyServiceStaking('0xIMPOSTOR', 165);

    expect(result.verified).toBe(false);
  });

  it('returns not verified when contract is not approved', async () => {
    mockFetch.mockResolvedValueOnce(ponderResponse({
      stakedServices: {
        items: [{
          id: '1',
          serviceId: '165',
          stakingContract: '0xUNAPPROVED',
          owner: '0xAAA',
          multisig: '0xBBB',
          stakedAt: '2024-01-01',
        }],
      },
    }));

    const result = await verifyServiceStaking('0xaaa', 165);

    expect(result.verified).toBe(false);
  });

  it('returns not verified when no staked services found', async () => {
    mockFetch.mockResolvedValueOnce(ponderResponse({
      stakedServices: { items: [] },
    }));

    const result = await verifyServiceStaking('0xaaa', 999);

    expect(result.verified).toBe(false);
  });

  it('throws on Ponder HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(verifyServiceStaking('0xaaa', 165))
      .rejects.toThrow('Ponder query failed');
  });

  it('throws on Ponder GraphQL error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        errors: [{ message: 'Unknown field' }],
      }),
    });

    await expect(verifyServiceStaking('0xaaa', 165))
      .rejects.toThrow('Ponder query error');
  });
});

describe('getMechForService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns mech address when mapping exists', async () => {
    mockFetch.mockResolvedValueOnce(ponderResponse({
      mechServiceMappings: {
        items: [{ mech: '0xMECH' }],
      },
    }));

    const result = await getMechForService(165);
    expect(result).toBe('0xMECH');
  });

  it('returns null when no mapping exists', async () => {
    mockFetch.mockResolvedValueOnce(ponderResponse({
      mechServiceMappings: { items: [] },
    }));

    const result = await getMechForService(999);
    expect(result).toBeNull();
  });
});
