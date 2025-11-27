'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

export interface RealtimeEvent {
  type: string
  data: any
  timestamp: string
}

export interface UseRealtimeDataOptions {
  url?: string
  enabled?: boolean
  onEvent?: (event: RealtimeEvent) => void
  onError?: (error: Error) => void
}

export interface UseRealtimeDataReturn {
  status: ConnectionStatus
  lastEvent: RealtimeEvent | null
  subscribe: (eventType: string, handler: (data: any) => void) => () => void
}

/**
 * Hook to establish SSE connection and listen for real-time events from Ponder
 */
export function useRealtimeData(options: UseRealtimeDataOptions = {}): UseRealtimeDataReturn {
  const {
    url = process.env.NEXT_PUBLIC_REALTIME_URL || 'http://localhost:42070/events',
    enabled = true,
    onEvent,
    onError
  } = options

  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null)
  
  const eventSourceRef = useRef<EventSource | null>(null)
  const handlersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map())
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)

  // Subscribe to specific event types
  const subscribe = useCallback((eventType: string, handler: (data: any) => void) => {
    if (!handlersRef.current.has(eventType)) {
      handlersRef.current.set(eventType, new Set())
    }
    handlersRef.current.get(eventType)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = handlersRef.current.get(eventType)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          handlersRef.current.delete(eventType)
        }
      }
    }
  }, [])

  // Dispatch event to subscribed handlers
  const dispatchEvent = useCallback((event: RealtimeEvent) => {
    setLastEvent(event)
    onEvent?.(event)

    const handlers = handlersRef.current.get(event.type)
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event.data)
        } catch (error) {
          console.error(`[useRealtimeData] Error in event handler for ${event.type}:`, error)
        }
      })
    }
  }, [onEvent])

  // Connect to SSE
  const connect = useCallback(() => {
    if (!enabled) return
    if (eventSourceRef.current) return // Already connected

    setStatus('connecting')
    console.log('[useRealtimeData] Connecting to SSE:', url)

    try {
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        console.log('[useRealtimeData] SSE connection established')
        setStatus('connected')
        reconnectAttemptsRef.current = 0
      }

      // Handle 'connected' event from server
      eventSource.addEventListener('connected', (e) => {
        console.log('[useRealtimeData] Server connected event:', e.data)
      })

      // Handle specific event types
      const eventTypes = [
        'request:created',
        'request:updated',
        'artifact:created',
        'delivery:created',
        'jobDefinition:created',
        'jobDefinition:updated'
      ]

      eventTypes.forEach(eventType => {
        eventSource.addEventListener(eventType, (e) => {
          try {
            const data = JSON.parse(e.data)
            const event: RealtimeEvent = {
              type: eventType,
              data,
              timestamp: data.timestamp || new Date().toISOString()
            }
            console.log(`[useRealtimeData] Received ${eventType}:`, data)
            dispatchEvent(event)
          } catch (error) {
            console.error(`[useRealtimeData] Error parsing ${eventType} event:`, error)
          }
        })
      })

      eventSource.onerror = (error) => {
        console.error('[useRealtimeData] SSE connection error:', error)
        setStatus('error')

        // Close existing connection
        eventSource.close()
        eventSourceRef.current = null

        // Attempt reconnection with exponential backoff
        const maxRetries = 10
        const baseDelay = 1000
        const maxDelay = 30000

        if (reconnectAttemptsRef.current < maxRetries) {
          reconnectAttemptsRef.current++
          const delay = Math.min(
            baseDelay * Math.pow(2, reconnectAttemptsRef.current - 1),
            maxDelay
          )
          
          console.log(`[useRealtimeData] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxRetries})`)
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, delay)
        } else {
          console.error('[useRealtimeData] Max reconnection attempts reached')
          setStatus('disconnected')
          onError?.(new Error('Max reconnection attempts reached'))
        }
      }

    } catch (error) {
      console.error('[useRealtimeData] Error creating EventSource:', error)
      setStatus('error')
      onError?.(error as Error)
    }
  }, [enabled, url, dispatchEvent, onError])

  // Disconnect from SSE
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (eventSourceRef.current) {
      console.log('[useRealtimeData] Disconnecting from SSE')
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setStatus('disconnected')
    }
  }, [])

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (enabled) {
      connect()
    }

    return () => {
      disconnect()
    }
  }, [enabled, connect, disconnect])

  return {
    status,
    lastEvent,
    subscribe
  }
}

/**
 * Hook to listen for specific event types and trigger refresh callback
 */
export function useRealtimeRefresh(
  eventTypes: string[],
  onRefresh: () => void,
  options: Omit<UseRealtimeDataOptions, 'onEvent'> = {}
) {
  const { subscribe } = useRealtimeData(options)

  useEffect(() => {
    const unsubscribers = eventTypes.map(eventType =>
      subscribe(eventType, () => {
        console.log(`[useRealtimeRefresh] Triggering refresh for ${eventType}`)
        onRefresh()
      })
    )

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe())
    }
  }, [eventTypes, subscribe, onRefresh])
}

