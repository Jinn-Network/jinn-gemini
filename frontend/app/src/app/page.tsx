import Link from 'next/link';
import { Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VentureFeedCard } from '@/components/venture-feed-card';
import { HowItWorks } from '@/components/how-it-works';
import { getVentures, type Venture } from '@/lib/ventures';

export const revalidate = 30;

export default async function HomePage() {
  const ventures = await getVentures();

  // "Seed" includes both proposed (pre-launch) and bonding (active curve)
  // "Launched" includes graduated tokens
  const seedVentures = ventures.filter((v) => v.status === 'proposed' || v.status === 'bonding');
  const launchedVentures = ventures.filter((v) => v.status === 'active' && v.token_address);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      {/* Hero */}
      <section className="flex flex-col items-center text-center space-y-4 py-8 md:py-12">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          From idea to execution — powered by AI agents
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Propose a venture. Define success criteria. Launch a token. AI agents do the work.
        </p>
        <Button asChild size="lg" className="rounded-full px-8 h-12 text-base">
          <Link href="/create">
            <Lightbulb className="h-4 w-4 mr-2" />
            Post an Idea
          </Link>
        </Button>
      </section>

      {/* Dismissible How it Works */}
      <HowItWorks />

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:divide-x lg:divide-border/50">
        {/* Left Column: Seed (Proposed + Bonding) */}
        <div className="space-y-6 lg:pr-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Seed</h2>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Concept & Rallying</span>
          </div>

          <div className="grid gap-4">
            {seedVentures.length > 0 ? (
              seedVentures.map((venture) => (
                <VentureFeedCard key={venture.id} venture={venture} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center italic">No seed ventures yet.</p>
            )}
          </div>
        </div>

        {/* Right Column: Launched (Graduated) */}
        <div className="space-y-6 lg:pl-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Launched</h2>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Trading on Base</span>
          </div>

          <div className="grid gap-4">
            {launchedVentures.length > 0 ? (
              launchedVentures.map((venture) => (
                <VentureFeedCard key={venture.id} venture={venture} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center italic">No launched ventures yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
