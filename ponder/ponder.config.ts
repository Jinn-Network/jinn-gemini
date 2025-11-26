import '../env/index.js';
import { getMechAddress } from '../env/operate-profile.js';
import MechMarketplaceAbi from './abis/MechMarketplace.json';
import AgentMechAbi from '@jinn-network/mech-client-ts/dist/abis/AgentMech.json';
import { createConfig } from "@ponder/core";
import { http } from "viem";
import fetch from 'cross-fetch';

// Suppress config logs when running under non-default runtime environments
const runtimeMode = process.env.RUNTIME_ENVIRONMENT || 'default';
const suppressLogs = runtimeMode !== 'default';

// Get start block: use env var if set, otherwise fetch current block and use recent history
async function getStartBlock(): Promise<number> {
  const rpcUrl = process.env.BASE_RPC_URL || process.env.RPC_URL || "https://mainnet.base.org";

  if (process.env.PONDER_START_BLOCK) {
    return Number(process.env.PONDER_START_BLOCK);
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });

    const result = await response.json();
    const currentBlock = parseInt(result.result, 16);
    const recentStartBlock = Math.max(currentBlock - 100, 0);

    if (!suppressLogs) {
      console.log(`[ponder] Using recent start block: ${recentStartBlock} (current: ${currentBlock})`);
    }
    return recentStartBlock;
  } catch (error) {
    if (!suppressLogs) {
      console.warn('[ponder] Failed to fetch current block, using contract deployment block:', error);
    }
    return 35577849; // Fallback to contract deployment block
  }
}

// Review mode configuration
const endBlock = process.env.PONDER_END_BLOCK ? Number(process.env.PONDER_END_BLOCK) : undefined;

if (runtimeMode === 'review') {
  console.log('[Ponder Config] 🔍 REVIEW MODE ACTIVE');
  console.log(`[Ponder Config]   Start Block: ${process.env.PONDER_START_BLOCK || 'auto-detect'}`);
  console.log(`[Ponder Config]   End Block: ${endBlock || 'none (will sync to chain head)'}`);
}

const startBlock = await getStartBlock();

const MECH_ADDRESS = process.env.MECH_ADDRESS || getMechAddress();
if (!MECH_ADDRESS) {
  throw new Error('[Ponder Config] MECH_ADDRESS is required. Set MECH_ADDRESS environment variable or ensure .operate/service_*/service_config.json contains MECH_TO_CONFIG.');
}
if (!suppressLogs) {
  console.log('[Ponder Config] Indexing mech:', MECH_ADDRESS);
  console.log('[Ponder Config] Start block:', startBlock);
}

// Read RPC_URL dynamically to support runtime overrides (important for tests!)
// Ponder's transport will be created lazily, so this function is called after env vars are set
function getRpcUrl(): string {
  const rpcUrl = process.env.BASE_RPC_URL || process.env.RPC_URL || "https://mainnet.base.org";
  return rpcUrl;
}

// Determine finality block count based on RPC URL
function getFinalityBlockCount(): number {
  const rpcUrl = getRpcUrl();
  // Tenderly virtual networks don't mine new blocks automatically, so finality checks fail
  // when Ponder tries to look ahead. Set finalityBlockCount to 0 for virtual networks.
  const isTenderlyVirtualNetwork = rpcUrl.includes('virtual') && rpcUrl.includes('tenderly.co');
  return isTenderlyVirtualNetwork ? 0 : 30;
}

// Support suite-specific database directory for parallel test execution (SQLite only)
const databaseDir = process.env.PONDER_DATABASE_DIR || '.ponder';

// Determine database config
const databaseConfig = process.env.PONDER_DATABASE_URL
  ? { kind: 'postgres' as const, connectionString: process.env.PONDER_DATABASE_URL }
  : { kind: 'sqlite' as const, directory: databaseDir };

// ============================================================================
// RUNTIME CONFIGURATION LOGGING (for debugging test environment issues)
// Write to both stderr and a debug file (Ponder UI may overwrite stderr)
// ============================================================================
const rpcUrl = getRpcUrl();
const isTenderly = rpcUrl.includes('virtual') && rpcUrl.includes('tenderly.co');

const configInfo = [
  '',
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '🔍 PONDER RUNTIME CONFIG',
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  `VITEST: ${process.env.VITEST || 'not set'}`,
  `RPC_URL: ${process.env.RPC_URL || 'not set'}`,
  `BASE_RPC_URL: ${process.env.BASE_RPC_URL || 'not set'}`,
  `Resolved RPC URL: ${rpcUrl}`,
  `Is Tenderly VNet: ${isTenderly}`,
  `Finality Block Count: ${getFinalityBlockCount()}`,
  `Start Block: ${startBlock}`,
  `End Block: ${endBlock || 'none (realtime)'}`,
  `Database Mode: ${databaseConfig.kind}`,
];

if (databaseConfig.kind === 'postgres') {
  const connStr = databaseConfig.connectionString;
  const masked = connStr.replace(/:[^:@]+@/, ':****@'); // Mask password
  configInfo.push(`Database URL: ${masked}`);
} else {
  configInfo.push(`Database Dir: ${databaseConfig.directory}`);
}

configInfo.push(
  `MECH_ADDRESS: ${MECH_ADDRESS}`,
  `OPERATE_PROFILE_DIR: ${process.env.OPERATE_PROFILE_DIR || 'not set'}`,
  `PORT: ${process.env.PORT || 'not set'}`,
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ''
);

const configText = configInfo.join('\n');

// Write to stderr (may be overwritten by Ponder UI)
console.error(configText);

// Also write to a debug file in the current working directory
try {
  const { writeFileSync } = await import('fs');
  const debugFile = '.ponder-config-debug.txt';
  writeFileSync(debugFile, configText + `\nTimestamp: ${new Date().toISOString()}\nCWD: ${process.cwd()}\n`);
  console.error(`[Ponder Config] Debug info written to ${debugFile}`);
} catch (err) {
  console.error('[Ponder Config] Failed to write debug file:', err);
}


export default createConfig({
  // Production mode: Use PostgreSQL for all storage (not SQLite)
  // Test mode: Use suite-specific SQLite directory for parallel test isolation
  // This ensures artifacts table persists across restarts in production,
  // and enables parallel test execution without database conflicts
  database: databaseConfig,

  networks: {
    base: {
      chainId: 8453,
      transport: http(getRpcUrl()), // Call function to get RPC URL at runtime
      pollingInterval: 6_000,
      maxRequestsPerSecond: 2,
      finalityBlockCount: getFinalityBlockCount(), // Call function to get finality count at runtime
    },
  },
  contracts: {
    MechMarketplace: {
      network: "base",
      address: "0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020",
      // Reuse ABI from mech-client-ts to avoid duplication during dev
      abi: MechMarketplaceAbi,
      startBlock,
      endBlock,
    },
    OlasMech: {
      network: "base",
      address: MECH_ADDRESS,
      abi: (AgentMechAbi as any)?.abi || (AgentMechAbi as any),
      startBlock,
      endBlock,
    },
  },
});

