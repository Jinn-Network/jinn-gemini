'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Badge } from '@/components/ui/badge'

interface ServiceStatus {
  serviceId: string
  isActivelyStaked: boolean
  isEvicted: boolean
  accumulatedReward: string
  pendingReward: string
  totalClaimable: string
  hasClaimableRewards: boolean
  contractAvailableRewards: string
  stakedSince: string | null
}

interface ServiceStakingStatusProps {
  serviceId: string
  variant?: 'badge' | 'full'
}

function StakingBadge({ status }: { status: ServiceStatus | null }) {
  if (!status) {
    return (
      <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted animate-pulse">
        loading
      </Badge>
    )
  }

  if (status.isEvicted) {
    return (
      <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20">
        evicted
      </Badge>
    )
  }
  if (status.isActivelyStaked) {
    return (
      <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
        staked
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="bg-gray-500/10 text-gray-500 border-gray-500/20">
      unstaked
    </Badge>
  )
}

export function ServiceStakingStatus({ serviceId, variant = 'badge' }: ServiceStakingStatusProps) {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/staking/service-status?serviceId=${encodeURIComponent(serviceId)}`)
      if (!res.ok) throw new Error(`API ${res.status}`)
      const data: ServiceStatus = await res.json()
      setStatus(data)
      setError(null)
      hasLoadedOnce.current = true
    } catch (e) {
      if (!hasLoadedOnce.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [serviceId])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 120_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  if (variant === 'badge') {
    if (error) {
      return (
        <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
          error
        </Badge>
      )
    }
    return <StakingBadge status={status} />
  }

  // Full variant — used on detail page
  if (error) {
    return (
      <div className="text-sm text-destructive">
        Failed to load staking status: {error}
      </div>
    )
  }

  if (!status) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center justify-between py-1.5">
            <div className="h-4 w-32 bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between py-1.5">
        <span className="text-sm text-muted-foreground">On-chain Status</span>
        <StakingBadge status={status} />
      </div>

      {status.isEvicted && (
        <div className="rounded-md border border-orange-500/20 bg-orange-500/5 p-3 text-sm">
          <p className="font-medium text-orange-500">Service Evicted</p>
          <p className="text-muted-foreground mt-1">
            This service was removed from active staking due to insufficient activity.
            To restake, run:
          </p>
          <code className="block text-xs bg-muted px-2 py-1.5 rounded mt-2 break-all">
            tsx scripts/migrate-staking-contract.ts --service-id={serviceId} --source=jinn --target=jinn
          </code>
        </div>
      )}

      <div className="flex items-center justify-between py-1.5">
        <span className="text-sm text-muted-foreground">Accumulated Rewards</span>
        <span className="text-sm font-mono">
          {parseFloat(status.accumulatedReward).toFixed(4)} OLAS
        </span>
      </div>

      {status.isActivelyStaked && (
        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm text-muted-foreground">Pending (next checkpoint)</span>
          <span className="text-sm font-mono">
            {parseFloat(status.pendingReward).toFixed(4)} OLAS
          </span>
        </div>
      )}

      <div className="flex items-center justify-between py-1.5">
        <span className="text-sm text-muted-foreground">Claimable</span>
        <span className={`text-sm font-mono ${status.hasClaimableRewards ? 'text-green-500' : ''}`}>
          {status.hasClaimableRewards
            ? `${parseFloat(status.totalClaimable).toFixed(4)} OLAS`
            : 'None'
          }
        </span>
      </div>

      <div className="flex items-center justify-between py-1.5">
        <span className="text-sm text-muted-foreground">Contract Reward Pool</span>
        <span className="text-sm font-mono">
          {parseFloat(status.contractAvailableRewards).toFixed(2)} OLAS
        </span>
      </div>
    </div>
  )
}
