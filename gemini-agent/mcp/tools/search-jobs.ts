import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

const base = z.object({
  query: z.string().min(1).describe('Case-insensitive text to match against job name and description.'),
  cursor: z.string().optional().describe('Opaque cursor for pagination.'),
});

export const searchJobsParams = base;
export type SearchJobsParams = z.infer<typeof searchJobsParams>;

export const searchJobsSchema = {
  description: 'Search job definitions by name/description. Returns lightweight rows with pagination.',
  inputSchema: searchJobsParams.shape,
};

export async function searchJobs(params: SearchJobsParams) {
  try {
    const parsed = searchJobsParams.safeParse(params);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message } }) }]
      };
    }

    const { query, cursor } = parsed.data;
    const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

    // Perform a simple ilike search on name and description
    const term = `%${query}%`;
    const { data, error } = await supabase
      .from('jobs')
      .select('id, name, version, is_active, created_at, parent_job_definition_id, job_id')
      .or(`name.ilike.${term},description.ilike.${term}`)
      .order('created_at', { ascending: false });

    if (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'DB_ERROR', message: error.message } }) }]
      };
    }

    const composed = composeSinglePageResponse(data || [], {
      startOffset: keyset.offset,
      requestedMeta: { cursor, query }
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: { ok: true, ...composed.meta } }) }] };
  } catch (e: any) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'UNEXPECTED_ERROR', message: e?.message || String(e) } }) }]
    };
  }
}


