import { SiteHeader } from '@/components/site-header';
import { FeaturedVentureCardSkeleton } from '@/components/ventures/featured-venture-card';

export default function VenturesLoading() {
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeaturedVentureCardSkeleton />
            <FeaturedVentureCardSkeleton />
          </div>
        </div>
      </main>
    </div>
  );
}
