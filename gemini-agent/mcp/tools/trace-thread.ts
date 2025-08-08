import { supabase } from './shared/supabase.js';
import { traceThreadParams, TraceThreadParams } from './shared/types.js';

export const traceThreadSchema = {
  description: 'Traces the complete history of a thread, returning a chronological timeline of all associated jobs and artifacts.',
  inputSchema: traceThreadParams.shape,
};

export async function traceThread(params: TraceThreadParams) {
  try {
    // Use safeParse to avoid throwing exceptions on validation errors
    const parseResult = traceThreadParams.safeParse(params);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
        }]
      };
    }
    const { thread_id } = parseResult.data;
    const { data, error } = await supabase.rpc('get_thread_timeline', { p_thread_id: thread_id });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e: any) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: 'DB_ERROR', message: `Error tracing thread: ${e.message}` }, null, 2) }]
    };
  }
}