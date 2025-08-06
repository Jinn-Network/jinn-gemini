import { supabase, getCurrentJobContext } from './shared/supabase.js';
import { z } from 'zod';

export const manageArtifactParams = z.object({
    artifact_id: z.string().optional().describe('The ID of the artifact to update. If omitted, a new artifact is created.'),
    operation: z.enum(['REPLACE', 'APPEND', 'PREPEND']).describe('The content operation to perform.'),
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
    const { artifact_id, operation, content, topic, status } = manageArtifactParams.parse(params);
    const { jobId, jobName, threadId } = getCurrentJobContext();

    try {
        if (artifact_id) {
            // Update Mode
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
            // Create Mode
            if (!threadId) {
                throw new Error("Cannot create an artifact because the current job is not associated with a thread. Use the `manage_thread` tool to create a thread first.");
            }
            if (operation !== 'REPLACE') {
                throw new Error("Operation must be 'REPLACE' when creating a new artifact.");
            }

            const newArtifact = {
                thread_id: threadId,
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
