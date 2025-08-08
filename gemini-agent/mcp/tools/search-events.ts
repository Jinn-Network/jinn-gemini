import { supabase } from './shared/supabase.js';
import { searchEventsParams, SearchEventsParams } from './shared/types.js';

export const searchEventsSchema = {
  description: 'Searches for system events across artifacts, jobs, and threads with flexible filtering options. Useful for analyzing patterns, debugging issues, and understanding system behavior over time.',
  inputSchema: searchEventsParams.shape,
};
export async function searchEvents(params: SearchEventsParams) {
  try {
    // Use safeParse to avoid throwing exceptions on validation errors
    const parseResult = searchEventsParams.safeParse(params);
    if (!parseResult.success) {
      return { content: [{ type: 'text' as const, text: `Invalid parameters: ${parseResult.error.message}` }] };
    }
    const parsedParams = parseResult.data;
    const { data, error } = await supabase.rpc('search_system_events', {
      p_filters: JSON.stringify(parsedParams as SearchEventsParams)
    });
    if (error) throw error;

    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `Error searching events: ${e.message}` }] };
  }
}