/**
 * Core types and interfaces for the Jinn Wallet Manager library.
 * 
 * This module defines all the data contracts used for Gnosis Safe wallet
 * bootstrapping and identity management in the Olas ecosystem. These types
 * provide comprehensive type safety and clear contracts for all library
 * operations.
 * 
 * ## Type Safety
 * 
 * All types use strict TypeScript patterns including:
 * - Branded types for addresses (`0x${string}`)
 * - Discriminated unions for result types
 * - BigInt for precise financial calculations
 * - Optional properties with clear semantics
 * 
 * ## Data Flow
 * 
 * The types follow this general flow:
 * 1. `WalletManagerConfig` - Input configuration from consumer
 * 2. `WalletIdentity` - Persistent wallet data structure
 * 3. `BootstrapResult` - Operation outcome with detailed information
 * 4. Supporting types for metrics, requirements, and errors
 * 
 * @version 2.0.0
 * @since 1.0.0
 */

import type { Chain } from 'viem';

/**
 * Configuration object provided by the consumer application to initialize
 * the WalletManager. The consumer is responsible for sourcing these values
 * (e.g., from environment variables) and ensuring the private key is
 * handled securely.
 * 
 * ## Security Considerations
 * 
 * - The `workerPrivateKey` must be handled with extreme care
 * - Keys should be sourced from secure environment variables
 * - The library never persists the private key to disk
 * - Consider using hardware security modules for production deployments
 * 
 * ## Validation
 * 
 * All configuration parameters are validated at WalletManager construction:
 * - Private key format (64-character hex with 0x prefix)
 * - Chain ID must be supported (see `getSupportedChainIds()`)
 * - RPC URL must be a valid HTTP/HTTPS endpoint
 * 
 * @example Basic Configuration
 * ```typescript
 * const config: WalletManagerConfig = {
 *   workerPrivateKey: process.env.WORKER_PRIVATE_KEY as `0x${string}`,
 *   chainId: 8453, // Base mainnet
 *   rpcUrl: 'https://mainnet.base.org'
 * };
 * ```
 * 
 * @example With Custom Options
 * ```typescript
 * const config: WalletManagerConfig = {
 *   workerPrivateKey: '0x1234...', // 64-character hex
 *   chainId: 84532, // Base Sepolia
 *   rpcUrl: 'https://sepolia.base.org',
 *   options: {
 *     storageBasePath: '/custom/path/wallets',
 *     txServiceUrl: 'https://safe-transaction-base-sepolia.safe.global/'
 *   }
 * };
 * ```
 * 
 * @since 1.0.0
 */
export interface WalletManagerConfig {
  /** 
   * The private key of the EOA that will own the Gnosis Safe.
   * Must be a 64-character hexadecimal string with '0x' prefix.
   * 
   * @example '0x1234567890123456789012345678901234567890123456789012345678901234'
   */
  workerPrivateKey: `0x${string}`;
  
  /** 
   * The chain ID where the Safe should be deployed.
   * Must be a supported chain (see getSupportedChainIds()).
   * 
   * @example 8453 // Base mainnet
   * @example 84532 // Base Sepolia
   */
  chainId: number;
  
  /** 
   * The RPC URL for interacting with the blockchain.
   * Must be a valid HTTP or HTTPS endpoint.
   * 
   * @example 'https://mainnet.base.org'
   * @example 'https://sepolia.base.org'
   */
  rpcUrl: string;
  
  /** Optional configuration overrides for advanced use cases */
  options?: {
    /** 
     * Override for the default storage path (~/.jinn/wallets).
     * The path can be absolute or use tilde (~) for home directory.
     * Directory will be created with 0700 permissions if it doesn't exist.
     * 
     * @example '/custom/path/wallets'
     * @example '~/.myapp/wallets'
     */
    storageBasePath?: string;
    
    /** 
     * Override for the Safe Transaction Service URL.
     * Used for checking pre-existing Safe deployments.
     * 
     * @example 'https://safe-transaction-base.safe.global/'
     * @example 'https://safe-transaction-base-sepolia.safe.global/'
     */
    txServiceUrl?: string;
  };
}

/**
 * The wallet identity data structure that is persisted to disk.
 * Contains only public information - no private keys are ever stored.
 * 
 * This structure represents the complete identity of a deployed Gnosis Safe
 * and is stored locally in JSON format with restrictive file permissions.
 * The identity is deterministic - the same EOA and chain ID will always
 * generate the same Safe address.
 * 
 * ## Storage Security
 * 
 * - Stored as JSON with 0600 file permissions (owner read/write only)
 * - Parent directory has 0700 permissions (owner access only)
 * - Written atomically to prevent corruption during concurrent access
 * - No sensitive information (private keys) is ever included
 * 
 * ## File Location
 * 
 * Default path: `~/.jinn/wallets/<chainId>/<ownerAddress>.json`
 * Custom path: `<storageBasePath>/<chainId>/<ownerAddress>.json`
 * 
 * @example JSON Structure
 * ```json
 * {
 *   "ownerAddress": "0x742C65e68d8d2700ba29399dC13968F7bE4EeB6B",
 *   "safeAddress": "0x1234567890123456789012345678901234567890",
 *   "chainId": 8453,
 *   "createdAt": "2025-08-25T12:34:56.789Z",
 *   "saltNonce": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
 * }
 * ```
 * 
 * @since 1.0.0
 */
export interface WalletIdentity {
  /** 
   * The EOA address that owns the Gnosis Safe.
   * This is derived from the workerPrivateKey provided in the configuration.
   * 
   * @example '0x742C65e68d8d2700ba29399dC13968F7bE4EeB6B'
   */
  ownerAddress: `0x${string}`;
  
  /** 
   * The deployed Gnosis Safe contract address.
   * This address is deterministically generated from the owner address,
   * chain ID, and Safe deployment parameters.
   * 
   * @example '0x1234567890123456789012345678901234567890'
   */
  safeAddress: `0x${string}`;
  
  /** 
   * The chain ID where the Safe is deployed.
   * Must match the chainId from the original configuration.
   * 
   * @example 8453
   */
  chainId: number;
  
  /** 
   * ISO 8601 timestamp when the identity was created.
   * Represents when the Safe was first deployed or adopted.
   * 
   * @example '2025-08-25T12:34:56.789Z'
   */
  createdAt: string;
  
  /** 
   * The deterministic salt nonce used for Safe deployment.
   * Generated from keccak256(ownerAddress + chainId) to ensure
   * deterministic Safe addresses across deployments.
   * 
   * @example '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
   */
  saltNonce: `0x${string}`;
}

/**
 * Optional telemetry and performance metrics collected during
 * wallet operations. Useful for monitoring and optimization.
 * 
 * These metrics provide insights into the performance characteristics
 * of wallet operations, particularly Safe deployment transactions.
 * All metrics use precise types (BigInt for gas, number for time)
 * to ensure accurate reporting.
 * 
 * ## Usage
 * 
 * Metrics are included in successful bootstrap operations and can be
 * used for:
 * - Performance monitoring and optimization
 * - Cost analysis and budgeting
 * - Transaction verification and auditing
 * - System health monitoring
 * 
 * @example Accessing Metrics
 * ```typescript
 * const result = await walletManager.bootstrap();
 * if (result.status === 'created' && result.metrics) {
 *   console.log('Gas used:', result.metrics.gasUsed?.toString());
 *   console.log('Duration:', result.metrics.durationMs + 'ms');
 *   console.log('Tx hash:', result.metrics.txHash);
 * }
 * ```
 * 
 * @since 1.0.0
 */
export interface BootstrapMetrics {
  /** 
   * Amount of gas consumed during Safe deployment transaction.
   * Only available for 'created' status results.
   * Uses BigInt for precise gas accounting.
   * 
   * @example 234567n
   */
  gasUsed?: bigint;
  
  /** 
   * Total time taken for the bootstrap operation in milliseconds.
   * Includes all steps from validation through deployment and verification.
   * 
   * @example 2500 // 2.5 seconds
   */
  durationMs?: number;
  
  /** 
   * Transaction hash of the Safe deployment transaction.
   * Can be used to verify the deployment on a block explorer.
   * Only available for actual deployments (not pre-existing Safes).
   * 
   * @example '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
   */
  txHash?: `0x${string}`;
}

/**
 * Funding requirements returned when the EOA needs to be funded
 * before Safe deployment can proceed.
 * 
 * This interface provides detailed information about the exact funding
 * requirements for Safe deployment, including gas estimates and fee
 * calculations based on current network conditions.
 * 
 * ## Safety Margins
 * 
 * - Gas estimates include a 20% safety margin
 * - Recommended funding includes a 50% safety margin
 * - Fee calculations use EIP-1559 (maxFeePerGas/maxPriorityFeePerGas)
 * 
 * ## Precision
 * 
 * All values use BigInt to prevent JavaScript Number precision issues
 * when dealing with wei amounts and gas calculations.
 * 
 * @example Handling Funding Requirements
 * ```typescript
 * if (result.status === 'needs_funding') {
 *   const required = result.required;
 *   console.log('Fund address:', result.address);
 *   console.log('Minimum wei needed:', required.minRecommendedWei.toString());
 *   console.log('Gas limit:', required.gasLimit.toString());
 *   console.log('Max fee per gas:', required.maxFeePerGas.toString());
 * }
 * ```
 * 
 * @since 1.0.0
 */
export interface FundingRequirements {
  /** 
   * Estimated gas limit for Safe deployment transaction.
   * Includes a 20% safety margin above the base estimate.
   * 
   * @example 234567n // Gas units needed
   */
  gasLimit: bigint;
  
  /** 
   * Maximum fee per gas unit (EIP-1559) in wei.
   * Represents the total fee willing to pay per gas unit,
   * including both base fee and priority fee.
   * 
   * @example 15000000000n // 15 gwei
   */
  maxFeePerGas: bigint;
  
  /** 
   * Maximum priority fee per gas unit (EIP-1559) in wei.
   * The tip paid to miners/validators for transaction inclusion.
   * 
   * @example 2000000000n // 2 gwei
   */
  maxPriorityFeePerGas: bigint;
  
  /** 
   * Minimum recommended balance including safety margin in wei.
   * Calculated as: gasLimit * maxFeePerGas * 1.5 (50% safety margin)
   * 
   * @example 5268757500000000000n // ~5.27 ETH equivalent in wei
   */
  minRecommendedWei: bigint;
}

/**
 * Standardized error codes for common bootstrap failure scenarios.
 * These provide programmatic error handling capabilities for consumers.
 * 
 * Each error code represents a specific category of failure that can
 * occur during the wallet bootstrap process. Applications can use these
 * codes to implement appropriate error handling and user feedback.
 * 
 * ## Error Categories
 * 
 * - **Funding Issues**: `unfunded` - EOA needs more funds
 * - **Configuration Issues**: `unsupported_chain` - Chain not supported
 * - **Blockchain Issues**: `rpc_error` - Network connectivity problems
 * - **Deployment Issues**: `deployment_failed` - Transaction failed
 * - **Validation Issues**: `safe_config_mismatch` - Existing Safe incompatible
 * - **Service Issues**: `tx_service_unavailable` - API temporarily down
 * 
 * @example Error Handling
 * ```typescript
 * if (result.status === 'failed') {
 *   switch (result.code) {
 *     case 'unfunded':
 *       // Guide user to fund their address
 *       break;
 *     case 'unsupported_chain':
 *       // Suggest supported chains
 *       break;
 *     case 'rpc_error':
 *       // Check network connectivity
 *       break;
 *     case 'deployment_failed':
 *       // Check transaction details, retry
 *       break;
 *     case 'safe_config_mismatch':
 *       // Existing Safe has wrong configuration
 *       break;
 *     case 'tx_service_unavailable':
 *       // Service temporarily down, retry later
 *       break;
 *   }
 * }
 * ```
 * 
 * @since 1.0.0
 */
export type BootstrapError =
  | 'unfunded'                    /** EOA has insufficient funds for deployment */
  | 'unsupported_chain'          /** Chain ID is not supported by the library */
  | 'safe_config_mismatch'       /** Existing Safe has different owners/threshold than expected */
  | 'tx_service_unavailable'     /** Safe Transaction Service API is temporarily unavailable */
  | 'rpc_error'                  /** RPC endpoint returned an error or is unreachable */
  | 'deployment_failed';         /** Safe deployment transaction failed on-chain */

/**
 * The result of a wallet bootstrap operation. Uses discriminated unions
 * to ensure type safety when handling different outcomes.
 * 
 * This type represents all possible outcomes of a wallet bootstrap operation.
 * The discriminated union pattern ensures type safety - TypeScript can
 * determine which fields are available based on the `status` field.
 * 
 * ## Result Types
 * 
 * - **`exists`**: Safe already exists and is properly configured
 * - **`created`**: New Safe was successfully deployed
 * - **`needs_funding`**: EOA requires funding before deployment can proceed
 * - **`failed`**: Operation failed with detailed error information
 * 
 * ## Type Safety
 * 
 * The discriminated union ensures that:
 * - `identity` is only available for successful operations
 * - `metrics` is required for 'created', optional for 'exists'
 * - `required` funding info is only available for 'needs_funding'
 * - `error` and `code` are only available for 'failed'
 * 
 * @example Type-Safe Result Handling
 * ```typescript
 * const result = await walletManager.bootstrap();
 * 
 * // TypeScript knows the available fields based on status
 * if (result.status === 'exists') {
 *   // result.identity is guaranteed to exist
 *   console.log(result.identity.safeAddress);
 *   // result.metrics might exist
 *   console.log(result.metrics?.durationMs);
 * }
 * 
 * if (result.status === 'created') {
 *   // result.identity and result.metrics are guaranteed to exist
 *   console.log(result.identity.safeAddress);
 *   console.log(result.metrics.gasUsed);
 * }
 * 
 * if (result.status === 'needs_funding') {
 *   // result.address and result.required are guaranteed to exist
 *   console.log(result.address);
 *   console.log(result.required.minRecommendedWei);
 * }
 * 
 * if (result.status === 'failed') {
 *   // result.error is guaranteed, result.code might exist
 *   console.log(result.error);
 *   if (result.code) {
 *     console.log('Error code:', result.code);
 *   }
 * }
 * ```
 * 
 * @since 1.0.0
 */
export type BootstrapResult =
  | {
      /** 
       * Safe already exists and is properly configured.
       * The existing Safe was found and verified to have the correct
       * owner and threshold configuration.
       */
      status: 'exists';
      /** The wallet identity with Safe address and metadata */
      identity: WalletIdentity;
      /** Optional metrics if the verification took measurable time */
      metrics?: BootstrapMetrics;
    }
  | {
      /** 
       * New Safe was successfully created and deployed.
       * A new Safe was deployed on-chain and verified.
       */
      status: 'created';
      /** The wallet identity with Safe address and metadata */
      identity: WalletIdentity;
      /** Deployment metrics including gas usage and transaction hash */
      metrics: BootstrapMetrics;
    }
  | {
      /** 
       * EOA needs funding before deployment can proceed.
       * The owner address needs to be funded with the specified amount
       * before Safe deployment can be attempted.
       */
      status: 'needs_funding';
      /** The EOA address that needs to be funded */
      address: `0x${string}`;
      /** Detailed funding requirements with safety margins */
      required: FundingRequirements;
    }
  | {
      /** 
       * Bootstrap operation failed with an error.
       * Contains detailed error information for debugging and user feedback.
       */
      status: 'failed';
      /** Human-readable error message describing what went wrong */
      error: string;
      /** Optional standardized error code for programmatic handling */
      code?: BootstrapError;
    };

/**
 * Internal storage operations interface. This abstraction allows for
 * different storage backends in the future while maintaining the same API.
 * 
 * This interface defines the contract for wallet identity storage operations.
 * The current implementation uses file-based storage, but this abstraction
 * allows for future implementations using databases, cloud storage, or
 * other persistence mechanisms.
 * 
 * ## Implementation Requirements
 * 
 * - All operations must be atomic to prevent corruption
 * - Concurrent access must be handled safely via locking
 * - Only public data should be stored (no private keys)
 * - File permissions must be restrictive (0600 for files, 0700 for directories)
 * 
 * ## Thread Safety
 * 
 * Implementations must provide thread safety through exclusive locking.
 * The `acquireLock`/`releaseLock` methods provide this guarantee.
 * 
 * @internal This interface is for internal use and may change between versions
 * @since 1.0.0
 */
export interface StorageProvider {
  /** 
   * Load wallet identity from persistent storage.
   * Returns null if no identity exists for the given chain and owner.
   * 
   * @param chainId - The blockchain chain ID
   * @param ownerAddress - The EOA address that owns the Safe
   * @returns Promise resolving to identity or null if not found
   */
  loadWalletIdentity(chainId: number, ownerAddress: `0x${string}`): Promise<WalletIdentity | null>;
  
  /** 
   * Save wallet identity to persistent storage with atomic write.
   * Creates directories and files with appropriate permissions.
   * 
   * @param identity - The wallet identity to persist
   * @throws Error if unable to write or set permissions
   */
  saveWalletIdentity(identity: WalletIdentity): Promise<void>;
  
  /** 
   * Acquire an exclusive lock to prevent concurrent operations.
   * Must be paired with releaseLock() in a finally block.
   * 
   * @param chainId - The blockchain chain ID
   * @param ownerAddress - The EOA address that owns the Safe
   * @throws Error if unable to acquire lock within timeout
   */
  acquireLock(chainId: number, ownerAddress: `0x${string}`): Promise<void>;
  
  /** 
   * Release the exclusive lock.
   * Must be called in a finally block to ensure cleanup.
   * 
   * @param chainId - The blockchain chain ID
   * @param ownerAddress - The EOA address that owns the Safe
   */
  releaseLock(chainId: number, ownerAddress: `0x${string}`): Promise<void>;
}

/**
 * Configuration for a specific blockchain, including chain metadata
 * and associated service URLs.
 * 
 * This interface encapsulates all the chain-specific configuration
 * needed for wallet operations on a particular blockchain network.
 * 
 * ## Usage
 * 
 * Chain configurations are predefined for supported networks and can
 * be retrieved using `getChainConfig(chainId)`. Each configuration
 * includes the Viem chain object and associated service URLs.
 * 
 * @example Getting Chain Configuration
 * ```typescript
 * import { getChainConfig } from '@jinn/wallet-manager';
 * 
 * const config = getChainConfig(8453); // Base mainnet
 * console.log('Chain name:', config.chain.name);
 * console.log('Transaction service:', config.txServiceUrl);
 * ```
 * 
 * @since 1.0.0
 */
export interface ChainConfig {
  /** 
   * Viem chain object with network metadata.
   * Contains chain ID, name, RPC URLs, block explorers, and other metadata.
   * 
   * @see https://viem.sh/docs/chains/introduction
   */
  chain: Chain;
  
  /** 
   * Safe Transaction Service API URL for this chain.
   * Used for querying existing Safe deployments and transaction history.
   * 
   * @example 'https://safe-transaction-base.safe.global/'
   */
  txServiceUrl: string;
}


