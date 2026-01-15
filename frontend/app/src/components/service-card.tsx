import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExplorerLink } from '@/components/explorer-link';
import type { Service } from '@/lib/service-types';

interface ServiceCardProps {
  service: Service;
  featured?: boolean;
}

export function ServiceCard({ service, featured }: ServiceCardProps) {
  return (
    <Card className={featured ? 'border-primary/50 bg-gradient-to-br from-primary/5 to-transparent' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-xl">{service.name}</CardTitle>
            <CardDescription className="mt-2">
              {service.description || 'Autonomous blog management service'}
            </CardDescription>
          </div>
          {featured && (
            <Badge variant="secondary">Featured</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{service.runCount}</span> active instances
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <ExplorerLink type="templates" id={service.id}>
          View in Explorer
        </ExplorerLink>
        <Button disabled>
          Coming Soon
        </Button>
      </CardFooter>
    </Card>
  );
}

// Loading skeleton
export function ServiceCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-full animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </CardContent>
      <CardFooter>
        <div className="h-9 w-24 animate-pulse rounded bg-muted" />
      </CardFooter>
    </Card>
  );
}
