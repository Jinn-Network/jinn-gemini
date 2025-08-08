import { supabase } from './shared/supabase.js';
import { searchEventsParams, SearchEventsParams } from './shared/types.js';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';
export const searchEventsSchema = {
  description: 'Searches for system events across artifacts, jobs, and threads with flexible filtering options. Useful for analyzing patterns, debugging issues, and understanding system behavior over time.',
  inputSchema: searchEventsParams.shape,
};
export async function searchEvents(params: SearchEventsParams) {
  try {
    // Use safeParse to avoid throwing exceptions on validation errors
    const parseResult = searchEventsParams.safeParse(params);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
        }]
      };
    }
    const parsedParams = parseResult.data;
    const keyset = decodeCursor<{ offset: number }>(parsedParams.cursor) ?? { offset: 0 };

    // Fetch all items for now (phase 1 simple impl); we page locally with token budget
    const { data, error } = await supabase.rpc('search_system_events', {
      p_filters: JSON.stringify(parsedParams as SearchEventsParams)
    });
    if (error) throw error;


    const composed = composeSinglePageResponse(data, {
      startOffset: keyset.offset,
      truncationPolicy: {
        content: 1000,
        output: 1000,
        summary: 600,
        description: 600,
      },
      requestedMeta: { cursor: parsedParams.cursor },
    });

    // meta first, then data
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }, null, 2) }] };
  } catch (e: any) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: 'DB_ERROR', message: `Error searching events: ${e.message}` }, null, 2) }] 
    };
  }
}