/**
 * Acceptance Criteria C: Correctness
 * 
 * Verify that the deployed Safe exists on-chain and has the correct configuration:
 * - The Safe contract exists at the predicted address
 * - The Safe has the correct owner (single EOA)
 * - The Safe has the correct threshold (1)
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { WalletManager } from '../index.js';
import type { WalletManagerConfig, BootstrapResult } from '../types.js';

// Safe ABI for verification
const SAFE_ABI = [
  {
    "constant": true,
    "inputs": [],
    "name": "getOwners",
    "outputs": [{ "name": "", "type": "address[]" }],
    "payable": false, 
    "stateMutability": "view", 
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "getThreshold",
    "outputs": [{ "name": "", "type": "uint256" }],
    "payable": false, 
    "stateMutability": "view", 
    "type": "function"
  }
] as const;

describe('Acceptance Criteria C: Correctness', () => {
  let walletManager: WalletManager;
  let publicClient: ReturnType<typeof createPublicClient>;
  let config: WalletManagerConfig;
  let bootstrapResult: BootstrapResult;

  beforeAll(async () => {
    // Load environment variables
    const tenderly_rpc_url = process.env.TENDERLY_RPC_URL;
    const worker_private_key = process.env.WORKER_PRIVATE_KEY as `0x${string}`;

    if (!tenderly_rpc_url || !worker_private_key) {
      throw new Error('Missing required environment variables: TENDERLY_RPC_URL, WORKER_PRIVATE_KEY');
    }

    // Configure test environment
    config = {
      workerPrivateKey: worker_private_key,
      chainId: base.id, // Base mainnet (8453)
      rpcUrl: tenderly_rpc_url,
      options: {
        storageBasePath: `/tmp/.jinn-test/wallets-test-c-${Date.now()}`
      }
    };

    // Initialize wallet manager
    walletManager = new WalletManager(config);

    // Initialize public client for on-chain verification
    publicClient = createPublicClient({
      chain: base,
      transport: http(tenderly_rpc_url)
    }) as any; // Type assertion to work around viem type compatibility issues

    // Perform bootstrap to ensure we have a deployed Safe
    bootstrapResult = await walletManager.bootstrap();
    console.log(`Bootstrap result: ${bootstrapResult.status}`);
    
    // Ensure we have a valid Safe (either created or exists)
    if (bootstrapResult.status !== 'created' && bootstrapResult.status !== 'exists') {
      throw new Error(`Bootstrap failed: ${JSON.stringify(bootstrapResult)}`);
    }
  }, 30000); // 30 second timeout for setup

  test('Safe contract exists at the predicted address', async () => {
    // Verify we have a successful bootstrap result
    expect(['created', 'exists']).toContain(bootstrapResult.status);
    
    if (bootstrapResult.status === 'created' || bootstrapResult.status === 'exists') {
      const safeAddress = bootstrapResult.identity.safeAddress;
      
      // Check that bytecode exists at the Safe address
      const bytecode = await publicClient.getBytecode({ address: safeAddress });
      
      expect(bytecode).toBeDefined();
      expect(bytecode).not.toBe('0x');
      expect(bytecode!.length).toBeGreaterThan(2); // More than just '0x'
      
      console.log(`✅ Safe contract confirmed at address: ${safeAddress}`);
      console.log(`   Bytecode length: ${bytecode!.length} characters`);
    }
  }, 10000);

  test('Safe has the correct single owner configuration', async () => {
    expect(['created', 'exists']).toContain(bootstrapResult.status);
    
    if (bootstrapResult.status === 'created' || bootstrapResult.status === 'exists') {
      const safeAddress = bootstrapResult.identity.safeAddress;
      const expectedOwner = bootstrapResult.identity.ownerAddress;
      
      // Read owners from the Safe contract
      const owners = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: 'getOwners',
      }) as `0x${string}`[];
      
      // Verify single owner
      expect(owners).toHaveLength(1);
      expect(owners[0].toLowerCase()).toBe(expectedOwner.toLowerCase());
      
      console.log(`✅ Safe owner verification passed:`);
      console.log(`   Expected owner: ${expectedOwner}`);
      console.log(`   Actual owner: ${owners[0]}`);
      console.log(`   Owners count: ${owners.length}`);
    }
  }, 10000);

  test('Safe has the correct threshold configuration', async () => {
    expect(['created', 'exists']).toContain(bootstrapResult.status);
    
    if (bootstrapResult.status === 'created' || bootstrapResult.status === 'exists') {
      const safeAddress = bootstrapResult.identity.safeAddress;
      
      // Read threshold from the Safe contract
      const threshold = await publicClient.readContract({
        address: safeAddress,
        abi: SAFE_ABI,
        functionName: 'getThreshold',
      }) as bigint;
      
      // Verify threshold is 1
      expect(threshold).toBe(1n);
      
      console.log(`✅ Safe threshold verification passed:`);
      console.log(`   Expected threshold: 1`);
      console.log(`   Actual threshold: ${threshold.toString()}`);
    }
  }, 10000);

  test('Safe configuration matches 1-of-1 specification', async () => {
    expect(['created', 'exists']).toContain(bootstrapResult.status);
    
    if (bootstrapResult.status === 'created' || bootstrapResult.status === 'exists') {
      const safeAddress = bootstrapResult.identity.safeAddress;
      const expectedOwner = bootstrapResult.identity.ownerAddress;
      
      // Read both owners and threshold in parallel
      const [owners, threshold] = await Promise.all([
        publicClient.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getOwners',
        }) as Promise<`0x${string}`[]>,
        publicClient.readContract({
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: 'getThreshold',
        }) as Promise<bigint>
      ]);
      
      // Verify complete 1-of-1 configuration
      expect(owners).toHaveLength(1);
      expect(owners[0].toLowerCase()).toBe(expectedOwner.toLowerCase());
      expect(threshold).toBe(1n);
      
      // Calculate the effective security model
      const isValidOneOfOne = owners.length === 1 && threshold === 1n;
      expect(isValidOneOfOne).toBe(true);
      
      console.log(`✅ Complete 1-of-1 Safe configuration verified:`);
      console.log(`   Safe address: ${safeAddress}`);
      console.log(`   Owner: ${owners[0]}`);
      console.log(`   Threshold: ${threshold.toString()}`);
      console.log(`   Configuration: ${owners.length}-of-${owners.length} with threshold ${threshold.toString()}`);
      console.log(`   Security model: ${isValidOneOfOne ? 'Valid 1-of-1' : 'Invalid configuration'}`);
    }
  }, 10000);

  test('Safe address matches the deterministic prediction', async () => {
    expect(['created', 'exists']).toContain(bootstrapResult.status);
    
    if (bootstrapResult.status === 'created' || bootstrapResult.status === 'exists') {
      const actualSafeAddress = bootstrapResult.identity.safeAddress;
      const ownerAddress = bootstrapResult.identity.ownerAddress;
      const saltNonce = bootstrapResult.identity.saltNonce;
      
      // Use the bootstrap module to predict the address with the same parameters
      const { predictSafeAddress } = await import('../bootstrap.js');
      const predictedAddress = await predictSafeAddress(config, ownerAddress, saltNonce);
      
      // Verify the addresses match
      expect(actualSafeAddress.toLowerCase()).toBe(predictedAddress.toLowerCase());
      
      console.log(`✅ Deterministic address prediction verified:`);
      console.log(`   Predicted address: ${predictedAddress}`);
      console.log(`   Actual address: ${actualSafeAddress}`);
      console.log(`   Salt nonce: ${saltNonce}`);
      console.log(`   Owner: ${ownerAddress}`);
    }
  }, 10000);
});
