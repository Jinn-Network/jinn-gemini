import { supabase } from './shared/supabase.js';
import { traceThreadParams, TraceThreadParams } from './shared/types.js';

export const traceThreadSchema = {
  description: 'Traces the complete history of a thread, returning a chronological timeline of all associated jobs and artifacts.',
  inputSchema: traceThreadParams.shape,
};

export async function traceThread(params: TraceThreadParams) {
  const { thread_id } = traceThreadParams.parse(params);
  try {
    const { data, error } = await supabase.rpc('get_thread_timeline', { p_thread_id: thread_id });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `Error tracing thread: ${e.message}` }] };
  }
}