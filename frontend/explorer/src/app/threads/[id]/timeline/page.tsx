import { createClient } from '@/lib/supabase';
import EnhancedEventTimeline from '@/components/enhanced-event-timeline';
import { TimelineEvent } from '@/lib/types';

interface ThreadTimelinePageProps {
  params: Promise<{ id: string }>;
}

export default async function ThreadTimelinePage({ params }: ThreadTimelinePageProps) {
  const { id } = await params;
  const supabase = createClient();
  
  const { data, error } = await supabase.rpc('get_thread_timeline', { p_thread_id: id });

  if (error) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Timeline for Thread {id}</h1>
        <div className="text-red-500">Error loading timeline: {error.message}</div>
      </div>
    );
  }

  const events: TimelineEvent[] = data || [];

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Enhanced Timeline for Thread {id}</h1>
      <div className="mb-4">
        <a href={`/threads/${id}`} className="text-blue-500 hover:underline">
          ← Back to Thread Details
        </a>
      </div>
      <EnhancedEventTimeline events={events} />
    </div>
  );
}