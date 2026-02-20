import { NextRequest, NextResponse } from 'next/server'
import { type Address } from 'viem'
import { JINN_STAKING_CONTRACT, stakingAbi, MECH_MARKETPLACE, marketplaceAbi, TARGET_REQUESTS_PER_EPOCH } from '@/lib/staking/constants'
import { getLatestCheckpoint, getStakingContract } from '@/lib/staking/subgraph'
import { getRpcClient } from '@/lib/staking/rpc'

// Cache subgraph data for 5 minutes — it only changes when checkpoint() is called on-chain (~daily)
let subgraphCache: { livenessPeriod: number; checkpointTimestamp: number; epochLength: number; fetchedAt: number } | null = null
const SUBGRAPH_CACHE_TTL_MS = 5 * 60_000

async function getSubgraphEpochData() {
  if (subgraphCache && Date.now() - subgraphCache.fetchedAt < SUBGRAPH_CACHE_TTL_MS) {
    return subgraphCache
  }

  const [contract, checkpoint] = await Promise.all([
    getStakingContract(JINN_STAKING_CONTRACT),
    getLatestCheckpoint(JINN_STAKING_CONTRACT),
  ])

  if (!contract || !checkpoint) {
    throw new Error('Staking contract or checkpoint not found in subgraph')
  }

  subgraphCache = {
    livenessPeriod: Number(contract.livenessPeriod),
    checkpointTimestamp: Number(checkpoint.blockTimestamp),
    epochLength: Number(checkpoint.epochLength),
    fetchedAt: Date.now(),
  }

  return subgraphCache
}

async function rpcWithRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 2000): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, delayMs))
      return rpcWithRetry(fn, retries - 1, delayMs)
    }
    throw err
  }
}

export async function GET(request: NextRequest) {
  try {
    const multisig = request.nextUrl.searchParams.get('multisig')
    const serviceId = request.nextUrl.searchParams.get('serviceId')

    // Primary: subgraph for epoch timing (static data, highly reliable)
    const epoch = await getSubgraphEpochData()
    const nextCheckpoint = epoch.checkpointTimestamp + epoch.livenessPeriod

    // RPC: request count (essential real-time data, with retry + graceful fallback)
    // Uses shared singleton client with multicall batching — concurrent calls from
    // multiple service cards get batched into fewer actual RPC requests.
    let requestCount: number | undefined
    if (multisig) {
      try {
        const client = getRpcClient()

        const [currentCount, serviceInfo] = await Promise.all([
          rpcWithRetry(() =>
            client.readContract({
              address: MECH_MARKETPLACE,
              abi: marketplaceAbi,
              functionName: 'mapRequestCounts',
              args: [multisig as Address],
            })
          ),
          serviceId
            ? rpcWithRetry(() =>
                client.readContract({
                  address: JINN_STAKING_CONTRACT,
                  abi: stakingAbi,
                  functionName: 'getServiceInfo',
                  args: [BigInt(serviceId)],
                })
              )
            : Promise.resolve(null),
        ])

        if (serviceId && serviceInfo) {
          // getServiceInfo returns a tuple: { multisig, owner, nonces, tsStart, reward, inactivity }
          // nonces[1] is the request count baseline at the last checkpoint
          const info = serviceInfo as { nonces: readonly bigint[] }
          const baseline = Number(info.nonces[1])
          const delta = Number(currentCount) - baseline
          requestCount = delta >= 0 ? delta : Number(currentCount)
        } else {
          requestCount = Number(currentCount)
        }
      } catch (err) {
        console.warn('Failed to fetch request count after retry, returning without it:', err)
      }
    }

    return NextResponse.json({
      checkpoint: epoch.checkpointTimestamp,
      nextCheckpoint,
      livenessPeriod: epoch.livenessPeriod,
      targetRequests: TARGET_REQUESTS_PER_EPOCH,
      requestCount,
    })
  } catch (error) {
    console.error('Error fetching staking epoch:', error)
    return NextResponse.json(
      { error: 'Failed to fetch epoch data' },
      { status: 502 }
    )
  }
}
