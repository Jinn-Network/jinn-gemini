import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { EpochProgress } from './epoch-progress'
import type { StakedService } from '@/lib/staking/queries'

interface StakedServiceCardProps {
  service: StakedService
  mechAddress?: string
  lastDeliveryTimestamp?: string | null
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function StakedServiceCard({ service, lastDeliveryTimestamp }: StakedServiceCardProps) {
  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">
            <Link href={`/nodes/staking/${service.serviceId}`} className="hover:text-primary hover:underline">
              Service {service.serviceId}
            </Link>
          </CardTitle>
          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
            staked
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground font-mono">
          Owner: {truncateAddress(service.owner)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <EpochProgress multisig={service.multisig} />
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
