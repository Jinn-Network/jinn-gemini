#!/usr/bin/env tsx
/**
 * Migrate a service from one OLAS staking contract to another
 *
 * This script handles the full migration process:
 * 1. Preflight checks (verify staking status, bond amounts, slot availability)
 * 2. Unstake from source staking contract
 * 3. Top-up bond if target requires higher minimum
 * 4. Stake to target staking contract
 * 5. Verification
 *
 * Usage:
 *   tsx scripts/migrate-staking-contract.ts --service-id=165 --source=agentsfun1 --target=jinn [--dry-run]
 *
 * Environment:
 *   OPERATE_PASSWORD - Required to decrypt master wallet for signing transactions
 *   RPC_URL - RPC endpoint (defaults to Base mainnet)
 *
 * Known staking contracts on Base:
 *   - Jinn: 0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139 (5,000 OLAS min)
 *   - AgentsFun1: 0x2585e63df7BD9De8e058884D496658a030b5c6ce (50 OLAS min)
 */

import 'jinn-node/env';
import { ethers } from 'ethers';
import { getMasterPrivateKey, getMasterEOA } from 'jinn-node/env/operate-profile';

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';

// Known staking contracts
const STAKING_CONTRACTS: Record<string, { address: string; name: string; minStake: bigint }> = {
  jinn: {
    address: '0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139',
    name: 'Jinn Staking',
    minStake: ethers.parseEther('5000'), // 5,000 OLAS
  },
  agentsfun1: {
    address: '0x2585e63df7BD9De8e058884D496658a030b5c6ce',
    name: 'AgentsFun1',
    minStake: ethers.parseEther('50'), // 50 OLAS
  },
};

// Core OLAS contracts on Base
const CONTRACTS = {
  SERVICE_REGISTRY: '0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE',
  SERVICE_REGISTRY_TOKEN_UTILITY: '0x34C895f302D0b5cf52ec0Edd3945321EB0f83dd5',
  OLAS_TOKEN: '0x54330d28ca3357F294334BDC454a032e7f353416',
};

// ABIs
const STAKING_ABI = [
  'function stake(uint256 serviceId) external',
  'function unstake(uint256 serviceId) external returns (uint256)',
  'function getServiceIds() view returns (uint256[])',
  'function mapServiceInfo(uint256 serviceId) view returns (address multisig, address owner, uint256[] nonces, uint256 tsStart, uint256 reward, uint256 inactivity)',
  'function minStakingDeposit() view returns (uint256)',
  'function maxNumServices() view returns (uint256)',
];

const SERVICE_REGISTRY_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getService(uint256 serviceId) view returns (tuple(uint96 securityDeposit, address multisig, bytes32 configHash, uint32 threshold, uint32 maxNumAgentInstances, uint32 numAgentInstances, uint8 state, address[] agentIds))',
];

const TOKEN_UTILITY_ABI = [
  'function mapServiceIdTokenDeposit(uint256 serviceId) view returns (uint256 securityDeposit, address token)',
  'function increaseSecurityDeposit(uint256 serviceId, uint256 amount) external',
];

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// ============================================================================
// Helpers
// ============================================================================

function parseArgs(): {
  serviceId: number;
  source: string;
  target: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let serviceId: number | undefined;
  let source: string | undefined;
  let target: string | undefined;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--service-id=')) {
      serviceId = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--source=')) {
      source = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--target=')) {
      target = arg.split('=')[1].toLowerCase();
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!serviceId || !source || !target) {
    console.error('Usage: tsx scripts/migrate-staking-contract.ts --service-id=<ID> --source=<name> --target=<name> [--dry-run]');
    console.error('\nKnown staking contracts:');
    for (const [name, info] of Object.entries(STAKING_CONTRACTS)) {
      console.error(`  ${name}: ${info.address} (${ethers.formatEther(info.minStake)} OLAS min)`);
    }
    process.exit(1);
  }

  if (!STAKING_CONTRACTS[source]) {
    console.error(`Unknown source staking contract: ${source}`);
    console.error('Known contracts:', Object.keys(STAKING_CONTRACTS).join(', '));
    process.exit(1);
  }

  if (!STAKING_CONTRACTS[target]) {
    console.error(`Unknown target staking contract: ${target}`);
    console.error('Known contracts:', Object.keys(STAKING_CONTRACTS).join(', '));
    process.exit(1);
  }

  return { serviceId, source, target, dryRun };
}

async function getStakedServiceIds(contract: ethers.Contract): Promise<number[]> {
  const ids: bigint[] = await contract.getServiceIds();
  return ids.map((id) => Number(id));
}

// ============================================================================
// Main Migration Logic
// ============================================================================

async function main() {
  const { serviceId, source, target, dryRun } = parseArgs();
  const sourceConfig = STAKING_CONTRACTS[source];
  const targetConfig = STAKING_CONTRACTS[target];

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        OLAS Staking Contract Migration                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Service ID:     ${serviceId}`);
  console.log(`Source:         ${sourceConfig.name} (${sourceConfig.address})`);
  console.log(`Target:         ${targetConfig.name} (${targetConfig.address})`);
  console.log(`Mode:           ${dryRun ? '🔍 DRY RUN (no transactions)' : '⚡ LIVE'}`);
  console.log();

  // Get master wallet
  const masterPrivateKey = getMasterPrivateKey();
  if (!masterPrivateKey) {
    console.error('❌ Failed to get master wallet private key');
    console.error('   Ensure OPERATE_PASSWORD is set and .operate/wallets/ethereum.txt exists');
    process.exit(1);
  }

  const masterEOA = getMasterEOA();
  console.log(`Master EOA:     ${masterEOA}`);

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(masterPrivateKey, provider);

  // Contract instances
  const sourceStaking = new ethers.Contract(sourceConfig.address, STAKING_ABI, signer);
  const targetStaking = new ethers.Contract(targetConfig.address, STAKING_ABI, signer);
  const serviceRegistry = new ethers.Contract(CONTRACTS.SERVICE_REGISTRY, SERVICE_REGISTRY_ABI, provider);
  const tokenUtility = new ethers.Contract(CONTRACTS.SERVICE_REGISTRY_TOKEN_UTILITY, TOKEN_UTILITY_ABI, signer);
  const olasToken = new ethers.Contract(CONTRACTS.OLAS_TOKEN, ERC20_ABI, signer);

  // ════════════════════════════════════════════════════════════════════════
  // Step 1: Preflight Checks
  // ════════════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Step 1: Preflight Checks');
  console.log('═══════════════════════════════════════════════════════════════');

  // Check service ownership
  const owner = await serviceRegistry.ownerOf(serviceId);
  console.log(`\n📋 Service Owner: ${owner}`);
  if (owner.toLowerCase() !== masterEOA?.toLowerCase()) {
    console.error(`❌ Service is owned by ${owner}, not master EOA ${masterEOA}`);
    console.error('   The master wallet must own the service to migrate it');
    process.exit(1);
  }
  console.log('   ✅ Master EOA owns the service');

  // Check if staked in source
  const sourceStakedIds = await getStakedServiceIds(sourceStaking);
  const isStakedInSource = sourceStakedIds.includes(serviceId);
  console.log(`\n📍 Source Staking Status: ${isStakedInSource ? '✅ STAKED' : '❌ NOT STAKED'}`);
  if (!isStakedInSource) {
    console.error(`   Service ${serviceId} is not staked in ${sourceConfig.name}`);
    console.error(`   Staked services: ${sourceStakedIds.join(', ') || 'none'}`);
    process.exit(1);
  }

  // Check current bond amount
  const [currentBond] = await tokenUtility.mapServiceIdTokenDeposit(serviceId);
  const currentBondFormatted = ethers.formatEther(currentBond);
  console.log(`\n💰 Current Bond: ${currentBondFormatted} OLAS`);

  // Check target minimum stake
  const targetMinStake = await targetStaking.minStakingDeposit();
  console.log(`   Target Min Stake: ${ethers.formatEther(targetMinStake)} OLAS`);

  const needsBondTopup = currentBond < targetMinStake;
  const topupAmount = needsBondTopup ? targetMinStake - currentBond : 0n;
  if (needsBondTopup) {
    console.log(`   ⚠️  Bond top-up required: ${ethers.formatEther(topupAmount)} OLAS`);

    // Check OLAS balance
    const olasBalance = await olasToken.balanceOf(masterEOA);
    console.log(`   Master EOA OLAS balance: ${ethers.formatEther(olasBalance)} OLAS`);

    if (olasBalance < topupAmount) {
      console.error(`   ❌ Insufficient OLAS balance for top-up`);
      console.error(`      Need: ${ethers.formatEther(topupAmount)} OLAS`);
      console.error(`      Have: ${ethers.formatEther(olasBalance)} OLAS`);
      process.exit(1);
    }
    console.log('   ✅ Sufficient OLAS for bond top-up');
  } else {
    console.log('   ✅ Current bond meets target minimum');
  }

  // Check target has slots available
  const targetStakedIds = await getStakedServiceIds(targetStaking);
  const targetMaxServices = await targetStaking.maxNumServices();
  console.log(`\n🎰 Target Slots: ${targetStakedIds.length}/${targetMaxServices}`);
  if (targetStakedIds.length >= targetMaxServices) {
    console.error(`   ❌ Target staking contract is full`);
    process.exit(1);
  }
  console.log('   ✅ Slots available');

  // Check not already staked in target
  if (targetStakedIds.includes(serviceId)) {
    console.error(`\n❌ Service ${serviceId} is already staked in target ${targetConfig.name}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  DRY RUN COMPLETE - No transactions executed');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\nWould execute:');
    console.log(`  1. Unstake from ${sourceConfig.name}`);
    if (needsBondTopup) {
      console.log(`  2. Approve ${ethers.formatEther(topupAmount)} OLAS for ServiceRegistryTokenUtility`);
      console.log(`  3. Increase security deposit by ${ethers.formatEther(topupAmount)} OLAS`);
      console.log(`  4. Stake in ${targetConfig.name}`);
    } else {
      console.log(`  2. Stake in ${targetConfig.name}`);
    }
    console.log('\nRun without --dry-run to execute migration');
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Step 2: Unstake from Source
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Step 2: Unstake from Source');
  console.log('═══════════════════════════════════════════════════════════════');

  console.log(`\n🔄 Unstaking service ${serviceId} from ${sourceConfig.name}...`);
  const unstakeTx = await sourceStaking.unstake(serviceId);
  console.log(`   TX: ${unstakeTx.hash}`);
  const unstakeReceipt = await unstakeTx.wait();
  console.log(`   ✅ Unstaked (block ${unstakeReceipt?.blockNumber})`);

  // ════════════════════════════════════════════════════════════════════════
  // Step 3: Top-up Bond (if needed)
  // ════════════════════════════════════════════════════════════════════════
  if (needsBondTopup) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Step 3: Top-up Bond');
    console.log('═══════════════════════════════════════════════════════════════');

    // Approve OLAS spending
    console.log(`\n🔄 Approving ${ethers.formatEther(topupAmount)} OLAS for ServiceRegistryTokenUtility...`);
    const approveTx = await olasToken.approve(CONTRACTS.SERVICE_REGISTRY_TOKEN_UTILITY, topupAmount);
    console.log(`   TX: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('   ✅ Approved');

    // Increase security deposit
    console.log(`\n🔄 Increasing security deposit by ${ethers.formatEther(topupAmount)} OLAS...`);
    const increaseTx = await tokenUtility.increaseSecurityDeposit(serviceId, topupAmount);
    console.log(`   TX: ${increaseTx.hash}`);
    await increaseTx.wait();
    console.log('   ✅ Security deposit increased');

    // Verify new bond
    const [newBond] = await tokenUtility.mapServiceIdTokenDeposit(serviceId);
    console.log(`   New bond: ${ethers.formatEther(newBond)} OLAS`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Step 4: Stake in Target
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Step 4: Stake in Target');
  console.log('═══════════════════════════════════════════════════════════════');

  console.log(`\n🔄 Staking service ${serviceId} in ${targetConfig.name}...`);
  const stakeTx = await targetStaking.stake(serviceId);
  console.log(`   TX: ${stakeTx.hash}`);
  const stakeReceipt = await stakeTx.wait();
  console.log(`   ✅ Staked (block ${stakeReceipt?.blockNumber})`);

  // ════════════════════════════════════════════════════════════════════════
  // Step 5: Verification
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Step 5: Verification');
  console.log('═══════════════════════════════════════════════════════════════');

  // Verify staking status
  const finalTargetIds = await getStakedServiceIds(targetStaking);
  const isStakedInTarget = finalTargetIds.includes(serviceId);
  console.log(`\n📍 Target Staking Status: ${isStakedInTarget ? '✅ STAKED' : '❌ NOT STAKED'}`);

  // Get staking info
  if (isStakedInTarget) {
    const stakingInfo = await targetStaking.mapServiceInfo(serviceId);
    console.log(`   Multisig: ${stakingInfo[0]}`);
    console.log(`   Owner: ${stakingInfo[1]}`);
    console.log(`   Staking Start: ${new Date(Number(stakingInfo[3]) * 1000).toISOString()}`);
  }

  // Verify not in source anymore
  const finalSourceIds = await getStakedServiceIds(sourceStaking);
  const stillInSource = finalSourceIds.includes(serviceId);
  console.log(`\n📍 Source Staking Status: ${stillInSource ? '⚠️ STILL STAKED' : '✅ REMOVED'}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Migration Complete!');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\nService ${serviceId} migrated from ${sourceConfig.name} to ${targetConfig.name}`);
  console.log(`\n🔗 Links:`);
  console.log(`   Target Staking: https://basescan.org/address/${targetConfig.address}`);
  console.log(`   Service Registry: https://basescan.org/token/${CONTRACTS.SERVICE_REGISTRY}?a=${serviceId}`);
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
