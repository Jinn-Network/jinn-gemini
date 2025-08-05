import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const createMemoryParams = z.object({
    content: z.string().describe('The textual content of the memory to be stored and embedded.'),
    metadata: z.record(z.any()).optional().describe('A JSON object for classifying the memory (e.g., source_job_id, memory_type).'),
    linked_memory_id: z.string().uuid().optional().describe('The ID of a single, existing memory that this new one is related to.'),
    link_type: z.enum(['CAUSE', 'EFFECT', 'ELABORATION', 'CONTRADICTION', 'SUPPORT']).optional().describe('Describes the relationship between this new memory and the linked one.'),
});

export type CreateMemoryParams = z.infer<typeof createMemoryParams>;

export const createMemorySchema = {
    description: 'Creates a new, structured memory, generating a vector embedding for its content. Can link memories to build a knowledge graph.',
    inputSchema: createMemoryParams.shape,
};

export async function createMemory(params: CreateMemoryParams) {
    const { content, metadata, linked_memory_id, link_type } = createMemoryParams.parse(params);

    if (linked_memory_id && !link_type) {
        throw new Error("`link_type` is required when `linked_memory_id` is provided.");
    }

    try {
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: content,
        });
        const embedding = embeddingResponse.data[0].embedding;

        const { data, error } = await supabase
            .from('memories')
            .insert({
                content,
                embedding: `[${embedding.join(',')}]`,
                metadata,
                linked_memory_id,
                link_type,
            })
            .select('id')
            .single();

        if (error) throw error;

        // Delay to allow for vector indexing
        await new Promise(resolve => setTimeout(resolve, 3000));

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: true,
                    memory_id: data.id,
                    message: 'Memory created successfully.'
                }, null, 2)
            }]
        };
    } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error creating memory: ${e.message}` }] };
    }
}
