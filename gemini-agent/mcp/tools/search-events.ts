import { supabase } from './shared/supabase.js';
import { searchEventsParams, SearchEventsParams } from './shared/types.js';
import { enforceDataSizeLimit, DEFAULT_SIZE_LIMIT_MB, calculateDataSize, bytesToMB } from './shared/data-size-limiter.js';

export const searchEventsSchema = {
  description: 'Searches for system events across artifacts, jobs, and threads with flexible filtering options. Useful for analyzing patterns, debugging issues, and understanding system behavior over time.',
  inputSchema: searchEventsParams.shape,
};
// Module-level helpers so they’re available in both try and catch
const truncateString = (value: string, maxChars = 300): string => {
  if (typeof value !== 'string') return value as unknown as string;
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + '... [truncated]';
};

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
export async function searchEvents(params: SearchEventsParams) {
  try {
    // Use safeParse to avoid throwing exceptions on validation errors
    const parseResult = searchEventsParams.safeParse(params);
    if (!parseResult.success) {
      return { content: [{ type: 'text' as const, text: `Invalid parameters: ${parseResult.error.message}` }] };
    }
    const parsedParams = parseResult.data;



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
    // Best-effort fallback: fetch minimal window, then truncate array length to fit size cap
    try {
      const minimalHours = 1;
      const rpcFilters = { ...(params as any), time_range_hours: minimalHours } as SearchEventsParams;
      const { data, error } = await supabase.rpc('search_system_events', {
        p_filters: JSON.stringify(rpcFilters)
      });
      if (error) {
        throw error;
      }

      const sanitized = deepTruncate(data, 300);
      const capMB = DEFAULT_SIZE_LIMIT_MB;

      // Helper to ensure payload fits by slicing arrays
      const fitToLimit = (payload: any): { fitted: any; truncated: boolean; keptCount?: number; totalCount?: number } => {
        const sizeMB = bytesToMB(calculateDataSize(payload));
        if (sizeMB <= capMB) {
          return { fitted: payload, truncated: false };
        }

        // If top-level is an array, binary-search slice size
        if (Array.isArray(payload)) {
          let lo = 0;
          let hi = payload.length; // exclusive
          let best = 0;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const candidate = payload.slice(0, mid);
            const candidateMB = bytesToMB(calculateDataSize(candidate));
            if (candidateMB <= capMB) {
              best = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          const fitted = payload.slice(0, best);
          return { fitted, truncated: best < payload.length, keptCount: best, totalCount: payload.length };
        }

        // If object with array fields, try to shrink largest array field
        if (payload && typeof payload === 'object') {
          const entries = Object.entries(payload);
          // Find array-like fields
          const arrayFields = entries.filter(([, v]) => Array.isArray(v)) as [string, any[]][];
          if (arrayFields.length > 0) {
            // Sort fields by length desc and try truncating one by one
            arrayFields.sort((a, b) => b[1].length - a[1].length);
            let working: any = { ...payload };
            let truncated = false;
            for (const [field, arr] of arrayFields) {
              const attempt = fitToLimit(arr);
              if (attempt.truncated || bytesToMB(calculateDataSize(working)) > capMB) {
                working = { ...working, [field]: attempt.fitted };
                truncated = truncated || attempt.truncated;
                if (bytesToMB(calculateDataSize(working)) <= capMB) {
                  return { fitted: working, truncated };
                }
              }
            }
            return { fitted: working, truncated: true };
          }
        }

        // As a last resort, return the sanitized payload even if still over (tool will indicate truncation)
        return { fitted: sanitized, truncated: true };
      };

      const fitted = fitToLimit(sanitized);
      const notice = `NOTE: Results truncated to fit ${capMB}MB. Window: requested ${params.time_range_hours ?? 6}h, actual ${minimalHours}h. ` +
        (typeof fitted.keptCount === 'number' && typeof fitted.totalCount === 'number'
          ? `Items: ${fitted.keptCount}/${fitted.totalCount}. Heavy fields truncated to 300 chars.`
          : `Heavy fields truncated to 300 chars.`) + '\n\n';

      return {
        content: [{
          type: 'text' as const,
          text: notice + JSON.stringify(fitted.fitted, null, 2)
        }]
      };
    } catch (finalErr: any) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching events (fallback failed): ${finalErr.message}`
        }]
      };
    }
  }
}