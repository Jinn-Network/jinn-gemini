'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { GraphNode } from '@/lib/graph-queries'

export const JobNode = memo(({ data }: NodeProps<GraphNode>) => {
  const statusColors: Record<string, string> = {
    completed: 'border-green-500 bg-green-50',
    active: 'border-yellow-500 bg-yellow-50',
    failed: 'border-red-500 bg-red-50',
    unknown: 'border-gray-400 bg-gray-50',
    delegating: 'border-blue-500 bg-blue-50',
    waiting: 'border-purple-500 bg-purple-50',
    pending: 'border-orange-500 bg-orange-50',
  }

  const statusDotColors: Record<string, string> = {
    completed: 'bg-green-500',
    active: 'bg-yellow-500',
    failed: 'bg-red-500',
    unknown: 'bg-gray-400',
    delegating: 'bg-blue-500',
    waiting: 'bg-purple-500',
    pending: 'bg-orange-500',
  }

  const statusHandleColors: Record<string, string> = {
    completed: 'bg-green-500',
    active: 'bg-yellow-500',
    failed: 'bg-red-500',
    unknown: 'bg-gray-400',
    delegating: 'bg-blue-500',
    waiting: 'bg-purple-500',
    pending: 'bg-orange-500',
  }

  // Format status for display
  const statusLabel = data.status.charAt(0).toUpperCase() + data.status.slice(1)
  
  return (
    <div className={`px-4 py-3 rounded-lg border-2 shadow-md min-w-[200px] max-w-[250px] hover:shadow-lg transition-shadow cursor-pointer ${statusColors[data.status] || statusColors.unknown}`}>
      <Handle type="target" position={Position.Top} className={`w-3 h-3 ${statusHandleColors[data.status] || statusHandleColors.unknown}`} />

      <div className="flex items-start gap-2">
        <div className={`flex-shrink-0 w-2 h-2 mt-1.5 rounded-full ${statusDotColors[data.status] || statusDotColors.unknown}`} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate" title={data.label}>
            {data.label || 'Job'}
          </div>
          <div className="text-xs text-gray-600 mt-1 flex items-center gap-2 flex-wrap">
            <span>{statusLabel}</span>
            {data.metadata.runCount !== undefined && data.metadata.runCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                {data.metadata.runCount} {data.metadata.runCount === 1 ? 'run' : 'runs'}
              </span>
            )}
            {data.metadata.artifactCount !== undefined && data.metadata.artifactCount > 0 && (
              <span>• {data.metadata.artifactCount} artifacts</span>
            )}
          </div>
          {data.metadata.blockTimestamp && (
            <div className="text-xs text-gray-500 mt-0.5">
              {new Date(Number(data.metadata.blockTimestamp) * 1000).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className={`w-3 h-3 ${statusHandleColors[data.status] || statusHandleColors.unknown}`} />
    </div>
  )
})
JobNode.displayName = 'JobNode'
