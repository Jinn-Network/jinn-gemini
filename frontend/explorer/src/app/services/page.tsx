import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getServices, type Service } from '@/lib/ventures-services';
import { GitBranch, ExternalLink } from 'lucide-react';

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
  return <Badge variant="outline" className={colors[type]}>{type}</Badge>;
}

function StatusBadge({ status }: { status: Service['status'] }) {
  const colors: Record<Service['status'], string> = {
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    deprecated: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    archived: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };
  return <Badge variant="outline" className={colors[status]}>{status}</Badge>;
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ServiceCard({ service }: { service: Service }) {
  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="pt-6">
        {/* Identity: name, slug, description */}
        <div className="space-y-1 mb-4">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/services/${service.id}`}
              className="text-lg font-semibold text-primary hover:underline"
            >
              {service.name}
            </Link>
            <StatusBadge status={service.status} />
          </div>
          <code className="text-xs text-muted-foreground">{service.slug}</code>
          {service.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 pt-1">
              {service.description}
            </p>
          )}
        </div>

        {/* Technical: service_type, primary_language, version, repository_url */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <ServiceTypeBadge type={service.service_type} />
          {service.primary_language && (
            <Badge variant="secondary">{service.primary_language}</Badge>
          )}
          {service.version && (
            <Badge variant="outline">v{service.version}</Badge>
          )}
        </div>

        {service.repository_url && (
          <a
            href={service.repository_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary mb-3"
          >
            <GitBranch className="h-3 w-3" />
            {new URL(service.repository_url).pathname.slice(1)}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* Metadata: tags, timestamps */}
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3 mt-3">
          <div className="flex flex-wrap gap-1">
            {service.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="bg-muted px-1.5 py-0.5 rounded">{tag}</span>
            ))}
            {service.tags.length > 3 && (
              <span className="text-muted-foreground">+{service.tags.length - 3}</span>
            )}
          </div>
          <span>Updated {formatDate(service.updated_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {services.map((service) => (
        <ServiceCard key={service.id} service={service} />
      ))}
    </div>
  );
}

function ServicesListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="pt-6 space-y-3">
            <div className="h-5 w-3/4 bg-muted animate-pulse rounded" />
            <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
            <div className="flex gap-2">
              <div className="h-5 w-12 bg-muted animate-pulse rounded" />
              <div className="h-5 w-16 bg-muted animate-pulse rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
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
