import { supabase } from './shared/supabase.js';
import { searchEventsParams, SearchEventsParams } from './shared/types.js';
import { enforceDataSizeLimit } from './shared/data-size-limiter.js';

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

    // Truncation helper for heavy string fields
    const truncateString = (value: string, maxChars = 300): string => {
      if (typeof value !== 'string') return value as unknown as string;
      if (value.length <= maxChars) return value;
      return value.slice(0, maxChars) + '... [truncated]';
    };

    // Deeply truncate strings in objects/arrays
    const deepTruncate = (value: any, maxChars = 300): any => {
      if (value == null) return value;
      if (typeof value === 'string') return truncateString(value, maxChars);
      if (Array.isArray(value)) return value.map(v => deepTruncate(v, maxChars));
      if (typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
          out[k] = deepTruncate(v, maxChars);
        }
        return out;
      }
      return value;
    };

    // Use shared size limiter: progressively reduce time_range_hours until payload is under limit
    const initialHours = parsedParams.time_range_hours ?? 6;
    let lastEffectiveHours = initialHours;

    const limitedData = await enforceDataSizeLimit(async (reductionFactor: number) => {
      // Compute effective hours (min 1 hour)
      const effectiveHours = Math.max(1, Math.floor(initialHours * reductionFactor));
      lastEffectiveHours = effectiveHours;

      const rpcFilters = { ...parsedParams, time_range_hours: effectiveHours } as SearchEventsParams;
      const { data, error } = await supabase.rpc('search_system_events', {
        p_filters: JSON.stringify(rpcFilters)
      });
      if (error) throw error;

      // Truncate heavy content before size measurement
      const sanitized = deepTruncate(data, 300);
      return sanitized;
    }, {
      logPrefix: 'search_events data size check'
    });

    const cappedNotice = lastEffectiveHours < initialHours
      ? `NOTE: Results capped to prevent context overload. Requested window: ${initialHours}h, Actual: ${lastEffectiveHours}h. Heavy fields truncated to 300 chars.\n\n`
      : `NOTE: Heavy fields truncated to 300 chars to prevent context overload.\n\n`;

    return {
      content: [{
        type: 'text' as const,
        text: cappedNotice + JSON.stringify(limitedData, null, 2)
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