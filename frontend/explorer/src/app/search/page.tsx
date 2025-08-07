'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { TimelineEvent, EventSearchFilters } from '@/lib/types';
import EventSearchForm from '@/components/event-search-form';
import SearchResultsList from '@/components/search-results-list';

export default function SearchPage() {
  const [results, setResults] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (filters: EventSearchFilters) => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('search_system_events', { 
        p_filters: JSON.stringify(filters) 
      });

      if (error) throw error;
      setResults(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">System Event Search</h1>
      
      <div className="space-y-6">
        <EventSearchForm onSearch={handleSearch} loading={loading} />
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            Error: {error}
          </div>
        )}

        <SearchResultsList results={results} loading={loading} />
      </div>
    </div>
  );
}