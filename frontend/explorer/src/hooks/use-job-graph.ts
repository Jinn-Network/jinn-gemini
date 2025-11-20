'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { buildJobGraph, JobGraph, GraphQueryOptions, consolidateByJobDefinition } from '@/lib/graph-queries'
import { Node, Edge } from 'reactflow'
import { layoutGraph } from '@/lib/graph-layout'
import { toast } from 'sonner'

interface UseJobGraphOptions {
  rootId: string
  rootType?: 'jobDefinition' | 'request'
  initialDepth?: number
  initialDirection?: 'upstream' | 'downstream' | 'both'
  groupByDefinition?: boolean
}

export function useJobGraph({
  rootId,
  rootType = 'request',
  initialDepth = 3,
  initialDirection = 'both',
  groupByDefinition = false,
}: UseJobGraphOptions) {
  const [graph, setGraph] = useState<JobGraph | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [depth, setDepth] = useState(initialDepth)
  const [direction, setDirection] = useState(initialDirection)
  const [layout, setLayout] = useState<'TB' | 'LR'>('LR')
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const graphRef = useRef<JobGraph | null>(null)

  // Update ref whenever graph changes
  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  const fetchGraph = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }

    try {
      const options: GraphQueryOptions = {
        rootId,
        rootType,
        maxDepth: depth,
        direction,
      }

      const graphData = await buildJobGraph(options)
      
      // Note: groupByDefinition is currently not fully implemented
      // The graph shows request nodes which represent job executions
      // TODO: Implement proper job definition consolidation
      
      // Only update if data actually changed (compare structure)
      const currentGraph = graphRef.current
      const hasChanges = !currentGraph || 
        currentGraph.nodes.length !== graphData.nodes.length ||
        currentGraph.edges.length !== graphData.edges.length ||
        JSON.stringify(currentGraph.nodes) !== JSON.stringify(graphData.nodes)
      
      if (!hasChanges && silent) {
        // No changes detected during silent polling, skip update
        return
      }

      setGraph(graphData)

      // Layout the graph
      const { nodes: layoutedNodes, edges: layoutedEdges } = layoutGraph(
        graphData.nodes,
        graphData.edges,
        {
          direction: layout,
          nodeWidth: 250,
          nodeHeight: 80,
          horizontalSpacing: 100,
          verticalSpacing: 80,
        }
      )

      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load graph'
      if (!silent) {
        setError(message)
        toast.error(message)
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [rootId, rootType, depth, direction, layout, groupByDefinition])

  useEffect(() => {
    fetchGraph()
  }, [fetchGraph])

  // Set up polling for real-time updates
  useEffect(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }
    
    pollingIntervalRef.current = setInterval(() => {
      fetchGraph(true) // Silent poll
    }, 10000) // Poll every 10 seconds
    
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [fetchGraph])

  const updateDepth = useCallback((newDepth: number) => {
    setDepth(newDepth)
  }, [])

  const updateDirection = useCallback((newDirection: typeof direction) => {
    setDirection(newDirection)
  }, [])

  const toggleLayout = useCallback(() => {
    setLayout(prev => prev === 'TB' ? 'LR' : 'TB')
  }, [])

  const refresh = useCallback(() => {
    fetchGraph()
  }, [fetchGraph])

  return {
    graph,
    nodes,
    edges,
    loading,
    error,
    depth,
    direction,
    layout,
    updateDepth,
    updateDirection,
    toggleLayout,
    refresh,
  }
}
