const PONDER_URL = process.env.PONDER_GRAPHQL_URL || 'https://indexer.jinn.network/graphql'

export interface PonderArtifact {
  id: string
  cid: string
  contentCid: string | null
  documentType: string | null
  topic: string
  type: string | null
  tags: string[] | null
  contentPreview: string | null
  blockTimestamp: string
  requestId: string
  ventureId: string | null
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

export async function getADWDocuments(limit = 50): Promise<PonderArtifact[]> {
  const { artifacts } = await ponderQuery<{
    artifacts: { items: PonderArtifact[] }
  }>(`
    query ADWDocuments($limit: Int!) {
      artifacts(
        where: { documentType_not: null }
        limit: $limit
        orderBy: "blockTimestamp"
        orderDirection: "desc"
      ) {
        items {
          id cid contentCid documentType topic type tags contentPreview
          blockTimestamp requestId ventureId
        }
      }
    }
  `, { limit })
  return artifacts.items
}

export async function getADWDocumentByCid(cid: string): Promise<PonderArtifact | null> {
  const { artifacts } = await ponderQuery<{
    artifacts: { items: PonderArtifact[] }
  }>(`
    query ADWDocumentByCid($cid: String!) {
      artifacts(where: { cid: $cid }, limit: 1) {
        items {
          id cid contentCid documentType topic type tags contentPreview
          blockTimestamp requestId ventureId
        }
      }
    }
  `, { cid })
  return artifacts.items[0] ?? null
}

export async function getADWDocumentsByType(documentType: string, limit = 50): Promise<PonderArtifact[]> {
  const { artifacts } = await ponderQuery<{
    artifacts: { items: PonderArtifact[] }
  }>(`
    query ADWDocumentsByType($documentType: String!, $limit: Int!) {
      artifacts(
        where: { documentType: $documentType }
        limit: $limit
        orderBy: "blockTimestamp"
        orderDirection: "desc"
      ) {
        items {
          id cid contentCid documentType topic type tags contentPreview
          blockTimestamp requestId ventureId
        }
      }
    }
  `, { documentType, limit })
  return artifacts.items
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

export async function fetchRegistrationFile(cid: string): Promise<RegistrationFile | null> {
  try {
    const res = await fetch(`${IPFS_GATEWAY}${cid}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return (await res.json()) as RegistrationFile
  } catch {
    return null
  }
}
