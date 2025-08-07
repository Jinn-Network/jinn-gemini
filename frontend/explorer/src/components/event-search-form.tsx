'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EventSearchFilters } from '@/lib/types';

interface EventSearchFormProps {
  onSearch: (filters: EventSearchFilters) => void;
  loading: boolean;
}

export default function EventSearchForm({ onSearch, loading }: EventSearchFormProps) {
  const [filters, setFilters] = useState<EventSearchFilters>({
    time_range_hours: 24, // Default to last 24 hours
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Clean up filters - remove empty strings and convert to proper types
    const cleanFilters: EventSearchFilters = {};
    
    if (filters.event_type) {
      cleanFilters.event_type = filters.event_type;
    }
    if (filters.status && filters.status.trim() !== '') {
      cleanFilters.status = filters.status.trim();
    }
    if (filters.job_name && filters.job_name.trim() !== '') {
      cleanFilters.job_name = filters.job_name.trim();
    }
    if (filters.topic && filters.topic.trim() !== '') {
      cleanFilters.topic = filters.topic.trim();
    }
    if (filters.thread_id && filters.thread_id.trim() !== '') {
      cleanFilters.thread_id = filters.thread_id.trim();
    }
    if (filters.time_range_hours && filters.time_range_hours > 0) {
      cleanFilters.time_range_hours = filters.time_range_hours;
    }

    onSearch(cleanFilters);
  };

  const handleReset = () => {
    setFilters({
      time_range_hours: 24,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Event Type */}
            <div>
              <label className="block text-sm font-medium mb-1">Event Type</label>
              <select
                value={filters.event_type || ''}
                onChange={(e) => setFilters({...filters, event_type: e.target.value === '' ? undefined : e.target.value as EventSearchFilters['event_type']})}
                className="w-full p-2 border border-gray-300 rounded-md"
              >
                <option value="">All Types</option>
                <option value="ARTIFACT_CREATED">Artifact Created</option>
                <option value="JOB_CREATED">Job Created</option>
                <option value="THREAD_CREATED">Thread Created</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <Input
                type="text"
                placeholder="e.g., COMPLETED, PENDING"
                value={filters.status || ''}
                onChange={(e) => setFilters({...filters, status: e.target.value})}
              />
            </div>

            {/* Job Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Job Name</label>
              <Input
                type="text"
                placeholder="e.g., Metacog.GenesysMetacog"
                value={filters.job_name || ''}
                onChange={(e) => setFilters({...filters, job_name: e.target.value})}
              />
            </div>

            {/* Topic */}
            <div>
              <label className="block text-sm font-medium mb-1">Topic</label>
              <Input
                type="text"
                placeholder="e.g., mission_progress"
                value={filters.topic || ''}
                onChange={(e) => setFilters({...filters, topic: e.target.value})}
              />
            </div>

            {/* Thread ID */}
            <div>
              <label className="block text-sm font-medium mb-1">Thread ID</label>
              <Input
                type="text"
                placeholder="UUID of specific thread"
                value={filters.thread_id || ''}
                onChange={(e) => setFilters({...filters, thread_id: e.target.value})}
              />
            </div>

            {/* Time Range */}
            <div>
              <label className="block text-sm font-medium mb-1">Time Range (hours)</label>
              <Input
                type="number"
                min="1"
                max="168"
                placeholder="24"
                value={filters.time_range_hours || ''}
                onChange={(e) => setFilters({...filters, time_range_hours: parseInt(e.target.value) || undefined})}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? 'Searching...' : 'Search Events'}
            </Button>
            <Button type="button" variant="outline" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}