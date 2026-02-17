import { createPublicClient, http, type PublicClient } from 'viem'
import { base } from 'viem/chains'

/**
 * Module-level singleton RPC client with multicall batching.
 *
 * When multiple API routes call readContract() concurrently, viem automatically
 * batches them into a single eth_call via the Multicall3 contract. This reduces
 * 12 parallel RPC calls (3 services × 2 routes × 2 calls each) down to ~2-3
 * batched calls, avoiding rate limits on the public Base RPC.
 *
 * RPC URL resolution order:
 *   1. RPC_URL (set in root .env — Tenderly paid RPC)
 *   2. BASE_RPC_URL (alias)
 *   3. https://mainnet.base.org (public, rate-limited — last resort)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: PublicClient | null = null
let _clientRpcUrl: string | null = null

export function getRpcClient(): PublicClient {
  const rpcUrl = process.env.RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org'

  // Recreate if RPC URL changed (e.g. env reload in dev)
  if (_client && _clientRpcUrl === rpcUrl) {
    return _client
  }

  if (!_clientRpcUrl) {
    // Log once on first creation
    const source = process.env.RPC_URL ? 'RPC_URL' : process.env.BASE_RPC_URL ? 'BASE_RPC_URL' : 'fallback (mainnet.base.org)'
    console.log(`[staking/rpc] Creating client from ${source}: ${rpcUrl.replace(/\/[a-f0-9-]{20,}$/i, '/***')}`)
  }

  _client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
    batch: {
      multicall: true,
    },
  }) as PublicClient
  _clientRpcUrl = rpcUrl

  return _client
}
