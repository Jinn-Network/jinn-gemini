import React from 'react'
import Link from 'next/link'
import { SubgraphRecord } from '@/hooks/use-subgraph-collection'
import { formatDate } from '@/lib/utils'

interface JobDefinitionsTableProps {
  records: SubgraphRecord[]
}

export function JobDefinitionsTable({ records }: JobDefinitionsTableProps) {
  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No records found
      </div>
    )
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Name</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Last Activity</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Status</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Enabled Tools</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">ID</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const name = 'name' in record && record.name && typeof record.name === 'string'
              ? (record.name.length > 50 ? record.name.substring(0, 50) + '...' : record.name)
              : 'Unnamed'
            
            const lastInteraction = 'lastInteraction' in record && record.lastInteraction
              ? formatDate(Number(record.lastInteraction) * 1000)
              : '-'
            
            const lastStatus = 'lastStatus' in record && record.lastStatus && typeof record.lastStatus === 'string'
              ? record.lastStatus
              : 'UNKNOWN'
            
            const statusColor = lastStatus === 'COMPLETED' 
              ? 'bg-green-100 text-green-800' 
              : lastStatus === 'PENDING' 
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-gray-100 text-gray-800'
            
            const enabledTools = 'enabledTools' in record && Array.isArray(record.enabledTools)
              ? record.enabledTools.length > 0 
                ? record.enabledTools.join(', ').substring(0, 50) + (record.enabledTools.join(', ').length > 50 ? '...' : '')
                : '-'
              : '-'

            return (
              <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <Link 
                    href={`/jobDefinitions/${record.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {lastInteraction}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
                    {lastStatus}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {enabledTools}
                </td>
                <td className="px-4 py-3 text-right text-sm text-gray-600 font-mono">
                  {record.id.toString().substring(0, 12)}...
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

