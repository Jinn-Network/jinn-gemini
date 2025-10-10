'use client'

import { useState, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CollectionName } from '@/lib/types'
import { RecordList } from '@/components/record-list'
import { RequestsTable } from '@/components/requests-table'
import { AutoRefreshToggle } from '@/components/auto-refresh-toggle'
import { Pagination } from '@/components/pagination'
import { RecordListSkeleton } from '@/components/loading-skeleton'
import { getCollectionLabel } from '@/lib/utils'
import { useSubgraphCollection } from '@/hooks/use-subgraph-collection'

interface CollectionViewProps {
  collectionName: CollectionName
}

// Helper function to determine the best sorting strategy for each collection
function getSortingConfig(collectionName: CollectionName): { column: string; ascending: boolean } {
  // Collection-specific sorting configurations for subgraph entities
  const sortingConfigs: Record<CollectionName, { column: string; ascending: boolean }> = {
    jobDefinitions: { column: 'name', ascending: true },
    requests: { column: 'blockTimestamp', ascending: false },
    deliveries: { column: 'blockTimestamp', ascending: false },
    artifacts: { column: 'blockTimestamp', ascending: false },
    messages: { column: 'blockTimestamp', ascending: false },
  }
  
  return sortingConfigs[collectionName] || { column: 'id', ascending: false }
}



export function CollectionView({ collectionName }: CollectionViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  // Initialize from URL search params
  // Auto-refresh is enabled by default for requests
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(collectionName === 'requests')
  const workstreamFilter = searchParams.get('workstream')
  const pageSize = 100

  // Build where filter for workstream filtering - memoized to prevent infinite rerenders
  const whereFilter = useMemo(() => {
    if (collectionName === 'requests' && workstreamFilter) {
      return { sourceRequestId: workstreamFilter }
    }
    return undefined
  }, [collectionName, workstreamFilter])

  // Use the subgraph collection hook
  const sortConfig = getSortingConfig(collectionName)
  const {
    records,
    loading,
    totalRecords,
    currentPage,
    lastUpdate,
    setCurrentPage,
    refresh,
    error
  } = useSubgraphCollection({
    collectionName,
    pageSize,
    enablePolling: autoRefreshEnabled,
    pollingInterval: 10000, // 10 seconds
    sortColumn: sortConfig.column,
    sortAscending: sortConfig.ascending,
    whereFilter,
  })

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">{getCollectionLabel(collectionName)}</h1>
        </div>
        <RecordListSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">
          {getCollectionLabel(collectionName)}
        </h1>
        <div className="text-red-500 p-4 border border-red-200 rounded bg-red-50">
          Error loading {collectionName}: {error}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">
        {getCollectionLabel(collectionName)}
      </h1>
      
      {/* Workstream filter badge */}
      {workstreamFilter && (
        <div className="mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-md text-sm">
            <span className="text-blue-700">
              Filtered by workstream
            </span>
            <a
              href={`/workstreams/${workstreamFilter}`}
              className="text-blue-600 hover:text-blue-800 underline font-mono text-xs"
            >
              {workstreamFilter.substring(0, 16)}...
            </a>
            <button
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString())
                params.delete('workstream')
                router.push(`?${params.toString()}`)
              }}
              className="text-blue-600 hover:text-blue-800 ml-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      
      <div className="mb-4 flex items-center justify-between">
        <p className="text-gray-600">
          Showing {records.length} records (Page {currentPage})
        </p>
        
        <div className="flex items-center gap-4">
          <AutoRefreshToggle
            enabled={autoRefreshEnabled}
            onToggle={setAutoRefreshEnabled}
            interval={10000}
            lastUpdate={lastUpdate}
          />
          <button
            onClick={refresh}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Refresh
          </button>
        </div>
      </div>
      
      {collectionName === 'requests' ? (
        <RequestsTable records={records} />
      ) : (
        <RecordList records={records} collectionName={collectionName} />
      )}
      
      <Pagination
        currentPage={currentPage}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
      />
    </div>
  )
}