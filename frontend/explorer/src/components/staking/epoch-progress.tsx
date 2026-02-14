'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Progress } from '@/components/ui/progress'
import { TARGET_DELIVERIES_PER_EPOCH } from '@/lib/staking/constants'

interface EpochData {
  checkpoint: number
  nextCheckpoint: number
  livenessPeriod: number
  targetDeliveries: number
  deliveryCount?: number
}

interface EpochProgressProps {
  multisig: string
}

export function EpochProgress({ multisig }: EpochProgressProps) {
  const [data, setData] = useState<EpochData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/staking/epoch?multisig=${encodeURIComponent(multisig)}`)
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`API ${res.status}: ${body}`)
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
  }, [multisig])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (error) {
    return <span className="text-xs text-destructive" title={error}>Failed to load epoch</span>
  }

  if (!data) {
    return (
      <div className="space-y-1.5">
        <div className="h-2 w-full bg-muted animate-pulse rounded-full" />
        <div className="h-3 w-20 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  const target = TARGET_DELIVERIES_PER_EPOCH
  const deliveryCount = data.deliveryCount ?? 0
  const percentage = Math.min((deliveryCount / target) * 100, 100)
  const now = Math.floor(Date.now() / 1000)
  const remaining = data.nextCheckpoint - now
  const isOverdue = remaining <= 0

  let colorClass = 'text-red-500'
  let progressColor = '[&_[data-slot=progress-indicator]]:bg-red-500'
  if (percentage >= 100) {
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
      <Progress value={deliveryCount} max={target} className={progressColor} />
      <div className="flex items-center justify-between text-xs">
        <span className={colorClass}>
          {deliveryCount} / {target} deliveries
        </span>
        <span className={isOverdue ? 'text-yellow-500' : 'text-muted-foreground'}>
          {timeLabel}
        </span>
      </div>
    </div>
  )
}
