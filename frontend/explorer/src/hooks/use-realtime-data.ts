'use client'

import { useEffect, useState } from 'react'
import { ponderClient } from '@/lib/ponder-client'
import * as schema from '@/lib/schema'
import { count } from 'drizzle-orm'

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

export interface UseRealtimeDataOptions {
  enabled?: boolean
  onEvent?: () => void
  onError?: (error: Error) => void
}

export interface UseRealtimeDataReturn {
  status: ConnectionStatus
  isConnected: boolean
}

/**
 * Hook to subscribe to Ponder table changes using client.live()
 * 
 * Ponder's createClient multiplexes all live queries over a SINGLE SSE connection,
 * so multiple subscriptions don't create multiple connections.
 * 
 * This hook now subscribes ONLY to the specific table needed by the component.
 * 
 * @param collectionName - Collection name to subscribe to ('requests', 'artifacts', etc.)
 * @param options - Configuration options
 */
export function useRealtimeData(
  collectionName?: string,
  options: UseRealtimeDataOptions = {}
): UseRealtimeDataReturn {
  const { enabled = true, onEvent, onError } = options
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected')
      return
    }

    // Map collection name to table schema
    const tableSchemaMap: Record<string, typeof schema.request> = {
      'jobDefinitions': schema.jobDefinition,
      'requests': schema.request,
      'deliveries': schema.delivery,
      'artifacts': schema.artifact,
      'messages': schema.message
    }

    // If no collection specified, subscribe to all tables
    const tablesToSubscribe = collectionName 
      ? [tableSchemaMap[collectionName]]
      : Object.values(tableSchemaMap)

    // Check if all tables are valid
    if (tablesToSubscribe.some(t => !t)) {
      console.error(`[useRealtimeData] Unknown collection: ${collectionName}`)
      setStatus('error')
      return
    }

    setStatus('connecting')

    try {
      // Subscribe to table(s) changes using Drizzle query builder
      // Ponder client multiplexes all queries over a single SSE connection
      // Create subscriptions for each table
      const unsubscribers = tablesToSubscribe.map((table) => {
        const { unsubscribe } = ponderClient.live(
          (db) => db.select({ count: count() }).from(table),
          (result) => {
            const tableName = collectionName || 'all tables'
            console.log(`[useRealtimeData] SSE event received for ${tableName}:`, result)
            setStatus('connected')
            onEvent?.()
          },
          (error) => {
            console.error(`[useRealtimeData] Error in ${collectionName || 'all tables'} subscription:`, error)
            setStatus('error')
            onError?.(error)
          }
        )
        return unsubscribe
      })

      return () => {
        unsubscribers.forEach(unsub => unsub())
        setStatus('disconnected')
      }
    } catch (error) {
      console.error('[useRealtimeData] Error setting up subscription:', error)
      setStatus('error')
      onError?.(error as Error)
    }
  }, [enabled, collectionName, onEvent, onError])

  return {
    status,
    isConnected: status === 'connected'
  }
}

