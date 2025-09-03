'use client'

import { useState, useEffect } from 'react';
import { TimelineEvent } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IdLink } from './id-link';
import { createClient } from '@/lib/supabase';

interface CausalLink {
  event_id: string;
  triggered_by?: {
    id: string;
    type: 'event' | 'job';
    job_name?: string;
  };
  triggers?: Array<{
    id: string;
    type: 'event' | 'job';
    job_name?: string;
  }>;
}

// Removed unused interface - we use TimelineEvent directly

function CausalLinkDisplay({ eventId, eventType }: { eventId: string; eventType: string }) {
  const [causalData, setCausalData] = useState<CausalLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCausal, setShowCausal] = useState(false);

  useEffect(() => {
    const fetchCausalLinks = async () => {
      try {
        const supabase = createClient();
        let triggeredBy: {
          id: string;
          type: 'event' | 'job';
          job_name?: string;
        } | undefined = undefined;
        let triggers: Array<{
          id: string;
          type: 'event' | 'job';
          job_name?: string;
        }> = [];

        // Events-only causality: show which event triggered a job and which jobs were triggered by an event
        if (eventType === 'JOB_CREATED') {
          // Resolve the source event for this job
          const { data: jobData } = await supabase
            .from('job_board')
            .select('source_event_id')
            .eq('id', eventId)
            .single();

          if (jobData?.source_event_id) {
            triggeredBy = {
              id: jobData.source_event_id,
              type: 'event' as const,
            };
          }
        }

        if (eventType === 'ARTIFACT_CREATED') {
          // We no longer use artifacts as causal sources; no artifact-based joins
          triggers = [];
        }

        setCausalData({
          event_id: eventId,
          triggered_by: triggeredBy,
          triggers: triggers,
        });

      } catch (error) {
        console.error('Error fetching causal links:', error);
      } finally {
        setLoading(false);
      }
    };

    if (showCausal) {
      fetchCausalLinks();
    }
  }, [eventId, eventType, showCausal]);

  if (!showCausal) {
    return (
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => setShowCausal(true)}
        className="mt-2"
      >
        Show Causal Links
      </Button>
    );
  }

  if (loading) {
    return <div className="text-sm text-gray-500 mt-2">Loading causal links...</div>;
  }

  if (!causalData || (!causalData.triggered_by && causalData.triggers?.length === 0)) {
    return (
      <div className="mt-2">
        <div className="text-sm text-gray-500">No causal links found.</div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setShowCausal(false)}
          className="text-xs"
        >
          Hide
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-blue-900">Causal Chain</h4>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setShowCausal(false)}
          className="text-xs text-blue-700"
        >
          Hide
        </Button>
      </div>
      
      <div className="space-y-2 text-sm">
        {causalData.triggered_by && (
          <div className="flex items-center gap-2">
            <span className="text-blue-700">↗ Triggered by:</span>
            <IdLink 
              collection={causalData.triggered_by.type === 'event' ? 'events' : 'job_board'} 
              id={causalData.triggered_by.id} 
            />
          </div>
        )}
        
        {causalData.triggers && causalData.triggers.length > 0 && (
          <div>
            <div className="text-blue-700 mb-1">↘ Triggers:</div>
            <div className="space-y-1 ml-4">
              {causalData.triggers.map((trigger, index) => (
                <div key={index} className="flex items-center gap-2">
                  <IdLink 
                    collection={trigger.type === 'event' ? 'events' : 'job_board'} 
                    id={trigger.id} 
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to render specific details for each event type
const renderEventDetails = (event: TimelineEvent) => {
  switch (event.event_type) {
    case 'ARTIFACT_CREATED':
      return (
        <>
          {event.event_details.topic && <p>Topic: {event.event_details.topic}</p>}
          {event.event_details.status && <p>Status: {event.event_details.status}</p>}
          <IdLink collection="artifacts" id={event.event_details.id} />
          <CausalLinkDisplay eventId={event.event_details.id} eventType={event.event_type} />
        </>
      );
    case 'JOB_CREATED':
      return (
        <>
          {event.event_details.name && <p>Job Name: {event.event_details.name}</p>}
          {event.event_details.status && <p>Status: {event.event_details.status}</p>}
          <IdLink collection="job_board" id={event.event_details.id} />
          <a href={`/jobs/${event.event_details.id}/impact`} className="text-xs text-blue-500 hover:underline ml-2">
            View Impact
          </a>
          <CausalLinkDisplay eventId={event.event_details.id} eventType={event.event_type} />
        </>
      );
    case 'THREAD_CREATED':
      return (
        <>
          {event.event_details.objective && <p>Objective: {event.event_details.objective}</p>}
          <IdLink collection="threads" id={event.event_details.id} />
        </>
      );
    default:
      return <p>{JSON.stringify(event.event_details)}</p>;
  }
};

export default function EnhancedEventTimeline({ events }: { events: TimelineEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No events found for this thread.
      </div>
    );
  }

  return (
    <div className="relative border-l-4 border-blue-200">
      {events.map((event, index) => (
        <div key={index} className="mb-8 ml-6">
          <div className="absolute w-4 h-4 bg-blue-400 rounded-full -left-2 mt-1.5 border-2 border-white"></div>
          <Card className="shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-blue-900">
                  {event.event_type.replace('_', ' ')}
                </CardTitle>
                <time className="text-sm text-gray-500 font-mono">
                  {new Date(event.created_at).toLocaleString()}
                </time>
              </div>
            </CardHeader>
            <CardContent>
              {renderEventDetails(event)}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
