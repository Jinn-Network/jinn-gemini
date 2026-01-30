import { Suspense } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { FeaturedVentureCardSkeleton } from '@/components/ventures/featured-venture-card';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getVentures, type Venture } from '@/lib/ventures-services';

function VentureCard({ venture }: { venture: Venture }) {
  // Link to the root workstream if available, otherwise to the venture ID
  const href = venture.root_workstream_id
    ? `/ventures/${venture.root_workstream_id}`
    : `/ventures/${venture.id}`;

  return (
    <Card className="relative overflow-hidden border-primary/50 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent opacity-50" />
      <CardHeader className="relative">
        <CardTitle className="text-2xl">{venture.name}</CardTitle>
        <CardDescription className="mt-2 text-base">
          {venture.description}
        </CardDescription>
      </CardHeader>
      <CardFooter className="relative">
        <Button asChild variant="default" className="flex-1">
          <Link href={href}>View Dashboard</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

async function VenturesList() {
  const ventures = await getVentures();

  if (ventures.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No ventures found
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {ventures.map((venture) => (
        <VentureCard key={venture.id} venture={venture} />
      ))}
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
