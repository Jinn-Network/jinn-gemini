'use client'

import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import {
  VOTE_WEIGHTING_ADDRESS,
  JINN_NOMINEE_BYTES32,
  NOMINEE_CHAIN_ID,
  voteWeightingAbi,
} from '@/lib/vote/constants'

export function useVoteSubmit() {
  const {
    writeContract,
    data: txHash,
    isPending: isSubmitting,
    error: submitError,
    reset,
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  function vote(weightBasisPoints: bigint) {
    writeContract({
      address: VOTE_WEIGHTING_ADDRESS,
      abi: voteWeightingAbi,
      functionName: 'voteForNomineeWeights',
      args: [JINN_NOMINEE_BYTES32, NOMINEE_CHAIN_ID, weightBasisPoints],
    })
  }

  return {
    vote,
    txHash,
    isSubmitting,
    isConfirming,
    isConfirmed,
    error: submitError || confirmError,
    reset,
  }
}
