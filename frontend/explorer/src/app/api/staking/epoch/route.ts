import { NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { JINN_STAKING_CONTRACT, stakingAbi, TARGET_DELIVERIES_PER_EPOCH, LIVENESS_PERIOD } from '@/lib/staking/constants'

export async function GET() {
  try {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    })

    const checkpoint = await client.readContract({
      address: JINN_STAKING_CONTRACT,
      abi: stakingAbi,
      functionName: 'tsCheckpoint',
    })

    const checkpointNumber = Number(checkpoint)
    const epochEnd = checkpointNumber + LIVENESS_PERIOD

    return NextResponse.json({
      checkpoint: checkpointNumber,
      epochEnd,
      livenessPeriod: LIVENESS_PERIOD,
      targetDeliveries: TARGET_DELIVERIES_PER_EPOCH,
    })
  } catch (error) {
    console.error('Error fetching staking epoch:', error)
    return NextResponse.json(
      { error: 'Failed to fetch epoch data' },
      { status: 500 }
    )
  }
}
