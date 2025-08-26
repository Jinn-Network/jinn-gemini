/**
 * Acceptance Criteria Test A: Determinism
 * 
 * Objective: Verify that predictSafeAddress consistently returns the same address
 * for the same inputs against real Gnosis Safe contracts on Tenderly fork.
 */

import { predictSafeAddress } from '../bootstrap.js';
import type { WalletManagerConfig } from '../types.js';
import { privateKeyToAccount } from 'viem/accounts';

describe('Acceptance Criteria A: Determinism', () => {
  let testConfig: WalletManagerConfig;
  let ownerAddress: `0x${string}`;

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

    // Configure for Base mainnet (chain ID 8453)
    testConfig = {
      workerPrivateKey: privateKey,
      chainId: 8453, // Base mainnet
      rpcUrl
    };

    console.log(`Test configuration:`);
    console.log(`- Chain ID: ${testConfig.chainId}`);
    console.log(`- RPC URL: ${rpcUrl}`);
    console.log(`- Owner Address: ${ownerAddress}`);
  });

  test('predictSafeAddress returns identical addresses for identical inputs', async () => {
    const iterations = 5;
    const addresses: string[] = [];

    // Call predictSafeAddress multiple times with the same configuration
    for (let i = 0; i < iterations; i++) {
      const address = await predictSafeAddress(
        testConfig,
        ownerAddress,
        '0x1234567890123456789012345678901234567890123456789012345678901234' // Fixed salt nonce for determinism
      );
      addresses.push(address);
      console.log(`Iteration ${i + 1}: ${address}`);
    }

    // Assert all addresses are identical
    const firstAddress = addresses[0];
    for (let i = 1; i < addresses.length; i++) {
      expect(addresses[i]).toBe(firstAddress);
    }

    console.log(`✅ All ${iterations} calls returned the same address: ${firstAddress}`);
  });

  test('predictSafeAddress returns valid Ethereum address format', async () => {
    const address = await predictSafeAddress(
      testConfig,
      ownerAddress,
      '0x1234567890123456789012345678901234567890123456789012345678901234'
    );

    // Assert address format is valid
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(address).toHaveLength(42);

    console.log(`✅ Address format is valid: ${address}`);
  });

  test('different salt nonces produce different addresses', async () => {
    const saltNonce1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const saltNonce2 = '0x2222222222222222222222222222222222222222222222222222222222222222';

    const address1 = await predictSafeAddress(testConfig, ownerAddress, saltNonce1);
    const address2 = await predictSafeAddress(testConfig, ownerAddress, saltNonce2);

    // Assert different salt nonces produce different addresses
    expect(address1).not.toBe(address2);

    console.log(`✅ Different salt nonces produce different addresses:`);
    console.log(`  Salt 1: ${saltNonce1} -> ${address1}`);
    console.log(`  Salt 2: ${saltNonce2} -> ${address2}`);
  });

  test('same configuration with different owners produces different addresses', async () => {
    // Use a different private key for this test
    const differentPrivateKey = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const differentAccount = privateKeyToAccount(differentPrivateKey);
    const differentOwnerAddress = differentAccount.address as `0x${string}`;

    const saltNonce = '0x1234567890123456789012345678901234567890123456789012345678901234';

    const address1 = await predictSafeAddress(testConfig, ownerAddress, saltNonce);
    const address2 = await predictSafeAddress(testConfig, differentOwnerAddress, saltNonce);

    // Assert different owners produce different addresses
    expect(address1).not.toBe(address2);

    console.log(`✅ Different owners produce different addresses:`);
    console.log(`  Owner 1: ${ownerAddress} -> ${address1}`);
    console.log(`  Owner 2: ${differentOwnerAddress} -> ${address2}`);
  });
});
