'use client'

import { useEffect, useState } from 'react'
import { ponderClient } from '@/lib/ponder-client'
import { sql } from '@ponder/client'

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
    if (!enabled || !collectionName) {
      setStatus('disconnected')
      return
    }

    // Map collection name to table name
    const tableNameMap: Record<string, string> = {
      'jobDefinitions': 'job_definition',
      'requests': 'request',
      'deliveries': 'delivery',
      'artifacts': 'artifact',
      'messages': 'message'
    }

    const tableName = tableNameMap[collectionName]
    if (!tableName) {
      console.error(`[useRealtimeData] Unknown collection: ${collectionName}`)
      setStatus('error')
      return
    }

    setStatus('connecting')

    try {
      // Subscribe to ONLY this specific table
      // Ponder client multiplexes all queries over a single SSE connection
      const { unsubscribe } = ponderClient.live(
        (db) => db.execute(sql`SELECT id FROM "${sql.raw(tableName)}" ORDER BY id DESC LIMIT 1`),
        () => {
          setStatus('connected')
          onEvent?.()
        },
        (error) => {
          console.error(`[useRealtimeData] Error in ${tableName} subscription:`, error)
          setStatus('error')
          onError?.(error)
        }
      )

      return () => {
        unsubscribe()
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

