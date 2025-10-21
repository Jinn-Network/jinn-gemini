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
import { join } from 'path';
import { configLogger } from '../logging/index.js';

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
 * Priority: OPERATE_HOME env var > olas-operate-middleware/.operate > project root/.operate
 */
function getOperateDir(): string | null {
  if (process.env.OPERATE_HOME) {
    return process.env.OPERATE_HOME;
  }
  
  // Try current directory/.operate
  const cwdPath = join(process.cwd(), '.operate');
  if (existsSync(cwdPath)) {
    return cwdPath;
  }
  
  // Try parent directory/.operate (for when running from subdirectories like ponder/)
  const parentPath = join(process.cwd(), '..', '.operate');
  if (existsSync(parentPath)) {
    return parentPath;
  }
  
  // Try olas-operate-middleware/.operate (common in development)
  const middlewarePath = join(process.cwd(), 'olas-operate-middleware', '.operate');
  if (existsSync(middlewarePath)) {
    return middlewarePath;
  }
  
  // Try parent/olas-operate-middleware/.operate
  const parentMiddlewarePath = join(process.cwd(), '..', 'olas-operate-middleware', '.operate');
  if (existsSync(parentMiddlewarePath)) {
    return parentMiddlewarePath;
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
      configLogger.warn(' No .operate directory found');
      return null;
    }
    
    const servicesDir = join(operateDir, 'services');
    if (!existsSync(servicesDir)) {
      configLogger.warn(' No services directory found in', operateDir);
      return null;
    }
    
    // Find the first service directory
    const serviceDirs = readdirSync(servicesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    if (serviceDirs.length === 0) {
      configLogger.warn(' No service directories found in', servicesDir);
      return null;
    }
    
    // Read config.json from the first service
    const serviceDir = serviceDirs[0];
    const configPath = join(servicesDir, serviceDir, 'config.json');
    
    if (!existsSync(configPath)) {
      configLogger.warn(' No config.json found at', configPath);
      return null;
    }
    
    const configData = readFileSync(configPath, 'utf-8');
    const config: ServiceConfig = JSON.parse(configData);
    
    return config;
  } catch (error) {
    configLogger.warn(' Error reading service config:', error);
    return null;
  }
}

/**
 * Get the mech address for this service
 * 
 * Priority:
 * 1. MECH_ADDRESS environment variable
 * 2. MECH_WORKER_ADDRESS environment variable (legacy)
 * 3. Read from .operate service config MECH_TO_CONFIG
 * 
 * @returns Mech address or null if not found
 */
export function getMechAddress(): string | null {
  // Check environment variables first
  const envMechAddress = process.env.MECH_ADDRESS || process.env.MECH_WORKER_ADDRESS;
  if (envMechAddress) {
    return envMechAddress.trim();
  }
  
  // Read from service config
  const config = readServiceConfig();
  if (!config) {
    return null;
  }
  
  // Extract mech address from MECH_TO_CONFIG
  const mechToConfig = config.env_variables?.MECH_TO_CONFIG?.value;
  if (!mechToConfig) {
    configLogger.warn(' MECH_TO_CONFIG not found in service config');
    return null;
  }
  
  try {
    // Parse MECH_TO_CONFIG JSON
    const mechConfig = JSON.parse(mechToConfig);
    const mechAddresses = Object.keys(mechConfig);
    
    if (mechAddresses.length === 0) {
      configLogger.warn(' No mech addresses found in MECH_TO_CONFIG');
      return null;
    }
    
    const mechAddress = mechAddresses[0];
    configLogger.info(` Found mech address: ${mechAddress}`);
    return mechAddress;
  } catch (error) {
    configLogger.warn(' Error parsing MECH_TO_CONFIG:', error);
    return null;
  }
}

/**
 * Get the Gnosis Safe address for this service
 * 
 * Priority:
 * 1. Read from .operate service config chain_configs.<chain>.chain_data.multisig
 * 2. Fall back to safe_address at root (backwards compatibility)
 * 
 * Note: Ignores MECH_SAFE_ADDRESS environment variable - must come from .operate
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
  
  configLogger.warn(' safe_address not found in service config');
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
    configLogger.warn(' No agent instance found in chain_configs');
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
    configLogger.warn(' Error reading private key from .operate:', error);
  }
  
  return null;
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
  };
}

