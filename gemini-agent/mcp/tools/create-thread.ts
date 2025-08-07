import { supabase } from './shared/supabase.js';
import { z } from 'zod';

export const createThreadParams = z.object({
    title: z.string().describe('A descriptive title for the thread.'),
    objective: z.string().describe('The specific goal of the thread.'),
    parent_thread_id: z.string().uuid().optional().describe('The ID of a parent thread to create a sub-task.'),
});

export type CreateThreadParams = z.infer<typeof createThreadParams>;

export const createThreadSchema = {
    description: 'Creates a new research or execution thread.',
    inputSchema: createThreadParams.shape,
};

export async function createThread(params: CreateThreadParams) {
    try {
        // Use safeParse to avoid throwing exceptions on validation errors
        const parseResult = createThreadParams.safeParse(params);
        if (!parseResult.success) {
            return { content: [{ type: 'text' as const, text: `Invalid parameters: ${parseResult.error.message}` }] };
        }
        const { title, objective, parent_thread_id } = parseResult.data;
        const newThread: any = {
            title,
            objective,
            parent_thread_id,
        };

        const { data, error } = await supabase
            .from('threads')
            .insert(newThread)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create thread: ${error.message}`);
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };

    } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error creating thread: ${e.message}` }] };
    }
}
