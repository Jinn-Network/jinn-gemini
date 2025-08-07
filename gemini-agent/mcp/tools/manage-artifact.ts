import { supabase, getCurrentJobContext } from './shared/supabase.js';
import { z } from 'zod';

export const manageArtifactParams = z.object({
    artifact_id: z.string().uuid().optional().describe('The ID of the artifact to update. If omitted, a new artifact is created.'),
    thread_id: z.string().uuid().optional().describe('The ID of the thread to associate the artifact with. Only used during creation if the job has no thread context.'),
    operation: z.enum(['CREATE', 'REPLACE', 'APPEND', 'PREPEND']).describe('The content operation to perform. Use CREATE for new artifacts, others for updates.'),
    content: z.string().describe('The content to be used in the specified operation.'),
    topic: z.string().optional().describe('The topic for classification. On update, omission leaves it unchanged.'),
    status: z.string().optional().describe('The processing status. Defaults to RAW on creation. On update, omission leaves it unchanged.'),
});

export type ManageArtifactParams = z.infer<typeof manageArtifactParams>;

export const manageArtifactSchema = {
    description: 'Creates or updates an artifact, automatically linking it to the current job and thread context.',
    inputSchema: manageArtifactParams.shape,
};

export async function manageArtifact(params: ManageArtifactParams) {
    const { artifact_id, thread_id: param_thread_id, operation, content, topic, status } = manageArtifactParams.parse(params);
    const { jobId, jobName, threadId: contextThreadId } = getCurrentJobContext();



    try {
        if (artifact_id) {
            // Update Mode - context logic remains the same
            const rpc_params = {
                p_artifact_id: artifact_id,
                p_operation: operation,
                p_content: content,
                p_topic: topic ?? null,
                p_status: status ?? null,
                p_source_job_id: jobId ?? null,
                p_source_job_name: jobName ?? null,
            };

            const { data, error } = await supabase.rpc('atomic_update_artifact', rpc_params);

            if (error) {
                throw new Error(`Failed to update artifact: ${error.message}`);
            }
            if (!data || data.length === 0) {
                throw new Error(`Artifact with ID '${artifact_id}' not found or update failed.`);
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(data[0], null, 2) }] };

        } else {
            // Create Mode - new flexible thread logic
            const finalThreadId = contextThreadId || param_thread_id;

            if (!finalThreadId) {
                throw new Error("Cannot create an artifact. The job has no thread context, and no 'thread_id' parameter was provided. Use the `manage_thread` tool to create a new thread, and then pass the returned `thread_id` to this tool.");
            }
            if (operation !== 'CREATE' && operation !== 'REPLACE') {
                throw new Error("Operation must be 'CREATE' or 'REPLACE' when creating a new artifact. Use 'CREATE' for clarity.");
            }

            const newArtifact = {
                thread_id: finalThreadId,
                content,
                topic,
                status: status ?? 'RAW',
                source_job_id: jobId ?? null,
                source_job_name: jobName ?? null,
            };

            const { data, error: createError } = await supabase
                .from('artifacts')
                .insert(newArtifact)
                .select()
                .single();

            if (createError) {
                throw new Error(`Failed to create artifact: ${createError.message}`);
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        }
    } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error managing artifact: ${e.message}` }] };
    }
}