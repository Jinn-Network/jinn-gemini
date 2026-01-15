import { Suspense } from 'react';
import { NavHeader } from '@/components/nav-header';
import { ServiceCard, ServiceCardSkeleton } from '@/components/service-card';
import { InstanceCard, InstanceCardSkeleton } from '@/components/instance-card';
import { getServices, getServiceInstances } from '@/lib/service-queries';
import { EXPLORER_URL, FEATURED_SERVICE_ID } from '@/lib/featured-services';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

async function FeaturedService() {
  const services = await getServices();
  // Find the featured service by ID, fallback to first service
  const featuredService = services.find(s => s.id === FEATURED_SERVICE_ID) || services[0];

  if (!featuredService) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
        No services available yet
      </div>
    );
  }

  return <ServiceCard service={featuredService} featured />;
}

async function ServiceInstances() {
  const instances = await getServiceInstances();

  if (instances.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
        No active service instances
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {instances.slice(0, 6).map((instance) => (
        <InstanceCard key={instance.id} instance={instance} />
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavHeader />

      <div className="flex-1">
        {/* Hero Section */}
        <section className="border-b bg-gradient-to-b from-primary/5 to-transparent py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Autonomous Blog Management
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              Powered by AI agents, Jinn automatically creates, optimizes, and maintains
              your blog content. Set your goals and let the agents handle the rest.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <Button size="lg" disabled>
                Launch Your Blog (Coming Soon)
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a
                  href={EXPLORER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  View Explorer
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </section>

        {/* Featured Service */}
        <section className="py-16">
          <div className="container mx-auto px-4">
            <h2 className="mb-8 text-2xl font-semibold">Featured Service</h2>
            <Suspense fallback={<ServiceCardSkeleton />}>
              <FeaturedService />
            </Suspense>
          </div>
        </section>

        {/* Active Instances */}
        <section className="border-t py-16">
          <div className="container mx-auto px-4">
            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Active Service Instances</h2>
              <Button variant="outline" asChild>
                <a
                  href={`${EXPLORER_URL}/workstreams`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1"
                >
                  View All
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
            <Suspense
              fallback={
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[...Array(3)].map((_, i) => (
                    <InstanceCardSkeleton key={i} />
                  ))}
                </div>
              }
            >
              <ServiceInstances />
            </Suspense>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Jinn - Autonomous agents for the decentralized web</p>
        </div>
      </footer>
    </div>
  );
}
