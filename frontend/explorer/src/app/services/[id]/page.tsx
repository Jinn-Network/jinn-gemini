import { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getServiceWithDetails,
  getVenture,
  type Service,
  type Deployment,
  type Interface,
} from '@/lib/ventures-services';
import { ExternalLink, GitBranch, Globe, Clock, AlertCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface ServicePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { id } = await params;
  const { service } = await getServiceWithDetails(id);
  return {
    title: service?.name || 'Service',
    description: service?.description || 'Service details',
  };
}

// Shared badge components
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

function StatusBadge({ status, size = 'default' }: { status: string; size?: 'sm' | 'default' }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    healthy: 'bg-green-500/10 text-green-500 border-green-500/20',
    deprecated: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    degraded: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    unhealthy: 'bg-red-500/10 text-red-500 border-red-500/20',
    failed: 'bg-red-500/10 text-red-500 border-red-500/20',
    archived: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    unknown: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    stopped: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    deploying: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    removed: 'bg-red-500/10 text-red-500 border-red-500/20',
  };
  const className = size === 'sm' ? 'text-xs px-1.5 py-0' : '';
  return <Badge variant="outline" className={`${colors[status] || colors.unknown} ${className}`}>{status}</Badge>;
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatDateTime(dateString: string) {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Deployment Card - reflects Deployment interface structure
function DeploymentCard({ deployment }: { deployment: Deployment }) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {/* Environment & Provider */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="default">{deployment.environment}</Badge>
            <span className="text-sm text-muted-foreground">{deployment.provider}</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={deployment.status} size="sm" />
            <StatusBadge status={deployment.health_status} size="sm" />
          </div>
        </div>

        {/* URLs */}
        {deployment.url && (
          <a
            href={deployment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Globe className="h-3 w-3" />
            {deployment.url}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* Provider IDs */}
        {(deployment.provider_project_id || deployment.provider_service_id) && (
          <div className="text-xs text-muted-foreground font-mono space-y-0.5">
            {deployment.provider_project_id && <div>project: {deployment.provider_project_id}</div>}
            {deployment.provider_service_id && <div>service: {deployment.provider_service_id}</div>}
          </div>
        )}

        {/* Health & Version */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <div className="flex items-center gap-3">
            {deployment.version && <span>v{deployment.version}</span>}
            {deployment.health_check_url && (
              <a href={deployment.health_check_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                health endpoint
              </a>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDateTime(deployment.deployed_at)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Interface Card - reflects Interface structure
function InterfaceCard({ iface }: { iface: Interface }) {
  const typeColors: Record<Interface['interface_type'], string> = {
    mcp_tool: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    rest_endpoint: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    graphql: 'bg-pink-500/10 text-pink-500 border-pink-500/20',
    grpc: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    websocket: 'bg-green-500/10 text-green-500 border-green-500/20',
    webhook: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    other: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {/* Name & Type */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-sm font-medium">
              {iface.http_method && <span className="text-muted-foreground mr-1">{iface.http_method}</span>}
              {iface.name}
            </div>
            {iface.http_path && (
              <code className="text-xs text-muted-foreground">{iface.http_path}</code>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className={typeColors[iface.interface_type]}>
              {iface.interface_type.replace('_', ' ')}
            </Badge>
            <StatusBadge status={iface.status} size="sm" />
          </div>
        </div>

        {/* Description */}
        {iface.description && (
          <p className="text-sm text-muted-foreground">{iface.description}</p>
        )}

        {/* Auth */}
        <div className="flex items-center gap-2 text-xs">
          {iface.auth_required ? (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
              auth: {iface.auth_type || 'required'}
            </Badge>
          ) : (
            <span className="text-muted-foreground">no auth</span>
          )}
          {iface.x402_price > 0 && (
            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
              {iface.x402_price} wei
            </Badge>
          )}
        </div>

        {/* Tags & Timestamps */}
        {iface.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {iface.tags.map((tag) => (
              <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded">{tag}</span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function ServiceDetail({ id }: { id: string }) {
  const { service, deployments, interfaces } = await getServiceWithDetails(id);

  if (!service) {
    notFound();
  }

  const venture = await getVenture(service.venture_id);

  return (
    <div className="space-y-6">
      {/* === SERVICE: Identity Group === */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* id, name, slug */}
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold">{service.name}</h1>
                <StatusBadge status={service.status} />
              </div>
              <code className="text-sm text-muted-foreground">{service.slug}</code>
              <div className="text-xs text-muted-foreground font-mono mt-1">id: {service.id}</div>
            </div>

            {/* description */}
            {service.description && (
              <p className="text-muted-foreground">{service.description}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* === SERVICE: Technical Group === */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Technical Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* service_type, primary_language, version */}
          <div className="flex flex-wrap items-center gap-2">
            <ServiceTypeBadge type={service.service_type} />
            {service.primary_language && (
              <Badge variant="secondary">{service.primary_language}</Badge>
            )}
            {service.version && (
              <Badge variant="outline">v{service.version}</Badge>
            )}
          </div>

          {/* repository_url */}
          {service.repository_url && (
            <a
              href={service.repository_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <GitBranch className="h-4 w-4" />
              {service.repository_url}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </CardContent>
      </Card>

      {/* === SERVICE: Metadata Group === */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* venture_id */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Venture:</span>
            {venture ? (
              <Link href={`/ventures/${venture.root_workstream_id || venture.id}`} className="text-primary hover:underline">
                {venture.name}
              </Link>
            ) : (
              <code className="text-xs text-muted-foreground">{service.venture_id}</code>
            )}
          </div>

          {/* tags */}
          {service.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {service.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}

          {/* created_at, updated_at */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Created: {formatDate(service.created_at)}</span>
            <span>Updated: {formatDate(service.updated_at)}</span>
          </div>
        </CardContent>
      </Card>

      {/* === DEPLOYMENTS (nested) === */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Deployments
          <Badge variant="secondary">{deployments.length}</Badge>
        </h2>
        {deployments.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <AlertCircle className="h-5 w-5 mx-auto mb-2 opacity-50" />
              No deployments registered
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {deployments.map((deployment) => (
              <DeploymentCard key={deployment.id} deployment={deployment} />
            ))}
          </div>
        )}
      </div>

      {/* === INTERFACES (nested) === */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Interfaces
          <Badge variant="secondary">{interfaces.length}</Badge>
        </h2>
        {interfaces.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <AlertCircle className="h-5 w-5 mx-auto mb-2 opacity-50" />
              No interfaces registered
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {interfaces.map((iface) => (
              <InterfaceCard key={iface.id} iface={iface} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="h-8 w-64 bg-muted animate-pulse rounded" />
          <div className="h-4 w-32 bg-muted animate-pulse rounded" />
          <div className="h-16 w-full bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="h-5 w-40 bg-muted animate-pulse rounded" />
          <div className="flex gap-2">
            <div className="h-6 w-16 bg-muted animate-pulse rounded" />
            <div className="h-6 w-20 bg-muted animate-pulse rounded" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function ServicePage({ params }: ServicePageProps) {
  const { id } = await params;
  const { service } = await getServiceWithDetails(id);

  if (!service) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        breadcrumbs={[
          { label: 'Explorer', href: '/' },
          { label: 'Services', href: '/services' },
          { label: service.name },
        ]}
      />

      <main className="flex-1 py-6">
        <div className="container mx-auto px-4 max-w-4xl">
          <Suspense fallback={<ServiceDetailSkeleton />}>
            <ServiceDetail id={id} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
