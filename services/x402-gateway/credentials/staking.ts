/**
 * Staking Verification
 *
 * Queries Ponder's indexed on-chain data to verify:
 * 1. Service ownership — signer controls the claimed serviceId
 * 2. Active staking — service is staked in an approved contract
 *
 * Used during operator self-registration to calculate trust tier.
 */

import type { StakingContractConfig } from './types.js';

/** Approved staking contracts. Key = lowercase contract address. */
export const APPROVED_STAKING_CONTRACTS: Record<string, StakingContractConfig> = {
  '0x0dfafbf570e9e813507aae18aa08dfba0abc5139': { name: 'jinn', minStakeOlas: 5000 },
};

const ponderUrl = process.env.PONDER_GRAPHQL_URL || 'https://ponder-production-6d16.up.railway.app/graphql';

interface PonderQueryResult {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

async function queryPonder(query: string): Promise<Record<string, unknown>> {
  const res = await fetch(ponderUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Ponder query failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as PonderQueryResult;
  if (json.errors?.length) {
    throw new Error(`Ponder query error: ${json.errors[0].message}`);
  }

  return json.data ?? {};
}

export interface StakingVerification {
  verified: boolean;
  stakingContract?: string;
  contractName?: string;
  owner?: string;
  multisig?: string;
}

/**
 * Verify that a signer address owns/controls a service and that it's staked
 * in an approved contract.
 *
 * Checks:
 * 1. stakedService where serviceId matches and isStaked = true
 * 2. Signer is the service owner
 * 3. Staking contract is in APPROVED_STAKING_CONTRACTS
 */
export async function verifyServiceStaking(
  signerAddress: string,
  serviceId: number,
): Promise<StakingVerification> {
  const signer = signerAddress.toLowerCase();

  // Query staked services for this serviceId
  const data = await queryPonder(`{
    stakedServices(where: { serviceId: "${serviceId}", isStaked: true }) {
      items { id serviceId stakingContract owner multisig stakedAt }
    }
  }`);

  const items = (data.stakedServices as { items?: Array<{
    stakingContract: string;
    owner: string;
    multisig: string;
  }> })?.items ?? [];

  for (const item of items) {
    const owner = item.owner.toLowerCase();
    const contract = item.stakingContract.toLowerCase();

    // Signer must be the service owner
    if (owner !== signer) continue;

    // Contract must be approved
    const config = APPROVED_STAKING_CONTRACTS[contract];
    if (!config) continue;

    return {
      verified: true,
      stakingContract: contract,
      contractName: config.name,
      owner: item.owner,
      multisig: item.multisig,
    };
  }

  // Fallback: check if signer is the multisig (agent EOA controlling the service)
  for (const item of items) {
    const multisig = item.multisig.toLowerCase();
    const contract = item.stakingContract.toLowerCase();

    if (multisig !== signer) continue;

    const config = APPROVED_STAKING_CONTRACTS[contract];
    if (!config) continue;

    return {
      verified: true,
      stakingContract: contract,
      contractName: config.name,
      owner: item.owner,
      multisig: item.multisig,
    };
  }

  return { verified: false };
}

/**
 * Look up the mech address for a service ID.
 * Returns null if no mapping found.
 */
export async function getMechForService(serviceId: number): Promise<string | null> {
  const data = await queryPonder(`{
    mechServiceMappings(where: { serviceId: "${serviceId}" }) {
      items { mech }
    }
  }`);

  const items = (data.mechServiceMappings as { items?: Array<{ mech: string }> })?.items ?? [];
  return items[0]?.mech ?? null;
}
