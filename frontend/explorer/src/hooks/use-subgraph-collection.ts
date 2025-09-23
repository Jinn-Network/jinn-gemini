'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { CollectionName } from '@/lib/types'
import { 
  queryJobDefinitions, 
  queryRequests, 
  queryDeliveries, 
  queryArtifacts,
  JobDefinition,
  Request,
  Delivery,
  Artifact,
  QueryOptions
} from '@/lib/subgraph'
import { toast } from 'sonner'

export type SubgraphRecord = JobDefinition | Request | Delivery | Artifact

interface UseSubgraphCollectionOptions {
  collectionName: CollectionName
  pageSize?: number
  enablePolling?: boolean
  pollingInterval?: number
  sortColumn?: string
  sortAscending?: boolean
}

interface UseSubgraphCollectionReturn {
  records: SubgraphRecord[]
  loading: boolean
  totalRecords: number
  currentPage: number
  lastUpdate: Date
  setCurrentPage: (page: number) => void
  refresh: () => void
  error: string | null
}

export function useSubgraphCollection({
  collectionName,
  pageSize = 100,
  enablePolling = false,
  pollingInterval = 10000,
  sortColumn,
  sortAscending = false,
}: UseSubgraphCollectionOptions): UseSubgraphCollectionReturn {
  const [records, setRecords] = useState<SubgraphRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [error, setError] = useState<string | null>(null)
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Get the appropriate query function for the collection
  const getQueryFunction = useCallback(() => {
    switch (collectionName) {
      case 'jobDefinitions':
        return queryJobDefinitions
      case 'requests':
        return queryRequests
      case 'deliveries':
        return queryDeliveries
      case 'artifacts':
        return queryArtifacts
      default:
        throw new Error(`Unknown collection: ${collectionName}`)
    }
  }, [collectionName])

  // Get default sort column for collection
  const getDefaultSortColumn = useCallback(() => {
    if (sortColumn) return sortColumn
    
    switch (collectionName) {
      case 'jobDefinitions':
        return 'name'
      case 'requests':
      case 'deliveries':
        return 'blockTimestamp'
      case 'artifacts':
        return 'requestId'
      default:
        return 'id'
    }
  }, [collectionName, sortColumn])

  // Fetch records with pagination
  const fetchRecords = useCallback(async (page: number, showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    
    try {
      const queryFn = getQueryFunction()
      const options: QueryOptions = {
        limit: pageSize,
        orderBy: getDefaultSortColumn(),
        orderDirection: sortAscending ? 'asc' : 'desc',
        // For pagination, we'll use simple offset-based pagination
        // Note: This is a simplification. Proper cursor-based pagination would be better
      }

      const data = await queryFn(options)
      
      setRecords(data)
      // Note: We don't have total count from GraphQL, so we estimate
      setTotalRecords(data.length >= pageSize ? (page * pageSize) + 1 : (page - 1) * pageSize + data.length)
      setLastUpdate(new Date())
    } catch (fetchError) {
      console.error(`Error fetching ${collectionName} records:`, fetchError)
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch records')
      toast.error(`Failed to fetch ${collectionName} records`)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [collectionName, pageSize, getQueryFunction, getDefaultSortColumn, sortAscending])

  // Set up polling
  const setupPolling = useCallback(() => {
    if (!enablePolling) return
    
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }
    
    pollingIntervalRef.current = setInterval(() => {
      console.log(`Polling for ${collectionName} updates...`)
      fetchRecords(currentPage, false)
    }, pollingInterval)
  }, [enablePolling, pollingInterval, currentPage, fetchRecords, collectionName])

  // Manual refresh function
  const refresh = useCallback(() => {
    fetchRecords(currentPage, false)
  }, [fetchRecords, currentPage])

  // Initial load and setup
  useEffect(() => {
    fetchRecords(currentPage)
    
    if (enablePolling) {
      setupPolling()
    }
    
    return () => {
      // Cleanup
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  // Update when page changes
  useEffect(() => {
    if (currentPage !== 1) {
      fetchRecords(currentPage)
    }
  }, [currentPage, fetchRecords])

  return {
    records,
    loading,
    totalRecords,
    currentPage,
    lastUpdate,
    setCurrentPage,
    refresh,
    error
  }
}