'use client';

import Link from 'next/link';
import { ExternalLink, User, Bot, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Venture } from '@/lib/ventures';
import { LikeButton } from '@/components/like-button';
import { ShareButton } from '@/components/share-button';
import { MessageSquare } from 'lucide-react';

interface VentureFeedCardProps {
  venture: Venture;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function VentureFeedCard({ venture }: VentureFeedCardProps) {
  const statusLabel = venture.status === 'proposed'
    ? 'proposed'
    : venture.status === 'bonding'
      ? 'bonding'
      : venture.status === 'active' && venture.token_address
        ? 'graduated'
        : 'unknown';

  const dopplerUrl = venture.token_address
    ? `https://app.doppler.lol/tokens/base/${venture.token_address}`
    : null;

  return (
    <Link href={`/ventures/${venture.slug}`} className="block">
      <Card className="hover:border-primary/30 transition-colors">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>{venture.name}</span>
            {venture.token_symbol && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                ${venture.token_symbol}
              </Badge>
            )}

          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {venture.description && (
            <p className="text-muted-foreground line-clamp-2">{venture.description}</p>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {venture.creator_type === 'delegate' ? (
                <Bot className="h-3 w-3" />
              ) : (
                <User className="h-3 w-3" />
              )}
              <span className="font-mono">{formatAddress(venture.owner_address)}</span>
            </div>

            {dopplerUrl ? (
              <Button
                asChild
                size="sm"
                variant="secondary"
                onClick={(e) => e.stopPropagation()}
              >
                <a href={dopplerUrl} target="_blank" rel="noopener noreferrer">
                  Support on Doppler
                  <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-4 text-muted-foreground">
            <LikeButton
              ventureId={venture.id}
              initialCount={venture.likes?.[0]?.count || 0}
            />
            <div className="flex items-center gap-1.5 px-2 text-xs font-medium">
              <MessageSquare className="h-4 w-4" />
              <span>{venture.comments?.[0]?.count || 0}</span>
            </div>
            <ShareButton
              url={`https://app.jinn.network/ventures/${venture.slug}`}
              title={venture.name}
              status={venture.status}
            />
            <Link
              href={`/ventures/${venture.slug}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), "ml-auto")}
              onClick={(e) => e.stopPropagation()}
            >
              View idea <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
