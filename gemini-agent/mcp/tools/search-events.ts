import { supabase } from './shared/supabase.js';
import { searchEventsParams, SearchEventsParams } from './shared/types.js';

export const searchEventsSchema = {
  description: 'Searches for system events across artifacts, jobs, and threads with flexible filtering options. Useful for analyzing patterns, debugging issues, and understanding system behavior over time.',
  inputSchema: searchEventsParams.shape,
};

export async function searchEvents(params: SearchEventsParams) {
  const parsedParams = searchEventsParams.parse(params);
  
  try {
    const { data, error } = await supabase.rpc('search_system_events', { 
      p_filters: JSON.stringify(parsedParams) 
    });
    
    if (error) throw error;
    
    return { 
      content: [{ 
        type: 'text' as const, 
        text: JSON.stringify(data, null, 2) 
      }] 
    };
  } catch (e: any) {
    return { 
      content: [{ 
        type: 'text' as const, 
        text: `Error searching events: ${e.message}` 
      }] 
    };
  }
}