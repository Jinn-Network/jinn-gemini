import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

const base = z.object({
  query: z.string().min(1).describe('Case-insensitive text to match against topic and content.'),
  cursor: z.string().optional().describe('Opaque cursor for pagination.'),
});

export const searchArtifactsParams = base;
export type SearchArtifactsParams = z.infer<typeof searchArtifactsParams>;

export const searchArtifactsSchema = {
  description: 'Search artifacts by topic/content. Returns minimal fields with pagination.',
  inputSchema: searchArtifactsParams.shape,
};

export async function searchArtifacts(params: SearchArtifactsParams) {
  try {
    const parsed = searchArtifactsParams.safeParse(params);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message } }) }]
      };
    }

    const { query, cursor } = parsed.data;
    const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

    const term = `%${query}%`;
    // Search on topic first and content lightly (content can be large)
    const { data, error } = await supabase
      .from('artifacts')
      .select('id, topic, status, created_at, job_id, parent_job_definition_id')
      .or(`topic.ilike.${term},content.ilike.${term}`)
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


