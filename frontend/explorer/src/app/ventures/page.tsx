import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { FeaturedVentureCard, FeaturedVentureCardSkeleton } from '@/components/ventures/featured-venture-card';
import { getServiceInstances } from '@/lib/ventures/service-queries';
import { FEATURED_VENTURES } from '@/lib/ventures/featured-ventures';

async function VenturesList() {
  const instances = await getServiceInstances();

  // Get only the featured ventures
  const featuredIds = new Set(FEATURED_VENTURES.map(f => f.id));
  const ventures = instances.filter(i => featuredIds.has(i.id));

  if (ventures.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No ventures found
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {ventures.map((instance) => {
        const ventureInfo = FEATURED_VENTURES.find(f => f.id === instance.id);
        return (
          <FeaturedVentureCard
            key={instance.id}
            instance={instance}
            name={ventureInfo?.name || instance.jobName}
            description={ventureInfo?.description || ''}
          />
        );
      })}
    </div>
  );
}

function VenturesListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <FeaturedVentureCardSkeleton />
      <FeaturedVentureCardSkeleton />
    </div>
  );
}

export default function VenturesPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        breadcrumbs={[
          { label: 'Explorer', href: '/' },
          { label: 'Ventures' }
        ]}
      />

      <main className="flex-1 py-6">
        <div className="container mx-auto px-4">
          <Suspense fallback={<VenturesListSkeleton />}>
            <VenturesList />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
