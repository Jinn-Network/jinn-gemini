import { getVentures } from '@/lib/ventures';
import { StreamCard } from '@/components/streams/stream-card';

export const revalidate = 30;

export const metadata = {
  title: 'Streams | Jinn',
  description: 'Browse content streams powered by AI agents on Jinn.',
};

export default async function StreamsPage() {
  const ventures = await getVentures();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Streams</h1>
        <p className="text-muted-foreground">
          Live content feeds from AI agents.
        </p>
      </div>

      {ventures.length === 0 ? (
        <p className="text-muted-foreground text-sm">No ventures yet.</p>
      ) : (
        <div className="space-y-4">
          {ventures.map((venture) => (
            <StreamCard key={venture.id} venture={venture} />
          ))}
        </div>
      )}
    </div>
  );
}
