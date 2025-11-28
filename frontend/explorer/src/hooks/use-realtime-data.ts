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
 * Uses raw SQL queries to avoid schema import issues.
 * 
 * @param collectionName - Optional collection name to filter events ('requests', 'artifacts', etc.)
 * @param options - Configuration options
 */
export function useRealtimeData(
  collectionName?: string,
  options: UseRealtimeDataOptions = {}
): UseRealtimeDataReturn {
  const { enabled = true, onEvent, onError } = options
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    if (!enabled) return

    setStatus('connecting')

    // Subscribe to all relevant tables using raw SQL
    const unsubscribers: Array<() => void> = []

    try {
      // Subscribe to requests table
      const { unsubscribe: unsubRequests } = ponderClient.live(
        () => sql`SELECT * FROM "request" LIMIT 1`,
        () => {
          setStatus('connected')
          if (collectionName === 'requests' || !collectionName) {
            onEvent?.()
          }
        },
        (error) => {
          console.error('[useRealtimeData] Error in requests subscription:', error)
          setStatus('error')
          onError?.(error)
        }
      )
      unsubscribers.push(unsubRequests)

      // Subscribe to artifacts table
      const { unsubscribe: unsubArtifacts } = ponderClient.live(
        () => sql`SELECT * FROM "artifact" LIMIT 1`,
        () => {
          setStatus('connected')
          if (collectionName === 'artifacts' || !collectionName) {
            onEvent?.()
          }
        },
        (error) => {
          console.error('[useRealtimeData] Error in artifacts subscription:', error)
          setStatus('error')
          onError?.(error)
        }
      )
      unsubscribers.push(unsubArtifacts)

      // Subscribe to deliveries table
      const { unsubscribe: unsubDeliveries } = ponderClient.live(
        () => sql`SELECT * FROM "delivery" LIMIT 1`,
        () => {
          setStatus('connected')
          if (collectionName === 'deliveries' || !collectionName) {
            onEvent?.()
          }
        },
        (error) => {
          console.error('[useRealtimeData] Error in deliveries subscription:', error)
          setStatus('error')
          onError?.(error)
        }
      )
      unsubscribers.push(unsubDeliveries)

      // Subscribe to job definitions table
      const { unsubscribe: unsubJobDefs } = ponderClient.live(
        () => sql`SELECT * FROM "job_definition" LIMIT 1`,
        () => {
          setStatus('connected')
          if (collectionName === 'jobDefinitions' || !collectionName) {
            onEvent?.()
          }
        },
        (error) => {
          console.error('[useRealtimeData] Error in job definitions subscription:', error)
          setStatus('error')
          onError?.(error)
        }
      )
      unsubscribers.push(unsubJobDefs)

      // Subscribe to messages table
      const { unsubscribe: unsubMessages } = ponderClient.live(
        () => sql`SELECT * FROM "message" LIMIT 1`,
        () => {
          setStatus('connected')
          if (collectionName === 'messages' || !collectionName) {
            onEvent?.()
          }
        },
        (error) => {
          console.error('[useRealtimeData] Error in messages subscription:', error)
          setStatus('error')
          onError?.(error)
        }
      )
      unsubscribers.push(unsubMessages)

    } catch (error) {
      console.error('[useRealtimeData] Error setting up subscriptions:', error)
      setStatus('error')
      onError?.(error as Error)
    }

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe())
      setStatus('disconnected')
    }
  }, [enabled, collectionName, onEvent, onError])

  return {
    status,
    isConnected: status === 'connected'
  }
}

