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
  inactivity: number
}

interface ServiceStakingStatusProps {
  serviceId: string
  variant?: 'badge' | 'full'
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
    const interval = setInterval(fetchStatus, 120_000) // poll every 2 min
    return () => clearInterval(interval)
  }, [fetchStatus])

  if (error) return null // fail silently in badge mode
  if (!status) return null

  if (variant === 'badge') {
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

  // Full variant — used on detail page
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between py-1.5">
        <span className="text-sm text-muted-foreground">On-chain Status</span>
        <div className="flex items-center gap-2">
          {status.isEvicted ? (
            <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20">
              evicted
            </Badge>
          ) : status.isActivelyStaked ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
              staked
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-gray-500/10 text-gray-500 border-gray-500/20">
              unstaked
            </Badge>
          )}
        </div>
      </div>

      {status.isEvicted && (
        <div className="rounded-md border border-orange-500/20 bg-orange-500/5 p-3 text-sm">
          <p className="font-medium text-orange-500">Service Evicted</p>
          <p className="text-muted-foreground mt-1">
            This service was removed from active staking due to insufficient activity.
            Rewards accumulated before eviction may still be claimable. To restake, run:{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              tsx scripts/migrate-staking-contract.ts --service-id={serviceId} --source=jinn --target=jinn
            </code>
          </p>
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
