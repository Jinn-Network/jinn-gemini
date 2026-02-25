'use client'

import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import {
  VOTE_WEIGHTING_ADDRESS,
  JINN_NOMINEE_BYTES32,
  JINN_V1_NOMINEE_BYTES32,
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

  /** Remove v1 vote and set v2 vote in a single batch transaction */
  function migrateVote(v2WeightBasisPoints: bigint) {
    writeContract({
      address: VOTE_WEIGHTING_ADDRESS,
      abi: voteWeightingAbi,
      functionName: 'voteForNomineeWeightsBatch',
      args: [
        [JINN_V1_NOMINEE_BYTES32, JINN_NOMINEE_BYTES32],
        [NOMINEE_CHAIN_ID, NOMINEE_CHAIN_ID],
        [BigInt(0), v2WeightBasisPoints],
      ],
    })
  }

  /** Remove v1 vote only (set to 0) without touching v2 */
  function removeV1Vote() {
    writeContract({
      address: VOTE_WEIGHTING_ADDRESS,
      abi: voteWeightingAbi,
      functionName: 'voteForNomineeWeights',
      args: [JINN_V1_NOMINEE_BYTES32, NOMINEE_CHAIN_ID, BigInt(0)],
    })
  }

  return {
    vote,
    migrateVote,
    removeV1Vote,
    txHash,
    isSubmitting,
    isConfirming,
    isConfirmed,
    error: submitError || confirmError,
    reset,
  }
}
