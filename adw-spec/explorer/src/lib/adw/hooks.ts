'use client'

import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { documentRegistryContract, reputationRegistryContract, validationRegistryContract } from './contracts'

// ─── Read Hooks ────────────────────────────────────────────────────────────────

export function useDocumentCount() {
  return useReadContract({
    ...documentRegistryContract,
    functionName: 'totalDocuments',
  })
}

export function useDocumentURI(documentId: bigint) {
  return useReadContract({
    ...documentRegistryContract,
    functionName: 'resolve',
    args: [documentId],
    query: { enabled: documentId > BigInt(0) },
  })
}

export function useDocumentContentHash(documentId: bigint) {
  return useReadContract({
    ...documentRegistryContract,
    functionName: 'documentContentHashes',
    args: [documentId],
    query: { enabled: documentId > BigInt(0) },
  })
}

export function useDocumentOwner(documentId: bigint) {
  return useReadContract({
    ...documentRegistryContract,
    functionName: 'ownerOf',
    args: [documentId],
    query: { enabled: documentId > BigInt(0) },
  })
}

// ─── Write Hooks ───────────────────────────────────────────────────────────────

export function useRegisterDocument() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const register = (args: { documentURI: string; contentHash: `0x${string}`; documentType: string }) => {
    writeContract({
      ...documentRegistryContract,
      functionName: 'register',
      args: [args.documentURI, args.contentHash, args.documentType],
    })
  }

  return { register, hash, isPending, isConfirming, isSuccess, error, reset }
}

export function useSetDocumentURI() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const setURI = (documentId: bigint, newURI: string) => {
    writeContract({
      ...documentRegistryContract,
      functionName: 'setDocumentURI',
      args: [documentId, newURI],
    })
  }

  return { setURI, hash, isPending, isConfirming, isSuccess, error, reset }
}

export function useGiveFeedback() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const giveFeedback = (args: {
    documentId: bigint
    score: bigint
    decimals: number
    tag1: string
    tag2: string
    endpoint: string
    feedbackURI: string
    feedbackHash: `0x${string}`
  }) => {
    writeContract({
      ...reputationRegistryContract,
      functionName: 'giveFeedback',
      args: [args.documentId, args.score, args.decimals, args.tag1, args.tag2, args.endpoint, args.feedbackURI, args.feedbackHash],
    })
  }

  return { giveFeedback, hash, isPending, isConfirming, isSuccess, error, reset }
}

export function useRequestValidation() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const requestValidation = (args: {
    validator: `0x${string}`
    documentId: bigint
    requestURI: string
    requestHash: `0x${string}`
  }) => {
    writeContract({
      ...validationRegistryContract,
      functionName: 'validationRequest',
      args: [args.validator, args.documentId, args.requestURI, args.requestHash],
    })
  }

  return { requestValidation, hash, isPending, isConfirming, isSuccess, error, reset }
}

export function useRespondValidation() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const respondValidation = (args: {
    requestHash: `0x${string}`
    response: number
    responseURI: string
    responseHash: `0x${string}`
    tag: string
  }) => {
    writeContract({
      ...validationRegistryContract,
      functionName: 'validationResponse',
      args: [args.requestHash, args.response, args.responseURI, args.responseHash, args.tag],
    })
  }

  return { respondValidation, hash, isPending, isConfirming, isSuccess, error, reset }
}
