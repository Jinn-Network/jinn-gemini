'use client'

import { useState } from 'react'

interface AutoRefreshToggleProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  interval?: number
  lastUpdate?: Date
  className?: string
}

export function AutoRefreshToggle({ 
  enabled, 
  onToggle, 
  interval = 10000, 
  lastUpdate,
  className = '' 
}: AutoRefreshToggleProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleToggle = () => {
    setIsRefreshing(true)
    onToggle(!enabled)
    setTimeout(() => setIsRefreshing(false), 500)
  }

  const formatInterval = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const seconds = ms / 1000
    if (seconds < 60) return `${seconds}s`
    const minutes = seconds / 60
    return `${minutes}m`
  }

  return (
    <div className={`flex items-center gap-3 text-sm ${className}`}>
      <div className="flex items-center gap-2">
        <button
          onClick={handleToggle}
          disabled={isRefreshing}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            enabled ? 'bg-blue-600' : 'bg-gray-300'
          } ${isRefreshing ? 'opacity-50' : ''}`}
        >
          <span className="sr-only">Toggle auto refresh</span>
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
        <span className="text-gray-600">
          Auto refresh {enabled ? 'ON' : 'OFF'}
        </span>
      </div>
      
      {enabled && (
        <div className="flex items-center gap-2 text-gray-500">
          <div className={`w-2 h-2 rounded-full ${enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          <span>Every {formatInterval(interval)}</span>
        </div>
      )}
      
      {lastUpdate && (
        <span className="text-gray-500">
          Last update: {lastUpdate.toLocaleTimeString()}
        </span>
      )}
    </div>
  )
}