'use client'

import { useState } from 'react'

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
 * Hook for real-time data updates
 * 
 * Currently returns 'disconnected' to trigger polling fallback.
 * Ponder native SSE (client.live) is not available in the current version.
 * 
 * @param collectionName - Optional collection name to filter events ('requests', 'artifacts', etc.)
 * @param options - Configuration options
 */
export function useRealtimeData(
  collectionName?: string,
  options: UseRealtimeDataOptions = {}
): UseRealtimeDataReturn {
  // Always report disconnected to use polling fallback
  return {
    status: 'disconnected',
    isConnected: false
  }
}

