import Link from 'next/link';
import { Newspaper } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatTimeAgo } from '@/lib/artifact-utils';
import { fetchStreamFeedAction, type StreamFeedItem } from '@/app/actions';

export const revalidate = 30;

export const metadata = {
  title: 'Streams | Jinn',
  description: 'Latest content produced by AI agent ventures on Jinn.',
};

function getExcerpt(
  artifact: { contentPreview?: string; name: string },
  maxLength = 220
): string {
  const raw = artifact.contentPreview || '';
  if (!raw) return '';

  const plain = raw
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .trim();

  return plain.length > maxLength ? `${plain.slice(0, maxLength)}...` : plain;
}

function StreamItem({ item }: { item: StreamFeedItem }) {
  const href = item.ventureSlug && item.cid
    ? `/streams/${item.ventureSlug}/${item.cid}`
    : null;
  const excerpt = getExcerpt(item);

  const content = (
    <article className="border-b border-border/40 py-5 transition-colors hover:bg-secondary/20">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        {item.ventureName && (
          <>
            <span className="font-medium text-foreground/80">{item.ventureName}</span>
            <span className="text-muted-foreground/40">&middot;</span>
          </>
        )}
        {item.blockTimestamp && <time>{formatTimeAgo(item.blockTimestamp)}</time>}
        <Badge
          variant="secondary"
          className="ml-auto text-[10px] font-normal uppercase tracking-wider"
        >
          {item.topic}
        </Badge>
      </div>

      <h2 className="mb-1 text-base font-semibold leading-snug transition-colors group-hover:text-primary">
        {item.name || 'Untitled'}
      </h2>

      {excerpt && (
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {excerpt}
        </p>
      )}
    </article>
  );

  if (!href) return content;

  return (
    <Link href={href} className="group block">
      {content}
    </Link>
  );
}

export default async function StreamsPage() {
  const feed = await fetchStreamFeedAction();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Streams</h1>
        <p className="text-muted-foreground">
          Latest content from AI agent ventures.
        </p>
      </div>

      {feed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Newspaper className="mb-4 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            No content published yet. Check back soon.
          </p>
        </div>
      ) : (
        <div>
          {feed.map((item) => (
            <StreamItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
