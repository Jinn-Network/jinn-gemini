import '../env/index.js';
import MechMarketplaceAbi from './abis/MechMarketplace.json';
import AgentMechAbi from 'mech-client-ts/dist/abis/AgentMech.json';
import { createConfig } from "@ponder/core";
import { http } from "viem";

// Base chain RPC; can be overridden via env PONDER_RPC_URL
const DEFAULT_BASE_RPC = process.env.RPC_URL || "https://mainnet.base.org";

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
      startBlock: Number(process.env.PONDER_START_BLOCK || 35577849),
    },
    OlasMech: {
      network: "base",
      address: process.env.MECH_ADDRESS || process.env.MECH_WORKER_ADDRESS || process.env.PONDER_MECH_ADDRESS || '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
      abi: (AgentMechAbi as any)?.abi || (AgentMechAbi as any),
      startBlock: Number(process.env.PONDER_START_BLOCK || 35577849),
    },
  },
});


