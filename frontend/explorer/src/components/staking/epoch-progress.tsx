'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Progress } from '@/components/ui/progress'
import { TARGET_REQUESTS_PER_EPOCH } from '@/lib/staking/constants'

interface EpochData {
  checkpoint: number
  nextCheckpoint: number
  livenessPeriod: number
  targetRequests: number
  requestCount?: number
}

interface EpochProgressProps {
  multisig: string
  serviceId?: string
}

export function EpochProgress({ multisig, serviceId }: EpochProgressProps) {
  const [data, setData] = useState<EpochData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ multisig })
      if (serviceId) params.set('serviceId', serviceId)
      const res = await fetch(`/api/staking/epoch?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const epochData: EpochData = await res.json()
      setData(epochData)
      setError(null)
      hasLoadedOnce.current = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('EpochProgress fetch failed:', msg)
      // Only show error if we never successfully loaded — otherwise keep stale data
      if (!hasLoadedOnce.current) setError(msg)
    }
  }, [multisig, serviceId])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (error) {
    return (
      <div className="space-y-1.5">
        <span className="text-xs text-destructive">Failed to load epoch data</span>
        <button
          onClick={fetchData}
          className="ml-2 text-xs underline text-muted-foreground hover:text-foreground"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-1.5">
        <div className="h-2 w-full bg-muted animate-pulse rounded-full" />
        <div className="h-3 w-20 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  const target = TARGET_REQUESTS_PER_EPOCH
  const requestCountAvailable = data.requestCount != null
  const requestCount = data.requestCount ?? 0
  const percentage = requestCountAvailable ? Math.min((requestCount / target) * 100, 100) : 0
  const now = Math.floor(Date.now() / 1000)
  const remaining = data.nextCheckpoint - now
  const isOverdue = remaining <= 0

  let colorClass = 'text-red-500'
  let progressColor = '[&_[data-slot=progress-indicator]]:bg-red-500'
  if (!requestCountAvailable) {
    colorClass = 'text-muted-foreground'
    progressColor = '[&_[data-slot=progress-indicator]]:bg-muted-foreground'
  } else if (percentage >= 100) {
    colorClass = 'text-green-500'
    progressColor = '[&_[data-slot=progress-indicator]]:bg-green-500'
  } else if (percentage >= 50) {
    colorClass = 'text-yellow-500'
    progressColor = '[&_[data-slot=progress-indicator]]:bg-yellow-500'
  }

  let timeLabel: string
  if (isOverdue) {
    const overdue = Math.abs(remaining)
    const hours = Math.floor(overdue / 3600)
    const minutes = Math.floor((overdue % 3600) / 60)
    timeLabel = `Checkpoint overdue ${hours}h ${minutes}m`
  } else {
    const hours = Math.floor(remaining / 3600)
    const minutes = Math.floor((remaining % 3600) / 60)
    timeLabel = `Resets in ${hours}h ${minutes}m`
  }

  return (
    <div className="space-y-1.5">
      <Progress value={requestCountAvailable ? requestCount : 0} max={target} className={progressColor} />
      <div className="flex items-center justify-between text-xs">
        <span className={colorClass}>
          {requestCountAvailable
            ? `${requestCount} / ${target} requests`
            : 'Request count unavailable'
          }
        </span>
        <span className={isOverdue ? 'text-yellow-500' : 'text-muted-foreground'}>
          {timeLabel}
        </span>
      </div>
    </div>
  )
}
