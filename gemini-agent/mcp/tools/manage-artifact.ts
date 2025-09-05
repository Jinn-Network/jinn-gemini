import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { z } from 'zod';

export const manageArtifactParams = z.object({
    artifact_id: z.string().uuid().optional().describe('The ID of the artifact to update. If omitted, a new artifact is created.'),
    project_definition_id: z.string().uuid().optional().describe('The ID of the project definition to associate the artifact with. Only used during creation if the job has no project context.'),
    name: z.string().optional().describe('Optional human-readable name for the artifact.'),
    content: z.string().describe('The content to set or add to the artifact.'),
    topic: z.string().optional().describe('The topic for classification. On update, omission leaves it unchanged.'),
    status: z.string().optional().describe('The processing status. Defaults to RAW on creation. On update, omission leaves it unchanged.'),
    mode: z.enum(['replace', 'append', 'prepend']).default('replace').optional().describe('How to handle the content: replace (default), append to end, or prepend to beginning. Only used for updates.'),
});

export type ManageArtifactParams = z.infer<typeof manageArtifactParams>;

export const manageArtifactSchema = {
    description: 'Creates or updates an artifact, automatically linking it to the current job and project context.',
    inputSchema: manageArtifactParams.shape,
};

export async function manageArtifact(params: ManageArtifactParams) {
    try {
        // Use safeParse to avoid throwing exceptions on validation errors
        const parseResult = manageArtifactParams.safeParse(params);
        if (!parseResult.success) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `Invalid parameters: ${parseResult.error.message}`
                }]
            };
        }
        
        const { artifact_id, project_definition_id: param_project_definition_id, name, content, topic, status, mode = 'replace' } = parseResult.data;
        const { jobId, jobName, jobDefinitionId, projectRunId, projectDefinitionId } = getCurrentJobContext();

        if (artifact_id) {
            // Update Mode - modify existing artifact

            // First get the current artifact
            const { data: currentArtifact, error: fetchError } = await supabase
                .from('artifacts')
                .select('*')
                .eq('id', artifact_id)
                .single();

            if (fetchError) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Artifact with ID '${artifact_id}' not found: ${fetchError.message}`
                    }]
                };
            }

            // Calculate new content based on mode
            let newContent = content;
            if (mode === 'append') {
                newContent = (currentArtifact.content || '') + content;
            } else if (mode === 'prepend') {
                newContent = content + (currentArtifact.content || '');
            }
            // 'replace' uses content as-is

            // Update the artifact
            const updateData: any = {
                content: newContent,
                updated_at: new Date().toISOString()
            };

            // Only update topic and status if provided
            if (topic !== undefined) updateData.topic = topic;
            if (status !== undefined) updateData.status = status;
            if (name !== undefined) updateData.name = name;

            const { data: updatedArtifact, error: updateError } = await supabase
                .from('artifacts')
                .update(updateData)
                .eq('id', artifact_id)
                .select()
                .single();

            if (updateError) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Failed to update artifact: ${updateError.message}`
                    }]
                };
            }

            return { 
                content: [{ 
                    type: 'text' as const, 
                    text: `Updated artifact: ${artifact_id}`
                }] 
            };

        } else {
            // Create Mode - new artifact

            // Determine project context
            const finalProjectRunId = projectRunId;
            const finalProjectDefinitionId = projectDefinitionId || param_project_definition_id;

            if (!finalProjectRunId) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: "Cannot create an artifact. The job has no project_run_id context. Artifacts require a project run context."
                    }]
                };
            }

            const newArtifact = {
                project_run_id: finalProjectRunId,
                project_definition_id: finalProjectDefinitionId,
                name: name || null,
                content,
                topic: topic || null,
                status: status || 'RAW',
                job_id: jobId,
                parent_job_definition_id: jobDefinitionId
            };

            const { data: createdArtifact, error: createError } = await supabase
                .from('artifacts')
                .insert(newArtifact)
                .select('id')
                .single();

            if (createError) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Failed to create artifact: ${createError.message}`
                    }]
                };
            }

            return { 
                content: [{ 
                    type: 'text' as const, 
                    text: `Created artifact: ${createdArtifact.id}`
                }] 
            };
        }
    } catch (e: any) {
        return { 
            content: [{ 
                type: 'text' as const, 
                text: `Error managing artifact: ${e.message}`
            }] 
        };
    }
}