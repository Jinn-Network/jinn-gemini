'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { DbRecord, CollectionName } from '@/lib/types'
import { toast } from 'sonner'

interface UseRealtimeCollectionOptions {
  collectionName: CollectionName
  pageSize?: number
  enablePolling?: boolean
  pollingInterval?: number
  enableRealtime?: boolean
  sortColumn?: string
  sortAscending?: boolean
}

interface UseRealtimeCollectionReturn {
  records: DbRecord[]
  loading: boolean
  totalRecords: number
  currentPage: number
  isRealTimeConnected: boolean
  lastUpdate: Date
  setCurrentPage: (page: number) => void
  refresh: () => void
  error: string | null
}

export function useRealtimeCollection({
  collectionName,
  pageSize = 100,
  enablePolling = false,
  pollingInterval = 10000, // 10 seconds default
  enableRealtime = false,
  sortColumn = 'created_at',
  sortAscending = false
}: UseRealtimeCollectionOptions): UseRealtimeCollectionReturn {
  const [records, setRecords] = useState<DbRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [isRealTimeConnected, setIsRealTimeConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [error, setError] = useState<string | null>(null)
  
  const supabase = createClient()
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Fetch records with pagination
  const fetchRecords = useCallback(async (page: number, showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    
    try {
      const { data, error: fetchError, count } = await supabase
        .from(collectionName)
        .select('*', { count: 'exact' })
        .order(sortColumn, { ascending: sortAscending })
        .range((page - 1) * pageSize, page * pageSize - 1)

      if (fetchError) throw fetchError

      setRecords(data || [])
      setTotalRecords(count || 0)
      setLastUpdate(new Date())
    } catch (fetchError) {
      console.error(`Error fetching ${collectionName} records:`, fetchError)
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch records')
      toast.error(`Failed to fetch ${collectionName} records`)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [supabase, collectionName, sortColumn, sortAscending, pageSize])

  // Set up real-time subscription
  const setupRealtimeSubscription = useCallback(() => {
    if (!enableRealtime) return
    
    try {
      subscriptionRef.current = supabase
        .channel(`${collectionName}-changes`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: collectionName
          },
          (payload) => {
            console.log(`Real-time ${collectionName} change:`, payload)
            
            // Refresh current page on any change
            fetchRecords(currentPage, false)
            
            // Show subtle notification for changes
            if (payload.eventType === 'INSERT') {
              toast.info(`New ${collectionName} record added`)
            } else if (payload.eventType === 'UPDATE') {
              toast.info(`${collectionName} record updated`)
            }
          }
        )
        .subscribe((status) => {
          console.log(`Real-time subscription status for ${collectionName}:`, status)
          setIsRealTimeConnected(status === 'SUBSCRIBED')
          
          if (status === 'CHANNEL_ERROR' && enablePolling) {
            // Start polling directly to avoid circular dependency
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current)
            }
            pollingIntervalRef.current = setInterval(() => {
              console.log(`Polling for ${collectionName} updates...`)
              fetchRecords(currentPage, false)
            }, pollingInterval)
          }
        })
    } catch (setupError) {
      console.error(`Error setting up real-time subscription for ${collectionName}:`, setupError)
      if (enablePolling) {
        // Start polling directly to avoid circular dependency
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
        }
        pollingIntervalRef.current = setInterval(() => {
          console.log(`Polling for ${collectionName} updates...`)
          fetchRecords(currentPage, false)
        }, pollingInterval)
      }
    }
  }, [supabase, collectionName, currentPage, fetchRecords, enableRealtime, enablePolling, pollingInterval])

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
    
    if (enableRealtime) {
      setupRealtimeSubscription()
    } else if (enablePolling) {
      setupPolling()
    }
    
    return () => {
      // Cleanup
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current)
      }
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
    isRealTimeConnected,
    lastUpdate,
    setCurrentPage,
    refresh,
    error
  }
}