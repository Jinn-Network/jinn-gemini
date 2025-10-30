'use client'

import { useCallback, useEffect } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Panel,
  Node,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { JobNode } from './job-node'
import { JobEdge } from './job-edge'
import { GraphControls } from './graph-controls'
import { useJobGraph } from '@/hooks/use-job-graph'
import { useRouter } from 'next/navigation'

const nodeTypes = {
  job: JobNode,
}

const edgeTypes = {
  jobEdge: JobEdge,
}

interface JobGraphViewInnerProps {
  rootId: string
}

function JobGraphViewInner({ rootId }: JobGraphViewInnerProps) {
  const router = useRouter()
  const {
    graph,
    nodes: initialNodes,
    edges: initialEdges,
    loading,
    error,
    depth,
    direction,
    layout,
    updateDepth,
    updateDirection,
    toggleLayout,
    refresh,
  } = useJobGraph({ rootId })

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  // Update nodes/edges when graph data changes
  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
    // Fit view after layout with a small delay to ensure render
    if (initialNodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50)
    }
  }, [initialNodes, initialEdges, setNodes, setEdges, fitView])

  // Navigate to detail page on node click
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    router.push(`/requests/${node.id}`)
  }, [router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[700px] border rounded-lg bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <div className="text-gray-600">Loading graph...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[700px] border rounded-lg bg-red-50">
        <div className="text-center text-red-600 p-8">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="font-semibold text-lg">Error loading graph</div>
          <div className="text-sm mt-2">{error}</div>
          <button
            onClick={refresh}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[700px] border rounded-lg bg-gray-50">
        <div className="text-center text-gray-600 p-8">
          <div className="text-4xl mb-4">🔍</div>
          <div className="font-semibold text-lg">No relationships found</div>
          <div className="text-sm mt-2">
            This job has no connected nodes.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full bg-gray-50 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'jobEdge' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={() => '#10b981'}
          className="bg-white border shadow-md"
        />

        {/* Statistics Panel */}
        <Panel position="top-left" className="bg-white p-4 rounded-lg shadow-md">
          <h3 className="font-semibold text-sm mb-2">Graph Statistics</h3>
          <div className="text-xs text-gray-600 space-y-1">
            <div className="flex justify-between gap-4">
              <span>Jobs:</span>
              <span className="font-semibold">{graph?.stats.totalNodes || 0}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Connections:</span>
              <span className="font-semibold">{graph?.stats.totalEdges || 0}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Max Depth:</span>
              <span className="font-semibold">{graph?.stats.maxDepth || 0}</span>
            </div>
          </div>
        </Panel>

        {/* Graph Controls */}
        <GraphControls
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFitView={() => fitView({ padding: 0.2, duration: 300 })}
          onToggleLayout={toggleLayout}
          layout={layout}
          currentDepth={depth}
          onDepthChange={updateDepth}
          direction={direction}
          onDirectionChange={updateDirection}
          onRefresh={refresh}
        />

        {/* SVG marker definitions for arrow heads */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }}>
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L9,3 z" fill="#666" />
            </marker>
          </defs>
        </svg>
      </ReactFlow>
    </div>
  )
}

// Wrapper component that provides ReactFlow context
export function JobGraphView(props: JobGraphViewInnerProps) {
  return (
    <ReactFlowProvider>
      <JobGraphViewInner {...props} />
    </ReactFlowProvider>
  )
}
