'use client'

import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CollectionName } from '@/lib/types'
import { RecordList } from '@/components/record-list'
import { RequestsTable } from '@/components/requests-table'
import { ArtifactsTable } from '@/components/artifacts-table'
import { JobDefinitionsTable } from '@/components/job-definitions-table'
import { AutoRefreshToggle } from '@/components/auto-refresh-toggle'
import { Pagination } from '@/components/pagination'
import { RecordListSkeleton, RequestsTableSkeleton, ArtifactsTableSkeleton, JobDefinitionsTableSkeleton } from '@/components/loading-skeleton'
import { getCollectionLabel } from '@/lib/utils'
import { useSubgraphCollection } from '@/hooks/use-subgraph-collection'
import { getRequest, Request } from '@/lib/subgraph'
import { TruncatedId } from '@/components/truncated-id'

interface CollectionViewProps {
  collectionName: CollectionName
}

// Helper function to determine the best sorting strategy for each collection
function getSortingConfig(collectionName: CollectionName): { column: string; ascending: boolean } {
  // Collection-specific sorting configurations for subgraph entities
  const sortingConfigs: Record<CollectionName, { column: string; ascending: boolean }> = {
    jobDefinitions: { column: 'lastInteraction', ascending: false },
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
  const [rootRequest, setRootRequest] = useState<Request | null>(null)
  const pageSize = 100

  // Fetch root request when filtering by workstream
  useEffect(() => {
    if (collectionName === 'requests' && workstreamFilter) {
      getRequest(workstreamFilter).then(setRootRequest).catch(console.error)
    } else {
      setRootRequest(null)
    }
  }, [collectionName, workstreamFilter])

  // Build where filter for workstream filtering - memoized to prevent infinite rerenders
  const whereFilter = useMemo(() => {
    if (collectionName === 'requests' && workstreamFilter) {
      return { workstreamId: workstreamFilter }
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
    error,
    hasNextPage,
    hasPreviousPage,
    setSorting,
    sortColumn,
    sortAscending
  } = useSubgraphCollection({
    collectionName,
    pageSize,
    enablePolling: autoRefreshEnabled,
    pollingInterval: 10000, // 10 seconds
    sortColumn: sortConfig.column,
    sortAscending: sortConfig.ascending,
    whereFilter,
  })

  const handleSort = (column: string, direction: 'asc' | 'desc') => {
    setSorting(column, direction === 'asc')
  }

  // When filtering by workstream, prepend the root request to the list
  const displayRecords = useMemo(() => {
    if (rootRequest && collectionName === 'requests' && workstreamFilter) {
      return [rootRequest, ...records]
    }
    return records
  }, [rootRequest, records, collectionName, workstreamFilter])

  if (loading) {
    const getSkeletonForCollection = () => {
      switch (collectionName) {
        case 'requests':
          return <RequestsTableSkeleton />
        case 'artifacts':
          return <ArtifactsTableSkeleton />
        case 'jobDefinitions':
          return <JobDefinitionsTableSkeleton />
        default:
          return <RecordListSkeleton />
      }
    }
    
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">{getCollectionLabel(collectionName)}</h1>
        </div>
        {getSkeletonForCollection()}
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
            <TruncatedId 
              value={workstreamFilter}
              linkTo={`/workstreams/${workstreamFilter}`}
              className="text-xs"
            />
            <button
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString())
                params.delete('workstream')
                router.push(`?${params.toString()}`)
              }}
              className="text-blue-600 hover:text-blue-800 ml-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      
      <div className="mb-4 flex items-center justify-between">
        <p className="text-gray-600">
          Showing {displayRecords.length} records (Page {currentPage})
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
        <RequestsTable records={displayRecords} />
      ) : collectionName === 'artifacts' ? (
        <ArtifactsTable records={displayRecords} />
      ) : collectionName === 'jobDefinitions' ? (
        <JobDefinitionsTable 
          records={displayRecords} 
          onSort={handleSort}
          sortColumn={sortColumn}
          sortAscending={sortAscending}
        />
      ) : (
        <RecordList records={displayRecords} collectionName={collectionName} />
      )}
      
      <Pagination
        currentPage={currentPage}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        hasNextPage={hasNextPage}
        hasPreviousPage={hasPreviousPage}
      />
    </div>
  )
}