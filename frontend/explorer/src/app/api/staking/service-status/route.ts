import { NextRequest, NextResponse } from 'next/server'
import { formatEther } from 'viem'
import { JINN_STAKING_CONTRACT, stakingAbi } from '@/lib/staking/constants'
import { getServiceFromSubgraph } from '@/lib/staking/subgraph'
import { getRpcClient } from '@/lib/staking/rpc'

export async function GET(request: NextRequest) {
  const serviceIdParam = request.nextUrl.searchParams.get('serviceId')

  if (!serviceIdParam) {
    return NextResponse.json({ error: 'serviceId parameter required' }, { status: 400 })
  }

  try {
    // Primary: subgraph for staking state and rewards
    const service = await getServiceFromSubgraph(serviceIdParam)

    if (!service) {
      return NextResponse.json({
        serviceId: serviceIdParam,
        isActivelyStaked: false,
        isEvicted: false,
        accumulatedReward: '0',
        pendingReward: '0',
        totalClaimable: '0',
        hasClaimableRewards: false,
        contractAvailableRewards: '0',
        stakedSince: null,
      })
    }

    // On-chain truth: getStakingState() is the only reliable source
    // 0 = NotStaked, 1 = Staked, 2 = Evicted
    let isActivelyStaked = false
    let isEvicted = false
    const hasBeenStaked = BigInt(service.currentOlasStaked) > BigInt(0)

    try {
      const client = getRpcClient()
      const stakingState = await client.readContract({
        address: JINN_STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: 'getStakingState',
        args: [BigInt(serviceIdParam)],
      }) as number
      isActivelyStaked = Number(stakingState) === 1
      isEvicted = Number(stakingState) === 2
    } catch (err) {
      // Fallback: subgraph-only (can't distinguish evicted from staked)
      console.warn('getStakingState RPC failed, falling back to subgraph:', err)
      isActivelyStaked = service.latestStakingContract?.toLowerCase() === JINN_STAKING_CONTRACT.toLowerCase()
      isEvicted = hasBeenStaked && !isActivelyStaked
    }

    // Subgraph rewards are in wei
    const earned = BigInt(service.olasRewardsEarned)
    const claimed = BigInt(service.olasRewardsClaimed)
    const unclaimed = earned > claimed ? earned - claimed : BigInt(0)

    // For evicted services: calculate when restaking becomes possible
    let restakeEligibleAt: number | null = null
    if (isEvicted) {
      try {
        const client = getRpcClient()
        const [serviceInfo, minDuration] = await Promise.all([
          client.readContract({
            address: JINN_STAKING_CONTRACT,
            abi: stakingAbi,
            functionName: 'getServiceInfo',
            args: [BigInt(serviceIdParam)],
          }) as Promise<{ tsStart: bigint }>,
          client.readContract({
            address: JINN_STAKING_CONTRACT,
            abi: stakingAbi,
            functionName: 'minStakingDuration',
          }) as Promise<bigint>,
        ])
        restakeEligibleAt = Number(serviceInfo.tsStart + minDuration)
      } catch (err) {
        console.warn('Failed to fetch restake eligibility (non-fatal):', err)
      }
    }

    // Optional RPC: pending reward for current epoch (non-fatal if it fails)
    // Uses shared singleton client with multicall batching.
    let pendingReward = '0'
    let contractAvailableRewards = '0'
    if (isActivelyStaked) {
      try {
        const client = getRpcClient()
        const [pending, available] = await Promise.all([
          client.readContract({
            address: JINN_STAKING_CONTRACT,
            abi: stakingAbi,
            functionName: 'calculateStakingReward',
            args: [BigInt(serviceIdParam)],
          }),
          client.readContract({
            address: JINN_STAKING_CONTRACT,
            abi: stakingAbi,
            functionName: 'availableRewards',
          }),
        ])
        pendingReward = formatEther(pending)
        contractAvailableRewards = formatEther(available)
      } catch (err) {
        console.warn('RPC enhancement failed (non-fatal), using subgraph data only:', err)
      }
    }

    return NextResponse.json({
      serviceId: serviceIdParam,
      isActivelyStaked,
      isEvicted,
      accumulatedReward: formatEther(earned),
      pendingReward,
      totalClaimable: formatEther(unclaimed),
      hasClaimableRewards: unclaimed > BigInt(0),
      contractAvailableRewards,
      stakedSince: null, // subgraph doesn't expose tsStart; use totalEpochsParticipated instead
      totalEpochsParticipated: service.totalEpochsParticipated,
      olasStaked: formatEther(BigInt(service.currentOlasStaked)),
      restakeEligibleAt,
    })
  } catch (error) {
    console.error('Error fetching service staking status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch service status from subgraph' },
      { status: 502 }
    )
  }
}
