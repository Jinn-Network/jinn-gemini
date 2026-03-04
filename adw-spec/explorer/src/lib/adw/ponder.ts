const PONDER_URL = process.env.PONDER_GRAPHQL_URL || 'https://adw-ponder-production.up.railway.app/graphql'

export interface ADWDocument {
  id: string
  creator: string
  documentType: string
  documentURI: string
  contentHash: string
  timestamp: string
  blockNumber: string
  transactionHash: string
  feedbackCount: number
  avgScore: number | null
  validationRequestCount: number
  validationResponseCount: number
}

interface PonderResponse<T> {
  data: T
}

async function ponderQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(PONDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 30 },
  })
  if (!res.ok) throw new Error(`Ponder query failed: ${res.status}`)
  const json = (await res.json()) as PonderResponse<T>
  return json.data
}

const DOCUMENT_FIELDS = `
  id creator documentType documentURI contentHash timestamp
  blockNumber transactionHash feedbackCount avgScore
  validationRequestCount validationResponseCount
`

export async function getADWDocuments(limit = 50): Promise<ADWDocument[]> {
  const { documents } = await ponderQuery<{
    documents: { items: ADWDocument[] }
  }>(`
    query ADWDocuments($limit: Int!) {
      documents(
        limit: $limit
        orderBy: "timestamp"
        orderDirection: "desc"
      ) {
        items { ${DOCUMENT_FIELDS} }
      }
    }
  `, { limit })
  return documents.items
}

export async function getADWDocumentById(id: string): Promise<ADWDocument | null> {
  const { document } = await ponderQuery<{
    document: ADWDocument | null
  }>(`
    query ADWDocumentById($id: BigInt!) {
      document(id: $id) { ${DOCUMENT_FIELDS} }
    }
  `, { id })
  return document
}

export interface RegistrationFile {
  type: string
  '@context': string
  documentType: string
  version?: string
  name: string
  description?: string
  contentHash: string
  creator: string
  created: string
  tags?: string[]
  storage?: Array<{ provider: string; uri: string; gateway?: string }>
  provenance?: Record<string, unknown>
  trust?: { level: number; creatorProof?: { signature: string; signer: string } }
  profile?: Record<string, unknown>
}

const IPFS_GATEWAY = 'https://gateway.autonolas.tech/ipfs/'

export async function fetchRegistrationFile(documentURI: string): Promise<RegistrationFile | null> {
  try {
    const url = documentURI.startsWith('ipfs://')
      ? `${IPFS_GATEWAY}${documentURI.replace('ipfs://', '')}`
      : documentURI
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return (await res.json()) as RegistrationFile
  } catch {
    return null
  }
}
