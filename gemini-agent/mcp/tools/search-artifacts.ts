import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

// MCP registration schema (permissive) to avoid -32602 pre-validation failures.
// We normalize and strictly validate inside the handler.
const base = z.object({
  query: z.any(),
  cursor: z.string().optional().describe('Opaque cursor for pagination.'),
});

// Strict internal schema used by the handler after normalization
export const searchArtifactsParams = z.object({
  query: z.string().min(1).describe('Case-insensitive text to match against name, topic and content.'),
  cursor: z.string().optional().describe('Opaque cursor for pagination.'),
});
export type SearchArtifactsParams = z.infer<typeof searchArtifactsParams>;

export const searchArtifactsSchema = {
  description: 'Search artifacts by name/topic/content. Returns minimal fields with pagination.',
  inputSchema: searchArtifactsParams.shape,
};

export async function searchArtifacts(params: any) {
  try {
    // Normalize permissive inputs, then validate strictly
    const raw: any = params ?? {};
    let { query, cursor } = raw as { query?: any; cursor?: string };
    if (query === undefined || query === null) query = '';
    if (typeof query !== 'string') query = String(query);

    const parsed = searchArtifactsParams.safeParse({ query, cursor });
    if (!parsed.success) {
      const message = parsed.error?.errors?.[0]?.message || 'Invalid parameters';
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ 
          data: [], 
          meta: { ok: false, code: 'VALIDATION_ERROR', message, details: parsed.error.flatten?.() ?? undefined }
        }) }]
      };
    }

    ({ query, cursor } = parsed.data);
    const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

    const term = `%${query}%`;
    // Search by name/topic/content; include name in selection
    const { data, error } = await supabase
      .from('artifacts')
      .select('id, name, topic, status, created_at, job_id, parent_job_definition_id')
      .or(`name.ilike.${term},topic.ilike.${term},content.ilike.${term}`)
      // Prioritize name matches by ordering: name match first, then recency
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


