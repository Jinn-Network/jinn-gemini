/**
 * Chain configurations and Safe Transaction Service URLs.
 * 
 * This module provides Viem chain objects and associated service URLs
 * for supported networks in the Olas ecosystem.
 */

import { base, baseSepolia } from 'viem/chains';
import type { ChainConfig } from './types.js';

/**
 * Mapping of chain IDs to their configuration including Viem chain objects
 * and Safe Transaction Service URLs. This ensures consistent chain handling
 * across the wallet manager.
 */
const chainConfigMap: Record<number, ChainConfig> = {
  [base.id]: {
    chain: base,
    txServiceUrl: 'https://safe-transaction-base.safe.global/',
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    txServiceUrl: 'https://safe-transaction-base-sepolia.safe.global/',
  },
};

/**
 * Retrieves the chain configuration for a given chain ID.
 * 
 * @param chainId - The chain ID to get configuration for
 * @returns The chain configuration including Viem chain object and service URLs
 * @throws Error if the chain ID is not supported
 * 
 * @example
 * ```typescript
 * const config = getChainConfig(8453); // Base mainnet
 * console.log(config.chain.name); // "Base"
 * console.log(config.txServiceUrl); // "https://safe-transaction-base.safe.global/"
 * ```
 */
export function getChainConfig(chainId: number): ChainConfig {
  const config = chainConfigMap[chainId];
  if (!config) {
    throw new Error(
      `Unsupported CHAIN_ID: ${chainId}. Supported chains: ${Object.keys(chainConfigMap).join(', ')}`
    );
  }
  return config;
}

/**
 * Returns an array of all supported chain IDs.
 * 
 * @returns Array of supported chain IDs
 * 
 * @example
 * ```typescript
 * const supportedChains = getSupportedChainIds();
 * console.log(supportedChains); // [8453, 84532]
 * ```
 */
export function getSupportedChainIds(): number[] {
  return Object.keys(chainConfigMap).map(Number);
}

/**
 * Checks if a given chain ID is supported by the wallet manager.
 * 
 * @param chainId - The chain ID to check
 * @returns True if the chain is supported, false otherwise
 * 
 * @example
 * ```typescript
 * const isSupported = isChainSupported(8453);
 * console.log(isSupported); // true
 * 
 * const isNotSupported = isChainSupported(1);
 * console.log(isNotSupported); // false
 * ```
 */
export function isChainSupported(chainId: number): boolean {
  return chainId in chainConfigMap;
}

/**
 * Gets the Safe Transaction Service URL for a given chain ID.
 * 
 * @param chainId - The chain ID to get the service URL for
 * @returns The Safe Transaction Service URL
 * @throws Error if the chain ID is not supported
 * 
 * @example
 * ```typescript
 * const serviceUrl = getTxServiceUrl(8453);
 * console.log(serviceUrl); // "https://safe-transaction-base.safe.global/"
 * ```
 */
export function getTxServiceUrl(chainId: number): string {
  const config = getChainConfig(chainId);
  return config.txServiceUrl;
}

/**
 * Default chain configurations used throughout the system.
 * These are the primary networks targeted for Olas service deployment.
 */
export const DEFAULT_CHAINS = {
  /** Base mainnet - primary production network */
  BASE_MAINNET: base.id,
  
  /** Base Sepolia - primary testnet */
  BASE_SEPOLIA: baseSepolia.id,
} as const;

/**
 * Safe contract version pinned for deterministic deployments.
 * This ensures consistent behavior across different environments.
 */
export const SAFE_VERSION = '1.4.1' as const;
