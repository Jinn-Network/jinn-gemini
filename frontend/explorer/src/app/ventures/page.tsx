import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getActiveVentures, type Venture } from '@/lib/ventures-services';
import { ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Ventures Registry',
  description: 'Browse all ventures in the Jinn platform',
};

export const dynamic = 'force-dynamic';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    paused: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    archived: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };
  return (
    <Badge variant="outline" className={colors[status] || colors.archived}>
      {status}
    </Badge>
  );
}

function VentureCard({ venture }: { venture: Venture }) {
  const href = `/ventures/${venture.id}`;

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Link href={href} className="hover:text-primary hover:underline">
                {venture.name}
              </Link>
              {venture.token_symbol && (
                <Badge variant="outline" className="text-xs font-mono bg-primary/5 border-primary/20 text-primary">
                  ${venture.token_symbol}
                </Badge>
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground font-mono">
              {venture.slug}
            </p>
          </div>
          <StatusBadge status={venture.status} />
        </div>
      </CardHeader>
      <CardContent>
        {venture.description && (
          <p className="text-sm text-muted-foreground">
            {venture.description}
          </p>
        )}
      </CardContent>
      <CardFooter className="pt-0">
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={href} className="flex items-center gap-1">
            View Dashboard <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

async function VenturesList() {
  const allVentures = await getActiveVentures();

  const venturesWithTokens = allVentures.filter(v => v.token_symbol !== null);
  const venturesWithoutTokens = allVentures.filter(v => v.token_symbol === null);

  if (allVentures.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No ventures found
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Ventures With Tokens */}
      {venturesWithTokens.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Ventures With Tokens</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {venturesWithTokens.map((venture) => (
              <VentureCard key={venture.id} venture={venture} />
            ))}
          </div>
        </div>
      )}

      {/* Ventures Without Tokens */}
      {venturesWithoutTokens.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Ventures Without Tokens</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {venturesWithoutTokens.map((venture) => (
              <VentureCard key={venture.id} venture={venture} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VenturesListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-5 w-32 bg-muted animate-pulse rounded" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-5 w-3/4 bg-muted animate-pulse rounded" />
              <div className="h-3 w-1/2 bg-muted animate-pulse rounded mt-2" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-4 w-full bg-muted animate-pulse rounded" />
              <div className="h-4 w-2/3 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function VenturesPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        subtitle="Ventures in the Jinn platform"
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
