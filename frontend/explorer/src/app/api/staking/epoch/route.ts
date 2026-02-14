import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { JINN_STAKING_CONTRACT, stakingAbi, TARGET_DELIVERIES_PER_EPOCH } from '@/lib/staking/constants'
import { getDeliveryCountSince } from '@/lib/staking/queries'

// Cache epoch data for 5 minutes — it only changes when checkpoint() is called on-chain (~daily)
let epochCache: { checkpoint: number; nextCheckpoint: number; livenessPeriod: number; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60_000

async function getEpochData() {
  if (epochCache && Date.now() - epochCache.fetchedAt < CACHE_TTL_MS) {
    return epochCache
  }

  try {
    const rpcUrl = process.env.RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    })

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

export async function GET(request: NextRequest) {
  try {
    const multisig = request.nextUrl.searchParams.get('multisig')
    const epoch = await getEpochData()

    let deliveryCount: number | undefined
    if (multisig) {
      try {
        deliveryCount = await getDeliveryCountSince(multisig, String(epoch.checkpoint))
      } catch (err) {
        console.warn('Failed to fetch delivery count, returning without it:', err)
      }
    }

    return NextResponse.json({
      checkpoint: epoch.checkpoint,
      nextCheckpoint: epoch.nextCheckpoint,
      livenessPeriod: epoch.livenessPeriod,
      targetDeliveries: TARGET_DELIVERIES_PER_EPOCH,
      deliveryCount,
    })
  } catch (error) {
    console.error('Error fetching staking epoch:', error)
    return NextResponse.json(
      { error: 'Failed to fetch epoch data' },
      { status: 500 }
    )
  }
}
