/**
 * Unified utility for reading OLAS Operate service profile configuration
 * 
 * This module provides a single source of truth for reading service configuration
 * from the .operate directory, including mech address, safe address, and private keys.
 * 
 * It's used across:
 * - Ponder configuration (for indexing the correct mech)
 * - Worker process (for claiming work)
 * - MCP tools (for dispatching jobs)
 * - Scripts (for various operations)
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname, parse, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { configLogger } from '../logging/index.js';

// Resolve repo root so this works from both src/ and dist/ builds
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Check if all critical service config env vars are set
 * When true, we don't need .operate directory and should suppress warnings
 */
function hasAllServiceEnvVars(): boolean {
  const mechAddr = process.env.JINN_SERVICE_MECH_ADDRESS;
  const safeAddr = process.env.JINN_SERVICE_SAFE_ADDRESS;
  const privateKey = process.env.JINN_SERVICE_PRIVATE_KEY;

  // All three must be valid for us to skip .operate
  return Boolean(
    mechAddr && /^0x[a-fA-F0-9]{40}$/i.test(mechAddr) &&
    safeAddr && /^0x[a-fA-F0-9]{40}$/i.test(safeAddr) &&
    privateKey && /^0x[a-fA-F0-9]{64}$/i.test(privateKey)
  );
}

function findRepoRoot(startDir: string): string | null {
  let current = startDir;
  const { root } = parse(current);

  while (true) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    if (current === root) {
      break;
    }
    current = dirname(current);
  }
  return null;
}

function resolveOperateHome(): string | null {
  const repoRoot = findRepoRoot(__dirname);
  const override =
    process.env.OPERATE_PROFILE_DIR ||
    process.env.OPERATE_DIR ||
    process.env.OPERATE_HOME;

  if (override) {
    const normalized = override.trim();
    const absolute = isAbsolute(normalized)
      ? normalized
      : resolve(repoRoot || process.cwd(), normalized);

    if (!existsSync(absolute)) {
      configLogger.warn({ operateDir: absolute }, 'Configured OPERATE_PROFILE_DIR not found');
      return null;
    }

    return absolute;
  }

  if (!repoRoot) {
    // Only warn if env vars don't provide the needed config
    if (!hasAllServiceEnvVars()) {
      configLogger.warn('Unable to locate repository root for operate profile discovery');
    }
    return null;
  }

  const candidate = join(repoRoot, 'olas-operate-middleware', '.operate');
  if (!existsSync(candidate)) {
    // Only warn if env vars don't provide the needed config
    if (!hasAllServiceEnvVars()) {
      configLogger.warn({ candidate }, 'Default .operate directory not found under olas-operate-middleware');
    }
    return null;
  }

  return candidate;
}

interface ServiceConfig {
  env_variables?: {
    MECH_TO_CONFIG?: {
      value: string;
    };
  };
  safe_address?: string;
  chain_configs?: {
    [chainName: string]: {
      chain_data?: {
        multisig?: string;
        instances?: string[];
      };
    };
  };
}

/**
 * Get the path to the .operate directory
 * Calls resolveOperateHome() lazily to respect runtime environment variable changes
 */
function getOperateDir(): string | null {
  const operateHome = resolveOperateHome();
  if (operateHome && existsSync(operateHome)) {
    return operateHome;
  }

  // Only warn if env vars don't provide the needed config
  if (!hasAllServiceEnvVars()) {
    configLogger.warn({ operateHome }, '.operate directory not found at expected location');
  }
  return null;
}

/**
 * Read service configuration from the first service found in .operate/services
 */
function readServiceConfig(): ServiceConfig | null {
  try {
    const operateDir = getOperateDir();
    if (!operateDir) {
      // Warning already handled in getOperateDir() if needed
      return null;
    }

    const servicesDir = join(operateDir, 'services');
    if (!existsSync(servicesDir)) {
      // Only warn if env vars don't provide the needed config
      if (!hasAllServiceEnvVars()) {
        configLogger.warn({ operateDir }, 'No services directory found');
      }
      return null;
    }

    // Find the first service directory that contains a config.json
    const serviceDirs = readdirSync(servicesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    let configPath: string | null = null;
    for (const serviceDir of serviceDirs) {
      const candidatePath = join(servicesDir, serviceDir, 'config.json');
      if (existsSync(candidatePath)) {
        configPath = candidatePath;
        break;
      }
    }

    if (!configPath) {
      // Only warn if env vars don't provide the needed config
      if (!hasAllServiceEnvVars()) {
        configLogger.warn({ servicesDir }, 'No service directories with config.json found');
      }
      return null;
    }

    const configData = readFileSync(configPath, 'utf-8');
    const config: ServiceConfig = JSON.parse(configData);

    return config;
  } catch (error) {
    configLogger.warn({ err: error }, 'Error reading service config');
    return null;
  }
}

/**
 * Get the service's target mech contract address
 *
 * Priority:
 * 1. JINN_SERVICE_MECH_ADDRESS environment variable (for Railway deployment)
 * 2. .operate service config MECH_TO_CONFIG
 *
 * @returns Mech contract address or null if not found
 */
export function getMechAddress(): string | null {
  // Check environment variable first (for Railway deployment)
  const envMech = process.env.JINN_SERVICE_MECH_ADDRESS;
  if (envMech && /^0x[a-fA-F0-9]{40}$/i.test(envMech)) {
    configLogger.info(` Using mech address from JINN_SERVICE_MECH_ADDRESS: ${envMech}`);
    return envMech;
  }

  // Fall back to service config
  const config = readServiceConfig();
  if (!config) {
    return null;
  }

  // Extract mech address from MECH_TO_CONFIG
  const mechToConfig = config.env_variables?.MECH_TO_CONFIG?.value;
  if (!mechToConfig) {
    configLogger.warn('MECH_TO_CONFIG not found in service config');
    return null;
  }

  try {
    // Parse MECH_TO_CONFIG JSON
    const mechConfig = JSON.parse(mechToConfig);
    const mechAddresses = Object.keys(mechConfig);

    if (mechAddresses.length === 0) {
      configLogger.warn('No mech addresses found in MECH_TO_CONFIG');
      return null;
    }

    const mechAddress = mechAddresses[0];
    configLogger.info(` Found service target mech: ${mechAddress}`);
    return mechAddress;
  } catch (error) {
    configLogger.warn({ err: error }, 'Error parsing MECH_TO_CONFIG');
    return null;
  }
}

/**
 * Get the Gnosis Safe multisig address for this service
 *
 * Priority:
 * 1. JINN_SERVICE_SAFE_ADDRESS environment variable (for Railway deployment)
 * 2. chain_configs.<chain>.chain_data.multisig (primary location)
 * 3. safe_address at root (backwards compatibility)
 *
 * @returns Safe address or null if not found
 */
export function getServiceSafeAddress(): string | null {
  // Check environment variable first (for Railway deployment)
  const envSafe = process.env.JINN_SERVICE_SAFE_ADDRESS;
  if (envSafe && /^0x[a-fA-F0-9]{40}$/i.test(envSafe)) {
    configLogger.info(` Using safe address from JINN_SERVICE_SAFE_ADDRESS: ${envSafe}`);
    return envSafe;
  }

  // Fall back to service config
  const config = readServiceConfig();
  if (!config) {
    return null;
  }

  // Try to find the Safe address from chain_configs (primary location)
  if (config.chain_configs) {
    // Look for the first chain config with a multisig address
    for (const [chainName, chainConfig] of Object.entries(config.chain_configs)) {
      const multisig = chainConfig.chain_data?.multisig;
      if (multisig) {
        configLogger.info(` Found safe address from chain_configs.${chainName}: ${multisig}`);
        return multisig.trim();
      }
    }
  }

  // Fall back to safe_address at root (backwards compatibility)
  const safeAddress = config.safe_address;
  if (safeAddress) {
    configLogger.info(` Found safe address: ${safeAddress}`);
    return safeAddress;
  }

  configLogger.warn('safe_address not found in service config');
  return null;
}

/**
 * Get the service's agent EOA private key
 *
 * Priority:
 * 1. JINN_SERVICE_PRIVATE_KEY environment variable (for Railway deployment)
 * 2. Read from .operate/keys/[agent_address] (JSON file with private_key field)
 *
 * @returns Private key or null if not found
 */
export function getServicePrivateKey(): string | null {
  // Check environment variable first (for Railway deployment)
  const envKey = process.env.JINN_SERVICE_PRIVATE_KEY;
  if (envKey && /^0x[a-fA-F0-9]{64}$/i.test(envKey)) {
    configLogger.info(' Using private key from JINN_SERVICE_PRIVATE_KEY');
    return envKey;
  }

  // Fall back to service config to get agent address
  const config = readServiceConfig();
  if (!config) {
    return null;
  }

  // Find the first agent instance address from chain_configs
  let agentAddress: string | null = null;
  if (config.chain_configs) {
    for (const chainConfig of Object.values(config.chain_configs)) {
      const instances = chainConfig.chain_data?.instances;
      if (instances && instances.length > 0) {
        agentAddress = instances[0];
        break;
      }
    }
  }

  if (!agentAddress) {
    configLogger.warn('No agent instance found in chain_configs');
    return null;
  }

  // Try to read from keys directory using agent address
  try {
    const operateDir = getOperateDir();
    if (!operateDir) {
      return null;
    }

    const keysPath = join(operateDir, 'keys', agentAddress);

    if (existsSync(keysPath)) {
      const keyData = readFileSync(keysPath, 'utf-8').trim();
      const keyJson = JSON.parse(keyData);
      const privateKey = keyJson.private_key;

      if (privateKey) {
        configLogger.info(` Found private key for agent ${agentAddress}`);
        return privateKey;
      }
    } else {
      configLogger.warn({ keysPath }, 'Key file not found');
    }
  } catch (error) {
    configLogger.warn({ err: error }, 'Error reading private key from .operate');
  }

  return null;
}

/**
 * Get the chain configuration name from service config
 * 
 * Reads from .operate service config chain_configs keys.
 * Defaults to 'base' if no chain configs found.
 * 
 * No environment variable fallbacks - this is service configuration.
 * 
 * @returns Chain config name (e.g., 'base', 'gnosis', 'ethereum')
 */
export function getMechChainConfig(): string {
  const config = readServiceConfig();
  if (!config || !config.chain_configs) {
    return 'base';
  }

  // Return the first chain config name found
  const chainNames = Object.keys(config.chain_configs);
  if (chainNames.length === 0) {
    return 'base';
  }

  return chainNames[0];
}

/**
 * Get all service configuration in one call
 * Useful when you need multiple pieces of information
 */
export function getServiceProfile() {
  return {
    mechAddress: getMechAddress(),
    safeAddress: getServiceSafeAddress(),
    privateKey: getServicePrivateKey(),
    chainConfig: getMechChainConfig(),
  };
}

/**
 * Get the master wallet configuration (EOA and Safe addresses)
 * 
 * Reads from .operate/wallets/ethereum.json
 * 
 * @returns Master wallet info or null if not found
 */
export function getMasterWallet(): { eoa: string; safes: Record<string, string> } | null {
  try {
    const operateDir = getOperateDir();
    if (!operateDir) {
      return null;
    }

    const walletPath = join(operateDir, 'wallets', 'ethereum.json');
    if (!existsSync(walletPath)) {
      configLogger.warn({ walletPath }, 'Master wallet config not found');
      return null;
    }

    const walletData = readFileSync(walletPath, 'utf-8');
    const wallet = JSON.parse(walletData);

    return {
      eoa: wallet.address,
      safes: wallet.safes || {},
    };
  } catch (error) {
    configLogger.warn({ err: error }, 'Error reading master wallet config');
    return null;
  }
}

/**
 * Get the master EOA address (Ethereum mainnet)
 */
export function getMasterEOA(): string | null {
  const wallet = getMasterWallet();
  return wallet?.eoa || null;
}

/**
 * Get the master Safe address for a specific chain
 * @param chain Chain name (default: 'base')
 */
export function getMasterSafe(chain: string = 'base'): string | null {
  const wallet = getMasterWallet();
  return wallet?.safes?.[chain] || null;
}

/**
 * Decrypt and return the master EOA private key.
 *
 * The master wallet keystore is at .operate/wallets/ethereum.txt (V3 JSON).
 * Requires OPERATE_PASSWORD env var for decryption.
 * Uses Python eth_account since the middleware is Python-based and
 * the JS web3-eth-accounts scrypt implementation has compatibility issues.
 *
 * @returns Private key hex string (0x-prefixed) or null
 */
export function getMasterPrivateKey(): string | null {
  const operateDir = getOperateDir();
  if (operateDir === null) {
    return null;
  }

  const keystorePath = join(operateDir, 'wallets', 'ethereum.txt');
  if (!existsSync(keystorePath)) {
    configLogger.warn({ keystorePath }, 'Master wallet keystore not found');
    return null;
  }

  const password = process.env.OPERATE_PASSWORD;
  if (password === undefined || password === '') {
    configLogger.warn('OPERATE_PASSWORD env var required to decrypt master wallet');
    return null;
  }

  try {
    const result = execSync(
      `python3 -c "
import json
from eth_account import Account
ks = json.loads(open('${keystorePath}').read())
print('0x' + Account.decrypt(ks, '${password.replace(/'/g, "\\'")}').hex())
"`,
      { encoding: 'utf-8', timeout: 30000 },
    ).trim();

    if (/^0x[a-fA-F0-9]{64}$/.test(result)) {
      configLogger.info(' Decrypted master EOA private key');
      return result;
    }

    configLogger.warn('Unexpected output from keystore decryption');
    return null;
  } catch (error) {
    configLogger.warn({ err: error }, 'Failed to decrypt master wallet keystore');
    return null;
  }
}
