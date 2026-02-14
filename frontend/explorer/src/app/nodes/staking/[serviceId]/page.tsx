import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SiteHeader } from '@/components/site-header'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { EpochProgress } from '@/components/staking/epoch-progress'
import { ServiceStakingStatus } from '@/components/staking/service-staking-status'
import { DeliveriesTable, RequestsTable } from '@/components/staking/service-deliveries-table'
import { getStakedServiceByServiceId, getMechsForServiceIds, getRecentDeliveries, getRecentRequests } from '@/lib/staking/queries'
import { formatDate } from '@/lib/utils'

interface PageProps {
  params: Promise<{ serviceId: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { serviceId } = await params
  return {
    title: `Service ${serviceId} - Staking`,
    description: `Staking details for service ${serviceId}`,
  }
}

export const dynamic = 'force-dynamic'

function AddressLink({ address, label }: { address: string; label: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <a
        href={`https://basescan.org/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-mono text-primary hover:underline"
      >
        {address}
      </a>
    </div>
  )
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const { serviceId } = await params
  const service = await getStakedServiceByServiceId(serviceId)

  if (!service) {
    notFound()
  }

  const [mechs, deliveries] = await Promise.all([
    getMechsForServiceIds([service.serviceId]),
    getRecentDeliveries(service.multisig, 50),
  ])

  const mech = mechs[0]
  const requests = mech ? await getRecentRequests(mech.mech, 50) : []

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        breadcrumbs={[
          { label: 'Explorer', href: '/' },
          { label: 'Staking', href: '/nodes/staking' },
          { label: `Service ${serviceId}` },
        ]}
      />

      <main className="flex-1 py-6">
        <div className="container mx-auto px-4 space-y-6">
          {/* Service Info Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Service {serviceId}</CardTitle>
                <ServiceStakingStatus serviceId={serviceId} variant="badge" />
              </div>
            </CardHeader>
            <CardContent className="space-y-1 divide-y">
              <AddressLink address={service.owner} label="Owner" />
              <AddressLink address={service.multisig} label="Multisig" />
              {mech && <AddressLink address={mech.mech} label="Mech" />}
              <AddressLink address={service.stakingContract} label="Staking Contract" />
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-muted-foreground">Staked Since</span>
                <span className="text-sm">{formatDate(service.stakedAt)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Staking Status & Rewards */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Staking Rewards</CardTitle>
            </CardHeader>
            <CardContent>
              <ServiceStakingStatus serviceId={serviceId} variant="full" />
            </CardContent>
          </Card>

          {/* Epoch Progress */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Epoch Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <EpochProgress multisig={service.multisig} />
            </CardContent>
          </Card>

          {/* Recent Deliveries */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Recent Deliveries</h2>
            <DeliveriesTable deliveries={deliveries} />
          </div>

          {/* Recent Requests */}
          {mech && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Recent Requests</h2>
              <RequestsTable requests={requests} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
