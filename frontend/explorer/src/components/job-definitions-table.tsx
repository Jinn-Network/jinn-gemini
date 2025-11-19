import React, { useState } from 'react'
import Link from 'next/link'
import { SubgraphRecord } from '@/hooks/use-subgraph-collection'
import { formatDate } from '@/lib/utils'

interface JobDefinitionsTableProps {
  records: SubgraphRecord[]
  onSort?: (column: string, direction: 'asc' | 'desc') => void
}

export function JobDefinitionsTable({ records, onSort }: JobDefinitionsTableProps) {
  const [sortColumn, setSortColumn] = useState<string>('lastInteraction')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const handleSort = (column: string) => {
    const newDirection = sortColumn === column && sortDirection === 'desc' ? 'asc' : 'desc'
    setSortColumn(column)
    setSortDirection(newDirection)
    if (onSort) {
      onSort(column, newDirection)
    }
  }

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) {
      return <span className="text-gray-400 ml-1">↕</span>
    }
    return <span className="ml-1">{sortDirection === 'desc' ? '↓' : '↑'}</span>
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
              className="text-left px-4 py-3 text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none w-[25%]"
              onClick={() => handleSort('lastInteraction')}
            >
              <span className="flex items-center">
                Last Activity
                <SortIcon column="lastInteraction" />
              </span>
            </th>
            <th 
              className="text-left px-4 py-3 text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none w-[15%]"
              onClick={() => handleSort('lastStatus')}
            >
              <span className="flex items-center">
                Status
                <SortIcon column="lastStatus" />
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
            
            const statusColor = lastStatus === 'COMPLETED' 
              ? 'bg-green-100 text-green-800' 
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
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${statusColor}`}>
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

