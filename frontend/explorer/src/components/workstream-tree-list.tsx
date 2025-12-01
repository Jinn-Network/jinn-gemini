'use client'

import { useJobGraph } from '@/hooks/use-job-graph'
import { useRealtimeData } from '@/hooks/use-realtime-data'
import Link from 'next/link'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronRight, ChevronDown, X, ExternalLink, Clock } from 'lucide-react'
import { GraphNode, GraphEdge } from '@/lib/graph-queries'
import { StatusIcon, JobStatus } from '@/components/status-icon'
import { getJobDefinition, type JobDefinition, queryRequests } from '@/lib/subgraph'
import { JobDefinitionDetailLayout } from '@/components/job-definition-detail-layout'
import { Button } from '@/components/ui/button'

interface WorkstreamTreeListProps {
  rootId: string
}

interface TreeNode {
  node: GraphNode
  children: TreeNode[]
}

// Check if a job's dependencies are met (all dependency jobs have delivered requests)
function checkJobDependenciesMet(node: GraphNode, allNodes: GraphNode[]): boolean {
  // Extract dependencies from metadata
  const dependencies = node.metadata.dependencies as string[] | undefined
  
  // If no dependencies, job is ready
  if (!dependencies || dependencies.length === 0) {
    return true
  }
  
  // Check each dependency - it can be a job name or UUID
  for (const depIdentifier of dependencies) {
    // Find the dependency node by ID or name
    const depNode = allNodes.find(n => 
      n.id === depIdentifier || 
      n.label === depIdentifier ||
      n.metadata.name === depIdentifier
    )
    
    // If dependency not found or not delivered, dependencies not met
    if (!depNode || !depNode.metadata.delivered) {
      return false
    }
  }
  
  return true
}

// Build a tree structure from flat nodes and edges
function buildTree(nodes: GraphNode[], edges: GraphEdge[], rootNode: GraphNode): TreeNode {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const childrenMap = new Map<string, string[]>()
  
  // Build adjacency list
  for (const edge of edges) {
    if (!childrenMap.has(edge.source)) {
      childrenMap.set(edge.source, [])
    }
    childrenMap.get(edge.source)!.push(edge.target)
  }
  
  // Recursive function to build tree
  function buildNode(nodeId: string, visited: Set<string> = new Set()): TreeNode | null {
    if (visited.has(nodeId)) return null // Prevent cycles
    visited.add(nodeId)
    
    const node = nodeMap.get(nodeId)
    if (!node) return null
    
    const childIds = childrenMap.get(nodeId) || []
    const children: TreeNode[] = childIds
      .map(childId => buildNode(childId, new Set(visited)))
      .filter((child): child is TreeNode => child !== null)
    
    return { node, children }
  }
  
  return buildNode(rootNode.id) || { node: rootNode, children: [] }
}

// Get status color classes matching job-definitions-table.tsx
function getStatusColor(status: string): string {
  const statusUpper = status.toUpperCase()
  if (statusUpper === 'COMPLETED') return 'bg-green-100 text-green-800'
  if (statusUpper === 'FAILED') return 'bg-red-100 text-red-800'
  if (statusUpper === 'DELEGATING') return 'bg-blue-100 text-blue-800'
  if (statusUpper === 'WAITING') return 'bg-purple-100 text-purple-800'
  if (statusUpper === 'PENDING') return 'bg-yellow-100 text-yellow-800'
  return 'bg-gray-100 text-gray-800'
}

// Recursive component to render tree nodes
function TreeNodeItem({ 
  treeNode, 
  depth = 0, 
  onSelectJob,
  allNodes,
  nextJobId
}: { 
  treeNode: TreeNode; 
  depth?: number;
  onSelectJob: (jobId: string) => void;
  allNodes: GraphNode[];
  nextJobId: string | null;
}) {
  const { node, children } = treeNode
  const [isCollapsed, setIsCollapsed] = useState(false)
  const hasChildren = children.length > 0
  
  const displayStatus = node.metadata.lastStatus || node.status.toUpperCase()
  const statusColor = getStatusColor(displayStatus)
  
  // Check if this is the next job in queue
  const isNextInQueue = node.id === nextJobId
  
  return (
    <div>
      <div 
        className={`py-2 px-3 rounded transition-colors cursor-pointer ${
          isNextInQueue 
            ? 'bg-blue-50 border-l-4 border-blue-500 hover:bg-blue-100' 
            : 'hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
        onClick={() => onSelectJob(node.id)}
      >
        <div className="flex items-start gap-2">
          {/* Collapse/Expand Button */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsCollapsed(!isCollapsed)
              }}
              className="mt-0.5 p-0.5 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
          ) : (
            <div className="w-5 flex-shrink-0" />
          )}
          
          {/* Job Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-medium text-sm hover:text-blue-600 block truncate">
                {node.label || 'Unnamed Job'}
              </div>
              {/* Next in Queue Indicator */}
              {isNextInQueue && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                  <Clock className="w-3 h-3" />
                  Next
                </span>
              )}
            </div>
            
            {/* Status Badge and Run Count */}
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${statusColor}`}>
                <StatusIcon status={displayStatus} size={14} />
                {displayStatus}
              </span>
              {node.metadata.runCount !== undefined && node.metadata.runCount > 0 && (
                <span className="text-sm text-gray-500">
                  {node.metadata.runCount} {node.metadata.runCount === 1 ? 'run' : 'runs'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Children */}
      {hasChildren && !isCollapsed && (
        <div>
          {children.map((child) => (
            <TreeNodeItem 
              key={child.node.id} 
              treeNode={child} 
              depth={depth + 1}
              onSelectJob={onSelectJob}
              allNodes={allNodes}
              nextJobId={nextJobId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function WorkstreamTreeList({ rootId }: WorkstreamTreeListProps) {
  const { graph, loading, error } = useJobGraph({
    rootId,
    rootType: 'request',
    groupByDefinition: true,
  })
  
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<JobDefinition | null>(null)
  const [loadingJob, setLoadingJob] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)

  // Fetch job definition when a job is selected
  const fetchJob = useCallback(async (jobId: string) => {
    setLoadingJob(true)
    setJobError(null)
    try {
      const job = await getJobDefinition(jobId)
      if (job) {
        setSelectedJob(job as JobDefinition)
      } else {
        setJobError('Job definition not found')
      }
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Failed to load job')
    } finally {
      setLoadingJob(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null)
      return
    }
    fetchJob(selectedJobId)
  }, [selectedJobId, fetchJob])

  // Subscribe to realtime updates for job definitions
  useRealtimeData('jobDefinitions', {
    enabled: !!selectedJobId,
    onEvent: () => {
      if (selectedJobId) {
        console.log('[WorkstreamTreeList] Refetching job definition due to SSE update')
        fetchJob(selectedJobId)
      }
    }
  })

  // State to hold the next job's definition ID
  const [nextJobDefinitionId, setNextJobDefinitionId] = useState<string | null>(null)

  // Calculate which job is next in queue by querying requests directly
  // This matches the worker's logic: oldest undelivered request with met dependencies
  useEffect(() => {
    if (!graph || !graph.rootNode) return

    const findNextJob = async () => {
      try {
        // Query undelivered requests in this workstream, ordered by blockTimestamp (oldest first)
        const requestsResponse = await queryRequests({
          where: {
            workstreamId: rootId,
            delivered: false
          },
          orderBy: 'blockTimestamp',
          orderDirection: 'asc',
          limit: 50
        })

        const requests = requestsResponse.items
        
        // Check dependencies for each request to find the first ready one
        for (const request of requests) {
          // If no dependencies, this job is ready
          if (!request.dependencies || request.dependencies.length === 0) {
            setNextJobDefinitionId(request.jobDefinitionId || null)
            return
          }

          // Check if all dependencies are met (have delivered requests)
          const depChecks = await Promise.all(
            request.dependencies.map(async (depIdentifier) => {
              // Try to find if this dependency has any delivered requests
              const depRequests = await queryRequests({
                where: {
                  workstreamId: rootId,
                  // Try matching by jobDefinitionId or jobName
                  OR: [
                    { jobDefinitionId: depIdentifier },
                    { jobName: depIdentifier }
                  ],
                  delivered: true
                },
                limit: 1
              })
              return depRequests.items.length > 0
            })
          )

          // If all dependencies are met, this is the next job
          if (depChecks.every(met => met)) {
            setNextJobDefinitionId(request.jobDefinitionId || null)
            return
          }
        }

        // No ready jobs found
        setNextJobDefinitionId(null)
      } catch (error) {
        console.error('Error finding next job:', error)
        setNextJobDefinitionId(null)
      }
    }

    findNextJob()
  }, [graph, rootId])

  const handleSelectJob = (jobId: string) => {
    setSelectedJobId(jobId)
  }

  const handleClosePanel = () => {
    setSelectedJobId(null)
    setSelectedJob(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <div className="text-sm text-gray-600">Loading jobs...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-600 text-sm">{error}</div>
      </div>
    )
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No jobs found
      </div>
    )
  }

  const tree = buildTree(graph.nodes, graph.edges, graph.rootNode)

  return (
    <div className={`grid gap-0 transition-all duration-300 ${selectedJobId ? 'grid-cols-5' : 'grid-cols-1'}`}>
      {/* Tree List */}
      <div 
        className={`force-scrollbar divide-y divide-gray-100 max-h-[800px] ${selectedJobId ? 'col-span-2' : 'col-span-5'}`}
        style={{ 
          overflowY: 'scroll',
          paddingLeft: '1.5rem',
          paddingRight: selectedJobId ? '1.5rem' : '1.5rem',
          paddingTop: '1rem',
          paddingBottom: '1rem'
        }}
      >
        <TreeNodeItem 
          treeNode={tree} 
          depth={0} 
          onSelectJob={handleSelectJob} 
          allNodes={graph.nodes}
          nextJobId={nextJobDefinitionId}
        />
      </div>

      {/* Detail Panel */}
      {selectedJobId && (
        <div 
          className="force-scrollbar col-span-3 border-l max-h-[800px]"
          style={{ overflowY: 'scroll' }}
        >
          {/* Panel Header */}
          <div className="flex items-center justify-between px-6 py-3 sticky top-0 bg-white border-b z-10">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-lg">{selectedJob?.name || 'Job Details'}</h3>
              <Link
                href={`/jobDefinitions/${selectedJobId}`}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                View Full <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClosePanel}
              className="h-8 w-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Panel Content */}
          <div className="px-6 py-4">
            {loadingJob ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                  <div className="text-sm text-gray-600">Loading job details...</div>
                </div>
              </div>
            ) : jobError ? (
              <div className="text-center py-12">
                <div className="text-red-600 text-sm">{jobError}</div>
              </div>
            ) : selectedJob ? (
              <JobDefinitionDetailLayout record={selectedJob} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

