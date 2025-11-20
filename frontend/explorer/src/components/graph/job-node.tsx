'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { GraphNode } from '@/lib/graph-queries'

export const JobNode = memo(({ data }: NodeProps<GraphNode>) => {
  // Status badge colors matching job-definitions-table.tsx
  const getStatusColor = (status: string) => {
    const statusUpper = status.toUpperCase()
    if (statusUpper === 'COMPLETED') return 'bg-green-100 text-green-800'
    if (statusUpper === 'FAILED') return 'bg-red-100 text-red-800'
    if (statusUpper === 'DELEGATING') return 'bg-blue-100 text-blue-800'
    if (statusUpper === 'WAITING') return 'bg-purple-100 text-purple-800'
    if (statusUpper === 'PENDING') return 'bg-yellow-100 text-yellow-800'
    return 'bg-gray-100 text-gray-800'
  }

  // Border color based on status
  const getBorderColor = (status: string) => {
    const statusUpper = status.toUpperCase()
    if (statusUpper === 'COMPLETED') return 'border-green-500'
    if (statusUpper === 'FAILED') return 'border-red-500'
    if (statusUpper === 'DELEGATING') return 'border-blue-500'
    if (statusUpper === 'WAITING') return 'border-purple-500'
    if (statusUpper === 'PENDING') return 'border-yellow-500'
    return 'border-gray-400'
  }

  // Format status for display - use lastStatus if available, otherwise use status
  const displayStatus = data.metadata.lastStatus || data.status.toUpperCase()
  const statusColor = getStatusColor(displayStatus)
  const borderColor = getBorderColor(displayStatus)
  
  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${borderColor} bg-white shadow-md min-w-[220px] max-w-[280px] hover:shadow-lg transition-shadow cursor-pointer`}>
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-400" />

      <div className="space-y-2">
        {/* Job Name */}
        <div className="font-semibold text-sm truncate" title={data.label}>
          {data.label || 'Unnamed Job'}
        </div>
        
        {/* Run Count and Status */}
        <div className="flex items-center gap-2 flex-wrap">
          {data.metadata.runCount !== undefined && data.metadata.runCount > 0 && (
            <span className="text-xs text-gray-600">
              {data.metadata.runCount} {data.metadata.runCount === 1 ? 'run' : 'runs'}
            </span>
          )}
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${statusColor}`}>
            {displayStatus}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-gray-400" />
    </div>
  )
})
JobNode.displayName = 'JobNode'
