import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowRight } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { EpochProgress } from './epoch-progress'
import { ServiceStakingStatus } from './service-staking-status'
import type { StakedService } from '@/lib/staking/queries'
import { formatEthBalance, formatOlasBalance, getEthFundingLevel } from '@/lib/staking/balances'

interface StakedServiceCardProps {
  service: StakedService
  mechAddress?: string
  lastDeliveryTimestamp?: string | null
  safeEthWei?: bigint | null
  safeOlasWei?: bigint | null
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function FundingBadge({ ethWei }: { ethWei: bigint }) {
  const level = getEthFundingLevel(ethWei)
  if (level === 'healthy') {
    return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Healthy</Badge>
  }
  if (level === 'warning') {
    return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Warning</Badge>
  }
  return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">Low</Badge>
}

export function StakedServiceCard({ service, lastDeliveryTimestamp, safeEthWei, safeOlasWei }: StakedServiceCardProps) {
  const isEvicted = !service.isStaked
  return (
    <Card className={`hover:border-primary/50 transition-colors ${isEvicted ? 'opacity-60' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">
            <Link href={`/nodes/staking/${service.serviceId}`} className="hover:text-primary hover:underline">
              Service {service.serviceId}
            </Link>
          </CardTitle>
          <ServiceStakingStatus serviceId={service.serviceId} variant="badge" />
        </div>
        <p className="text-sm text-muted-foreground font-mono">
          Owner: {truncateAddress(service.owner)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <EpochProgress multisig={service.multisig} serviceId={service.serviceId} />
        <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Safe ETH</span>
            {safeEthWei != null ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono">{formatEthBalance(safeEthWei)} ETH</span>
                <FundingBadge ethWei={safeEthWei} />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Unavailable</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Safe OLAS</span>
            <span className="text-xs font-mono">
              {safeOlasWei != null ? `${formatOlasBalance(safeOlasWei)} OLAS` : 'Unavailable'}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Staked {formatDate(service.stakedAt)}</span>
          {lastDeliveryTimestamp && (
            <span>Last delivery {formatDate(lastDeliveryTimestamp)}</span>
          )}
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={`/nodes/staking/${service.serviceId}`} className="flex items-center gap-1">
            View Details <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
