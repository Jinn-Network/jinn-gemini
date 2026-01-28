import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getServices, type Service } from '@/lib/ventures-services';

export const metadata: Metadata = {
  title: 'Services Registry',
  description: 'Browse all registered services in the Jinn platform',
};

export const dynamic = 'force-dynamic';

function ServiceTypeBadge({ type }: { type: Service['service_type'] }) {
  const colors: Record<Service['service_type'], string> = {
    mcp: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    api: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    worker: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    frontend: 'bg-green-500/10 text-green-500 border-green-500/20',
    library: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    other: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };

  return (
    <Badge variant="outline" className={colors[type]}>
      {type}
    </Badge>
  );
}

function StatusBadge({ status }: { status: Service['status'] }) {
  const colors: Record<Service['status'], string> = {
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    deprecated: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    archived: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };

  return (
    <Badge variant="outline" className={colors[status]}>
      {status}
    </Badge>
  );
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function ServicesList() {
  const services = await getServices({ status: 'active' });

  if (services.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No services found
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Language</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.id}>
              <TableCell>
                <Link
                  href={`/services/${service.id}`}
                  className="text-primary hover:underline font-medium"
                >
                  {service.name}
                </Link>
                {service.description && (
                  <p className="text-sm text-muted-foreground truncate max-w-md">
                    {service.description}
                  </p>
                )}
              </TableCell>
              <TableCell>
                <ServiceTypeBadge type={service.service_type} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {service.primary_language || '-'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {service.version || '-'}
              </TableCell>
              <TableCell>
                <StatusBadge status={service.status} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatDate(service.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ServicesListSkeleton() {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="p-4 space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-5 w-48 bg-muted animate-pulse rounded" />
            <div className="h-5 w-16 bg-muted animate-pulse rounded" />
            <div className="h-5 w-20 bg-muted animate-pulse rounded" />
            <div className="flex-1" />
            <div className="h-5 w-24 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ServicesPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        subtitle="Registered services in the Jinn platform"
        breadcrumbs={[
          { label: 'Explorer', href: '/' },
          { label: 'Services' },
        ]}
      />

      <main className="flex-1 py-6">
        <div className="container mx-auto px-4">
          <Suspense fallback={<ServicesListSkeleton />}>
            <ServicesList />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
