'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { GraphNode } from '@/lib/graph-queries'

export const JobNode = memo(({ data }: NodeProps<GraphNode>) => {
  const statusColors = {
    completed: 'border-green-500 bg-green-50',
    active: 'border-yellow-500 bg-yellow-50',
    failed: 'border-red-500 bg-red-50',
    unknown: 'border-gray-400 bg-gray-50',
  }

  const statusDotColors = {
    completed: 'bg-green-500',
    active: 'bg-yellow-500',
    failed: 'bg-red-500',
    unknown: 'bg-gray-400',
  }

  const statusHandleColors = {
    completed: 'bg-green-500',
    active: 'bg-yellow-500',
    failed: 'bg-red-500',
    unknown: 'bg-gray-400',
  }

  return (
    <div className={`px-4 py-3 rounded-lg border-2 shadow-md min-w-[200px] max-w-[250px] hover:shadow-lg transition-shadow cursor-pointer ${statusColors[data.status]}`}>
      <Handle type="target" position={Position.Top} className={`w-3 h-3 ${statusHandleColors[data.status]}`} />

      <div className="flex items-start gap-2">
        <div className={`flex-shrink-0 w-2 h-2 mt-1.5 rounded-full ${statusDotColors[data.status]}`} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate" title={data.label}>
            {data.label || 'Job'}
          </div>
          <div className="text-xs text-gray-600 mt-1 flex items-center gap-2">
            <span>{data.status === 'completed' ? '✓ Delivered' : '⏳ Pending'}</span>
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

      <Handle type="source" position={Position.Bottom} className={`w-3 h-3 ${statusHandleColors[data.status]}`} />
    </div>
  )
})
JobNode.displayName = 'JobNode'
