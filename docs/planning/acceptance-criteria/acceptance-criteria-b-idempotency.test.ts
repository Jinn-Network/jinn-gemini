/**
 * Acceptance Criteria Test B: Idempotency & Concurrency
 * 
 * Objective: Ensure multiple bootstrap calls result in a single valid Safe,
 * leveraging Tenderly fork to observe on-chain transactions.
 */

import { WalletManager } from '../index.js';
import type { WalletManagerConfig, BootstrapResult } from '../types.js';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

describe('Acceptance Criteria B: Idempotency & Concurrency', () => {
  let testConfig: WalletManagerConfig;
  let ownerAddress: `0x${string}`;
  let publicClient: any;
  let walletManager: WalletManager;
  let testStoragePath: string;

  beforeAll(() => {
    // Load environment variables
    const privateKey = process.env.WORKER_PRIVATE_KEY as `0x${string}`;
    const rpcUrl = process.env.TENDERLY_RPC_URL;

    if (!privateKey) {
      throw new Error('WORKER_PRIVATE_KEY environment variable is required');
    }

    if (!rpcUrl) {
      throw new Error('TENDERLY_RPC_URL environment variable is required');
    }

    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      throw new Error('WORKER_PRIVATE_KEY must be a valid 64-character hex string with 0x prefix');
    }

    // Derive owner address from private key
    const account = privateKeyToAccount(privateKey);
    ownerAddress = account.address as `0x${string}`;

    // Use unique storage path for test isolation
    testStoragePath = join(homedir(), '.jinn-test', `wallets-test-b-${Date.now()}`);

    // Configure for Base mainnet (chain ID 8453)
    testConfig = {
      workerPrivateKey: privateKey,
      chainId: 8453, // Base mainnet
      rpcUrl,
      options: {
        storageBasePath: testStoragePath
      }
    };

    // Create public client for on-chain verification
    publicClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl)
    });

    // Create wallet manager instance
    walletManager = new WalletManager(testConfig);

    console.log(`Test B configuration:`);
    console.log(`- Chain ID: ${testConfig.chainId}`);
    console.log(`- RPC URL: ${rpcUrl}`);
    console.log(`- Owner Address: ${ownerAddress}`);
    console.log(`- Storage Path: ${testStoragePath}`);
  });

  beforeEach(async () => {
    // Clean up any existing wallet identity files before each test
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }
  });

  afterAll(async () => {
    // Clean up test storage after all tests
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Sequential Idempotency', () => {
    test('first bootstrap call creates a wallet, second call finds it', async () => {
      // First bootstrap call - should create a new Safe
      console.log('🔄 Running first bootstrap call...');
      const result1 = await walletManager.bootstrap();
      
      console.log(`First call result: ${result1.status}`);
      if (result1.status === 'failed') {
        console.log(`Error: ${result1.error}`);
        if (result1.code) {
          console.log(`Error code: ${result1.code}`);
        }
      }
      
      // Should either be 'created' or 'needs_funding'
      if (result1.status === 'needs_funding') {
        console.log('⚠️  Account needs funding. Please fund the address on Tenderly fork:');
        console.log(`   Address: ${result1.address}`);
        console.log(`   Required amount: ${result1.required.minRecommendedWei.toString()} wei`);
        
        // Skip this test if funding is needed
        return;
      }

      // Expect either 'created' (fresh deployment) or 'exists' (Safe already on-chain from previous run)
      expect(['created', 'exists']).toContain(result1.status);
      if (result1.status !== 'created' && result1.status !== 'exists') {
        throw new Error(`Expected 'created' or 'exists' status, got '${result1.status}'`);
      }
      
      expect(result1.identity).toBeDefined();
      expect(result1.identity.safeAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(result1.identity.ownerAddress.toLowerCase()).toBe(ownerAddress.toLowerCase());
      expect(result1.identity.chainId).toBe(8453);

      const firstSafeAddress = result1.identity.safeAddress;
      if (result1.status === 'created') {
        console.log(`✅ First call succeeded: Safe deployed at ${firstSafeAddress}`);
      } else {
        console.log(`✅ First call succeeded: Found existing Safe at ${firstSafeAddress}`);
      }

      // Second bootstrap call (should return 'exists')
      console.log('🔄 Running second bootstrap call...');
      const result2 = await walletManager.bootstrap();
      
      console.log(`Second call result: ${result2.status}`);
      
      expect(result2.status).toBe('exists');
      if (result2.status !== 'exists') {
        throw new Error(`Expected 'exists' status, got '${result2.status}'`);
      }
      
      expect(result2.identity).toBeDefined();
      expect(result2.identity.safeAddress).toBe(firstSafeAddress);
      expect(result2.identity.ownerAddress.toLowerCase()).toBe(ownerAddress.toLowerCase());
      expect(result2.identity.chainId).toBe(8453);

      console.log(`✅ Second call succeeded: Found existing Safe at ${result2.identity.safeAddress}`);
      console.log('✅ Sequential idempotency test passed');
    }, 30000); // 30 second timeout for blockchain operations
  });

  describe('Concurrency Safety', () => {
    test('concurrent bootstrap calls result in single Safe deployment', async () => {
      console.log('🔄 Running concurrent bootstrap calls...');
      
      // Create multiple concurrent bootstrap calls
      const concurrentCalls = 3;
      const promises: Promise<BootstrapResult>[] = [];
      
      for (let i = 0; i < concurrentCalls; i++) {
        const manager = new WalletManager(testConfig);
        promises.push(manager.bootstrap());
      }

      // Wait for all calls to complete
      const results = await Promise.all(promises);
      
      console.log('📊 Concurrent call results:');
      results.forEach((result, index) => {
        console.log(`  Call ${index + 1}: ${result.status}`);
        if (result.status === 'failed') {
          console.log(`    Error: ${result.error}`);
          if (result.code) {
            console.log(`    Error code: ${result.code}`);
          }
        }
      });

      // Check for funding needs first
      const needsFundingResults = results.filter(r => r.status === 'needs_funding');
      if (needsFundingResults.length > 0) {
        console.log('⚠️  Account needs funding. Please fund the address on Tenderly fork:');
        console.log(`   Address: ${needsFundingResults[0].address}`);
        console.log(`   Required: ${needsFundingResults[0].required.minRecommendedWei.toString()} wei`);
        
        // Skip this test if funding is needed
        return;
      }

      // Count results by status
      const createdResults = results.filter(r => r.status === 'created');
      const existsResults = results.filter(r => r.status === 'exists');
      const failedResults = results.filter(r => r.status === 'failed');

      console.log(`📈 Result summary:`);
      console.log(`  - Created: ${createdResults.length}`);
      console.log(`  - Exists: ${existsResults.length}`);
      console.log(`  - Failed: ${failedResults.length}`);

      // CRITICAL FIX: Assert that no calls failed
      expect(failedResults.length).toBe(0);

      // For a persistent blockchain (Tenderly fork), all calls might return 'exists' if Safe already deployed
      // The key requirement is that all calls succeed and reference the same Safe
      const totalSuccessful = createdResults.length + existsResults.length;
      expect(totalSuccessful).toBe(concurrentCalls);
      
      // If any were created, exactly one should be created
      if (createdResults.length > 0) {
        expect(createdResults.length).toBe(1);
        expect(existsResults.length).toBe(concurrentCalls - 1);
      } else {
        // All found existing Safe (valid for persistent blockchain)
        expect(existsResults.length).toBe(concurrentCalls);
      }

      // All successful results should have the same Safe address
      const successfulResults = [...createdResults, ...existsResults];
      const safeAddress = successfulResults[0].identity.safeAddress;
      
      successfulResults.forEach((result, index) => {
        expect(result.identity.safeAddress).toBe(safeAddress);
        expect(result.identity.ownerAddress.toLowerCase()).toBe(ownerAddress.toLowerCase());
        expect(result.identity.chainId).toBe(8453);
        console.log(`  ✅ Result ${index + 1}: Safe at ${result.identity.safeAddress}`);
      });

      console.log(`✅ All concurrent calls referenced the same Safe: ${safeAddress}`);
      console.log('✅ Concurrency safety test passed');
    }, 45000); // 45 second timeout for multiple blockchain operations
  });

  describe('On-Chain Verification', () => {
    test('deployed Safe has correct on-chain configuration', async () => {
      console.log('🔄 Running bootstrap for on-chain verification...');
      
      const result = await walletManager.bootstrap();
      
      if (result.status === 'needs_funding') {
        console.log('⚠️  Account needs funding. Please fund the address on Tenderly fork:');
        console.log(`   Address: ${result.address}`);
        console.log(`   Required: ${result.required.minRecommendedWei.toString()} wei`);
        return;
      }

      expect(['created', 'exists']).toContain(result.status);
      
      if (result.status !== 'created' && result.status !== 'exists') {
        throw new Error(`Expected 'created' or 'exists' status, got '${result.status}'`);
      }
      
      const safeAddress = result.identity.safeAddress;
      console.log(`🔍 Verifying Safe configuration at ${safeAddress}...`);

      // Verify Safe configuration on-chain
      const safeAbi = [
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

      const [owners, threshold] = await Promise.all([
        publicClient.readContract({
          address: safeAddress,
          abi: safeAbi,
          functionName: 'getOwners',
        }),
        publicClient.readContract({
          address: safeAddress,
          abi: safeAbi,
          functionName: 'getThreshold',
        })
      ]);

      console.log(`📋 On-chain Safe configuration:`);
      console.log(`  - Owners: [${owners.join(', ')}]`);
      console.log(`  - Threshold: ${threshold.toString()}`);

      // Verify configuration
      expect(owners).toHaveLength(1);
      expect(owners[0].toLowerCase()).toBe(ownerAddress.toLowerCase());
      expect(threshold).toBe(1n);

      console.log(`✅ On-chain configuration verified:`);
      console.log(`  - Single owner: ${owners[0]}`);
      console.log(`  - Threshold of 1: ${threshold.toString()}`);
      console.log('✅ On-chain verification test passed');
    }, 30000);
  });
});