'use client'

import { useState } from 'react'
import { CollectionName } from '@/lib/types'
import { RecordList } from '@/components/record-list'
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
    artifacts: { column: 'requestId', ascending: false },
  }
  
  return sortingConfigs[collectionName] || { column: 'id', ascending: false }
}



export function CollectionView({ collectionName }: CollectionViewProps) {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false)
  const pageSize = 100

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
      
      <RecordList records={records} collectionName={collectionName} />
      
      <Pagination
        currentPage={currentPage}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
      />
    </div>
  )
}