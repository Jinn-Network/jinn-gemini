'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { CollectionName } from '@/lib/types'
import {
  queryJobDefinitions,
  queryRequests,
  queryDeliveries,
  queryArtifacts,
  queryMessages,
  JobDefinition,
  Request,
  Delivery,
  Artifact,
  Message,
  QueryOptions
} from '@/lib/subgraph'
import { toast } from 'sonner'
import { useRealtimeData, type ConnectionStatus } from './use-realtime-data'

export type SubgraphRecord = JobDefinition | Request | Delivery | Artifact | Message

interface UseSubgraphCollectionOptions {
  collectionName: CollectionName
  pageSize?: number
  enablePolling?: boolean
  pollingInterval?: number
  sortColumn?: string
  sortAscending?: boolean
  whereFilter?: Record<string, unknown>
}

interface UseSubgraphCollectionReturn {
  records: SubgraphRecord[]
  loading: boolean
  totalRecords: number
  currentPage: number
  setCurrentPage: (page: number) => void
  refresh: () => void
  error: string | null
  hasNextPage: boolean
  hasPreviousPage: boolean
  setSorting: (column: string, ascending: boolean) => void
  sortColumn: string
  sortAscending: boolean
  realtimeStatus: ConnectionStatus
}

export function useSubgraphCollection({
  collectionName,
  pageSize = 100,
  enablePolling = true,
  pollingInterval = 10000,
  sortColumn,
  sortAscending = false,
  whereFilter,
}: UseSubgraphCollectionOptions): UseSubgraphCollectionReturn {
  const [records, setRecords] = useState<SubgraphRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [hasPreviousPage, setHasPreviousPage] = useState(false)
  const [currentSortColumn, setCurrentSortColumn] = useState<string>(sortColumn || '')
  const [currentSortAscending, setCurrentSortAscending] = useState<boolean>(sortAscending)
  const [realtimeStatus, setRealtimeStatus] = useState<ConnectionStatus>('disconnected')
  
  // Track cursors for each page
  const cursorsRef = useRef<Map<number, { after?: string; before?: string }>>(new Map())
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [realtimeUpdateTrigger, setRealtimeUpdateTrigger] = useState(0)
  
  // Callback to trigger refresh when SSE event arrives
  const handleRealtimeEvent = useCallback(() => {
    console.log(`[useSubgraphCollection] Real-time update for ${collectionName}`)
    setRealtimeUpdateTrigger(prev => prev + 1)
  }, [collectionName])
  
  // Use Ponder native SSE via client.live() - MUST be initialized early
  const { isConnected: isRealtimeConnected, status: rtStatus } = useRealtimeData(
    collectionName,
    {
      enabled: true,
      onEvent: handleRealtimeEvent,
      onError: (error) => {
        console.error('[useSubgraphCollection] Real-time connection error:', error)
      }
    }
  )

  // Update realtime status
  useEffect(() => {
    setRealtimeStatus(rtStatus)
  }, [rtStatus])
  
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
      case 'messages':
        return queryMessages
      default:
        throw new Error(`Unknown collection: ${collectionName}`)
    }
  }, [collectionName])

  // Get default sort column for collection
  const getDefaultSortColumn = useCallback(() => {
    if (currentSortColumn) return currentSortColumn
    if (sortColumn) return sortColumn
    
    switch (collectionName) {
      case 'jobDefinitions':
        return 'lastInteraction'
      case 'requests':
      case 'deliveries':
      case 'messages':
        return 'blockTimestamp'
      case 'artifacts':
        return 'requestId'
      default:
        return 'id'
    }
  }, [collectionName, sortColumn, currentSortColumn])

  // Fetch records with pagination
  const fetchRecords = useCallback(async (page: number, showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    
    try {
      const queryFn = getQueryFunction()
      
      // Get cursor for this page
      const pageCursor = cursorsRef.current.get(page)
      
      const options: QueryOptions = {
        limit: pageSize,
        orderBy: getDefaultSortColumn(),
        orderDirection: currentSortAscending ? 'asc' : 'desc',
        where: whereFilter,
        after: pageCursor?.after,
        before: pageCursor?.before,
      }

      const response = await queryFn(options)
      
      setRecords(response.items)
      setHasNextPage(response.pageInfo.hasNextPage)
      setHasPreviousPage(response.pageInfo.hasPreviousPage)
      
      // Store cursor for next page
      if (response.pageInfo.hasNextPage && response.pageInfo.endCursor) {
        cursorsRef.current.set(page + 1, { after: response.pageInfo.endCursor })
      }
      
      // Calculate minimum known total: current page's last record position
      // If there's a next page, add 1 to show there are more
      const currentEnd = (page - 1) * pageSize + response.items.length
      setTotalRecords(response.pageInfo.hasNextPage ? currentEnd + 1 : currentEnd)
    } catch (fetchError) {
      console.error(`Error fetching ${collectionName} records:`, fetchError)
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch records')
      toast.error(`Failed to fetch ${collectionName} records`)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [collectionName, pageSize, getQueryFunction, getDefaultSortColumn, currentSortAscending, whereFilter])

  // Set up polling only as fallback when SSE is not connected
  useEffect(() => {
    // If realtime is connected, disable polling
    if (isRealtimeConnected) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      return
    }

    // Fallback to polling if SSE is not connected
    if (!enablePolling) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      return
    }
    
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }
    
    pollingIntervalRef.current = setInterval(() => {
      console.log(`[useSubgraphCollection] Polling for ${collectionName} updates (SSE fallback)`)
      fetchRecords(currentPage, false)
    }, pollingInterval)
    
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [enablePolling, pollingInterval, currentPage, fetchRecords, collectionName, isRealtimeConnected])

  // Manual refresh function
  const refresh = useCallback(() => {
    fetchRecords(currentPage, false)
  }, [fetchRecords, currentPage])

  // Trigger refresh when realtime events arrive
  useEffect(() => {
    if (isRealtimeConnected && realtimeUpdateTrigger > 0) {
      fetchRecords(currentPage, false) // Silent refresh
    }
  }, [isRealtimeConnected, realtimeUpdateTrigger, currentPage, fetchRecords])

  // Function to update sorting
  const setSorting = useCallback((column: string, ascending: boolean) => {
    setCurrentSortColumn(column)
    setCurrentSortAscending(ascending)
    setCurrentPage(1) // Reset to first page when sorting changes
    cursorsRef.current.clear() // Clear cursor cache
  }, [])

  // Initial load and refetch when filter changes
  useEffect(() => {
    fetchRecords(currentPage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whereFilter]) // Refetch when filter changes

  // Update when page changes
  useEffect(() => {
    if (currentPage !== 1) {
      fetchRecords(currentPage)
    }
  }, [currentPage, fetchRecords])

  // Refetch when sorting changes
  useEffect(() => {
    fetchRecords(1)
  }, [currentSortColumn, currentSortAscending, fetchRecords])

  return {
    records,
    loading,
    totalRecords,
    currentPage,
    setCurrentPage,
    refresh,
    error,
    hasNextPage,
    hasPreviousPage,
    setSorting,
    sortColumn: currentSortColumn,
    sortAscending: currentSortAscending,
    realtimeStatus
  }
}