import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const searchMemoriesParams = z.object({
    query: z.string().describe('The natural language text to search for.'),
    limit: z.number().int().positive().optional().default(10).describe('The maximum number of memories to return.'),
    similarity_threshold: z.number().min(0).max(1).optional().default(0.5).describe('The minimum similarity score (0 to 1) for a match.'),
    filter: z.record(z.any()).optional().describe('A key-value object to filter memories by their metadata.'),
    include_links: z.boolean().optional().default(false).describe('If true, the results will include details about linked memories.'),
});

export type SearchMemoriesParams = z.infer<typeof searchMemoriesParams>;

export const searchMemoriesSchema = {
    description: 'Performs a semantic search for memories. Can filter by metadata and retrieve linked memories to explore the knowledge graph.',
    inputSchema: searchMemoriesParams.shape,
};

export async function searchMemories(params: SearchMemoriesParams) {
    const { query, limit, similarity_threshold, filter, include_links } = searchMemoriesParams.parse(params);

    try {
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query,
        });
        const query_embedding = embeddingResponse.data[0].embedding;

        const { data: memories, error } = await supabase.rpc('match_memories', {
            query_embedding,
            p_similarity_threshold: similarity_threshold,
            p_limit: limit,
            p_filter: filter || null,
        });

        if (error) throw error;

        if (include_links && memories.length > 0) {
            const linkedIds = memories.map(m => m.linked_memory_id).filter(id => id);
            if (linkedIds.length > 0) {
                const { data: linkedMemories, error: linkError } = await supabase
                    .from('memories')
                    .select('id, content, metadata')
                    .in('id', linkedIds);
                
                if (linkError) throw linkError;

                const linkedMap = new Map(linkedMemories.map(m => [m.id, m]));
                for (const memory of memories) {
                    if (memory.linked_memory_id) {
                        (memory as any).linked_memory = linkedMap.get(memory.linked_memory_id);
                    }
                }
            }
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(memories, null, 2) }] };
    } catch (e: any) {
        console.error('Full error in searchMemories:', e);
        return { content: [{ type: 'text' as const, text: `Error searching memories: ${e.message}\nFull error: ${JSON.stringify(e, null, 2)}` }] };
    }
}
