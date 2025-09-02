/**
 * Safe contract address resolution for deterministic deployments.
 * 
 * This module provides explicit Safe contract address resolution using
 * @safe-global/safe-deployments to ensure deterministic behavior across
 * all supported chains. This prevents Protocol Kit deployment resolution
 * failures that can occur with version/chain combinations.
 */

import {
  getSafeSingletonDeployment,
  getProxyFactoryDeployment,
  getMultiSendDeployment,
  getMultiSendCallOnlyDeployment,
  getFallbackHandlerDeployment,
  type DeploymentFilter
} from '@safe-global/safe-deployments';

/**
 * Safe contract addresses for a specific chain and version.
 * These addresses are used to configure Protocol Kit with explicit
 * contract networks to prevent deployment resolution failures.
 */
export interface SafeContracts {
  /** Safe singleton (master copy) contract address */
  safeMasterCopyAddress: `0x${string}`;
  /** Safe proxy factory contract address */
  safeProxyFactoryAddress: `0x${string}`;
  /** MultiSend contract address for batch transactions */
  multiSendAddress: `0x${string}`;
  /** MultiSendCallOnly contract address for read-only batch transactions */
  multiSendCallOnlyAddress: `0x${string}`;
  /** Fallback handler contract address */
  fallbackHandlerAddress: `0x${string}`;
}

/**
 * Resolves Safe contract addresses for a given chain ID and version.
 * 
 * Uses @safe-global/safe-deployments to look up canonical contract addresses
 * for the specified chain and Safe version. This ensures deterministic
 * behavior and prevents Protocol Kit deployment resolution failures.
 * 
 * @param chainId - The chain ID to resolve contracts for
 * @param version - The Safe version to use (pinned to '1.4.1')
 * @returns Resolved contract addresses for the chain and version
 * @throws Error with specific cause if any required contract cannot be resolved
 * 
 * @example
 * ```typescript
 * // Resolve contracts for Base mainnet
 * const contracts = resolveSafeContracts(8453, '1.4.1');
 * console.log('Safe singleton:', contracts.safeMasterCopyAddress);
 * console.log('Proxy factory:', contracts.safeProxyFactoryAddress);
 * ```
 */
export function resolveSafeContracts(chainId: number, version: '1.4.1'): SafeContracts {
  const filter: DeploymentFilter = {
    version,
    network: chainId.toString()
  };

  // Resolve Safe singleton (master copy)
  const singletonDeployment = getSafeSingletonDeployment(filter);
  if (!singletonDeployment?.networkAddresses[chainId.toString()]) {
    throw new Error(
      `Safe singleton version ${version} not deployed on chain ${chainId}. ` +
      `This chain may not be supported by Safe version ${version}.`
    );
  }

  // Resolve proxy factory
  const proxyFactoryDeployment = getProxyFactoryDeployment(filter);
  if (!proxyFactoryDeployment?.networkAddresses[chainId.toString()]) {
    throw new Error(
      `Safe proxy factory version ${version} not deployed on chain ${chainId}. ` +
      `This chain may not be supported by Safe version ${version}.`
    );
  }

  // Resolve MultiSend
  const multiSendDeployment = getMultiSendDeployment(filter);
  if (!multiSendDeployment?.networkAddresses[chainId.toString()]) {
    throw new Error(
      `MultiSend version ${version} not deployed on chain ${chainId}. ` +
      `This chain may not be supported by Safe version ${version}.`
    );
  }

  // Resolve MultiSendCallOnly
  const multiSendCallOnlyDeployment = getMultiSendCallOnlyDeployment(filter);
  if (!multiSendCallOnlyDeployment?.networkAddresses[chainId.toString()]) {
    throw new Error(
      `MultiSendCallOnly version ${version} not deployed on chain ${chainId}. ` +
      `This chain may not be supported by Safe version ${version}.`
    );
  }

  // Resolve fallback handler
  const fallbackHandlerDeployment = getFallbackHandlerDeployment(filter);
  if (!fallbackHandlerDeployment?.networkAddresses[chainId.toString()]) {
    throw new Error(
      `Fallback handler version ${version} not deployed on chain ${chainId}. ` +
      `This chain may not be supported by Safe version ${version}.`
    );
  }

  // Extract addresses and validate format
  const safeMasterCopyAddress = singletonDeployment.networkAddresses[chainId.toString()];
  const safeProxyFactoryAddress = proxyFactoryDeployment.networkAddresses[chainId.toString()];
  const multiSendAddress = multiSendDeployment.networkAddresses[chainId.toString()];
  const multiSendCallOnlyAddress = multiSendCallOnlyDeployment.networkAddresses[chainId.toString()];
  const fallbackHandlerAddress = fallbackHandlerDeployment.networkAddresses[chainId.toString()];

  // Validate all addresses are present and properly formatted
  const addresses = {
    safeMasterCopyAddress,
    safeProxyFactoryAddress,
    multiSendAddress,
    multiSendCallOnlyAddress,
    fallbackHandlerAddress
  };

  for (const [name, address] of Object.entries(addresses)) {
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      throw new Error(
        `Invalid ${name} address '${address}' for chain ${chainId} version ${version}. ` +
        `Expected 42-character hex string with 0x prefix.`
      );
    }
  }

  return {
    safeMasterCopyAddress: safeMasterCopyAddress as `0x${string}`,
    safeProxyFactoryAddress: safeProxyFactoryAddress as `0x${string}`,
    multiSendAddress: multiSendAddress as `0x${string}`,
    multiSendCallOnlyAddress: multiSendCallOnlyAddress as `0x${string}`,
    fallbackHandlerAddress: fallbackHandlerAddress as `0x${string}`
  };
}

/**
 * Create a contract networks configuration object for Protocol Kit.
 * 
 * This helper creates the contractNetworks configuration object expected
 * by Safe Protocol Kit to override its internal deployment resolution.
 * 
 * @param chainId - The chain ID to create configuration for
 * @param contracts - The resolved contract addresses
 * @returns Contract networks configuration for Protocol Kit
 * 
 * @example
 * ```typescript
 * const contracts = resolveSafeContracts(8453, '1.4.1');
 * const contractNetworks = createContractNetworks(8453, contracts);
 * 
 * const protocolKit = await Safe.init({
 *   provider: rpcUrl,
 *   signer: privateKey,
 *   predictedSafe,
 *   contractNetworks
 * });
 * ```
 */
export function createContractNetworks(
  chainId: number, 
  contracts: SafeContracts
): { [chainId: number]: SafeContracts } {
  return {
    [chainId]: contracts
  };
}
