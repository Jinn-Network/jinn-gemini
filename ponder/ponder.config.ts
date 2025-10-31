import '../env/index.js';
import { getMechAddress } from '../env/operate-profile.js';
import MechMarketplaceAbi from './abis/MechMarketplace.json';
import AgentMechAbi from '@jinn-network/mech-client-ts/dist/abis/AgentMech.json';
import { createConfig } from "@ponder/core";
import { http } from "viem";
import fetch from 'cross-fetch';

// Suppress config logs in test mode to reduce noise
const isTestMode = process.env.PONDER_REVIEW_MODE === '1';

// Get start block: use env var if set, otherwise fetch current block and use recent history
async function getStartBlock(): Promise<number> {
  const rpcUrl = process.env.RPC_URL || "https://mainnet.base.org";

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

    if (!isTestMode) {
      console.log(`[ponder] Using recent start block: ${recentStartBlock} (current: ${currentBlock})`);
    }
    return recentStartBlock;
  } catch (error) {
    if (!isTestMode) {
      console.warn('[ponder] Failed to fetch current block, using contract deployment block:', error);
    }
    return 35577849; // Fallback to contract deployment block
  }
}

// Review mode configuration
const endBlock = process.env.PONDER_END_BLOCK ? Number(process.env.PONDER_END_BLOCK) : undefined;

if (!isTestMode && process.env.PONDER_REVIEW_MODE === '1') {
  console.log('[Ponder Config] 🔍 REVIEW MODE ACTIVE');
  console.log(`[Ponder Config]   Start Block: ${process.env.PONDER_START_BLOCK || 'auto-detect'}`);
  console.log(`[Ponder Config]   End Block: ${endBlock || 'none (will sync to chain head)'}`);
}

const startBlock = await getStartBlock();

const MECH_ADDRESS = getMechAddress() || '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7';
if (!isTestMode) {
  console.log('[Ponder Config] Indexing mech:', MECH_ADDRESS);
  console.log('[Ponder Config] Start block:', startBlock);
}

// Read RPC_URL here (after env/index.js has run) to respect review mode overrides
const rpcUrl = process.env.RPC_URL || "https://mainnet.base.org";

// Tenderly virtual networks don't mine new blocks, so finality checks fail
// when Ponder tries to look ahead. Set finalityBlockCount to 0 for virtual networks.
const isTenderlyVirtualNetwork = rpcUrl.includes('virtual') && rpcUrl.includes('tenderly.co');
const finalityBlockCount = isTenderlyVirtualNetwork ? 0 : 30;

// Support suite-specific database directory for parallel test execution (SQLite only)
const databaseDir = process.env.PONDER_DATABASE_DIR || '.ponder';

export default createConfig({
  // Production mode: Use PostgreSQL for all storage (not SQLite)
  // Test mode: Use suite-specific SQLite directory for parallel test isolation
  // This ensures artifacts table persists across restarts in production,
  // and enables parallel test execution without database conflicts
  database: process.env.PONDER_DATABASE_URL
    ? { kind: 'postgres', connectionString: process.env.PONDER_DATABASE_URL }
    : { kind: 'sqlite', directory: databaseDir },

  networks: {
    base: {
      chainId: 8453,
      transport: http(rpcUrl),
      pollingInterval: 4_000,
      maxRequestsPerSecond: 5,
      finalityBlockCount,
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


