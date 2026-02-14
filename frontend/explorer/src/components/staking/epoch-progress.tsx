'use client'

import { useEffect, useState, useCallback } from 'react'
import { Progress } from '@/components/ui/progress'
import { TARGET_DELIVERIES_PER_EPOCH } from '@/lib/staking/constants'
import { getServiceEpochActivity } from '@/app/nodes/staking/actions'

interface EpochData {
  checkpoint: number
  epochEnd: number
  targetDeliveries: number
}

interface EpochProgressProps {
  multisig: string
}

export function EpochProgress({ multisig }: EpochProgressProps) {
  const [epoch, setEpoch] = useState<EpochData | null>(null)
  const [deliveryCount, setDeliveryCount] = useState<number | null>(null)
  const [error, setError] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/staking/epoch')
      if (!res.ok) throw new Error('Failed to fetch epoch')
      const epochData: EpochData = await res.json()
      setEpoch(epochData)

      const { deliveryCount: count } = await getServiceEpochActivity(multisig, epochData.checkpoint)
      setDeliveryCount(count)
      setError(false)
    } catch {
      setError(true)
    }
  }, [multisig])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (error) {
    return <span className="text-xs text-muted-foreground">Failed to load</span>
  }

  if (!epoch || deliveryCount === null) {
    return (
      <div className="space-y-1.5">
        <div className="h-2 w-full bg-muted animate-pulse rounded-full" />
        <div className="h-3 w-20 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  const target = TARGET_DELIVERIES_PER_EPOCH
  const percentage = Math.min((deliveryCount / target) * 100, 100)
  const now = Math.floor(Date.now() / 1000)
  const remaining = Math.max(epoch.epochEnd - now, 0)
  const hours = Math.floor(remaining / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)

  let colorClass = 'text-red-500'
  let progressColor = '[&_[data-slot=progress-indicator]]:bg-red-500'
  if (percentage >= 100) {
    colorClass = 'text-green-500'
    progressColor = '[&_[data-slot=progress-indicator]]:bg-green-500'
  } else if (percentage >= 50) {
    colorClass = 'text-yellow-500'
    progressColor = '[&_[data-slot=progress-indicator]]:bg-yellow-500'
  }

  return (
    <div className="space-y-1.5">
      <Progress value={deliveryCount} max={target} className={progressColor} />
      <div className="flex items-center justify-between text-xs">
        <span className={colorClass}>
          {deliveryCount} / {target} deliveries
        </span>
        <span className="text-muted-foreground">
          Resets in {hours}h {minutes}m
        </span>
      </div>
    </div>
  )
}
