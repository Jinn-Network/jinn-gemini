/**
 * Smoke tests for wallet-manager package
 * 
 * These tests verify that the package exports are stable and type contracts work correctly.
 * They don't test actual functionality (which will be added in later phases).
 */

import {
  WalletManager,
  getChainConfig,
  getSupportedChainIds,
  isChainSupported,
  getTxServiceUrl,
  DEFAULT_CHAINS,
  SAFE_VERSION,
} from '../index';

import type {
  WalletManagerConfig,
  WalletIdentity,
  BootstrapResult,
} from '../index';

describe('Package Exports', () => {
  test('all expected exports are available', () => {
    expect(typeof WalletManager).toBe('function');
    expect(typeof getChainConfig).toBe('function');
    expect(typeof getSupportedChainIds).toBe('function');
    expect(typeof isChainSupported).toBe('function');
    expect(typeof getTxServiceUrl).toBe('function');
    expect(typeof DEFAULT_CHAINS).toBe('object');
    expect(typeof SAFE_VERSION).toBe('string');
  });

  test('constants have expected values', () => {
    expect(SAFE_VERSION).toBe('1.4.1');
    expect(DEFAULT_CHAINS.BASE_MAINNET).toBe(8453);
    expect(DEFAULT_CHAINS.BASE_SEPOLIA).toBe(84532);
  });
});

describe('Chain Utilities', () => {
  test('getSupportedChainIds returns expected chains', () => {
    const chainIds = getSupportedChainIds();
    expect(chainIds).toContain(8453); // Base
    expect(chainIds).toContain(84532); // Base Sepolia
    expect(chainIds.length).toBe(2);
  });

  test('isChainSupported works correctly', () => {
    expect(isChainSupported(8453)).toBe(true);
    expect(isChainSupported(84532)).toBe(true);
    expect(isChainSupported(1)).toBe(false); // Ethereum mainnet - not supported
  });

  test('getChainConfig returns valid configuration', () => {
    const baseConfig = getChainConfig(8453);
    expect(baseConfig).toHaveProperty('chain');
    expect(baseConfig).toHaveProperty('txServiceUrl');
    expect(baseConfig.chain.id).toBe(8453);
    expect(baseConfig.txServiceUrl).toContain('safe-transaction-base');
  });

  test('getTxServiceUrl returns correct URLs', () => {
    expect(getTxServiceUrl(8453)).toBe('https://safe-transaction-base.safe.global/');
    expect(getTxServiceUrl(84532)).toBe('https://safe-transaction-base-sepolia.safe.global/');
  });

  test('unsupported chain throws error', () => {
    expect(() => getChainConfig(1)).toThrow('Unsupported CHAIN_ID: 1');
    expect(() => getTxServiceUrl(1)).toThrow('Unsupported CHAIN_ID: 1');
  });
});

describe('WalletManager Class', () => {
  const validConfig: WalletManagerConfig = {
    workerPrivateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
  };

  test('constructor accepts valid config', () => {
    expect(() => new WalletManager(validConfig)).not.toThrow();
  });

  test('constructor validates private key format', () => {
    const invalidConfig = { ...validConfig, workerPrivateKey: 'invalid' as `0x${string}` };
    expect(() => new WalletManager(invalidConfig)).toThrow('workerPrivateKey must be a valid hex string with 0x prefix');
  });

  test('constructor validates chain ID', () => {
    const invalidConfig = { ...validConfig, chainId: 0 };
    expect(() => new WalletManager(invalidConfig)).toThrow('chainId must be a positive integer');
  });

  test('constructor validates RPC URL', () => {
    const invalidConfig = { ...validConfig, rpcUrl: 'invalid-url' };
    expect(() => new WalletManager(invalidConfig)).toThrow('rpcUrl must be a valid HTTP/HTTPS URL');
  });

  test('getConfig returns safe configuration', () => {
    const manager = new WalletManager(validConfig);
    const config = manager.getConfig();
    
    expect(config).not.toHaveProperty('workerPrivateKey');
    expect(config.chainId).toBe(8453);
    expect(config.rpcUrl).toBe('https://mainnet.base.org');
  });

  test('bootstrap method exists', () => {
    const manager = new WalletManager(validConfig);
    expect(typeof manager.bootstrap).toBe('function');
  });
});

describe('Type Contracts', () => {
  test('WalletIdentity has required fields', () => {
    // This is a compile-time test - if types change, this won't compile
    const identity: WalletIdentity = {
      ownerAddress: '0x742d35cc6b...',
      safeAddress: '0x1234567890...',
      chainId: 8453,
      createdAt: '2025-08-25T12:34:56Z',
      saltNonce: '0xabcdef...',
    };
    
    expect(identity.chainId).toBe(8453);
  });

  test('BootstrapResult discriminated union', () => {
    // Test that all result types are properly typed
    const existsResult: BootstrapResult = {
      status: 'exists',
      identity: {
        ownerAddress: '0x742d35cc6b...',
        safeAddress: '0x1234567890...',
        chainId: 8453,
        createdAt: '2025-08-25T12:34:56Z',
        saltNonce: '0xabcdef...',
      },
    };

    const needsFundingResult: BootstrapResult = {
      status: 'needs_funding',
      address: '0x742d35cc6b...',
      required: {
        gasLimit: BigInt(1000000),
        maxFeePerGas: BigInt(1000000000),
        maxPriorityFeePerGas: BigInt(1000000000),
        minRecommendedWei: BigInt(1000000000000000),
      },
    };

    expect(existsResult.status).toBe('exists');
    expect(needsFundingResult.status).toBe('needs_funding');
  });
});
