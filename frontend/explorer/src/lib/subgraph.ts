import { request } from 'graphql-request'

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL || 'http://localhost:42069/graphql'

export interface JobDefinition {
  id: string
  name: string
  enabledTools: string[]
  promptContent?: string
  sourceJobDefinitionId?: string
  sourceRequestId?: string
}

export interface Request {
  id: string
  mech: string
  sender: string
  jobDefinitionId?: string
  sourceRequestId?: string
  sourceJobDefinitionId?: string
  requestData?: string
  ipfsHash?: string
  deliveryIpfsHash?: string
  transactionHash?: string
  blockNumber: string
  blockTimestamp: string
  delivered: boolean
  jobName?: string
  enabledTools: string[]
  additionalContext?: any
}

export interface Delivery {
  id: string
  requestId: string
  sourceRequestId?: string
  sourceJobDefinitionId?: string
  mech: string
  mechServiceMultisig: string
  deliveryRate: string
  ipfsHash?: string
  transactionHash: string
  blockNumber: string
  blockTimestamp: string
}

export interface Artifact {
  id: string
  requestId: string
  sourceRequestId?: string
  sourceJobDefinitionId?: string
  name: string
  cid: string
  topic: string
  contentPreview?: string
}

export interface Message {
  id: string
  requestId: string
  sourceRequestId?: string
  sourceJobDefinitionId?: string
  to?: string
  content: string
  blockTimestamp: string
}

export interface PageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor?: string
  endCursor?: string
}

export interface JobDefinitionsResponse {
  jobDefinitions: {
    items: JobDefinition[]
    pageInfo: PageInfo
  }
}

export interface RequestsResponse {
  requests: {
    items: Request[]
    pageInfo: PageInfo
  }
}

export interface DeliveriesResponse {
  deliverys: {
    items: Delivery[]
    pageInfo: PageInfo
  }
}

export interface ArtifactsResponse {
  artifacts: {
    items: Artifact[]
    pageInfo: PageInfo
  }
}

export interface MessagesResponse {
  messages: {
    items: Message[]
    pageInfo: PageInfo
  }
}

export interface QueryOptions {
  limit?: number
  after?: string
  before?: string
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
  where?: Record<string, unknown>
}

export async function queryJobDefinitions(options: QueryOptions = {}): Promise<JobDefinition[]> {
  const {
    limit = 100,
    after,
    before,
    orderBy = 'name',
    orderDirection = 'asc',
    where
  } = options

  const query = `
    query JobDefinitions($limit: Int, $after: String, $before: String, $orderBy: String, $orderDirection: String, $where: jobDefinitionFilter) {
      jobDefinitions(
        limit: $limit,
        after: $after,
        before: $before,
        orderBy: $orderBy,
        orderDirection: $orderDirection,
        where: $where
      ) {
        items {
          id
          name
          enabledTools
          promptContent
          sourceJobDefinitionId
          sourceRequestId
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `

  try {
    const response = await request<JobDefinitionsResponse>(SUBGRAPH_URL, query, {
      limit,
      after,
      before,
      orderBy,
      orderDirection,
      where
    })
    return response.jobDefinitions.items
  } catch (error) {
    console.error('Error querying job definitions:', error)
    return []
  }
}

export async function queryRequests(options: QueryOptions = {}): Promise<Request[]> {
  const {
    limit = 100,
    after,
    before,
    orderBy = 'blockTimestamp',
    orderDirection = 'desc',
    where
  } = options

  const query = `
    query Requests($limit: Int, $after: String, $before: String, $orderBy: String, $orderDirection: String, $where: requestFilter) {
      requests(
        limit: $limit,
        after: $after,
        before: $before,
        orderBy: $orderBy,
        orderDirection: $orderDirection,
        where: $where
      ) {
        items {
          id
          mech
          sender
          jobDefinitionId
          sourceRequestId
          sourceJobDefinitionId
          requestData
          ipfsHash
          deliveryIpfsHash
          transactionHash
          blockNumber
          blockTimestamp
          delivered
          jobName
          enabledTools
          additionalContext
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `

  try {
    const response = await request<RequestsResponse>(SUBGRAPH_URL, query, {
      limit,
      after,
      before,
      orderBy,
      orderDirection,
      where
    })
    return response.requests.items
  } catch (error) {
    console.error('Error querying requests:', error)
    return []
  }
}

export async function queryDeliveries(options: QueryOptions = {}): Promise<Delivery[]> {
  const {
    limit = 100,
    after,
    before,
    orderBy = 'blockTimestamp',
    orderDirection = 'desc',
    where
  } = options

  const query = `
    query Deliveries($limit: Int, $after: String, $before: String, $orderBy: String, $orderDirection: String, $where: deliveryFilter) {
      deliverys(
        limit: $limit,
        after: $after,
        before: $before,
        orderBy: $orderBy,
        orderDirection: $orderDirection,
        where: $where
      ) {
        items {
          id
          requestId
          sourceRequestId
          sourceJobDefinitionId
          mech
          mechServiceMultisig
          deliveryRate
          ipfsHash
          transactionHash
          blockNumber
          blockTimestamp
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `

  try {
    const response = await request<DeliveriesResponse>(SUBGRAPH_URL, query, {
      limit,
      after,
      before,
      orderBy,
      orderDirection,
      where
    })
    return response.deliverys.items
  } catch (error) {
    console.error('Error querying deliveries:', error)
    return []
  }
}

export async function queryArtifacts(options: QueryOptions = {}): Promise<Artifact[]> {
  const {
    limit = 100,
    after,
    before,
    orderBy = 'requestId',
    orderDirection = 'desc',
    where
  } = options

  const query = `
    query Artifacts($limit: Int, $after: String, $before: String, $orderBy: String, $orderDirection: String, $where: artifactFilter) {
      artifacts(
        limit: $limit,
        after: $after,
        before: $before,
        orderBy: $orderBy,
        orderDirection: $orderDirection,
        where: $where
      ) {
        items {
          id
          requestId
          sourceRequestId
          sourceJobDefinitionId
          name
          cid
          topic
          contentPreview
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `

  try {
    const response = await request<ArtifactsResponse>(SUBGRAPH_URL, query, {
      limit,
      after,
      before,
      orderBy,
      orderDirection,
      where
    })
    return response.artifacts.items
  } catch (error) {
    console.error('Error querying artifacts:', error)
    return []
  }
}

export async function getJobDefinition(id: string): Promise<JobDefinition | null> {
  const query = `
    query JobDefinition($id: String!) {
      jobDefinition(id: $id) {
        id
        name
        enabledTools
        promptContent
        sourceJobDefinitionId
        sourceRequestId
      }
    }
  `

  try {
    const response = await request<{ jobDefinition: JobDefinition | null }>(SUBGRAPH_URL, query, { id })
    return response.jobDefinition
  } catch (error) {
    console.error('Error querying job definition:', error)
    return null
  }
}

export async function getRequest(id: string): Promise<Request | null> {
  const query = `
    query Request($id: String!) {
      request(id: $id) {
        id
        mech
        sender
        jobDefinitionId
        sourceRequestId
        sourceJobDefinitionId
        requestData
        ipfsHash
        deliveryIpfsHash
        transactionHash
        blockNumber
        blockTimestamp
        delivered
        jobName
        enabledTools
        additionalContext
      }
    }
  `

  try {
    const response = await request<{ request: Request | null }>(SUBGRAPH_URL, query, { id })
    return response.request
  } catch (error) {
    console.error('Error querying request:', error)
    return null
  }
}

export async function getDelivery(id: string): Promise<Delivery | null> {
  const query = `
    query Delivery($id: String!) {
      delivery(id: $id) {
        id
        requestId
        sourceRequestId
        sourceJobDefinitionId
        mech
        mechServiceMultisig
        deliveryRate
        ipfsHash
        transactionHash
        blockNumber
        blockTimestamp
      }
    }
  `

  try {
    const response = await request<{ delivery: Delivery | null }>(SUBGRAPH_URL, query, { id })
    return response.delivery
  } catch (error) {
    console.error('Error querying delivery:', error)
    return null
  }
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  const query = `
    query Artifact($id: String!) {
      artifact(id: $id) {
        id
        requestId
        sourceRequestId
        sourceJobDefinitionId
        name
        cid
        topic
        contentPreview
      }
    }
  `

  try {
    const response = await request<{ artifact: Artifact | null }>(SUBGRAPH_URL, query, { id })
    return response.artifact
  } catch (error) {
    console.error('Error querying artifact:', error)
    return null
  }
}

export async function queryMessages(options: QueryOptions = {}): Promise<Message[]> {
  const {
    limit = 100,
    after,
    before,
    orderBy = 'blockTimestamp',
    orderDirection = 'desc',
    where
  } = options

  const query = `
    query Messages($limit: Int, $after: String, $before: String, $orderBy: String, $orderDirection: String, $where: messageFilter) {
      messages(
        limit: $limit,
        after: $after,
        before: $before,
        orderBy: $orderBy,
        orderDirection: $orderDirection,
        where: $where
      ) {
        items {
          id
          requestId
          sourceRequestId
          sourceJobDefinitionId
          to
          content
          blockTimestamp
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `

  try {
    const response = await request<MessagesResponse>(SUBGRAPH_URL, query, {
      limit,
      after,
      before,
      orderBy,
      orderDirection,
      where
    })
    return response.messages.items
  } catch (error) {
    console.error('Error querying messages:', error)
    return []
  }
}

export async function getMessage(id: string): Promise<Message | null> {
  const query = `
    query Message($id: String!) {
      message(id: $id) {
        id
        requestId
        sourceRequestId
        sourceJobDefinitionId
        to
        content
        blockTimestamp
      }
    }
  `

  try {
    const response = await request<{ message: Message | null }>(SUBGRAPH_URL, query, { id })
    return response.message
  } catch (error) {
    console.error('Error querying message:', error)
    return null
  }
}

export async function getRequestsAndDeliveries(options: QueryOptions = {}): Promise<{ requests: Request[], deliveries: Delivery[] }> {
  const [requests, deliveries] = await Promise.all([
    queryRequests(options),
    queryDeliveries(options)
  ])

  return { requests, deliveries }
}