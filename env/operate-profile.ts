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
import { join, dirname, parse, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { configLogger } from '../logging/index.js';

// Resolve repo root so this works from both src/ and dist/ builds
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    configLogger.warn('Unable to locate repository root for operate profile discovery');
    return null;
  }

  const candidate = join(repoRoot, 'olas-operate-middleware', '.operate');
  if (!existsSync(candidate)) {
    configLogger.warn({ candidate }, 'Default .operate directory not found under olas-operate-middleware');
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
  
  configLogger.warn({ operateHome }, '.operate directory not found at expected location');
  return null;
}

/**
 * Read service configuration from the first service found in .operate/services
 */
function readServiceConfig(): ServiceConfig | null {
  try {
    const operateDir = getOperateDir();
    if (!operateDir) {
      configLogger.warn('No .operate directory found');
      return null;
    }
    
    const servicesDir = join(operateDir, 'services');
    if (!existsSync(servicesDir)) {
      configLogger.warn({ operateDir }, 'No services directory found');
      return null;
    }
    
    // Find the first service directory
    const serviceDirs = readdirSync(servicesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    if (serviceDirs.length === 0) {
      configLogger.warn({ servicesDir }, 'No service directories found');
      return null;
    }
    
    // Read config.json from the first service
    const serviceDir = serviceDirs[0];
    const configPath = join(servicesDir, serviceDir, 'config.json');
    
    if (!existsSync(configPath)) {
      configLogger.warn({ configPath }, 'No config.json found');
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
 * Reads from .operate service config MECH_TO_CONFIG only.
 * No environment variable fallbacks - this is service configuration.
 * 
 * @returns Mech contract address or null if not found
 */
export function getMechAddress(): string | null {
  // Read from service config only
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
 * Reads from .operate service config only:
 * 1. chain_configs.<chain>.chain_data.multisig (primary location)
 * 2. safe_address at root (backwards compatibility)
 * 
 * No environment variable fallbacks - this is service configuration.
 * 
 * @returns Safe address or null if not found
 */
export function getServiceSafeAddress(): string | null {
  // Read from service config
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
 * 1. Read from .operate/keys/[agent_address] (JSON file with private_key field)
 * 
 * Note: Ignores environment variables - must come from .operate
 * 
 * @returns Private key or null if not found
 */
export function getServicePrivateKey(): string | null {
  // Read from service config to get agent address
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
