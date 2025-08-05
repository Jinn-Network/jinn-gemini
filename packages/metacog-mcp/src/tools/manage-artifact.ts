import { supabase } from './shared/supabase.js';
import { z } from 'zod';

export const manageArtifactParams = z.object({
    artifact_id: z.string().optional().describe('The ID of the artifact to update. If omitted, a new artifact is created.'),
    thread_id: z.string().optional().describe('The ID of the thread for the new artifact. Required for creation.'),
    operation: z.enum(['REPLACE', 'APPEND', 'PREPEND']).describe('The content operation to perform.'),
    content: z.string().describe('The content to be used in the specified operation.'),
    source: z.string().optional().describe('The source job_name of the artifact. On update, omission leaves it unchanged.'),
    topic: z.string().optional().describe('The topic for classification. On update, omission leaves it unchanged.'),
    status: z.string().optional().describe('The processing status. Defaults to RAW on creation. On update, omission leaves it unchanged.'),
});

export type ManageArtifactParams = z.infer<typeof manageArtifactParams>;

export const manageArtifactSchema = {
    description: 'A unified tool to create or update artifacts. It handles content manipulation and metadata updates, returning the full, final state of the artifact upon completion.',
    inputSchema: manageArtifactParams.shape,
};

export async function manageArtifact(params: ManageArtifactParams) {
    const { artifact_id, thread_id, operation, content, source, topic, status } = manageArtifactParams.parse(params);

    try {
        if (artifact_id) {
            // Update Mode
            const rpc_params: any = {
                p_artifact_id: artifact_id,
                p_operation: operation,
                p_content: content,
                p_source: source,
                p_topic: topic,
                p_status: status,
            };
            
            // We must pass null for omitted optional values for COALESCE to work in the RPC
            if (source === undefined) rpc_params.p_source = null;
            if (topic === undefined) rpc_params.p_topic = null;
            if (status === undefined) rpc_params.p_status = null;


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
            if (!thread_id) {
                throw new Error("`thread_id` is required to create a new artifact. If you don't have one, use the `create_thread` tool first.");
            }
            if (operation !== 'REPLACE') {
                throw new Error("Operation must be 'REPLACE' when creating a new artifact.");
            }

            const newArtifact: any = {
                thread_id,
                content,
                source,
                topic,
                status: status ?? 'RAW',
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
