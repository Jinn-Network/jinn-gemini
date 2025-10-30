import React from 'react'
import Link from 'next/link'
import { SubgraphRecord } from '@/hooks/use-subgraph-collection'
import { formatDate } from '@/lib/utils'

interface RequestsTableProps {
  records: SubgraphRecord[]
}

export function RequestsTable({ records }: RequestsTableProps) {
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
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Job Name</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Job Def ID</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Request ID</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Status</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Workstream</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Mech</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Sender</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const jobName = 'jobName' in record && record.jobName 
              ? (record.jobName.length > 60 ? record.jobName.substring(0, 60) + '...' : record.jobName)
              : record.id.toString().substring(0, 16) + '...'
            
            const delivered = 'delivered' in record ? record.delivered : false
            const statusText = delivered ? 'DELIVERED' : 'PENDING'
            const statusClass = delivered 
              ? 'text-green-600 bg-green-50 border-green-200'
              : 'text-yellow-600 bg-yellow-50 border-yellow-200'
            
            // Get workstream ID (sourceRequestId for child jobs, or id for root jobs)
            const workstreamId = 'sourceRequestId' in record && record.sourceRequestId 
              ? record.sourceRequestId 
              : record.id
            
            const mech = 'mech' in record && record.mech 
              ? record.mech.slice(0, 10) + '...' 
              : '-'
            
            const sender = 'sender' in record && record.sender 
              ? record.sender.slice(0, 10) + '...' 
              : '-'
            
            const timestamp = 'blockTimestamp' in record && record.blockTimestamp 
              ? formatDate(record.blockTimestamp) 
              : '-'

            const jobDefId = 'jobDefinitionId' in record && record.jobDefinitionId
              ? record.jobDefinitionId.toString().substring(0, 12) + '...'
              : '-'

            const requestId = record.id.toString().substring(0, 12) + '...'

            return (
              <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <Link 
                    href={`/requests/${record.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {jobName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {'jobDefinitionId' in record && record.jobDefinitionId ? (
                    <Link
                      href={`/jobDefinitions/${record.jobDefinitionId}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono"
                    >
                      {jobDefId}
                    </Link>
                  ) : (
                    <span className="text-gray-400 text-sm">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-gray-600 font-mono">{requestId}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs border ${statusClass}`}>
                    {statusText}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/workstreams/${workstreamId}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono"
                  >
                    {workstreamId.toString().substring(0, 12)}...
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                  {mech}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                  {sender}
                </td>
                <td className="px-4 py-3 text-right text-sm text-gray-600">
                  {timestamp}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

