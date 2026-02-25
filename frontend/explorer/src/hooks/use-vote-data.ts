'use client'

import { useAccount, useReadContracts } from 'wagmi'
import {
  VOTE_WEIGHTING_ADDRESS,
  VE_OLAS_ADDRESS,
  JINN_NOMINEE_BYTES32,
  NOMINEE_CHAIN_ID,
  voteWeightingAbi,
  veOlasAbi,
} from '@/lib/vote/constants'

export function useVoteData() {
  const { address, isConnected } = useAccount()

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      {
        address: VE_OLAS_ADDRESS,
        abi: veOlasAbi,
        functionName: 'balanceOf',
        args: [address!],
      },
      {
        address: VOTE_WEIGHTING_ADDRESS,
        abi: voteWeightingAbi,
        functionName: 'voteUserPower',
        args: [address!],
      },
      {
        address: VOTE_WEIGHTING_ADDRESS,
        abi: voteWeightingAbi,
        functionName: 'getNomineeWeight',
        args: [JINN_NOMINEE_BYTES32, NOMINEE_CHAIN_ID],
      },
      {
        address: VOTE_WEIGHTING_ADDRESS,
        abi: voteWeightingAbi,
        functionName: 'getWeightsSum',
      },
    ],
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 30_000,
    },
  })

  const [veOlasBalance, userPower, nomineeWeight, weightsSum] = data ?? []

  return {
    isConnected,
    isLoading,
    refetch,
    veOlasBalance: veOlasBalance?.result as bigint | undefined,
    userAllocatedPower: userPower?.result as bigint | undefined,
    nomineeWeight: nomineeWeight?.result as bigint | undefined,
    weightsSum: weightsSum?.result as bigint | undefined,
  }
}
