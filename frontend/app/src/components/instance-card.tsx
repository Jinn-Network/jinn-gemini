import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExplorerLink } from '@/components/explorer-link';
import { formatRelativeTime, truncateAddress } from '@jinn/shared-ui';
import type { ServiceInstance } from '@/lib/service-types';

interface InstanceCardProps {
  instance: ServiceInstance;
}

export function InstanceCard({ instance }: InstanceCardProps) {
  const status = instance.delivered ? 'completed' : 'active';

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <Link href={`/instances/${instance.workstreamId}`}>
              <CardTitle className="text-lg hover:text-primary transition-colors cursor-pointer">
                {instance.jobName}
              </CardTitle>
            </Link>
            <CardDescription className="mt-1">
              Created by {truncateAddress(instance.sender)}
            </CardDescription>
          </div>
          <Badge variant={status === 'active' ? 'default' : 'secondary'}>
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {formatRelativeTime(instance.blockTimestamp)}
          </span>
          <ExplorerLink type="workstream" id={instance.workstreamId}>
            Details
          </ExplorerLink>
        </div>
      </CardContent>
    </Card>
  );
}

// Loading skeleton
export function InstanceCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <div className="h-5 w-36 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-4 w-24 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-5 w-16 animate-pulse rounded bg-muted" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}
