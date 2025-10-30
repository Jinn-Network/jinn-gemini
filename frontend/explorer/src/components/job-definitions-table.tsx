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
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Description</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Created</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Source Job</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">ID</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const name = 'name' in record && record.name && typeof record.name === 'string'
              ? (record.name.length > 50 ? record.name.substring(0, 50) + '...' : record.name)
              : 'Unnamed'
            
            const description = 'description' in record && record.description && typeof record.description === 'string'
              ? (record.description.length > 80 ? record.description.substring(0, 80) + '...' : record.description)
              : '-'
            
            const timestamp = 'blockTimestamp' in record && record.blockTimestamp 
              ? formatDate(record.blockTimestamp) 
              : '-'
            
            const sourceJobDefinitionId = 'sourceJobDefinitionId' in record && record.sourceJobDefinitionId 
              ? record.sourceJobDefinitionId 
              : null

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
                  {description}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {timestamp}
                </td>
                <td className="px-4 py-3">
                  {sourceJobDefinitionId ? (
                    <Link
                      href={`/jobDefinitions/${sourceJobDefinitionId}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono"
                    >
                      {sourceJobDefinitionId.toString().substring(0, 12)}...
                    </Link>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
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

