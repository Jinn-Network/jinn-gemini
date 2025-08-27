/**
 * Jinn Wallet Manager - Public API
 * 
 * This module provides the main entry point for the Jinn Wallet Manager library,
 * which handles Gnosis Safe wallet bootstrapping and identity management for
 * autonomous agents in the Olas ecosystem.
 * 
 * The library provides a secure, deterministic way to provision 1-of-1 Gnosis Safe
 * wallets for worker agents, enabling participation in the Olas Marketplace,
 * Staking, and Governance protocols.
 * 
 * ## Key Features
 * 
 * - **Deterministic Wallet Creation**: Generates the same Safe address for a given EOA and chain ID
 * - **Idempotent Bootstrap Process**: Safe for concurrent execution with file-based locking
 * - **Comprehensive Pre-flight Checks**: Validates funding, chain compatibility, and configuration
 * - **Secure Identity Storage**: Persists only public data with atomic write operations
 * - **Error Recovery**: Handles common failure scenarios with clear error codes
 * 
 * @example Basic Usage
 * ```typescript
 * import { WalletManager } from '@jinn/wallet-manager';
 * 
 * const walletManager = new WalletManager({
 *   workerPrivateKey: process.env.WORKER_PRIVATE_KEY as `0x${string}`,
 *   chainId: 8453, // Base mainnet
 *   rpcUrl: 'https://mainnet.base.org'
 * });
 * 
 * const result = await walletManager.bootstrap();
 * if (result.status === 'created') {
 *   console.log('Safe deployed at:', result.identity.safeAddress);
 *   console.log('Gas used:', result.metrics.gasUsed);
 * }
 * ```
 * 
 * @example Handling Different Bootstrap Outcomes
 * ```typescript
 * const result = await walletManager.bootstrap();
 * 
 * switch (result.status) {
 *   case 'exists':
 *     console.log('Safe already exists:', result.identity.safeAddress);
 *     break;
 *   case 'created':
 *     console.log('New Safe deployed:', result.identity.safeAddress);
 *     break;
 *   case 'needs_funding':
 *     console.log('Please fund address:', result.address);
 *     console.log('Required amount:', result.required.minRecommendedWei);
 *     // Wait for funding, then retry bootstrap
 *     break;
 *   case 'failed':
 *     console.error('Bootstrap failed:', result.error);
 *     console.error('Error code:', result.code);
 *     break;
 *   case 'dry_run':
 *     console.log('Dry run completed');
 *     console.log('Predicted Safe address:', result.report.predictedSafeAddress);
 *     console.log('On-chain state:', result.report.onChainState);
 *     console.log('Is funded:', result.report.isFunded);
 *     console.log('Planned actions:', result.report.actions);
 *     break;
 * }
 * ```
 * 
 * @example With Custom Storage Path
 * ```typescript
 * const walletManager = new WalletManager({
 *   workerPrivateKey: '0x...',
 *   chainId: 8453,
 *   rpcUrl: 'https://mainnet.base.org',
 *   options: {
 *     storageBasePath: '/custom/path/wallets'
 *   }
 * });
 * ```
 * 
 * @example Dry Run Mode (v3.0.0+)
 * ```typescript
 * // Preview what would happen without executing transactions
 * const result = await walletManager.bootstrap({ dryRun: true });
 * if (result.status === 'dry_run') {
 *   console.log('Would deploy to:', result.report.predictedSafeAddress);
 *   console.log('Current state:', result.report.onChainState);
 *   console.log('Is funded:', result.report.isFunded);
 *   result.report.actions.forEach(action => {
 *     console.log(`Action: ${action.type} - ${action.details}`);
 *   });
 * }
 * ```
 * 
 * @version 3.0.0
 * @since 1.0.0
 */

export { bootstrap, predictSafeAddress } from './bootstrap.js';
export { getChainConfig, getSupportedChainIds, isChainSupported, getTxServiceUrl, DEFAULT_CHAINS, SAFE_VERSION } from './chains.js';
export { 
  loadWalletIdentity, 
  saveWalletIdentity, 
  walletExists, 
  getWalletPath,
  withLock,
  type StorageError,
  type StorageResult,
  type LockHandle
} from './storage.js';
export type {
  WalletManagerConfig,
  WalletIdentity,
  BootstrapMetrics,
  FundingRequirements,
  BootstrapError,
  BootstrapResult,
  BootstrapOptions,
  DryRunReport,
  NeedsFundingResult,
  StorageProvider,
  ChainConfig
} from './types.js';

import { bootstrap, setupClients, SAFE_ABI } from './bootstrap.js';
import { loadWalletIdentity } from './storage.js';
import type { WalletManagerConfig, BootstrapResult, BootstrapOptions, WalletIdentity } from './types.js';

/**
 * Main wallet manager class that provides a clean API for wallet operations.
 * 
 * This class serves as the primary interface for consumers of the wallet manager
 * library. It encapsulates the configuration and provides a simple, stateful
 * interface for wallet bootstrap operations.
 * 
 * ## Thread Safety
 * 
 * The WalletManager class is thread-safe for bootstrap operations through file-based
 * locking. Multiple instances can safely operate on the same wallet identity without
 * corruption or race conditions.
 * 
 * ## Security
 * 
 * - Private keys are never persisted to disk
 * - Only public wallet information is stored locally
 * - Storage files use restrictive permissions (0600)
 * - Configuration validation prevents common misconfigurations
 * 
 * @example Creating a WalletManager
 * ```typescript
 * const manager = new WalletManager({
 *   workerPrivateKey: process.env.WORKER_PRIVATE_KEY as `0x${string}`,
 *   chainId: 8453, // Base mainnet
 *   rpcUrl: 'https://mainnet.base.org'
 * });
 * ```
 * 
 * @example With Options
 * ```typescript
 * const manager = new WalletManager({
 *   workerPrivateKey: '0x...',
 *   chainId: 84532, // Base Sepolia
 *   rpcUrl: 'https://sepolia.base.org',
 *   options: {
 *     storageBasePath: '~/.myapp/wallets',
 *     txServiceUrl: 'https://safe-transaction-base-sepolia.safe.global/'
 *   }
 * });
 * ```
 * 
 * @since 1.0.0
 */
export class WalletManager {
  private readonly config: WalletManagerConfig;
  
  /**
   * Create a new WalletManager instance.
   * 
   * Validates the provided configuration and throws an error if any required
   * parameters are missing or invalid. The private key is validated for format
   * but not for validity against any specific blockchain.
   * 
   * @param config - Configuration object containing private key, chain ID, and RPC URL
   * 
   * @throws {Error} When workerPrivateKey is missing or invalid format
   * @throws {Error} When chainId is missing or not a positive integer
   * @throws {Error} When rpcUrl is missing or not a valid HTTP/HTTPS URL
   * 
   * @example Basic Configuration
   * ```typescript
   * const manager = new WalletManager({
   *   workerPrivateKey: process.env.WORKER_PRIVATE_KEY as `0x${string}`,
   *   chainId: 8453,
   *   rpcUrl: 'https://mainnet.base.org'
   * });
   * ```
   * 
   * @example With Custom Options
   * ```typescript
   * const manager = new WalletManager({
   *   workerPrivateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
   *   chainId: 84532, // Base Sepolia
   *   rpcUrl: 'https://sepolia.base.org',
   *   options: {
   *     storageBasePath: '/custom/path/wallets',
   *     txServiceUrl: 'https://safe-transaction-base-sepolia.safe.global/'
   *   }
   * });
   * ```
   * 
   * @since 1.0.0
   */
  constructor(config: WalletManagerConfig) {
    this.config = config;
    
    // Validate required configuration
    if (!config.workerPrivateKey) {
      throw new Error('workerPrivateKey is required');
    }
    
    if (!config.workerPrivateKey.startsWith('0x') || config.workerPrivateKey.length !== 66) {
      throw new Error('workerPrivateKey must be a valid hex string with 0x prefix');
    }
    
    if (!config.chainId || config.chainId <= 0) {
      throw new Error('chainId must be a positive integer');
    }
    
    if (!config.rpcUrl || !config.rpcUrl.startsWith('http')) {
      throw new Error('rpcUrl must be a valid HTTP/HTTPS URL');
    }
  }
  
  /**
   * Bootstrap a Gnosis Safe wallet for this manager's configuration.
   * 
   * This method implements a comprehensive "find-or-create" process that is
   * idempotent and safe for concurrent execution. The process includes:
   * 
   * 1. **Local Identity Check**: Loads existing wallet identity from storage
   * 2. **On-chain Verification**: Validates existing Safe configuration (owners, threshold)
   * 3. **Deterministic Generation**: Creates salt nonce from EOA address + chain ID
   * 4. **Pre-existence Check**: Queries Safe Transaction Service for existing deployments
   * 5. **Funding Validation**: Ensures EOA has sufficient funds for deployment
   * 6. **Safe Deployment**: Deploys new 1-of-1 Gnosis Safe (if needed)
   * 7. **Identity Persistence**: Saves wallet details to secure local storage
   * 
   * ## Concurrency Safety
   * 
   * The bootstrap process uses file-based locking to prevent race conditions.
   * Multiple processes can safely call this method simultaneously without
   * corrupting the local identity or creating duplicate Safes.
   * 
   * ## Deterministic Behavior
   * 
   * For a given EOA private key and chain ID, this method will always:
   * - Generate the same salt nonce
   * - Predict the same Safe address
   * - Create the same Safe configuration (1-of-1 with EOA as owner)
   * 
   * @returns Promise resolving to bootstrap result with status and detailed information
   * 
   * @throws Generally does not throw - errors are returned in the result object
   * @throws May throw on severe system errors (file system permissions, etc.)
   * 
   * @example Basic Bootstrap
   * ```typescript
   * const result = await manager.bootstrap();
   * console.log('Bootstrap status:', result.status);
   * ```
   * 
   * @example Comprehensive Error Handling
   * ```typescript
   * const result = await manager.bootstrap();
   * 
   * switch (result.status) {
   *   case 'exists':
   *     console.log('Safe already exists:', result.identity.safeAddress);
   *     console.log('Owner:', result.identity.ownerAddress);
   *     console.log('Created:', result.identity.createdAt);
   *     break;
   * 
   *   case 'created':
   *     console.log('New Safe deployed:', result.identity.safeAddress);
   *     console.log('Transaction hash:', result.metrics.txHash);
   *     console.log('Gas used:', result.metrics.gasUsed?.toString());
   *     console.log('Duration:', result.metrics.durationMs + 'ms');
   *     break;
   * 
   *   case 'needs_funding':
   *     console.log('Funding required for address:', result.address);
   *     console.log('Minimum amount (wei):', result.required.minRecommendedWei.toString());
   *     console.log('Gas limit:', result.required.gasLimit.toString());
   *     console.log('Max fee per gas:', result.required.maxFeePerGas.toString());
   *     
   *     // Example: Wait for funding and retry
   *     // await waitForFunding(result.address, result.required.minRecommendedWei);
   *     // const retryResult = await manager.bootstrap();
   *     break;
   * 
   *   case 'failed':
   *     console.error('Bootstrap failed:', result.error);
   *     
   *     switch (result.code) {
   *       case 'unsupported_chain':
   *         console.error('Chain ID not supported by this library');
   *         break;
   *       case 'safe_config_mismatch':
   *         console.error('Existing Safe has incompatible configuration');
   *         break;
   *       case 'rpc_error':
   *         console.error('RPC endpoint error - check network connectivity');
   *         break;
   *       case 'deployment_failed':
   *         console.error('Safe deployment transaction failed');
   *         break;
   *       default:
   *         console.error('Unknown error occurred');
   *     }
   *     break;
   * }
   * ```
   * 
   * @example Polling for Funding
   * ```typescript
   * let result = await manager.bootstrap();
   * 
   * if (result.status === 'needs_funding') {
   *   console.log(`Please fund ${result.address} with at least ${result.required.minRecommendedWei} wei`);
   *   
   *   // Poll for funding
   *   while (result.status === 'needs_funding') {
   *     await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
   *     result = await manager.bootstrap();
   *   }
   * }
   * 
   * if (result.status === 'created' || result.status === 'exists') {
   *   console.log('Safe ready:', result.identity.safeAddress);
   * }
   * ```
   * 
   * @since 1.0.0
   * @version 3.0.0 Added support for dry run mode
   */
  async bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
    return bootstrap(this.config, options);
  }
  
  /**
   * Get the configuration used by this wallet manager.
   * 
   * Returns a copy of the configuration object with the private key excluded
   * for security reasons. This is useful for logging, debugging, or displaying
   * configuration information without exposing sensitive data.
   * 
   * @returns Configuration object without the workerPrivateKey field
   * 
   * @example
   * ```typescript
   * const config = manager.getConfig();
   * console.log('Chain ID:', config.chainId);
   * console.log('RPC URL:', config.rpcUrl);
   * console.log('Storage path:', config.options?.storageBasePath);
   * // privateKey is NOT included in the returned object
   * ```
   * 
   * @since 1.0.0
   */
  getConfig(): Omit<WalletManagerConfig, 'workerPrivateKey'> {
    const { workerPrivateKey, ...safeConfig } = this.config;
    return safeConfig;
  }
  
  /**
   * Get the chain ID for this wallet manager.
   * 
   * @returns The configured chain ID (e.g., 8453 for Base mainnet)
   * 
   * @example
   * ```typescript
   * const chainId = manager.getChainId();
   * console.log('Operating on chain:', chainId);
   * ```
   * 
   * @since 1.0.0
   */
  getChainId(): number {
    return this.config.chainId;
  }
  
  /**
   * Get the RPC URL for this wallet manager.
   * 
   * @returns The configured RPC URL for blockchain interactions
   * 
   * @example
   * ```typescript
   * const rpcUrl = manager.getRpcUrl();
   * console.log('Using RPC endpoint:', rpcUrl);
   * ```
   * 
   * @since 1.0.0
   */
  getRpcUrl(): string {
    return this.config.rpcUrl;
  }

  /**
   * Get existing wallet identity from local storage if it exists.
   * 
   * This method checks for a previously saved wallet identity file without
   * performing any blockchain operations. It's useful for quickly determining
   * if a wallet has been bootstrapped before.
   * 
   * @returns The wallet identity if found, null if not found or invalid
   * 
   * @example
   * ```typescript
   * const existingIdentity = await manager.getExistingIdentity();
   * if (existingIdentity) {
   *   console.log('Found existing Safe:', existingIdentity.safeAddress);
   * } else {
   *   console.log('No local identity found');
   * }
   * ```
   * 
   * @since 3.0.0
   */
  async getExistingIdentity(): Promise<WalletIdentity | null> {
    try {
      // Derive the owner address from the private key to check for existing identity
      const { account } = await setupClients(this.config);
      const ownerAddress = account.address as `0x${string}`;
      
      const loadResult = await loadWalletIdentity(
        this.config.chainId,
        ownerAddress,
        this.config.options?.storageBasePath
      );
      
      if (loadResult.success) {
        return loadResult.data;
      }
      
      return null;
    } catch (error: any) {
      // Log error but don't throw - this is a best-effort check
      console.warn('Failed to load existing identity:', error.message);
      return null;
    }
  }

  /**
   * Verify that an existing wallet identity is still valid on-chain.
   * 
   * This method checks if the Safe referenced in the identity still exists
   * on-chain with the expected configuration. It's more efficient than a full
   * bootstrap when you already have a local identity.
   * 
   * @param identity The wallet identity to verify
   * @returns Verification result indicating if the identity is still valid
   * 
   * @example
   * ```typescript
   * const identity = await manager.getExistingIdentity();
   * if (identity) {
   *   const verification = await manager.verifyExistingIdentity(identity);
   *   if (verification.isValid) {
   *     console.log('Identity is still valid');
   *   } else {
   *     console.log('Identity is invalid:', verification.reason);
   *   }
   * }
   * ```
   * 
   * @since 3.0.0
   */
  async verifyExistingIdentity(identity: WalletIdentity): Promise<{
    isValid: boolean;
    reason?: string;
  }> {
    try {
      const { publicClient } = await setupClients(this.config);
      
      // Check if the Safe still exists with correct configuration
      const code = await publicClient.getBytecode({ address: identity.safeAddress });
      if (!code || code === '0x') {
        return { isValid: false, reason: 'Safe no longer exists on-chain' };
      }
      
      // Verify Safe configuration
      const [owners, threshold] = await Promise.all([
        publicClient.readContract({
          address: identity.safeAddress,
          abi: SAFE_ABI,
          functionName: 'getOwners',
          args: []
        } as any),
        publicClient.readContract({
          address: identity.safeAddress,
          abi: SAFE_ABI,
          functionName: 'getThreshold',
          args: []
        } as any)
      ]);
      
      const actualOwners = owners as `0x${string}`[];
      const actualThreshold = Number(threshold);
      
      if (actualThreshold !== 1) {
        return { isValid: false, reason: `Safe threshold is ${actualThreshold}, expected 1` };
      }
      
      if (actualOwners.length !== 1 || actualOwners[0].toLowerCase() !== identity.ownerAddress.toLowerCase()) {
        return { isValid: false, reason: 'Safe owners do not match expected configuration' };
      }
      
      return { isValid: true };
      
    } catch (error: any) {
      return { isValid: false, reason: `Verification failed: ${error.message}` };
    }
  }
}

/**
 * Default export for convenience.
 * 
 * Allows importing WalletManager as the default export:
 * 
 * @example
 * ```typescript
 * import WalletManager from '@jinn/wallet-manager';
 * 
 * const manager = new WalletManager({ ... });
 * ```
 * 
 * @since 1.0.0
 */
export default WalletManager;