import { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getServiceWithDetails,
  getVenture,
  type Service,
  type Deployment,
  type Interface,
} from '@/lib/ventures-services';
import { ExternalLink, GitBranch, Globe, Server, Code, FileText } from 'lucide-react';

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

function HealthBadge({ status }: { status: Deployment['health_status'] }) {
  const colors: Record<Deployment['health_status'], string> = {
    healthy: 'bg-green-500/10 text-green-500 border-green-500/20',
    unhealthy: 'bg-red-500/10 text-red-500 border-red-500/20',
    degraded: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    unknown: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };

  return (
    <Badge variant="outline" className={colors[status]}>
      {status}
    </Badge>
  );
}

function EnvironmentBadge({ env }: { env: Deployment['environment'] }) {
  const colors: Record<Deployment['environment'], string> = {
    production: 'bg-green-500/10 text-green-500 border-green-500/20',
    staging: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    development: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    preview: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  };

  return (
    <Badge variant="outline" className={colors[env]}>
      {env}
    </Badge>
  );
}

function InterfaceTypeBadge({ type }: { type: Interface['interface_type'] }) {
  const colors: Record<Interface['interface_type'], string> = {
    mcp_tool: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    rest_endpoint: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    graphql: 'bg-pink-500/10 text-pink-500 border-pink-500/20',
    grpc: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    websocket: 'bg-green-500/10 text-green-500 border-green-500/20',
    webhook: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    other: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };

  return (
    <Badge variant="outline" className={colors[type]}>
      {type.replace('_', ' ')}
    </Badge>
  );
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DeploymentsSection({ deployments }: { deployments: Deployment[] }) {
  if (deployments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No deployments registered
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Environment</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Health</TableHead>
          <TableHead>URL</TableHead>
          <TableHead className="text-right">Deployed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deployments.map((deployment) => (
          <TableRow key={deployment.id}>
            <TableCell>
              <EnvironmentBadge env={deployment.environment} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {deployment.provider}
            </TableCell>
            <TableCell>
              <HealthBadge status={deployment.health_status} />
            </TableCell>
            <TableCell>
              {deployment.url ? (
                <a
                  href={deployment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Globe className="h-3 w-3" />
                  {new URL(deployment.url).hostname}
                </a>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatDate(deployment.deployed_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function InterfacesSection({ interfaces }: { interfaces: Interface[] }) {
  if (interfaces.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No interfaces registered
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Auth</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {interfaces.map((iface) => (
          <TableRow key={iface.id}>
            <TableCell className="font-mono text-sm">
              {iface.http_method && (
                <span className="text-muted-foreground mr-2">{iface.http_method}</span>
              )}
              {iface.name}
            </TableCell>
            <TableCell>
              <InterfaceTypeBadge type={iface.interface_type} />
            </TableCell>
            <TableCell>
              {iface.auth_required ? (
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                  {iface.auth_type || 'required'}
                </Badge>
              ) : (
                <span className="text-muted-foreground">none</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground max-w-md truncate">
              {iface.description || '-'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{service.name}</h1>
            <ServiceTypeBadge type={service.service_type} />
          </div>
          {service.description && (
            <p className="text-muted-foreground max-w-2xl">{service.description}</p>
          )}
          {venture && (
            <p className="text-sm text-muted-foreground">
              Part of{' '}
              <Link href={`/ventures/${venture.id}`} className="text-primary hover:underline">
                {venture.name}
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {service.repository_url && (
            <a
              href={service.repository_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-md hover:bg-muted"
            >
              <GitBranch className="h-4 w-4" />
              Repository
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{service.version || '-'}</div>
            <div className="text-sm text-muted-foreground">Version</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{service.primary_language || '-'}</div>
            <div className="text-sm text-muted-foreground">Language</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{deployments.length}</div>
            <div className="text-sm text-muted-foreground">Deployments</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{interfaces.length}</div>
            <div className="text-sm text-muted-foreground">Interfaces</div>
          </CardContent>
        </Card>
      </div>

      {/* Deployments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Deployments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DeploymentsSection deployments={deployments} />
        </CardContent>
      </Card>

      {/* Interfaces */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Interfaces
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InterfacesSection interfaces={interfaces} />
        </CardContent>
      </Card>

      {/* Tags */}
      {service.tags.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Tags:</span>
          {service.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-5 w-96 bg-muted animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="h-8 w-16 bg-muted animate-pulse rounded mb-2" />
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="h-48 bg-muted/20 animate-pulse rounded" />
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
        <div className="container mx-auto px-4">
          <Suspense fallback={<ServiceDetailSkeleton />}>
            <ServiceDetail id={id} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
