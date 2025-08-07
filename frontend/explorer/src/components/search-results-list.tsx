'use client';

import { TimelineEvent } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdLink } from './id-link';

interface SearchResultsListProps {
  results: TimelineEvent[];
  loading: boolean;
}

export default function SearchResultsList({ results, loading }: SearchResultsListProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="text-gray-500">Searching events...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (results.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">
            No events found matching your criteria.
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatEventType = (eventType: string) => {
    return eventType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  };

  const getEventTypeColor = (eventType: string) => {
    switch (eventType) {
      case 'ARTIFACT_CREATED':
        return 'bg-blue-950 text-blue-300 border-blue-800';
      case 'JOB_CREATED':
        return 'bg-green-950 text-green-300 border-green-800';
      case 'THREAD_CREATED':
        return 'bg-purple-950 text-purple-300 border-purple-800';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const renderEventDetails = (event: TimelineEvent) => {
    const details = event.event_details;
    
    switch (event.event_type) {
      case 'ARTIFACT_CREATED':
        return (
          <div className="space-y-1">
            {details.topic && <p><span className="font-medium">Topic:</span> {details.topic}</p>}
            {details.status && <p><span className="font-medium">Status:</span> {details.status}</p>}
            {details.content && (
              <p><span className="font-medium">Content:</span> {details.content.substring(0, 100)}...</p>
            )}
            <IdLink collection="artifacts" id={details.id} />
          </div>
        );
      
      case 'JOB_CREATED':
        return (
          <div className="space-y-1">
            {details.name && <p><span className="font-medium">Job Name:</span> {details.name}</p>}
            {details.status && <p><span className="font-medium">Status:</span> {details.status}</p>}
            <IdLink collection="job_board" id={details.id} />
            {details.report_id && (
              <a href={`/jobs/${details.id}/impact`} className="text-xs text-blue-500 hover:underline ml-2">
                View Impact
              </a>
            )}
          </div>
        );
      
      case 'THREAD_CREATED':
        return (
          <div className="space-y-1">
            {details.title && <p><span className="font-medium">Title:</span> {details.title}</p>}
            {details.objective && <p><span className="font-medium">Objective:</span> {details.objective}</p>}
            {details.status && <p><span className="font-medium">Status:</span> {details.status}</p>}
            <IdLink collection="threads" id={details.id} />
            <a href={`/threads/${details.id}/timeline`} className="text-xs text-blue-500 hover:underline ml-2">
              View Timeline
            </a>
          </div>
        );
      
      default:
        return <div>Unknown event type</div>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search Results ({results.length} events found)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {results.map((event, index) => (
            <div key={`${event.event_type}-${event.id}-${event.created_at}-${index}`} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded border ${getEventTypeColor(event.event_type)}`}>
                    {formatEventType(event.event_type)}
                  </span>
                  <span className="text-sm text-gray-500">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
              
              <div className="text-sm">
                {renderEventDetails(event)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}