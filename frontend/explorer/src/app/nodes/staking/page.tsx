import { Metadata } from 'next'
import { Suspense } from 'react'
import { SiteHeader } from '@/components/site-header'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StakedServiceCard } from '@/components/staking/staked-service-card'
import { getStakedServices, getRecentDeliveries, getMechsForServiceIds } from '@/lib/staking/queries'
import { JINN_STAKING_CONTRACT } from '@/lib/staking/constants'

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

  // Fetch mech mappings for all service IDs
  const serviceIds = services.map((s) => s.serviceId)
  const mechs = await getMechsForServiceIds(serviceIds)
  const mechByServiceId = new Map(mechs.map((m) => [m.serviceId, m]))

  // Fetch last delivery timestamp for each service
  const deliveryPromises = services.map(async (service) => {
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
          {services.length} staked service{services.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((service) => (
          <StakedServiceCard
            key={service.id}
            service={service}
            mechAddress={mechByServiceId.get(service.serviceId)?.mech}
            lastDeliveryTimestamp={lastDeliveryMap.get(service.serviceId)}
          />
        ))}
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
