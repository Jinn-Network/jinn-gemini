import { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StakedServiceCard } from '@/components/staking/staked-service-card'
import { getStakedServices, getRecentDeliveries, getMechsForServiceIds } from '@/lib/staking/queries'
import {
  JINN_STAKING_CONTRACT,
  stakingAbi,
} from '@/lib/staking/constants'
import {
  formatEthBalance,
  formatOlasBalance,
  getAddressBalances,
  getAgentEoaAddress,
} from '@/lib/staking/balances'
import { formatDate } from '@/lib/utils'
import { getRpcClient } from '@/lib/staking/rpc'

export const metadata: Metadata = {
  title: 'Staking Dashboard',
  description: 'View staked services and epoch progress on the Jinn staking contract',
}

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ view?: string }>
}

type ViewMode = 'table' | 'cards'
type RiskLevel = 'low' | 'medium' | 'high' | 'evicted'

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function ViewToggle({ viewMode }: { viewMode: ViewMode }) {
  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm transition-colors ${active
      ? 'bg-background shadow-sm border text-foreground'
      : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="inline-flex items-center rounded-lg border bg-muted/30 p-1">
      <Link href="/nodes/staking" className={tabClass(viewMode === 'table')}>
        Table
      </Link>
      <Link href="/nodes/staking?view=cards" className={tabClass(viewMode === 'cards')}>
        Cards
      </Link>
    </div>
  )
}

function getEvictionRisk(isStaked: boolean, lastDeliveryTimestamp: string | null): RiskLevel {
  if (!isStaked) return 'evicted'
  if (!lastDeliveryTimestamp) return 'high'

  const ageMs = Date.now() - new Date(lastDeliveryTimestamp).getTime()
  const ageHours = ageMs / (1000 * 60 * 60)

  if (ageHours >= 24) return 'high'
  if (ageHours >= 12) return 'medium'
  return 'low'
}

function RiskBadge({ risk }: { risk: RiskLevel }) {
  if (risk === 'evicted') {
    return <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20">Evicted</Badge>
  }
  if (risk === 'high') {
    return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">High Risk</Badge>
  }
  if (risk === 'medium') {
    return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Medium Risk</Badge>
  }
  return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Low Risk</Badge>
}

async function StakedServicesList({ viewMode }: { viewMode: ViewMode }) {
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

  const agentEntries = await Promise.all(
    enrichedServices.map(async (service) => [service.serviceId, await getAgentEoaAddress(service.serviceId)] as const)
  )
  const agentEoaByServiceId = new Map(agentEntries)

  const balances = await getAddressBalances([
    ...enrichedServices.map((s) => s.multisig),
    ...agentEntries.flatMap(([, agentEoa]) => (agentEoa ? [agentEoa] : [])),
  ])
  const stakedCount = enrichedServices.filter(s => s.isStaked).length
  const evictedCount = enrichedServices.filter(s => !s.isStaked).length

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
      {viewMode === 'cards' ? (
        <CardsView
          services={enrichedServices}
          balances={balances}
          agentEoaByServiceId={agentEoaByServiceId}
          lastDeliveryMap={lastDeliveryMap}
        />
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service ID</TableHead>
                <TableHead>Status / Risk</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>ETH + OLAS</TableHead>
                <TableHead>Last Delivery</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrichedServices.map((service) => {
                const safeBalance = balances.get(service.multisig.toLowerCase())
                const agentEoa = agentEoaByServiceId.get(service.serviceId)
                const agentBalance = agentEoa ? balances.get(agentEoa.toLowerCase()) : null
                const primaryEthWei = agentBalance?.ethWei ?? safeBalance?.ethWei
                const lastDeliveryTimestamp = lastDeliveryMap.get(service.serviceId) || null
                const risk = getEvictionRisk(service.isStaked, lastDeliveryTimestamp)
                return (
                  <TableRow key={service.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/nodes/staking/${service.serviceId}`} className="text-primary hover:underline">
                        {service.serviceId}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        <Badge
                          variant="outline"
                          className={service.isStaked
                            ? 'bg-green-500/10 text-green-500 border-green-500/20'
                            : 'bg-orange-500/10 text-orange-500 border-orange-500/20'}
                        >
                          {service.isStaked ? 'Staked' : 'Evicted'}
                        </Badge>
                        <RiskBadge risk={risk} />
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <a
                        href={`https://basescan.org/address/${service.owner}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {truncateAddress(service.owner)}
                      </a>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="space-y-0.5 font-mono">
                        <div>{formatEthBalance(primaryEthWei)} ETH</div>
                        <div>{formatOlasBalance(safeBalance?.olasWei)} OLAS</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {lastDeliveryTimestamp ? formatDate(lastDeliveryTimestamp) : 'No delivery yet'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/nodes/staking/${service.serviceId}`}>View Details</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

async function CardsView({
  services,
  balances,
  agentEoaByServiceId,
  lastDeliveryMap,
}: {
  services: Awaited<ReturnType<typeof getStakedServices>>
  balances: Awaited<ReturnType<typeof getAddressBalances>>
  agentEoaByServiceId: Map<string, string | null>
  lastDeliveryMap: Map<string, string | null>
}) {
  const serviceIds = services.map((s) => s.serviceId)
  const mechs = await getMechsForServiceIds(serviceIds)
  const mechByServiceId = new Map(mechs.map((m) => [m.serviceId, m]))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {services.map((service) => {
        const safeBalance = balances.get(service.multisig.toLowerCase())
        const agentEoa = agentEoaByServiceId.get(service.serviceId)
        const agentBalance = agentEoa ? balances.get(agentEoa.toLowerCase()) : null
        const primaryEthWei = agentBalance?.ethWei ?? safeBalance?.ethWei
        return (
          <StakedServiceCard
            key={service.id}
            service={service}
            mechAddress={mechByServiceId.get(service.serviceId)?.mech}
            lastDeliveryTimestamp={lastDeliveryMap.get(service.serviceId)}
            primaryEthWei={primaryEthWei}
            primaryEthLabel={agentBalance?.ethWei != null ? 'Agent EOA ETH' : 'Service Safe ETH'}
          />
        )
      })}
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

export default async function StakingPage({ searchParams }: PageProps) {
  const params = await searchParams
  const viewMode: ViewMode = params.view === 'cards' ? 'cards' : 'table'

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
        <div className="container mx-auto px-4 space-y-4">
          <ViewToggle viewMode={viewMode} />
          <Suspense fallback={<StakedServicesListSkeleton />}>
            <StakedServicesList viewMode={viewMode} />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
