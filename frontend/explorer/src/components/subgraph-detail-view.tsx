'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SubgraphRecord } from '@/hooks/use-subgraph-collection'
import { CollectionName } from '@/lib/types'
import { IdLink } from '@/components/id-link'

interface SubgraphDetailViewProps {
  record: SubgraphRecord
  collectionName: CollectionName
}

function formatBlockTimestamp(timestamp: string): string {
  try {
    // Convert from seconds to milliseconds
    const date = new Date(Number(timestamp) * 1000)
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    })
  } catch {
    return timestamp
  }
}

function ValueDisplay({ value, fieldName }: { value: unknown; fieldName: string }) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 italic">null</span>
  }

  if (typeof value === 'boolean') {
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${
        value 
          ? 'text-green-600 bg-green-50 border border-green-200' 
          : 'text-red-600 bg-red-50 border border-red-200'
      }`}>
        {value ? '✓ true' : '✗ false'}
      </span>
    )
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return (
      <span className="font-mono text-sm">
        {value.toLocaleString()}
      </span>
    )
  }

  if (typeof value === 'string') {
    // Handle block timestamps
    if (fieldName === 'blockTimestamp') {
      return (
        <div className="space-y-1">
          <div className="text-sm">{formatBlockTimestamp(value)}</div>
          <div className="text-xs text-gray-500 font-mono">Raw: {value}</div>
        </div>
      )
    }

    // Handle Ethereum addresses
    if ((fieldName === 'mech' || fieldName === 'sender' || fieldName === 'mechServiceMultisig') && value.startsWith('0x')) {
      return (
        <div className="font-mono text-sm break-all text-gray-700">
          {value}
        </div>
      )
    }

    // Handle transaction hashes
    if (fieldName === 'transactionHash' && value.startsWith('0x')) {
      return (
        <div className="font-mono text-sm break-all text-gray-700">
          {value}
        </div>
      )
    }

    // Handle IPFS hashes
    if (fieldName === 'ipfsHash' || fieldName === 'deliveryIpfsHash') {
      return (
        <div className="space-y-1">
          <div className="font-mono text-sm break-all text-gray-700">{value}</div>
          {value && (
            <a 
              href={`https://gateway.autonolas.tech/ipfs/${value}`}
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline text-xs"
            >
              View on IPFS Gateway
            </a>
          )}
        </div>
      )
    }

    // Handle CIDs for artifacts
    if (fieldName === 'cid') {
      return (
        <div className="space-y-1">
          <div className="font-mono text-sm break-all text-gray-700">{value}</div>
          <a 
            href={`https://gateway.autonolas.tech/ipfs/${value}`}
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline text-xs"
          >
            View on IPFS Gateway
          </a>
        </div>
      )
    }

    // Handle foreign key relationships
    if (fieldName === 'requestId' || fieldName === 'sourceRequestId') {
      return <IdLink id={value} collection="requests" showFullId={true} />
    }
    if (fieldName === 'jobDefinitionId' || fieldName === 'sourceJobDefinitionId') {
      return <IdLink id={value} collection="jobDefinitions" showFullId={true} />
    }
    if (fieldName === 'to') {
      // 'to' field in messages points to a job definition
      return <IdLink id={value} collection="jobDefinitions" showFullId={true} />
    }

    // For long strings, show in a scrollable area
    if (value.length > 200) {
      const wordCount = value.split(/\s+/).length
      return (
        <div className="space-y-2">
          <div className="text-xs text-gray-500">
            {value.length} characters, ~{wordCount} words
          </div>
          <div className="max-h-32 overflow-auto bg-muted p-3 rounded border text-sm">
            {value}
          </div>
        </div>
      )
    }

    return <span className="break-words text-sm">{value}</span>
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-gray-400 italic text-sm">Empty array</span>
    }

    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Array ({value.length} items)</div>
        <div className="bg-muted rounded border overflow-hidden">
          <div className="max-h-64 overflow-auto p-3">
            <ul className="space-y-1">
              {value.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <span className="text-gray-400 font-mono text-xs mt-0.5">{index + 1}.</span>
                  <span className="flex-1">{String(item)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    )
  }

  // Handle objects (like additionalContext)
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return <span className="text-gray-400 italic text-sm">Empty object</span>
    }

    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Object ({entries.length} properties)</div>
        <div className="bg-muted rounded border overflow-hidden">
          <div className="max-h-64 overflow-auto p-3">
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {JSON.stringify(value, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  return <span className="font-mono text-sm">{String(value)}</span>
}

export function SubgraphDetailView({ record, collectionName }: SubgraphDetailViewProps) {
  // Get all fields from the record
  const fields = Object.entries(record).sort(([keyA], [keyB]) => {
    // Sort id first, then name if it exists, then rest alphabetically
    if (keyA === 'id') return -1
    if (keyB === 'id') return 1
    if (keyA === 'name') return -1
    if (keyB === 'name') return 1
    return keyA.localeCompare(keyB)
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{collectionName.slice(0, -1)} Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {fields.map(([key, value]) => (
            <div key={key} className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="lg:col-span-1">
                  <span className="text-sm font-medium text-gray-900">{key}</span>
                </div>
                <div className="lg:col-span-3">
                  <ValueDisplay value={value} fieldName={key} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}