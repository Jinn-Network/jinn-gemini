'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowUpDown, ArrowDown, ArrowUp } from 'lucide-react'
import { SubgraphRecord } from '@/hooks/use-subgraph-collection'
import { formatDate } from '@/lib/utils'
import { StatusIcon } from '@/components/status-icon'

interface JobDefinitionsTableProps {
  records: SubgraphRecord[]
  onSort?: (column: string, direction: 'asc' | 'desc') => void
  sortColumn?: string
  sortAscending?: boolean
}

export function JobDefinitionsTable({ records, onSort, sortColumn = '', sortAscending = false }: JobDefinitionsTableProps) {
  const handleSort = (column: string) => {
    // Toggle direction if clicking the same column, otherwise default to descending
    const newDirection = sortColumn === column && !sortAscending ? 'asc' : 'desc'
    if (onSort) {
      onSort(column, newDirection)
    }
  }

  const SortIcon = ({ column }: { column: string }) => {
    if (!onSort || sortColumn !== column) {
      return <ArrowUpDown className="w-4 h-4 text-gray-400 ml-1" />
    }
    return sortAscending 
      ? <ArrowUp className="w-4 h-4 ml-1" />
      : <ArrowDown className="w-4 h-4 ml-1" />
  }
  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No records found
      </div>
    )
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse table-fixed">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700 w-[40%]">Name</th>
            <th 
              className={`text-left px-4 py-3 text-sm font-semibold text-gray-700 w-[25%] ${onSort ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`}
              onClick={onSort ? () => handleSort('lastInteraction') : undefined}
            >
              <span className="flex items-center">
                Last Activity
                {onSort && <SortIcon column="lastInteraction" />}
              </span>
            </th>
            <th 
              className={`text-left px-4 py-3 text-sm font-semibold text-gray-700 w-[15%] ${onSort ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`}
              onClick={onSort ? () => handleSort('lastStatus') : undefined}
            >
              <span className="flex items-center">
                Status
                {onSort && <SortIcon column="lastStatus" />}
              </span>
            </th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700 w-[20%]">ID</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const fullName = 'name' in record && record.name && typeof record.name === 'string'
              ? record.name
              : 'Unnamed'
            
            const displayName = fullName.length > 60 ? fullName.substring(0, 60) + '...' : fullName
            
            const lastInteraction = 'lastInteraction' in record && record.lastInteraction
              ? formatDate(record.lastInteraction)
              : '-'
            
            const lastStatus = 'lastStatus' in record && record.lastStatus && typeof record.lastStatus === 'string'
              ? record.lastStatus
              : 'UNKNOWN'
            
            // Status color mapping based on protocol model states
            const statusColor = lastStatus === 'COMPLETED'
              ? 'bg-green-100 text-green-800'
              : lastStatus === 'FAILED'
              ? 'bg-red-100 text-red-800'
              : lastStatus === 'DELEGATING'
              ? 'bg-blue-100 text-blue-800'
              : lastStatus === 'WAITING'
              ? 'bg-purple-100 text-purple-800'
              : lastStatus === 'PENDING'
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-gray-100 text-gray-800'
            
            const fullId = record.id.toString()
            const displayId = fullId.length > 16 ? fullId.substring(0, 16) + '...' : fullId

            return (
              <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 truncate" title={fullName}>
                  <Link 
                    href={`/jobDefinitions/${record.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {displayName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {lastInteraction}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${statusColor}`}>
                    <StatusIcon status={lastStatus} size={14} />
                    {lastStatus}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono truncate" title={fullId}>
                  {displayId}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

