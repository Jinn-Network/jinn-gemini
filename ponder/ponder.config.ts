import '../env/index.js';
import MechMarketplaceAbi from './abis/MechMarketplace.json';
import AgentMechAbi from './abis/AgentMech.json';
import { createConfig } from "@ponder/core";
import { http } from "viem";

// Base chain RPC; can be overridden via env PONDER_RPC_URL
const DEFAULT_BASE_RPC = process.env.RPC_URL || "https://mainnet.base.org";

// JINN-209: Auto-load mech address from service config
// Use env var override if provided, otherwise let Ponder use the default
// (Service config will be read by indexer at runtime if needed)
const MECH_ADDRESS = process.env.PONDER_MECH_ADDRESS || '0x8c083Dfe9bee719a05Ba3c75A9B16BE4ba52c299'; // Service 165 mech
const MARKETPLACE_ADDRESS = '0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020'; // Base mainnet marketplace

// Log the mech address being used
console.log(`[Ponder Config] Indexing mech: ${MECH_ADDRESS}`);

// Optional startBlock and endBlock for review mode
const startBlock = process.env.PONDER_START_BLOCK ? Number(process.env.PONDER_START_BLOCK) : undefined;
const endBlock = process.env.PONDER_END_BLOCK ? Number(process.env.PONDER_END_BLOCK) : undefined;

if (startBlock) {
  console.log(`[ponder] ✓ startBlock set to ${startBlock}`);
} else {
  console.log(`[ponder] No startBlock set - will sync from recent block`);
}

if (endBlock) {
  console.log(`[ponder] ✓ endBlock set to ${endBlock} (review mode - will not sync beyond this block)`);
} else {
  console.log(`[ponder] No endBlock set - will sync to chain head`);
}

export default createConfig({
  networks: {
    base: {
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL || DEFAULT_BASE_RPC),
      pollingInterval: 4_000,
      maxRequestsPerSecond: 5,
      finalityBlockCount: 30,
    },
  },
  contracts: {
    MechMarketplace: {
      network: "base",
      address: "0xf24eE42edA0fc9b33B7D41B06Ee8ccD2Ef7C5020",
      // Reuse ABI from mech-client-ts to avoid duplication during dev
      abi: MechMarketplaceAbi,
      ...(startBlock !== undefined && { startBlock }),
      ...(endBlock !== undefined && { endBlock }),
    },
    OlasMech: {
      network: "base",
      address: process.env.PONDER_MECH_ADDRESS || MECH_ADDRESS, // Auto-loaded from service config
      abi: (AgentMechAbi as any)?.abi || (AgentMechAbi as any),
      ...(startBlock !== undefined && { startBlock }),
      ...(endBlock !== undefined && { endBlock }),
    },
  },
});


