import { Metadata } from 'next'
import { Suspense } from 'react'
import { SiteHeader } from '@/components/site-header'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StakedServiceCard } from '@/components/staking/staked-service-card'
import { getStakedServices, getRecentDeliveries, getMechsForServiceIds } from '@/lib/staking/queries'
import {
  ETH_FUNDING_TARGET_WEI,
  ETH_FUNDING_WARNING_WEI,
  JINN_STAKING_CONTRACT,
  stakingAbi,
} from '@/lib/staking/constants'
import {
  formatEthBalance,
  getAddressBalances,
  getEthFundingLevel,
} from '@/lib/staking/balances'
import { getRpcClient } from '@/lib/staking/rpc'

export const metadata: Metadata = {
  title: 'Staking Dashboard',
  description: 'View staked services and epoch progress on the Jinn staking contract',
}

export const dynamic = 'force-dynamic'

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

async function StakedServicesList() {
  const services = await getStakedServices()

  if (services.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No staked services found
      </div>
    )
  }

  // Get on-chain truth: which services are actually staked right now
  let activeServiceIds: Set<string> | null = null
  try {
    const client = getRpcClient()
    const ids = await client.readContract({
      address: JINN_STAKING_CONTRACT,
      abi: stakingAbi,
      functionName: 'getServiceIds',
    }) as bigint[]
    activeServiceIds = new Set(ids.map(id => id.toString()))
  } catch (err) {
    console.warn('[staking] Failed to fetch on-chain service IDs, falling back to Ponder isStaked:', err)
  }

  // Override Ponder's isStaked with on-chain truth when available
  const enrichedServices = services.map(s => ({
    ...s,
    isStaked: activeServiceIds ? activeServiceIds.has(s.serviceId) : s.isStaked,
  }))

  // Sort: actively staked first, then evicted
  enrichedServices.sort((a, b) => {
    if (a.isStaked !== b.isStaked) return a.isStaked ? -1 : 1
    return 0
  })

  const safeBalances = await getAddressBalances(enrichedServices.map((s) => s.multisig))

  const stakedCount = enrichedServices.filter(s => s.isStaked).length
  const evictedCount = enrichedServices.filter(s => !s.isStaked).length
  const fundingHealth = {
    healthy: 0,
    warning: 0,
    critical: 0,
    unknown: 0,
  }
  let fleetSafeEthWei = BigInt(0)

  for (const service of enrichedServices) {
    const safeBalance = safeBalances.get(service.multisig.toLowerCase())
    if (!safeBalance) {
      fundingHealth.unknown += 1
      continue
    }

    fleetSafeEthWei += safeBalance.ethWei
    const level = getEthFundingLevel(safeBalance.ethWei)
    fundingHealth[level] += 1
  }

  const knownFundingCount = fundingHealth.healthy + fundingHealth.warning + fundingHealth.critical
  const healthyWidth = knownFundingCount === 0 ? 0 : (fundingHealth.healthy / knownFundingCount) * 100
  const warningWidth = knownFundingCount === 0 ? 0 : (fundingHealth.warning / knownFundingCount) * 100
  const criticalWidth = knownFundingCount === 0 ? 0 : (fundingHealth.critical / knownFundingCount) * 100

  // Fetch mech mappings for all service IDs
  const serviceIds = enrichedServices.map((s) => s.serviceId)
  const mechs = await getMechsForServiceIds(serviceIds)
  const mechByServiceId = new Map(mechs.map((m) => [m.serviceId, m]))

  // Fetch last delivery timestamp for each service
  const deliveryPromises = enrichedServices.map(async (service) => {
    const deliveries = await getRecentDeliveries(service.multisig, 1)
    return {
      serviceId: service.serviceId,
      lastDeliveryTimestamp: deliveries[0]?.blockTimestamp || null,
    }
  })
  const deliveryResults = await Promise.all(deliveryPromises)
  const lastDeliveryMap = new Map(deliveryResults.map((d) => [d.serviceId, d.lastDeliveryTimestamp]))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="font-mono text-xs">
          <a
            href={`https://basescan.org/address/${JINN_STAKING_CONTRACT}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {truncateAddress(JINN_STAKING_CONTRACT)}
          </a>
        </Badge>
        <span className="text-sm text-muted-foreground">
          {stakedCount} staked{evictedCount > 0 && `, ${evictedCount} evicted`}
        </span>
      </div>
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Fleet Funding Health</span>
            <span className="text-xs text-muted-foreground">
              Target {formatEthBalance(ETH_FUNDING_TARGET_WEI)} ETH · Warning below {formatEthBalance(ETH_FUNDING_WARNING_WEI)} ETH
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted flex">
            <div style={{ width: `${healthyWidth}%` }} className="h-full bg-green-500/80" />
            <div style={{ width: `${warningWidth}%` }} className="h-full bg-yellow-500/80" />
            <div style={{ width: `${criticalWidth}%` }} className="h-full bg-red-500/80" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <div className="rounded border px-2 py-1.5">
              <div className="text-muted-foreground">Healthy</div>
              <div className="font-medium text-green-500">{fundingHealth.healthy}</div>
            </div>
            <div className="rounded border px-2 py-1.5">
              <div className="text-muted-foreground">Warning</div>
              <div className="font-medium text-yellow-500">{fundingHealth.warning}</div>
            </div>
            <div className="rounded border px-2 py-1.5">
              <div className="text-muted-foreground">Low</div>
              <div className="font-medium text-red-500">{fundingHealth.critical}</div>
            </div>
            <div className="rounded border px-2 py-1.5">
              <div className="text-muted-foreground">Unknown</div>
              <div className="font-medium">{fundingHealth.unknown}</div>
            </div>
            <div className="rounded border px-2 py-1.5">
              <div className="text-muted-foreground">Fleet Safe ETH</div>
              <div className="font-medium">{formatEthBalance(fleetSafeEthWei)}</div>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {enrichedServices.map((service) => {
          const balance = safeBalances.get(service.multisig.toLowerCase())
          return (
            <StakedServiceCard
              key={service.id}
              service={service}
              mechAddress={mechByServiceId.get(service.serviceId)?.mech}
              lastDeliveryTimestamp={lastDeliveryMap.get(service.serviceId)}
              safeEthWei={balance?.ethWei}
              safeOlasWei={balance?.olasWei}
            />
          )
        })}
      </div>
    </div>
  )
}

function StakedServicesListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-48 bg-muted animate-pulse rounded" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-5 w-3/4 bg-muted animate-pulse rounded" />
              <div className="h-3 w-1/2 bg-muted animate-pulse rounded mt-2" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-2 w-full bg-muted animate-pulse rounded-full" />
              <div className="h-3 w-24 bg-muted animate-pulse rounded" />
              <div className="h-4 w-full bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function StakingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        subtitle="Staked services and epoch progress"
        breadcrumbs={[
          { label: 'Explorer', href: '/' },
          { label: 'Staking' },
        ]}
      />

      <main className="flex-1 py-6">
        <div className="container mx-auto px-4">
          <Suspense fallback={<StakedServicesListSkeleton />}>
            <StakedServicesList />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
