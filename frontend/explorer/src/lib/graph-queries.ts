import {
  JobDefinition,
  Request,
  queryJobDefinitions,
  queryRequests,
  getJobDefinition,
  getRequest,
  queryArtifacts,
  queryMessages,
} from './subgraph'

// ============================================================================
// Core Data Structures
// ============================================================================

export interface GraphNode {
  id: string
  type: 'jobDefinition' | 'request'
  label: string
  status: 'active' | 'completed' | 'failed' | 'unknown'
  level: number // depth from root
  metadata: {
    blockTimestamp?: string
    enabledTools?: string[]
    artifactCount?: number
    messageCount?: number
    deliveryRate?: string
    delivered?: boolean
  }
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: 'execution_of' | 'created_job' | 'spawned_job' | 'child_execution' | 'dispatched_request'
  label?: string
}

export interface JobGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  rootNode: GraphNode
  stats: {
    totalNodes: number
    totalEdges: number
    maxDepth: number
    jobDefinitionCount: number
    requestCount: number
  }
}

export interface GraphQueryOptions {
  rootId: string
  rootType: 'jobDefinition' | 'request'
  maxDepth: number // 1-5
  direction: 'upstream' | 'downstream' | 'both'
}

// ============================================================================
// Helper Functions
// ============================================================================

function createEdgeId(source: string, target: string, type: string): string {
  return `${source}__${type}__${target}`
}

function determineRequestStatus(request: Request): GraphNode['status'] {
  if (request.delivered) return 'completed'
  return 'active'
}

function createGraphNode(
  record: JobDefinition | Request,
  type: 'jobDefinition' | 'request',
  level: number
): GraphNode {
  if (type === 'jobDefinition') {
    const jobDef = record as JobDefinition
    return {
      id: jobDef.id,
      type: 'jobDefinition',
      label: jobDef.name || 'Unnamed Job',
      status: 'unknown',
      level,
      metadata: {
        enabledTools: jobDef.enabledTools || [],
        artifactCount: 0,
        messageCount: 0,
      },
    }
  } else {
    const req = record as Request
    return {
      id: req.id,
      type: 'request',
      label: req.jobName || 'Request',
      status: determineRequestStatus(req),
      level,
      metadata: {
        blockTimestamp: req.blockTimestamp,
        enabledTools: req.enabledTools || [],
        delivered: req.delivered,
        artifactCount: 0,
        messageCount: 0,
      },
    }
  }
}

async function fetchRootNode(
  id: string,
  type: 'jobDefinition' | 'request'
): Promise<GraphNode | null> {
  try {
    if (type === 'jobDefinition') {
      const jobDef = await getJobDefinition(id)
      if (!jobDef) return null
      return createGraphNode(jobDef, 'jobDefinition', 0)
    } else {
      const req = await getRequest(id)
      if (!req) return null
      return createGraphNode(req, 'request', 0)
    }
  } catch (error) {
    console.error('Error fetching root node:', error)
    return null
  }
}

async function enrichNodeWithCounts(node: GraphNode): Promise<void> {
  try {
    // Fetch artifact count
    const artifactsResponse = await queryArtifacts({
      where: {
        [node.type === 'jobDefinition' ? 'sourceJobDefinitionId' : 'requestId']: node.id
      },
      limit: 1000,
    })
    node.metadata.artifactCount = artifactsResponse.items.length

    // Fetch message count
    // For job definitions, query by sourceJobDefinitionId (messages FROM this job)
    // For requests, query by requestId (messages TO this request)
    const messagesResponse = await queryMessages({
      where: {
        [node.type === 'jobDefinition' ? 'sourceJobDefinitionId' : 'requestId']: node.id
      },
      limit: 1000,
    })
    node.metadata.messageCount = messagesResponse.items.length
  } catch (error) {
    console.error('Error enriching node with counts:', error)
  }
}

// ============================================================================
// Downstream Traversal (Find Children)
// ============================================================================

interface TraversalResult {
  nodes: Map<string, GraphNode>
  edges: GraphEdge[]
}

async function traverseDownstream(
  startId: string,
  startType: 'jobDefinition' | 'request',
  maxDepth: number
): Promise<TraversalResult> {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const visited = new Set<string>()

  // BFS queue: { id, type, level }
  const queue: Array<{ id: string; type: 'jobDefinition' | 'request'; level: number }> = [
    { id: startId, type: startType, level: 0 }
  ]

  while (queue.length > 0) {
    const current = queue.shift()!

    if (current.level > maxDepth) continue
    if (visited.has(`${current.type}:${current.id}`)) continue

    visited.add(`${current.type}:${current.id}`)

    // Fetch current node if not already in map
    if (!nodes.has(current.id)) {
      const node = await fetchRootNode(current.id, current.type)
      if (node) {
        node.level = current.level
        await enrichNodeWithCounts(node)
        nodes.set(current.id, node)
      }
    }

    if (current.level >= maxDepth) continue

    // ==================================================================
    // Job Definition: Find downstream requests and child job definitions
    // ==================================================================
    if (current.type === 'jobDefinition') {
      // Find requests that execute this job definition
      const requestsResponse = await queryRequests({
        where: { jobDefinitionId: current.id },
        limit: 100,
      })

      for (const req of requestsResponse.items) {
        const reqNode = createGraphNode(req, 'request', current.level + 1)
        await enrichNodeWithCounts(reqNode)
        nodes.set(req.id, reqNode)

        edges.push({
          id: createEdgeId(current.id, req.id, 'execution_of'),
          source: current.id,
          target: req.id,
          type: 'execution_of',
        })

        queue.push({ id: req.id, type: 'request', level: current.level + 1 })
      }

      // Find job definitions spawned by this job definition
      const childJobDefsResponse = await queryJobDefinitions({
        where: { sourceJobDefinitionId: current.id },
        limit: 100,
      })

      for (const childJobDef of childJobDefsResponse.items) {
        const childNode = createGraphNode(childJobDef, 'jobDefinition', current.level + 1)
        await enrichNodeWithCounts(childNode)
        nodes.set(childJobDef.id, childNode)

        edges.push({
          id: createEdgeId(current.id, childJobDef.id, 'spawned_job'),
          source: current.id,
          target: childJobDef.id,
          type: 'spawned_job',
        })

        queue.push({ id: childJobDef.id, type: 'jobDefinition', level: current.level + 1 })
      }

      // Find requests dispatched from this job definition (via sourceJobDefinitionId)
      const dispatchedRequestsResponse = await queryRequests({
        where: { sourceJobDefinitionId: current.id },
        limit: 100,
      })

      for (const req of dispatchedRequestsResponse.items) {
        const reqNode = createGraphNode(req, 'request', current.level + 1)
        await enrichNodeWithCounts(reqNode)
        nodes.set(req.id, reqNode)

        edges.push({
          id: createEdgeId(current.id, req.id, 'dispatched_request'),
          source: current.id,
          target: req.id,
          type: 'dispatched_request',
        })

        queue.push({ id: req.id, type: 'request', level: current.level + 1 })
      }
    }

    // ==================================================================
    // Request: Find job definitions created by this request and child requests
    // ==================================================================
    if (current.type === 'request') {
      // Find job definitions created by this request
      const createdJobDefsResponse = await queryJobDefinitions({
        where: { sourceRequestId: current.id },
        limit: 100,
      })

      for (const jobDef of createdJobDefsResponse.items) {
        const jobDefNode = createGraphNode(jobDef, 'jobDefinition', current.level + 1)
        await enrichNodeWithCounts(jobDefNode)
        nodes.set(jobDef.id, jobDefNode)

        edges.push({
          id: createEdgeId(current.id, jobDef.id, 'created_job'),
          source: current.id,
          target: jobDef.id,
          type: 'created_job',
        })

        queue.push({ id: jobDef.id, type: 'jobDefinition', level: current.level + 1 })

        // Find requests dispatched from this created job definition
        // This creates the path: Request → JobDef → Request (via sourceJobDefinitionId)
        const requestsFromJobDefResponse = await queryRequests({
          where: { sourceJobDefinitionId: jobDef.id },
          limit: 100,
        })

        for (const childReq of requestsFromJobDefResponse.items) {
          if (!nodes.has(childReq.id)) {
            const childReqNode = createGraphNode(childReq, 'request', current.level + 2)
            await enrichNodeWithCounts(childReqNode)
            nodes.set(childReq.id, childReqNode)

            edges.push({
              id: createEdgeId(jobDef.id, childReq.id, 'dispatched_request'),
              source: jobDef.id,
              target: childReq.id,
              type: 'dispatched_request',
            })

            queue.push({ id: childReq.id, type: 'request', level: current.level + 2 })
          }
        }
      }

      // Find child requests spawned by this request
      const childRequestsResponse = await queryRequests({
        where: { sourceRequestId: current.id },
        limit: 100,
      })

      for (const childReq of childRequestsResponse.items) {
        const childReqNode = createGraphNode(childReq, 'request', current.level + 1)
        await enrichNodeWithCounts(childReqNode)
        nodes.set(childReq.id, childReqNode)

        edges.push({
          id: createEdgeId(current.id, childReq.id, 'child_execution'),
          source: current.id,
          target: childReq.id,
          type: 'child_execution',
        })

        queue.push({ id: childReq.id, type: 'request', level: current.level + 1 })
      }
    }
  }

  return { nodes, edges }
}

// ============================================================================
// Upstream Traversal (Find Parents)
// ============================================================================

async function traverseUpstream(
  startId: string,
  startType: 'jobDefinition' | 'request',
  maxDepth: number
): Promise<TraversalResult> {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const visited = new Set<string>()

  // BFS queue (level increases as we go UP the tree)
  const queue: Array<{ id: string; type: 'jobDefinition' | 'request'; level: number }> = [
    { id: startId, type: startType, level: 0 }
  ]

  while (queue.length > 0) {
    const current = queue.shift()!

    if (current.level > maxDepth) continue
    if (visited.has(`${current.type}:${current.id}`)) continue

    visited.add(`${current.type}:${current.id}`)

    // Fetch current node
    let currentRecord: JobDefinition | Request | null = null
    if (current.type === 'jobDefinition') {
      currentRecord = await getJobDefinition(current.id)
    } else {
      currentRecord = await getRequest(current.id)
    }

    if (!currentRecord) continue

    const currentNode = createGraphNode(currentRecord, current.type, current.level)
    await enrichNodeWithCounts(currentNode)
    nodes.set(current.id, currentNode)

    if (current.level >= maxDepth) continue

    // ==================================================================
    // Job Definition: Find parent job definition and creating request
    // ==================================================================
    if (current.type === 'jobDefinition') {
      const jobDef = currentRecord as JobDefinition

      // Parent job definition
      if (jobDef.sourceJobDefinitionId) {
        const parentJobDef = await getJobDefinition(jobDef.sourceJobDefinitionId)
        if (parentJobDef) {
          const parentNode = createGraphNode(parentJobDef, 'jobDefinition', current.level + 1)
          await enrichNodeWithCounts(parentNode)
          nodes.set(parentJobDef.id, parentNode)

          edges.push({
            id: createEdgeId(parentJobDef.id, current.id, 'spawned_job'),
            source: parentJobDef.id,
            target: current.id,
            type: 'spawned_job',
          })

          queue.push({ id: parentJobDef.id, type: 'jobDefinition', level: current.level + 1 })
        }
      }

      // Creating request
      if (jobDef.sourceRequestId) {
        const parentRequest = await getRequest(jobDef.sourceRequestId)
        if (parentRequest) {
          const parentNode = createGraphNode(parentRequest, 'request', current.level + 1)
          await enrichNodeWithCounts(parentNode)
          nodes.set(parentRequest.id, parentNode)

          edges.push({
            id: createEdgeId(parentRequest.id, current.id, 'created_job'),
            source: parentRequest.id,
            target: current.id,
            type: 'created_job',
          })

          queue.push({ id: parentRequest.id, type: 'request', level: current.level + 1 })
        }
      }
    }

    // ==================================================================
    // Request: Find parent request and parent job (skip jobDefinitionId for level 0)
    // ==================================================================
    if (current.type === 'request') {
      const req = currentRecord as Request

      // Skip jobDefinitionId relationship for root nodes (level 0)
      // This prevents duplicate nodes in workstream views where the request IS the top-level node
      // We only traverse to job definition if we're already traversing upstream from a child
      if (req.jobDefinitionId && current.level > 0) {
        const targetJobDef = await getJobDefinition(req.jobDefinitionId)
        if (targetJobDef) {
          const targetNode = createGraphNode(targetJobDef, 'jobDefinition', current.level + 1)
          await enrichNodeWithCounts(targetNode)
          nodes.set(targetJobDef.id, targetNode)

          edges.push({
            id: createEdgeId(targetJobDef.id, current.id, 'execution_of'),
            source: targetJobDef.id,
            target: current.id,
            type: 'execution_of',
          })

          queue.push({ id: targetJobDef.id, type: 'jobDefinition', level: current.level + 1 })
        }
      }

      // Parent request
      if (req.sourceRequestId) {
        const parentRequest = await getRequest(req.sourceRequestId)
        if (parentRequest) {
          const parentNode = createGraphNode(parentRequest, 'request', current.level + 1)
          await enrichNodeWithCounts(parentNode)
          nodes.set(parentRequest.id, parentNode)

          edges.push({
            id: createEdgeId(parentRequest.id, current.id, 'child_execution'),
            source: parentRequest.id,
            target: current.id,
            type: 'child_execution',
          })

          queue.push({ id: parentRequest.id, type: 'request', level: current.level + 1 })
        }
      }

      // Parent job definition (dispatched this request)
      if (req.sourceJobDefinitionId) {
        const parentJobDef = await getJobDefinition(req.sourceJobDefinitionId)
        if (parentJobDef) {
          const parentNode = createGraphNode(parentJobDef, 'jobDefinition', current.level + 1)
          await enrichNodeWithCounts(parentNode)
          nodes.set(parentJobDef.id, parentNode)

          // This represents a job definition dispatching/creating this request
          edges.push({
            id: createEdgeId(parentJobDef.id, current.id, 'dispatched_request'),
            source: parentJobDef.id,
            target: current.id,
            type: 'dispatched_request',
          })

          queue.push({ id: parentJobDef.id, type: 'jobDefinition', level: current.level + 1 })
        }
      }
    }
  }

  return { nodes, edges }
}

// ============================================================================
// Level Recalculation for Bidirectional Graphs
// ============================================================================

/**
 * Recalculate node levels based on graph distance from root
 * This fixes inconsistencies when nodes are visited in both upstream and downstream traversals
 */
function recalculateLevels(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  rootId: string
): void {
  const levels = new Map<string, number>()
  levels.set(rootId, 0)

  // BFS from root to assign consistent levels
  const queue = [rootId]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)

    const currentLevel = levels.get(currentId) || 0

    // Find all neighboring nodes via edges (considering graph as undirected for level calculation)
    for (const edge of edges) {
      // Check outgoing edges (downstream)
      if (edge.source === currentId && !levels.has(edge.target)) {
        levels.set(edge.target, currentLevel + 1)
        queue.push(edge.target)
      }
      // Check incoming edges (upstream)
      if (edge.target === currentId && !levels.has(edge.source)) {
        levels.set(edge.source, currentLevel + 1)
        queue.push(edge.source)
      }
    }
  }

  // Apply calculated levels to nodes
  for (const [id, level] of levels) {
    const node = nodes.get(id)
    if (node) {
      node.level = level
    }
  }
}

// ============================================================================
// Main Graph Builder
// ============================================================================

export async function buildJobGraph(options: GraphQueryOptions): Promise<JobGraph> {
  // Fetch root node first
  const rootNode = await fetchRootNode(options.rootId, options.rootType)
  if (!rootNode) {
    throw new Error(`Root node ${options.rootId} not found`)
  }

  let upstreamResult: TraversalResult = { nodes: new Map(), edges: [] }
  let downstreamResult: TraversalResult = { nodes: new Map(), edges: [] }

  // Execute traversals based on direction
  if (options.direction === 'upstream' || options.direction === 'both') {
    upstreamResult = await traverseUpstream(
      options.rootId,
      options.rootType,
      options.maxDepth
    )
  }

  if (options.direction === 'downstream' || options.direction === 'both') {
    downstreamResult = await traverseDownstream(
      options.rootId,
      options.rootType,
      options.maxDepth
    )
  }

  // Merge results
  const allNodes = new Map([...upstreamResult.nodes, ...downstreamResult.nodes])
  const allEdges = [...upstreamResult.edges, ...downstreamResult.edges]

  // Deduplicate edges by id
  const uniqueEdges = Array.from(
    new Map(allEdges.map(e => [e.id, e])).values()
  )

  // Recalculate levels for consistent graph layout (especially important for bidirectional traversal)
  if (options.direction === 'both') {
    recalculateLevels(allNodes, uniqueEdges, options.rootId)
  }

  // Convert nodes to array
  const nodes = Array.from(allNodes.values())

  // Calculate statistics
  const stats = {
    totalNodes: nodes.length,
    totalEdges: uniqueEdges.length,
    maxDepth: Math.max(...nodes.map(n => n.level), 0),
    jobDefinitionCount: nodes.filter(n => n.type === 'jobDefinition').length,
    requestCount: nodes.filter(n => n.type === 'request').length,
  }

  return {
    nodes,
    edges: uniqueEdges,
    rootNode,
    stats,
  }
}
