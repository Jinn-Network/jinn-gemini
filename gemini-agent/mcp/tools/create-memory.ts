import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { z } from 'zod';
import { linkTypeSchema } from './shared/types.js';
import { getOpenAIClient } from './shared/openai.js';

// Using shared OpenAI client from ./shared/openai.js

export const createMemoryParams = z.object({
    content: z.string().describe('The textual content of the memory to be stored and embedded.'),
    custom_metadata: z.record(z.string(), z.any()).optional().describe('Optional. Any additional, custom, searchable metadata to attach to the memory.'),
    linked_memory_id: z.string().uuid().optional().describe('The ID of a single, existing memory that this new one is related to.'),
    link_type: linkTypeSchema.optional().describe('Describes the relationship between this new memory and the linked one.'),
});

export type CreateMemoryParams = z.infer<typeof createMemoryParams>;

export const createMemorySchema = {
    description: 'Creates a new, structured memory, generating a vector embedding. It automatically tags the memory with the current job and project context.',
    inputSchema: createMemoryParams.shape,
};

export async function createMemory(params: CreateMemoryParams) {
    try {
        // Use safeParse to avoid throwing exceptions on validation errors
        const parseResult = createMemoryParams.safeParse(params);
        if (!parseResult.success) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
                }]
            };
        }
        const { content, custom_metadata, linked_memory_id, link_type } = parseResult.data;

        if (linked_memory_id && !link_type) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: 'link_type is required when linked_memory_id is provided.' }, null, 2) }]
            };
        }
        const { jobId, jobName, jobDefinitionId, projectRunId, projectDefinitionId } = getCurrentJobContext();

        let embedding: number[];
        try {
            if (!process.env.OPENAI_API_KEY) {
                // Fallback: generate a deterministic zero vector when no API key present
                embedding = Array.from({ length: 1536 }, () => 0);
            } else {
                const embeddingResponse = await getOpenAIClient().embeddings.create({
                    model: 'text-embedding-3-small',
                    input: content,
                });
                embedding = embeddingResponse.data[0].embedding as unknown as number[];
            }
        } catch (embedErr: any) {
            // Last-resort fallback to zero vector on embedding errors
            embedding = Array.from({ length: 1536 }, () => 0);
        }

        // Construct the metadata object, merging automatic context with custom metadata
        const final_metadata = {
            ...custom_metadata,
            job_id: jobId ?? null,
            parent_job_definition_id: jobDefinitionId ?? null,
            project_run_id: projectRunId ?? null,
            project_definition_id: projectDefinitionId ?? null,
        };

        const { data, error } = await supabase
            .from('memories')
            .insert({
                content,
                embedding: `[${embedding.join(',')}]`,
                metadata: final_metadata,
                linked_memory_id,
                link_type,
                // Also insert the context into the top-level columns for direct querying
                job_id: jobId ?? null,
                parent_job_definition_id: jobDefinitionId ?? null,
                project_run_id: projectRunId ?? null,
                project_definition_id: projectDefinitionId ?? null,
            })
            .select('id')
            .single();

        if (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: null, 
            meta: { 
              ok: false, 
              code: 'DB_ERROR', 
              message: `Error creating memory: ${error.message}` 
            } 
          }, null, 2)
        }]
      };
    }

        // Delay to allow for vector indexing
        await new Promise(resolve => setTimeout(resolve, 3000));

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ data: { memory_id: data.id }, meta: { ok: true } }, null, 2)
            }]
        };
    } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error creating memory: ${errorMessage}` } }, null, 2) }] };
    }
}
