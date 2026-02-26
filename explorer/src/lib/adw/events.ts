import { parseAbiItem } from 'viem'
import { getRpcClient } from '@/lib/rpc'
import { DOCUMENT_REGISTRY_ADDRESS, REPUTATION_REGISTRY_ADDRESS, VALIDATION_REGISTRY_ADDRESS, ADW_DEPLOYMENT_BLOCK } from './contracts'

const DOCUMENT_REGISTERED_EVENT = parseAbiItem(
  'event DocumentRegistered(uint256 indexed documentId, address indexed creator, string documentType, string documentURI, bytes32 contentHash, uint256 timestamp)'
)

const FEEDBACK_GIVEN_EVENT = parseAbiItem(
  'event FeedbackGiven(uint256 indexed documentId, address indexed sender, int128 score, uint8 decimals, string tag1, string tag2, string feedbackURI, bytes32 feedbackHash, uint256 timestamp)'
)

const VALIDATION_REQUESTED_EVENT = parseAbiItem(
  'event ValidationRequested(address indexed validator, uint256 indexed documentId, address indexed requester, string requestURI, bytes32 requestHash, uint256 timestamp)'
)

const VALIDATION_RESPONDED_EVENT = parseAbiItem(
  'event ValidationResponded(bytes32 indexed requestHash, address indexed validator, uint8 response, string responseURI, bytes32 responseHash, string tag, uint256 timestamp)'
)

export async function getDocumentRegisteredEvents() {
  try {
    const client = getRpcClient()
    const logs = await client.getLogs({
      address: DOCUMENT_REGISTRY_ADDRESS,
      event: DOCUMENT_REGISTERED_EVENT,
      fromBlock: ADW_DEPLOYMENT_BLOCK,
      toBlock: 'latest',
    })
    return logs
  } catch {
    return []
  }
}

export async function getFeedbackEvents(documentId: bigint) {
  try {
    const client = getRpcClient()
    const logs = await client.getLogs({
      address: REPUTATION_REGISTRY_ADDRESS,
      event: FEEDBACK_GIVEN_EVENT,
      args: { documentId },
      fromBlock: ADW_DEPLOYMENT_BLOCK,
      toBlock: 'latest',
    })
    return logs
  } catch {
    return []
  }
}

export async function getValidationRequestedEvents(documentId: bigint) {
  try {
    const client = getRpcClient()
    const logs = await client.getLogs({
      address: VALIDATION_REGISTRY_ADDRESS,
      event: VALIDATION_REQUESTED_EVENT,
      args: { documentId },
      fromBlock: ADW_DEPLOYMENT_BLOCK,
      toBlock: 'latest',
    })
    return logs
  } catch {
    return []
  }
}

export async function getValidationRespondedEvents(requestHashes?: `0x${string}`[]) {
  try {
    const client = getRpcClient()
    const logs = await client.getLogs({
      address: VALIDATION_REGISTRY_ADDRESS,
      event: VALIDATION_RESPONDED_EVENT,
      args: requestHashes?.length ? { requestHash: requestHashes } : undefined,
      fromBlock: ADW_DEPLOYMENT_BLOCK,
      toBlock: 'latest',
    })
    return logs
  } catch {
    return []
  }
}

export type DocumentRegisteredLog = Awaited<ReturnType<typeof getDocumentRegisteredEvents>>[number]
export type FeedbackGivenLog = Awaited<ReturnType<typeof getFeedbackEvents>>[number]
export type ValidationRequestedLog = Awaited<ReturnType<typeof getValidationRequestedEvents>>[number]
export type ValidationRespondedLog = Awaited<ReturnType<typeof getValidationRespondedEvents>>[number]
