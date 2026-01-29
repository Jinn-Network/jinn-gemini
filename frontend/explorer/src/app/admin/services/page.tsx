import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getServices, getVentures } from '@/lib/ventures-services';
import { Plus, Pencil } from 'lucide-react';

export const metadata = {
  title: 'Manage Services',
  description: 'Create and edit services',
};

export const dynamic = 'force-dynamic';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    deprecated: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    archived: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };
  return (
    <Badge variant="outline" className={colors[status] || colors.archived}>
      {status}
    </Badge>
  );
}

function ServiceTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    mcp: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    api: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    worker: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    frontend: 'bg-green-500/10 text-green-500 border-green-500/20',
    library: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    other: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };
  return (
    <Badge variant="outline" className={colors[type] || colors.other}>
      {type}
    </Badge>
  );
}

export default async function ServicesAdminPage() {
  const [services, ventures] = await Promise.all([
    getServices(),
    getVentures(),
  ]);

  const ventureMap = new Map(ventures.map(v => [v.id, v]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Services</h1>
          <p className="text-muted-foreground">
            {services.length} service{services.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/services/new">
            <Plus className="h-4 w-4 mr-1" />
            Create Service
          </Link>
        </Button>
      </div>

      {services.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No services yet.</p>
            <Button asChild className="mt-4">
              <Link href="/admin/services/new">Create your first service</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {services.map((service) => {
            const venture = ventureMap.get(service.venture_id);
            return (
              <Card key={service.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        {service.name}
                        <ServiceTypeBadge type={service.service_type} />
                      </CardTitle>
                      <p className="text-sm text-muted-foreground font-mono">
                        {service.slug}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={service.status} />
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/admin/services/${service.id}`}>
                          <Pencil className="h-4 w-4 mr-1" />
                          Edit
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {service.description && (
                    <p className="text-sm text-muted-foreground mb-3">
                      {service.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {venture && (
                      <span>
                        Venture:{' '}
                        <Link href={`/admin/ventures/${venture.id}`} className="text-primary hover:underline">
                          {venture.name}
                        </Link>
                      </span>
                    )}
                    {service.primary_language && (
                      <span>Language: {service.primary_language}</span>
                    )}
                    {service.version && (
                      <span>v{service.version}</span>
                    )}
                    {service.tags.length > 0 && (
                      <span>Tags: {service.tags.join(', ')}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
