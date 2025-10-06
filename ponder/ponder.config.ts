import '../env/index.js';
import MechMarketplaceAbi from './abis/MechMarketplace.json';
import AgentMechAbi from 'mech-client-ts/dist/abis/AgentMech.json';
import { createConfig } from "@ponder/core";
import { http } from "viem";
import fetch from 'cross-fetch';

// Base chain RPC; can be overridden via env PONDER_RPC_URL
const DEFAULT_BASE_RPC = process.env.RPC_URL || "https://mainnet.base.org";
const rpcUrl = process.env.PONDER_RPC_URL || DEFAULT_BASE_RPC;

// Get start block: use env var if set, otherwise fetch current block and use recent history
async function getStartBlock(): Promise<number> {
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

    console.log(`[ponder] Using recent start block: ${recentStartBlock} (current: ${currentBlock})`);
    return recentStartBlock;
  } catch (error) {
    console.warn('[ponder] Failed to fetch current block, using contract deployment block:', error);
    return 35577849; // Fallback to contract deployment block
  }
}

const startBlock = await getStartBlock();

export default createConfig({
  networks: {
    base: {
      chainId: 8453,
      transport: http(rpcUrl),
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
      startBlock,
    },
    OlasMech: {
      network: "base",
      address: process.env.MECH_ADDRESS || process.env.MECH_WORKER_ADDRESS || process.env.PONDER_MECH_ADDRESS || '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
      abi: (AgentMechAbi as any)?.abi || (AgentMechAbi as any),
      startBlock,
    },
  },
});


