import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Sparkles } from 'lucide-react';
import { getExplorerUrl } from '@/lib/featured-services';
import type { ServiceInstance } from '@/lib/service-types';

interface FeaturedVentureCardProps {
    instance: ServiceInstance;
    name: string;
    description: string;
}

export function FeaturedVentureCard({ instance, name, description }: FeaturedVentureCardProps) {
    return (
        <Card className="relative overflow-hidden border-primary/50 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent opacity-50" />

            <CardHeader className="relative">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        <Badge variant="outline" className="border-primary/50 text-primary">
                            Featured Venture
                        </Badge>
                    </div>
                </div>
                <CardTitle className="mt-4 text-2xl">{name}</CardTitle>
                <CardDescription className="mt-2 text-base">
                    {description}
                </CardDescription>
            </CardHeader>

            <CardFooter className="relative">
                <Button asChild variant="default" className="w-full">
                    <a
                        href={getExplorerUrl('workstream', instance.workstreamId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2"
                    >
                        View in Explorer
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
