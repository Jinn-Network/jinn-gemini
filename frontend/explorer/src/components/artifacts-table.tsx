import React from 'react'
import Link from 'next/link'
import { SubgraphRecord } from '@/hooks/use-subgraph-collection'
import { formatDate } from '@/lib/utils'

interface ArtifactsTableProps {
  records: SubgraphRecord[]
}

export function ArtifactsTable({ records }: ArtifactsTableProps) {
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
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Preview</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Timestamp</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">CID</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Topic</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Request</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const name = 'name' in record && record.name
              ? (record.name.length > 40 ? record.name.substring(0, 40) + '...' : record.name)
              : 'Unnamed'
            
            const preview = 'contentPreview' in record && record.contentPreview 
              ? (record.contentPreview.length > 60 ? record.contentPreview.substring(0, 60) + '...' : record.contentPreview)
              : '-'
            
            const timestamp = 'blockTimestamp' in record && record.blockTimestamp 
              ? formatDate(record.blockTimestamp) 
              : '-'
            
            const cid = 'cid' in record && record.cid 
              ? record.cid 
              : '-'
            
            const topic = 'topic' in record && record.topic 
              ? record.topic 
              : '-'
            
            const requestId = 'requestId' in record && record.requestId 
              ? record.requestId 
              : '-'

            return (
              <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <Link 
                    href={`/artifacts/${record.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {preview}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {timestamp}
                </td>
                <td className="px-4 py-3">
                  {cid !== '-' ? (
                    <a
                      href={`https://gateway.autonolas.tech/ipfs/${cid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono"
                    >
                      {cid.slice(0, 12)}...
                    </a>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {topic}
                </td>
                <td className="px-4 py-3">
                  {requestId !== '-' ? (
                    <Link
                      href={`/requests/${requestId}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-mono"
                    >
                      {requestId.toString().substring(0, 12)}...
                    </Link>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

