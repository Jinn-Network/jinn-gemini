#!/usr/bin/env npx tsx
/**
 * stOLAS Integration Test — Tenderly Base Fork
 *
 * Tests the LemonTree ExternalStakingDistributor contract for Jinn staking.
 *
 * FINDINGS (Feb 2026):
 *   - Deployed contract at 0x40abf47B... is NOT the StakingManager from the
 *     LemonTree GitHub repo. It's a custom unverified contract.
 *   - deposit() stores OLAS but does NOT create services. The staking trigger
 *     mechanism is unknown — likely called by the guard contract.
 *   - Jinn staking proxy is NOT YET CONFIGURED on mainnet.
 *   - We need the actual ABI from LemonTree to proceed further.
 *
 * What this test validates:
 *   1. setStakingProxyConfigs() — configure reward split for Jinn
 *   2. deposit() — deposit OLAS into the distributor
 *   3. State reads — verify config and balance
 *
 * Usage:
 *   npx tsx scripts/test/stolas-integration-test.ts
 *
 * Requires: TENDERLY_ACCESS_KEY, TENDERLY_ACCOUNT_SLUG, TENDERLY_PROJECT_SLUG
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
import { ethers } from 'ethers';
import { createTenderlyClient } from '../lib/tenderly.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
dotenv.config({ path: resolve(ROOT, '.env'), quiet: true } as any);
dotenv.config({ path: resolve(ROOT, '.env.test'), override: true, quiet: true } as any);

// ─── Addresses ─────────────────────────────────────────────────────────────────

const DISTRIBUTOR_PROXY     = '0x40abf47B926181148000DbCC7c8DE76A3a61a66f';
const DISTRIBUTOR_IMPL      = '0x4A26F79b9dd73a48d57ce4DF70295A875afa006c';
const L2_STAKING_PROCESSOR  = '0xCAF018A23a104095180e298856AC1a415f9831E8';
const DISTRIBUTOR_OWNER     = '0x40c0392c23fAfa216C69Bc291AFcb1b3F4abd49b';
const GUARD                 = '0x4D3911420a8E4E7dB8c979f4915dA8983C5e3ba2';
const JINN_STAKING          = '0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139';
const OLAS_TOKEN            = '0x54330d28ca3357F294334BDC454a032e7f353416';
const SERVICE_REGISTRY      = '0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE';

// ─── Reverse-Engineered ABI ────────────────────────────────────────────────────
//
// Config packing (via unwrapStakingConfig):
//   bits [0:7]   → stakingType (8 bits, enum: 0 or 1)
//   bits [8:23]  → collectorFactor (16 bits)
//   bits [24:39] → protocolFactor (16 bits)
//   bits [40+]   → agentFactor
//
// Pack: (agentFactor << 40) | (protocolFactor << 24) | (collectorFactor << 8) | stakingType
// Sum of factors must equal 10000 (basis points).

const DISTRIBUTOR_ABI = [
  // View functions (confirmed working)
  'function VERSION() view returns (string)',
  'function owner() view returns (address)',
  'function collector() view returns (address)',
  'function guard() view returns (address)',
  'function l2StakingProcessor() view returns (address)',
  'function serviceManager() view returns (address)',
  'function serviceRegistry() view returns (address)',
  'function serviceRegistryTokenUtility() view returns (address)',
  'function safeSameAddressMultisig() view returns (address)',
  'function fallbackHandler() view returns (address)',
  'function stakedBalance() view returns (uint256)',
  'function THRESHOLD() view returns (uint256)',
  'function NUM_AGENT_INSTANCES() view returns (uint256)',
  'function mapStakingProxyConfigs(address) view returns (uint256)',
  'function unwrapStakingConfig(uint256) view returns (uint256, uint256, uint256, uint256)',

  // Write functions (confirmed working)
  'function setStakingProxyConfigs(address[] stakingProxies, uint256[] configs) external',
  'function deposit(uint256 amount, bytes32 operation) external',
  'function claim(address[] stakingProxies, uint256[] serviceIds) external',
  'function unstakeAndWithdraw(address stakingProxy, uint256 amount, bytes32 operation) external',
  'function changeOwner(address newOwner) external',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const STAKING_ABI = [
  'function getServiceIds() view returns (uint256[])',
  'function maxNumServices() view returns (uint256)',
  'function minStakingDeposit() view returns (uint256)',
  'function availableRewards() view returns (uint256)',
  'function agentIds(uint256) view returns (uint256)',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function rpcCall(rpcUrl: string, method: string, params: unknown[] = []): Promise<any> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!resp.ok) throw new Error(`RPC ${method}: HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(`RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function ethToHex(eth: string): string {
  return '0x' + (BigInt(Math.floor(parseFloat(eth) * 1e18))).toString(16);
}

function section(title: string) { console.log(`\n${'═'.repeat(60)}\n  ${title}\n${'═'.repeat(60)}`); }
function ok(msg: string) { console.log(`  [OK] ${msg}`); }
function info(msg: string) { console.log(`  [..] ${msg}`); }
function fail(msg: string) { console.log(`  [!!] ${msg}`); }

function packStakingConfig(agentFactor: bigint, protocolFactor: bigint, collectorFactor: bigint, stakingType: bigint): bigint {
  if (agentFactor + protocolFactor + collectorFactor !== 10000n) {
    throw new Error(`Factors must sum to 10000: ${agentFactor} + ${protocolFactor} + ${collectorFactor} = ${agentFactor + protocolFactor + collectorFactor}`);
  }
  return (agentFactor << 40n) | (protocolFactor << 24n) | (collectorFactor << 8n) | stakingType;
}

async function sendTx(adminRpc: string, from: string, to: string, data: string, label: string, gas = '0x1000000'): Promise<any> {
  info(`${label}...`);
  const txHash = await rpcCall(adminRpc, 'eth_sendTransaction', [{ from, to, data, gas }]);
  const receipt = await rpcCall(adminRpc, 'eth_getTransactionReceipt', [txHash]);
  if (receipt.status === '0x1') {
    ok(`${label} — gas: ${parseInt(receipt.gasUsed, 16).toLocaleString()}, logs: ${receipt.logs.length}`);
    return receipt;
  }
  fail(`${label} — REVERTED`);
  throw new Error(`${label} reverted`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('stOLAS Integration Test — Tenderly Base Fork');
  console.log('='.repeat(60));

  const client = createTenderlyClient();

  section('Step 1: Create Tenderly Base Fork');
  await client.cleanupOldVnets({ maxAgeMs: 3600000 });
  const vnet = await client.createVnet(8453);
  ok(`VNet: ${vnet.id}`);

  const adminRpc = vnet.adminRpcUrl;
  const provider = new ethers.JsonRpcProvider(adminRpc);
  const iface = new ethers.Interface(DISTRIBUTOR_ABI);

  try {
    // ── Step 2: Read current state ──
    section('Step 2: Read Current State');

    const dist = new ethers.Contract(DISTRIBUTOR_PROXY, DISTRIBUTOR_ABI, provider);
    const staking = new ethers.Contract(JINN_STAKING, STAKING_ABI, provider);
    const olas = new ethers.Contract(OLAS_TOKEN, ERC20_ABI, provider);

    const [version, owner, guard, l2Proc, minDeposit, maxServices, currentIds, jinnConfig] = await Promise.all([
      dist.VERSION(), dist.owner(), dist.guard(), dist.l2StakingProcessor(),
      staking.minStakingDeposit(), staking.maxNumServices(), staking.getServiceIds(),
      dist.mapStakingProxyConfigs(JINN_STAKING),
    ]);

    info(`Version: ${version}, Owner: ${owner}`);
    info(`Guard: ${guard}`);
    info(`l2StakingProcessor: ${l2Proc}`);
    info(`Jinn: ${maxServices} max services, ${ethers.formatEther(minDeposit)} OLAS min deposit`);
    info(`Jinn services: [${currentIds.map((id: any) => id.toString()).join(', ')}]`);
    info(`Jinn stOLAS config: ${jinnConfig === 0n ? 'NOT CONFIGURED' : jinnConfig.toString()}`);

    // ── Step 3: Fund accounts ──
    section('Step 3: Fund Accounts');
    await rpcCall(adminRpc, 'tenderly_setBalance', [
      [DISTRIBUTOR_OWNER, L2_STAKING_PROCESSOR, DISTRIBUTOR_PROXY], ethToHex('10'),
    ]);
    const olasAmount = 20000n * 10n ** 18n;
    await rpcCall(adminRpc, 'tenderly_setErc20Balance', [
      OLAS_TOKEN, [L2_STAKING_PROCESSOR], `0x${olasAmount.toString(16)}`,
    ]);
    ok(`Funded: 10 ETH each, ${ethers.formatEther(olasAmount)} OLAS to processor`);

    // ── Step 4: Configure Jinn staking proxy ──
    section('Step 4: Configure Jinn Staking Proxy');

    // Testing config: 99.99% to operator, 0.01% to collector, 0% to protocol
    const config = packStakingConfig(9999n, 0n, 1n, 1n);
    info(`Packed config: ${config} (agent=9999, protocol=0, collector=1, type=1)`);

    await sendTx(adminRpc, DISTRIBUTOR_OWNER, DISTRIBUTOR_PROXY,
      iface.encodeFunctionData('setStakingProxyConfigs', [[JINN_STAKING], [config]]),
      'setStakingProxyConfigs');

    const newConfig = await dist.mapStakingProxyConfigs(JINN_STAKING);
    const [a, b, c, d] = await dist.unwrapStakingConfig(newConfig);
    ok(`Config verified: agent=${a}, protocol=${b}, collector=${c}, type=${d}`);

    // ── Step 5: Approve + Deposit ──
    section('Step 5: Approve + Deposit OLAS');

    const depositAmount = 10000n * 10n ** 18n;
    const erc20Iface = new ethers.Interface(ERC20_ABI);

    await sendTx(adminRpc, L2_STAKING_PROCESSOR, OLAS_TOKEN,
      erc20Iface.encodeFunctionData('approve', [DISTRIBUTOR_PROXY, olasAmount]),
      'OLAS approve', '0x50000');

    await sendTx(adminRpc, L2_STAKING_PROCESSOR, DISTRIBUTOR_PROXY,
      iface.encodeFunctionData('deposit', [depositAmount, ethers.zeroPadValue(JINN_STAKING, 32)]),
      `deposit(${ethers.formatEther(depositAmount)} OLAS)`);

    // ── Step 6: Verify ──
    section('Step 6: Verify State');

    const [distOlas, stakedBal, newIds] = await Promise.all([
      olas.balanceOf(DISTRIBUTOR_PROXY),
      dist.stakedBalance(),
      staking.getServiceIds(),
    ]);

    info(`Distributor OLAS balance: ${ethers.formatEther(distOlas)}`);
    info(`Distributor stakedBalance: ${ethers.formatEther(stakedBal)}`);
    info(`Jinn services: [${newIds.map((id: any) => id.toString()).join(', ')}]`);

    const newServices = newIds.filter(
      (id: any) => !currentIds.some((old: any) => old.toString() === id.toString())
    );

    if (newServices.length > 0) {
      ok(`New services: [${newServices.map((id: any) => id.toString()).join(', ')}]`);
    } else {
      info('No new services created — deposit stored OLAS but staking trigger is unknown');
      info('The guard or another mechanism must create/stake services separately');
    }

    // ── Summary ──
    section('Summary');
    ok('Config set successfully: setStakingProxyConfigs works');
    ok('Deposit successful: OLAS transferred to distributor');
    info('Staking NOT triggered: need ABI from LemonTree for the staking trigger function');
    console.log('');
    info('Questions for LemonTree:');
    info('  1. How does staking get triggered after deposit? (guard bot? separate function?)');
    info('  2. Can you share the actual ABI for the deployed ExternalStakingDistributor?');
    info('  3. Confirm: Jinn needs to be whitelisted via setStakingProxyConfigs on mainnet');
    info(`  4. Confirm config encoding: pack(agent=9999, protocol=0, collector=1, type=1) = ${config}`);

  } finally {
    section('Cleanup');
    const cleaned = await client.cleanupOldVnets({ maxAgeMs: 0 });
    ok(`Cleaned up ${cleaned} VNets`);
  }
}

main().catch(e => {
  console.error('\nFATAL:', e.message || e);
  process.exit(1);
});
