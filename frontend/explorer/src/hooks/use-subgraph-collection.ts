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
  lastUpdate: Date
  setCurrentPage: (page: number) => void
  refresh: () => void
  error: string | null
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export function useSubgraphCollection({
  collectionName,
  pageSize = 100,
  enablePolling = false,
  pollingInterval = 10000,
  sortColumn,
  sortAscending = false,
  whereFilter,
}: UseSubgraphCollectionOptions): UseSubgraphCollectionReturn {
  const [records, setRecords] = useState<SubgraphRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [error, setError] = useState<string | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [hasPreviousPage, setHasPreviousPage] = useState(false)
  
  // Track cursors for each page
  const cursorsRef = useRef<Map<number, { after?: string; before?: string }>>(new Map())
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
      case 'messages':
        return queryMessages
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
      case 'messages':
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
      
      // Get cursor for this page
      const pageCursor = cursorsRef.current.get(page)
      
      const options: QueryOptions = {
        limit: pageSize,
        orderBy: getDefaultSortColumn(),
        orderDirection: sortAscending ? 'asc' : 'desc',
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
      
      setLastUpdate(new Date())
    } catch (fetchError) {
      console.error(`Error fetching ${collectionName} records:`, fetchError)
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch records')
      toast.error(`Failed to fetch ${collectionName} records`)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [collectionName, pageSize, getQueryFunction, getDefaultSortColumn, sortAscending, whereFilter])

  // Set up polling
  useEffect(() => {
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
      console.log(`Polling for ${collectionName} updates...`)
      fetchRecords(currentPage, false)
    }, pollingInterval)
    
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [enablePolling, pollingInterval, currentPage, fetchRecords, collectionName])

  // Manual refresh function
  const refresh = useCallback(() => {
    fetchRecords(currentPage, false)
  }, [fetchRecords, currentPage])

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

  return {
    records,
    loading,
    totalRecords,
    currentPage,
    lastUpdate,
    setCurrentPage,
    refresh,
    error,
    hasNextPage,
    hasPreviousPage
  }
}