'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { DbRecord, CollectionName } from '@/lib/types'
import { RecordList } from '@/components/record-list'
import { SystemStateView } from '@/components/system-state-view'
import { Pagination } from '@/components/pagination'
import { RecordListSkeleton } from '@/components/loading-skeleton'
import { getCollectionLabel } from '@/lib/utils'
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
    job_definitions: { column: 'created_at', ascending: false },
    job_schedules: { column: 'created_at', ascending: false },
    job_reports: { column: 'created_at', ascending: false },
    threads: { column: 'created_at', ascending: false },
    artifacts: { column: 'created_at', ascending: false },
    messages: { column: 'created_at', ascending: false },
    memories: { column: 'created_at', ascending: false },
    prompt_library: { column: 'created_at', ascending: false },
    system_state: { column: 'updated_at', ascending: false }, // Use updated_at for system_state as it's more relevant
  }
  
  return sortingConfigs[collectionName] || defaultSort
}



export function CollectionView({ collectionName }: CollectionViewProps) {
  const [records, setRecords] = useState<DbRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const pageSize = 100

  const supabase = createClient()

  // Handle system_state with special view
  if (collectionName === 'system_state') {
    const [systemStateRecords, setSystemStateRecords] = useState<DbRecord[]>([])
    const [systemStateLoading, setSystemStateLoading] = useState(true)

    const fetchSystemState = async () => {
      setSystemStateLoading(true)
      try {
        const sortConfig = getSortingConfig(collectionName)
        
        // Try the preferred sort first, with fallback handling
        let result = await supabase
          .from(collectionName)
          .select('*')
          .order(sortConfig.column, { ascending: sortConfig.ascending })
          .limit(100)

        // If sorting fails, try fallbacks
        if (result.error && result.error.message?.includes('column') && result.error.message?.includes('does not exist')) {
          console.warn(`Sort column ${sortConfig.column} not found for ${collectionName}, trying updated_at`)
          result = await supabase
            .from(collectionName)
            .select('*')
            .order('updated_at', { ascending: false })
            .limit(100)
          
          if (result.error && result.error.message?.includes('column') && result.error.message?.includes('does not exist')) {
            console.warn(`updated_at not found for ${collectionName}, trying created_at`)
            result = await supabase
              .from(collectionName)
              .select('*')
              .order('created_at', { ascending: false })
              .limit(100)
          }
        }

        if (result.error) {
          console.error('Error fetching system state:', result.error)
          toast.error('Failed to load system state')
          return
        }

        setSystemStateRecords(result.data || [])
      } catch (error) {
        console.error('Error fetching system state:', error)
        toast.error('Failed to load system state')
      } finally {
        setSystemStateLoading(false)
      }
    }

    useEffect(() => {
      fetchSystemState()
    }, [])

    if (systemStateLoading) {
      return (
        <div>
          <h1 className="text-2xl font-bold mb-4">
            {getCollectionLabel(collectionName)}
          </h1>
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg p-6">
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

  const fetchRecords = async (page: number) => {
    setLoading(true)
    
    const sortConfig = getSortingConfig(collectionName)
    
    // Function to try different sorting strategies
    const tryFetchWithSort = async (sortColumn: string, ascending: boolean = false): Promise<any> => {
      let supabaseQuery = supabase
        .from(collectionName)
        .select('*', { count: 'exact' })
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

      setRecords(data || [])
      setTotalRecords(count || 0)
    } catch (error) {
      console.error('Unexpected error:', error)
      toast.error(`Unexpected error while fetching ${collectionName} records`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRecords(currentPage)
  }, [currentPage, collectionName])

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">
        {getCollectionLabel(collectionName)}
      </h1>
      
      <div className="mb-4">
        <p className="text-gray-600">
          Showing {records.length} of {totalRecords} records (Page {currentPage})
        </p>
      </div>
      
      <RecordList records={records} collectionName={collectionName} />
      
      <Pagination
        currentPage={currentPage}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={handlePageChange}
      />
    </div>
  )
}