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
      // Start from recent block to avoid 25-hour historical sync
      // Set PONDER_START_BLOCK env var to override, or use "latest" to start from current block
      startBlock: process.env.PONDER_START_BLOCK === "latest" 
        ? "latest" 
        : Number(process.env.PONDER_START_BLOCK || 36480000), // ~1 hour ago from block 36481259
    },
    OlasMech: {
      network: "base",
      address: process.env.PONDER_MECH_ADDRESS || MECH_ADDRESS, // Auto-loaded from service config
      abi: (AgentMechAbi as any)?.abi || (AgentMechAbi as any),
      // Start from recent block to avoid 25-hour historical sync
      startBlock: process.env.PONDER_START_BLOCK === "latest" 
        ? "latest" 
        : Number(process.env.PONDER_START_BLOCK || 36480000), // ~1 hour ago from block 36481259
    },
  },
});


