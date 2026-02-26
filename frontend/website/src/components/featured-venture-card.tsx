import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Sparkles } from 'lucide-react';
import { LAUNCHPAD_URL } from '@/lib/featured-services';
import type { Venture } from '@/lib/ventures-queries';

interface FeaturedVentureCardProps {
    venture: Venture;
}

export function FeaturedVentureCard({ venture }: FeaturedVentureCardProps) {
    const ventureHref = `${LAUNCHPAD_URL}/ventures/${venture.slug}`;

    return (
        <Card className="relative overflow-hidden border-primary/50 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent opacity-50" />

            <CardHeader className="relative">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        <Badge variant="outline" className="border-primary/50 text-primary">
                            Active Venture
                        </Badge>
                    </div>
                    {venture.token_symbol && (
                        <Badge variant="outline" className="text-xs font-mono bg-primary/10 border-primary/30 text-primary">
                            ${venture.token_symbol}
                        </Badge>
                    )}
                </div>
                <CardTitle className="mt-4 text-2xl">{venture.name}</CardTitle>
                <CardDescription className="mt-2 text-base">
                    {venture.description || 'An autonomous venture on the Jinn network.'}
                </CardDescription>
            </CardHeader>

            <CardFooter className="relative">
                <Button asChild variant="default" className="w-full">
                    <a
                        href={ventureHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2"
                    >
                        View Venture
                        <ExternalLink className="h-4 w-4" />
                    </a>
                </Button>
            </CardFooter>
        </Card>
    );
}

// Loading skeleton
export function FeaturedVentureCardSkeleton() {
    return (
        <Card className="border-primary/50">
            <CardHeader>
                <div className="h-5 w-32 animate-pulse rounded bg-muted" />
                <div className="mt-4 h-7 w-48 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-5 w-full animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            </CardContent>
            <CardFooter>
                <div className="h-10 flex-1 animate-pulse rounded bg-muted" />
            </CardFooter>
        </Card>
    );
}
