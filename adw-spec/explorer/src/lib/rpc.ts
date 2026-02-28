import { createPublicClient, http, type PublicClient, type Chain } from 'viem'
import { base } from 'viem/chains'

/**
 * Module-level singleton RPC client.
 *
 * For local development: point RPC_URL at http://127.0.0.1:8545 (hardhat node).
 * For production: point at Tenderly gateway or Base mainnet RPC.
 */

const localHardhat: Chain = {
  ...base,
  id: 8453,
  name: 'Hardhat (Base fork)',
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
}

let _client: PublicClient | null = null
let _clientRpcUrl: string | null = null

export function getRpcUrl(): string {
  return (process.env.RPC_URL || process.env.BASE_RPC_URL || 'http://127.0.0.1:8545').trim()
}

export function getRpcClient(): PublicClient {
  const rpcUrl = getRpcUrl()

  if (_client && _clientRpcUrl === rpcUrl) {
    return _client
  }

  const isLocal = rpcUrl.includes('127.0.0.1') || rpcUrl.includes('localhost')

  const proxyToken = process.env.RPC_PROXY_TOKEN
  const transportOptions = proxyToken
    ? { fetchOptions: { headers: { Authorization: `Bearer ${proxyToken}` } } }
    : {}

  _client = createPublicClient({
    chain: isLocal ? localHardhat : base,
    transport: http(rpcUrl, transportOptions),
    batch: { multicall: true },
  }) as PublicClient
  _clientRpcUrl = rpcUrl

  return _client
}
