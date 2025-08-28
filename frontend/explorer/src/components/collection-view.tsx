'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { DbRecord, CollectionName } from '@/lib/types'
import { RecordList } from '@/components/record-list'
import { SystemStateView } from '@/components/system-state-view'
import { RealtimeJobBoard } from '@/components/realtime-job-board'
import { AutoRefreshToggle } from '@/components/auto-refresh-toggle'
import { Pagination } from '@/components/pagination'
import { RecordListSkeleton } from '@/components/loading-skeleton'
import { getCollectionLabel } from '@/lib/utils'
import { useRealtimeCollection } from '@/hooks/use-realtime-collection'
import { toast } from 'sonner'

interface CollectionViewProps {
  collectionName: CollectionName
}

// Helper function to determine the best sorting strategy for each collection
function getSortingConfig(collectionName: CollectionName): { column: string; ascending: boolean } {
  // Default to created_at descending (newest first) for most collections
  const defaultSort = { column: 'created_at', ascending: false }
  
  // Collection-specific sorting configurations
  const sortingConfigs: Record<CollectionName, { column: string; ascending: boolean }> = {
    job_board: { column: 'created_at', ascending: false },
    jobs: { column: 'created_at', ascending: false },
    job_reports: { column: 'created_at', ascending: false },
    events: { column: 'created_at', ascending: false },
    artifacts: { column: 'created_at', ascending: false },
    messages: { column: 'created_at', ascending: false },
    memories: { column: 'created_at', ascending: false },
    system_state: { column: 'updated_at', ascending: false }, // Use updated_at for system_state as it's more relevant
  }
  
  return sortingConfigs[collectionName] || defaultSort
}

// Helper function to determine which columns to select for list view (to avoid large text fields)
function getSelectColumns(collectionName: CollectionName): string {
  // For collections with large text fields, only select the essential columns for list view
  const selectConfigs: Record<CollectionName, string> = {
    job_board: '*',
    jobs: 'id,job_id,version,name,description,enabled_tools,schedule_config,is_active,created_at,updated_at,model_settings',
    job_reports: 'id,job_id,worker_id,created_at,status,duration_ms,total_tokens,error_message,error_type',
    events: 'id,event_type,created_at,job_id,parent_event_id,correlation_id,source_table,source_id',
    artifacts: 'id,created_at,updated_at,status,topic,job_id',
    messages: '*',
    memories: 'id,created_at,last_accessed_at,metadata,linked_memory_id,link_type,job_id,parent_job_definition_id,source_event_id',
    system_state: '*',
  }
  
  return selectConfigs[collectionName] || '*'
}



export function CollectionView({ collectionName }: CollectionViewProps) {
  const [records, setRecords] = useState<DbRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [systemStateRecords, setSystemStateRecords] = useState<DbRecord[]>([])
  const [systemStateLoading, setSystemStateLoading] = useState(true)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const pageSize = 100

  const supabase = createClient()
  
  // Use the realtime collection hook for non-job_board collections when auto-refresh is enabled
  const sortConfig = getSortingConfig(collectionName)
  const selectColumns = getSelectColumns(collectionName)
  const {
    records: realtimeRecords,
    loading: realtimeLoading,
    totalRecords: realtimeTotalRecords,
    currentPage: realtimeCurrentPage,
    lastUpdate: realtimeLastUpdate,
    setCurrentPage: setRealtimeCurrentPage,
    refresh: realtimeRefresh
  } = useRealtimeCollection({
    collectionName,
    pageSize,
    enablePolling: autoRefreshEnabled && collectionName !== 'job_board' && collectionName !== 'system_state',
    pollingInterval: 10000, // 10 seconds
    sortColumn: sortConfig.column,
    sortAscending: sortConfig.ascending,
    selectColumns: selectColumns
  })

  const fetchSystemState = useCallback(async () => {
    setSystemStateLoading(true)
    try {
      const sortConfig = getSortingConfig(collectionName)
      const selectColumns = getSelectColumns(collectionName)
      
      // Try the preferred sort first, with fallback handling
      let result = await supabase
        .from(collectionName)
        .select(selectColumns)
        .order(sortConfig.column, { ascending: sortConfig.ascending })
        .limit(100)

      // If sorting fails, try fallbacks
      if (result.error && result.error.message?.includes('column') && result.error.message?.includes('does not exist')) {
        console.warn(`Sort column ${sortConfig.column} not found for ${collectionName}, trying updated_at`)
        result = await supabase
          .from(collectionName)
          .select(selectColumns)
          .order('updated_at', { ascending: false })
          .limit(100)
        
        if (result.error && result.error.message?.includes('column') && result.error.message?.includes('does not exist')) {
          console.warn(`updated_at not found for ${collectionName}, trying created_at`)
          result = await supabase
            .from(collectionName)
            .select(selectColumns)
            .order('created_at', { ascending: false })
            .limit(100)
        }
      }

      if (result.error) {
        console.error('Error fetching system state:', result.error)
        toast.error('Failed to load system state')
        return
      }

      setSystemStateRecords((result.data || []) as unknown as DbRecord[])
    } catch (error) {
      console.error('Error fetching system state:', error)
      toast.error('Failed to load system state')
    } finally {
      setSystemStateLoading(false)
    }
  }, [collectionName, supabase])

  const fetchRecords = useCallback(async (page: number) => {
    setLoading(true)
    
    const sortConfig = getSortingConfig(collectionName)
    const selectColumns = getSelectColumns(collectionName)
    
    // Function to try different sorting strategies  
    const tryFetchWithSort = async (sortColumn: string, ascending: boolean = false) => {
      const supabaseQuery = supabase
        .from(collectionName)
        .select(selectColumns, { count: 'exact' })
        .order(sortColumn, { ascending })
        .range((page - 1) * pageSize, page * pageSize - 1)

      return await supabaseQuery
    }

    try {
      // Try the preferred sort column first
      let result = await tryFetchWithSort(sortConfig.column, sortConfig.ascending)
      
      // If that fails, try fallback sorting strategies
      if (result.error && result.error.message?.includes('column') && result.error.message?.includes('does not exist')) {
        console.warn(`Sort column ${sortConfig.column} not found for ${collectionName}, trying created_at`)
        result = await tryFetchWithSort('created_at', false)
        
        if (result.error && result.error.message?.includes('column') && result.error.message?.includes('does not exist')) {
          console.warn(`created_at not found for ${collectionName}, trying updated_at`)
          result = await tryFetchWithSort('updated_at', false)
          
          if (result.error && result.error.message?.includes('column') && result.error.message?.includes('does not exist')) {
            console.warn(`updated_at not found for ${collectionName}, trying id`)
            result = await tryFetchWithSort('id', false)
          }
        }
      }

      const { data, error, count } = result

      if (error) {
        console.error('Error fetching records:', error)
        toast.error(`Failed to fetch ${collectionName} records: ${error.message}`)
        return
      }

      setRecords((data || []) as unknown as DbRecord[])
      setTotalRecords(count || 0)
    } catch (error) {
      console.error('Unexpected error:', error)
      toast.error(`Unexpected error while fetching ${collectionName} records`)
    } finally {
      setLoading(false)
    }
  }, [collectionName, pageSize, supabase])

  useEffect(() => {
    if (collectionName === 'system_state') {
      fetchSystemState()
    } else {
      fetchRecords(currentPage)
    }
  }, [currentPage, collectionName, fetchSystemState, fetchRecords])

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // Handle job_board with real-time updates
  if (collectionName === 'job_board') {
    return <RealtimeJobBoard />
  }

  // Handle system_state with special view
  if (collectionName === 'system_state') {



    if (systemStateLoading) {
      return (
        <div>
          <h1 className="text-2xl font-bold mb-4">
            {getCollectionLabel(collectionName)}
          </h1>
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-lg p-6">
                <div className="animate-pulse">
                  <div className="flex items-start justify-between mb-4">
                    <div className="h-6 bg-gray-200 rounded w-1/3"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  </div>
                  <div className="h-20 bg-gray-200 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">
          {getCollectionLabel(collectionName)}
        </h1>
        <SystemStateView records={systemStateRecords} />
      </div>
    )
  }

  // Use realtime data if auto-refresh is enabled
  const displayRecords = autoRefreshEnabled ? realtimeRecords : records
  const displayLoading = autoRefreshEnabled ? realtimeLoading : loading
  const displayTotalRecords = autoRefreshEnabled ? realtimeTotalRecords : totalRecords
  const displayCurrentPage = autoRefreshEnabled ? realtimeCurrentPage : currentPage
  const displayLastUpdate = autoRefreshEnabled ? realtimeLastUpdate : lastUpdate

  if (displayLoading) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">{getCollectionLabel(collectionName)}</h1>
        </div>
        <RecordListSkeleton />
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
          Showing {displayRecords.length} of {displayTotalRecords} records (Page {displayCurrentPage})
        </p>
        
        <div className="flex items-center gap-4">
          <AutoRefreshToggle
            enabled={autoRefreshEnabled}
            onToggle={setAutoRefreshEnabled}
            interval={10000}
            lastUpdate={displayLastUpdate}
          />
          <button
            onClick={() => {
              if (autoRefreshEnabled) {
                realtimeRefresh()
              } else {
                fetchRecords(currentPage)
              }
              setLastUpdate(new Date())
            }}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Refresh
          </button>
        </div>
      </div>
      
      <RecordList records={displayRecords} collectionName={collectionName} />
      
      <Pagination
        currentPage={displayCurrentPage}
        totalRecords={displayTotalRecords}
        pageSize={pageSize}
        onPageChange={autoRefreshEnabled ? setRealtimeCurrentPage : handlePageChange}
      />
    </div>
  )
}