import { supabase, getCurrentJobContext } from './shared/supabase.js';
import { z } from 'zod';

export const manageThreadParams = z.object({
    thread_id: z.string().optional().describe('The ID of the thread to update. If omitted, a new thread is created.'),
    title: z.string().optional().describe('A descriptive title for the thread. Required for creation.'),
    objective: z.string().optional().describe('The specific goal of the thread. Required for creation.'),
    parent_thread_id: z.string().optional().describe('The ID of a parent thread to create a sub-task.'),
    status: z.string().optional().describe("The new status (e.g., 'OPEN', 'COMPLETED'). On update, omission leaves it unchanged."),
    summary: z.record(z.any()).optional().describe("A summary of the thread's results. On update, omission leaves it unchanged."),
});

export type ManageThreadParams = z.infer<typeof manageThreadParams>;

export const manageThreadSchema = {
    description: 'A unified tool to create or update threads. Automatically stamps the thread with the creating or updating job context. Returns the full state of the thread upon completion.',
    inputSchema: manageThreadParams.shape,
};

export async function manageThread(params: ManageThreadParams) {
    const { thread_id, title, objective, parent_thread_id, status, summary } = manageThreadParams.parse(params);
    const { jobId, jobName } = getCurrentJobContext();

    try {
        if (thread_id) {
            // Update Mode
            const updates: any = {};
            if (title) updates.title = title;
            if (objective) updates.objective = objective;
            if (parent_thread_id) updates.parent_thread_id = parent_thread_id;
            if (status) updates.status = status;
            if (summary) updates.summary = summary;

            if (Object.keys(updates).length === 0) {
                throw new Error("Nothing to update. Please provide at least one field to modify.");
            }

            // Inject the context of the job performing the update
            updates.source_job_id = jobId ?? null;
            updates.source_job_name = jobName ?? null;
            updates.updated_at = new Date().toISOString();

            const { data, error } = await supabase
                .from('threads')
                .update(updates)
                .eq('id', thread_id)
                .select()
                .single();

            if (error) throw error;
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };

        } else {
            // Create Mode
            if (!title || !objective) {
                throw new Error("`title` and `objective` are required to create a new thread.");
            }
            
            const newThread: any = { 
                title, 
                objective, 
                parent_thread_id, 
                status: status || 'OPEN', 
                summary,
                source_job_id: jobId ?? null,
                source_job_name: jobName ?? null,
            };

            const { data, error } = await supabase
                .from('threads')
                .insert(newThread)
                .select()
                .single();

            if (error) throw error;
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        }
    } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error managing thread: ${e.message}` }] };
    }
}
