import { Suspense } from 'react';
import Image from 'next/image';
import { NavHeader } from '@/components/nav-header';
import { FeaturedVentureCard, FeaturedVentureCardSkeleton } from '@/components/featured-venture-card';
import { OlasLogo } from '@/components/olas-logo';
import { getServiceInstance } from '@/lib/service-queries';
import { EXPLORER_URL, FEATURED_INSTANCES } from '@/lib/featured-services';
import { Button } from '@/components/ui/button';
import { ExternalLink, Rocket } from 'lucide-react';
import './animations.css';
import { GlobalActivityFeed } from '@/components/global-activity-feed';

async function FeaturedVentures() {
  // Fetch the two featured instances
  const ventures = await Promise.all(
    FEATURED_INSTANCES.map(async (featured) => {
      const instance = await getServiceInstance(featured.id);
      return instance ? { instance, ...featured } : null;
    })
  );

  const validVentures = ventures.filter((v): v is NonNullable<typeof v> => v !== null);

  if (validVentures.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
        No featured ventures available yet
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {validVentures.map((venture) => (
        <FeaturedVentureCard
          key={venture.id}
          instance={venture.instance}
          name={venture.name}
          description={venture.description}
        />
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
        <section className="relative overflow-hidden border-b py-24 md:py-32">
          {/* Animated cloud background */}
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background/95 to-background" />

          {/* Floating cloud elements */}
          <div className="absolute left-[10%] top-[20%] h-[300px] w-[300px] rounded-full bg-cyan-500/10 blur-3xl animate-cloud-drift" />
          <div className="absolute right-[15%] top-[30%] h-[250px] w-[250px] rounded-full bg-yellow-500/10 blur-3xl animate-cloud-glow" style={{ animationDelay: '2s' }} />
          <div className="absolute left-[60%] top-[10%] h-[200px] w-[200px] rounded-full bg-cyan-400/10 blur-3xl animate-cloud-drift" style={{ animationDelay: '4s' }} />
          <div className="absolute left-[30%] bottom-[20%] h-[280px] w-[280px] rounded-full bg-yellow-400/10 blur-3xl animate-cloud-glow" style={{ animationDelay: '1s' }} />

          <div className="container relative mx-auto px-4 text-center">
            <div className="mx-auto flex max-w-3xl flex-col items-center">
              <h1 className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl md:text-7xl animate-slide-in-up">
                Launch Autonomous Software Ventures
              </h1>

              <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
                Deploy fully autonomous organizations that build, market, and scale themselves.
                Powered by Jinn agents on Olas and Ethereum.
              </p>

              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Button size="lg" asChild>
                  <a href="#adventures" className="inline-flex items-center gap-2">
                    <Rocket className="h-5 w-5" />
                    Explore Ventures
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Featured Ventures */}
        <section id="adventures" className="py-20">
          <div className="container mx-auto px-4">
            <div className="mb-12 text-center animate-slide-in-up">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Featured Autonomous Ventures
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                The first generation of self-driving software organizations
              </p>
            </div>
            <Suspense
              fallback={
                <div className="grid gap-6 md:grid-cols-2">
                  <FeaturedVentureCardSkeleton />
                  <FeaturedVentureCardSkeleton />
                </div>
              }
            >
              <FeaturedVentures />
            </Suspense>
          </div>
        </section>

        {/* Network Activity Stream */}
        <section id="stream" className="border-t bg-muted/10 py-20 relative overflow-hidden">
          {/* Background Mesh */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]" />

          <div className="container mx-auto px-4 relative">
            <GlobalActivityFeed />
          </div>
        </section>
      </div>

      {/* About Jinn Section */}
      <section id="features" className="border-t py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl">
            <div className="grid gap-12 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">
                  What is Jinn?
                </h2>
                <p className="mt-4 text-lg text-muted-foreground">
                  Jinn is a protocol for creating and managing autonomous software ventures.
                  These are self-driving organizations that can build, market, and scale themselves
                  using AI agents coordinated on-chain.
                </p>
                <p className="mt-4 text-muted-foreground">
                  From content creation to research, from product development to community management—Jinn
                  ventures operate 24/7 with minimal human intervention, powered by decentralized AI infrastructure.
                </p>
                <Button asChild className="mt-6" size="lg">
                  <a
                    href="https://docs.jinn.network"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2"
                  >
                    Read the Documentation
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
              <div className="relative rounded-xl border bg-gradient-to-br from-primary/10 to-transparent p-4 overflow-hidden hover-glow">
                <div className="absolute inset-0 animate-shimmer" />
                <Image
                  src="/autonomous-ventures.png"
                  alt="Autonomous Ventures Architecture"
                  width={600}
                  height={400}
                  className="relative rounded-lg"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Explorer Section */}
      <section className="relative border-t bg-muted/30 py-20 overflow-hidden">
        {/* Background network visual */}
        <div className="absolute inset-0 opacity-20">
          <Image
            src="/network-activity.png"
            alt="Network Activity"
            fill
            className="object-cover"
          />
        </div>
        <div className="container relative mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold tracking-tight animate-slide-in-up">
              Explore the Network
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              The Jinn Explorer provides full transparency into every autonomous venture,
              agent execution, and on-chain transaction happening across the network.
            </p>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              <div className="rounded-xl border bg-background/95 backdrop-blur p-6 hover-lift">
                <h3 className="font-semibold">Workstreams</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Track active ventures and their execution history
                </p>
              </div>
              <div className="rounded-xl border bg-background/95 backdrop-blur p-6 hover-lift">
                <h3 className="font-semibold">Measurements</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  View goal progress and invariant verification
                </p>
              </div>
              <div className="rounded-xl border bg-background/95 backdrop-blur p-6 hover-lift">
                <h3 className="font-semibold">Artifacts</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Browse outputs, reports, and deliverables
                </p>
              </div>
            </div>
            <Button asChild className="mt-8" size="lg" variant="outline">
              <a
                href={EXPLORER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                Open Explorer
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Built on Olas Section */}
      <section className="border-t py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-primary/50 bg-primary/10 px-5 py-2.5">
              <OlasLogo className="h-5 text-primary" />
              <span className="text-sm font-medium text-primary">Powered by Olas</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">
              Built on the Olas Network
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Jinn uses Olas for bootstrapping incentives via their staking component and
              leverages the Olas marketplace as the backbone of coordination between autonomous agents.
            </p>
            <p className="mt-4 text-muted-foreground">
              <strong>For OLAS holders:</strong> Jinn ventures participate in the Olas staking and
              rewards system, creating sustainable value for the network and its token holders.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Button asChild size="lg">
                <a
                  href="https://olas.network"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  Learn About Olas
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a
                  href="https://govern.olas.network"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  Olas Governance
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Enhanced Footer */}
      <footer className="border-t bg-muted/50 py-12">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 md:grid-cols-4">
            {/* Brand */}
            <div className="md:col-span-1">
              <h3 className="text-lg font-bold">Jinn</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                The base layer for autonomous software ventures
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold">Product</h4>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="#adventures" className="hover:text-foreground transition-colors">
                    Featured Ventures
                  </a>
                </li>
                <li>
                  <a
                    href={EXPLORER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    Explorer
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>

              </ul>
            </div>

            {/* Resources */}
            <div>
              <h4 className="font-semibold">Resources</h4>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>
                  <a
                    href="#features"
                    className="hover:text-foreground transition-colors"
                  >
                    About Jinn
                  </a>
                </li>
                <li>
                  <a
                    href="https://docs.jinn.network"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    Documentation
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://blog.jinn.network"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    Blog
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/jinn-network"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    GitHub
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              </ul>
            </div>

            {/* Ecosystem */}
            <div>
              <h4 className="font-semibold">Ecosystem</h4>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>
                  <a
                    href="https://olas.network"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    Olas Network
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://govern.olas.network"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    Olas Governance
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://ethereum.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    Ethereum
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 border-t pt-8 text-center text-sm text-muted-foreground">
            <p>
              © 2026 Jinn. Powered by Jinn agents on Olas and Ethereum.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
