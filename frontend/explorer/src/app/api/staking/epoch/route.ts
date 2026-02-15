import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, type Address } from 'viem'
import { base } from 'viem/chains'
import { JINN_STAKING_CONTRACT, stakingAbi, MECH_MARKETPLACE, marketplaceAbi, TARGET_REQUESTS_PER_EPOCH } from '@/lib/staking/constants'

// Cache epoch data for 5 minutes — it only changes when checkpoint() is called on-chain (~daily)
let epochCache: { checkpoint: number; nextCheckpoint: number; livenessPeriod: number; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60_000

function getRpcClient() {
  const rpcUrl = process.env.RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org'
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  })
}

async function getEpochData() {
  if (epochCache && Date.now() - epochCache.fetchedAt < CACHE_TTL_MS) {
    return epochCache
  }

  try {
    const client = getRpcClient()

    const [checkpoint, nextCheckpoint, livenessPeriod] = await Promise.all([
      client.readContract({
        address: JINN_STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: 'tsCheckpoint',
      }),
      client.readContract({
        address: JINN_STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: 'getNextRewardCheckpointTimestamp',
      }),
      client.readContract({
        address: JINN_STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: 'livenessPeriod',
      }),
    ])

    epochCache = {
      checkpoint: Number(checkpoint),
      nextCheckpoint: Number(nextCheckpoint),
      livenessPeriod: Number(livenessPeriod),
      fetchedAt: Date.now(),
    }
  } catch (err) {
    // Serve stale cache if RPC fails (rate limiting, network issues)
    if (epochCache) {
      console.warn('RPC call failed, serving stale epoch cache:', err)
      return epochCache
    }
    throw err
  }

  return epochCache
}

/**
 * Read mapRequestCounts from the Marketplace contract.
 * This is the authoritative source the activity checker uses for liveness.
 */
async function getRequestCount(multisig: string): Promise<number> {
  const client = getRpcClient()
  const count = await client.readContract({
    address: MECH_MARKETPLACE,
    abi: marketplaceAbi,
    functionName: 'mapRequestCounts',
    args: [multisig as Address],
  })
  return Number(count)
}

/**
 * Read the stored nonce baseline from the staking contract.
 * mapServiceInfo returns (multisig, owner, tsStart, reward, nonces).
 * The nonces field is the cumulative request count at the last checkpoint.
 */
async function getEpochBaselineNonce(serviceId: bigint): Promise<number> {
  const client = getRpcClient()
  const result = await client.readContract({
    address: JINN_STAKING_CONTRACT,
    abi: stakingAbi,
    functionName: 'mapServiceInfo',
    args: [serviceId],
  })
  // result is a tuple: [multisig, owner, tsStart, reward, nonces]
  return Number((result as readonly unknown[])[4])
}

export async function GET(request: NextRequest) {
  try {
    const multisig = request.nextUrl.searchParams.get('multisig')
    const serviceId = request.nextUrl.searchParams.get('serviceId')
    const epoch = await getEpochData()

    let requestCount: number | undefined
    if (multisig) {
      try {
        const currentCount = await getRequestCount(multisig)
        if (serviceId) {
          // If we have the serviceId, compute exact epoch delta using on-chain baseline
          const baseline = await getEpochBaselineNonce(BigInt(serviceId))
          requestCount = currentCount - baseline
        } else {
          // Fallback: just return raw count (less accurate but still useful)
          requestCount = currentCount
        }
      } catch (err) {
        console.warn('Failed to fetch request count, returning without it:', err)
      }
    }

    return NextResponse.json({
      checkpoint: epoch.checkpoint,
      nextCheckpoint: epoch.nextCheckpoint,
      livenessPeriod: epoch.livenessPeriod,
      targetRequests: TARGET_REQUESTS_PER_EPOCH,
      requestCount,
    })
  } catch (error) {
    console.error('Error fetching staking epoch:', error)
    return NextResponse.json(
      { error: 'Failed to fetch epoch data' },
      { status: 500 }
    )
  }
}
