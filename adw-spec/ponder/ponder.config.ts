import { createConfig } from "ponder";
import { http } from "viem";

import ADWDocumentRegistryAbi from "./abis/ADWDocumentRegistry.json";
import ADWReputationRegistryAbi from "./abis/ADWReputationRegistry.json";
import ADWValidationRegistryAbi from "./abis/ADWValidationRegistry.json";

// ADW registry addresses on Base mainnet
const DOCUMENT_REGISTRY = "0x40Eac2B201D12b13b442c330eED0A2aB04b06DeE" as const;
const REPUTATION_REGISTRY = "0x6dF7f8d643DD140fCE38C5bf346A11DA4a4B0330" as const;
const VALIDATION_REGISTRY = "0xC552bd9f22f8BB9CFa898A11f12B8D676D8155F6" as const;

// Contracts deployed ~Feb 26, 2026. Block 42500000 is safely before that.
const START_BLOCK = Number(process.env.ADW_START_BLOCK || 42500000);

function getRpcUrl(): string {
  const proxyToken = process.env.RPC_PROXY_TOKEN;
  if (proxyToken) return `https://rpc.jinn.network?token=${proxyToken}`;
  return process.env.RPC_URL || "https://mainnet.base.org";
}

export default createConfig({
  networks: {
    base: {
      chainId: 8453,
      transport: http(getRpcUrl()),
    },
  },
  contracts: {
    ADWDocumentRegistry: {
      network: "base",
      abi: ADWDocumentRegistryAbi,
      address: DOCUMENT_REGISTRY,
      startBlock: START_BLOCK,
    },
    ADWReputationRegistry: {
      network: "base",
      abi: ADWReputationRegistryAbi,
      address: REPUTATION_REGISTRY,
      startBlock: START_BLOCK,
    },
    ADWValidationRegistry: {
      network: "base",
      abi: ADWValidationRegistryAbi,
      address: VALIDATION_REGISTRY,
      startBlock: START_BLOCK,
    },
  },
});
