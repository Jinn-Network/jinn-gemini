import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { OpenAI } from 'openai';
import { Memory, LinkedMemory } from './shared/types.js';
import { exceedsSizeLimit, getDataSizeMB, DEFAULT_SIZE_LIMIT_MB } from './shared/data-size-limiter.js';

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required for memory operations');
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

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
    try {
        // Use safeParse to avoid throwing exceptions on validation errors
        const parseResult = searchMemoriesParams.safeParse(params);
        if (!parseResult.success) {
            return { content: [{ type: 'text' as const, text: `Invalid parameters: ${parseResult.error.message}` }] };
        }
        const { query, limit, similarity_threshold, filter, include_links } = parseResult.data;
        const embeddingResponse = await getOpenAIClient().embeddings.create({
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
            const linkedIds = memories.map((m: Memory) => m.linked_memory_id).filter((id: string | undefined): id is string => id !== undefined);
            if (linkedIds.length > 0) {
                const { data: linkedMemories, error: linkError } = await supabase
                    .from('memories')
                    .select('id, content, metadata')
                    .in('id', linkedIds);
                
                if (linkError) throw linkError;

                const linkedMap = new Map(linkedMemories.map((m: LinkedMemory) => [m.id, m as Memory]));
                for (const memory of memories) {
                    if (memory.linked_memory_id) {
                        memory.linked_memory = linkedMap.get(memory.linked_memory_id);
                    }
                }
            }
        }

        // Check if data exceeds size limit
        if (exceedsSizeLimit(memories)) {
            const dataSizeMB = getDataSizeMB(memories);
            
            // Limit number of memories to fit within size limit
            let finalMemories = memories;
            let reduction = 2;
            
            while (exceedsSizeLimit(finalMemories) && finalMemories.length > 1) {
                const maxMemories = Math.max(1, Math.floor(memories.length / reduction));
                finalMemories = memories.slice(0, maxMemories);
                reduction *= 2;
            }

            return { 
                content: [{ 
                    type: 'text' as const, 
                    text: JSON.stringify({
                        warning: `Results limited due to size constraint (${DEFAULT_SIZE_LIMIT_MB}MB). Original: ${memories.length} memories, Returned: ${finalMemories.length} memories`,
                        memories: finalMemories
                    }, null, 2) 
                }] 
            };
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(memories, null, 2) }] };
    } catch (e: unknown) {
        console.error('Full error in searchMemories:', e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text' as const, text: `Error searching memories: ${errorMessage}\nFull error: ${JSON.stringify(e, null, 2)}` }] };
    }
}
