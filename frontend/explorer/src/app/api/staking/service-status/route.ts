import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, formatEther } from 'viem'
import { base } from 'viem/chains'
import { JINN_STAKING_CONTRACT, stakingAbi } from '@/lib/staking/constants'

// Cache the active service IDs list for 2 minutes
let activeIdsCache: { ids: bigint[]; fetchedAt: number } | null = null
const CACHE_TTL_MS = 2 * 60_000

function getClient() {
  const rpcUrl = process.env.RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org'
  return createPublicClient({ chain: base, transport: http(rpcUrl) })
}

async function getActiveServiceIds(client: ReturnType<typeof getClient>): Promise<bigint[]> {
  if (activeIdsCache && Date.now() - activeIdsCache.fetchedAt < CACHE_TTL_MS) {
    return activeIdsCache.ids
  }

  const ids = await client.readContract({
    address: JINN_STAKING_CONTRACT,
    abi: stakingAbi,
    functionName: 'getServiceIds',
  })

  activeIdsCache = { ids: [...ids], fetchedAt: Date.now() }
  return activeIdsCache.ids
}

export async function GET(request: NextRequest) {
  const serviceIdParam = request.nextUrl.searchParams.get('serviceId')

  if (!serviceIdParam) {
    return NextResponse.json({ error: 'serviceId parameter required' }, { status: 400 })
  }

  const serviceId = BigInt(serviceIdParam)

  try {
    const client = getClient()

    const [activeIds, serviceInfo, availableRewards] = await Promise.all([
      getActiveServiceIds(client),
      client.readContract({
        address: JINN_STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: 'mapServiceInfo',
        args: [serviceId],
      }),
      client.readContract({
        address: JINN_STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: 'availableRewards',
      }),
    ])

    // ABI returns: (address multisig, address owner, uint256 tsStart, uint256 reward, uint256 nonces)
    const [, , tsStart, reward] = serviceInfo
    const isActivelyStaked = activeIds.some(id => id === serviceId)
    const hasBeenStaked = tsStart > BigInt(0)
    const isEvicted = hasBeenStaked && !isActivelyStaked

    let pendingReward = '0'
    if (isActivelyStaked) {
      try {
        const pending = await client.readContract({
          address: JINN_STAKING_CONTRACT,
          abi: stakingAbi,
          functionName: 'calculateStakingReward',
          args: [serviceId],
        })
        pendingReward = formatEther(pending)
      } catch {
        // calculateStakingReward can revert for evicted services
      }
    }

    return NextResponse.json({
      serviceId: serviceIdParam,
      isActivelyStaked,
      isEvicted,
      accumulatedReward: formatEther(reward),
      pendingReward,
      totalClaimable: formatEther(reward),
      hasClaimableRewards: reward > BigInt(0),
      contractAvailableRewards: formatEther(availableRewards),
      stakedSince: Number(tsStart) > 0 ? new Date(Number(tsStart) * 1000).toISOString() : null,
    })
  } catch (error) {
    console.error('Error fetching service staking status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch service status' },
      { status: 500 }
    )
  }
}
