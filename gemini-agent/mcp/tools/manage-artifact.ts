import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { z } from 'zod';

export const manageArtifactParams = z.object({
    artifact_id: z.string().uuid().optional().describe('The ID of the artifact to update. If omitted, a new artifact is created.'),
    project_definition_id: z.string().uuid().optional().describe('The ID of the project definition to associate the artifact with. Only used during creation if the job has no project context.'),
    operation: z.enum(['CREATE', 'REPLACE', 'APPEND', 'PREPEND']).describe('The content operation to perform. Use CREATE for new artifacts, others for updates.'),
    content: z.string().describe('The content to be used in the specified operation.'),
    topic: z.string().optional().describe('The topic for classification. On update, omission leaves it unchanged.'),
    status: z.string().optional().describe('The processing status. Defaults to RAW on creation. On update, omission leaves it unchanged.'),
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
                    text: JSON.stringify({ 
                        data: null, 
                        meta: { 
                            ok: false, 
                            code: 'VALIDATION_ERROR', 
                            message: `Invalid parameters: ${parseResult.error.message}`, 
                            details: parseResult.error.flatten?.() ?? undefined 
                        } 
                    }, null, 2)
                }]
            };
        }
        
        const { artifact_id, project_definition_id: param_project_definition_id, operation, content, topic, status } = parseResult.data;
        const { jobId, jobName, jobDefinitionId, projectRunId, projectDefinitionId } = getCurrentJobContext();

        if (artifact_id) {
            // Update Mode - modify existing artifact
            if (operation === 'CREATE') {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'INVALID_OPERATION', 
                                message: "Cannot use CREATE operation with artifact_id. Use REPLACE, APPEND, or PREPEND for updates." 
                            } 
                        }, null, 2)
                    }]
                };
            }

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
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'ARTIFACT_NOT_FOUND', 
                                message: `Artifact with ID '${artifact_id}' not found: ${fetchError.message}` 
                            } 
                        }, null, 2)
                    }]
                };
            }

            // Calculate new content based on operation
            let newContent = content;
            if (operation === 'APPEND') {
                newContent = (currentArtifact.content || '') + content;
            } else if (operation === 'PREPEND') {
                newContent = content + (currentArtifact.content || '');
            }
            // REPLACE uses content as-is

            // Update the artifact
            const updateData: any = {
                content: newContent,
                updated_at: new Date().toISOString()
            };

            // Only update topic and status if provided
            if (topic !== undefined) updateData.topic = topic;
            if (status !== undefined) updateData.status = status;

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
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'UPDATE_FAILED', 
                                message: `Failed to update artifact: ${updateError.message}` 
                            } 
                        }, null, 2)
                    }]
                };
            }

            return { 
                content: [{ 
                    type: 'text' as const, 
                    text: JSON.stringify({ 
                        data: updatedArtifact, 
                        meta: { ok: true } 
                    }, null, 2) 
                }] 
            };

        } else {
            // Create Mode - new artifact
            if (operation !== 'CREATE') {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'INVALID_OPERATION', 
                                message: "Operation must be 'CREATE' when creating a new artifact without artifact_id." 
                            } 
                        }, null, 2)
                    }]
                };
            }

            // Determine project context
            const finalProjectRunId = projectRunId;
            const finalProjectDefinitionId = projectDefinitionId || param_project_definition_id;

            if (!finalProjectRunId) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'MISSING_PROJECT_CONTEXT', 
                                message: "Cannot create an artifact. The job has no project_run_id context. Artifacts require a project run context." 
                            } 
                        }, null, 2)
                    }]
                };
            }

            const newArtifact = {
                project_run_id: finalProjectRunId,
                project_definition_id: finalProjectDefinitionId,
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
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'CREATE_FAILED', 
                                message: `Failed to create artifact: ${createError.message}` 
                            } 
                        }, null, 2)
                    }]
                };
            }

            return { 
                content: [{ 
                    type: 'text' as const, 
                    text: JSON.stringify({ 
                        data: createdArtifact, 
                        meta: { ok: true } 
                    }, null, 2) 
                }] 
            };
        }
    } catch (e: any) {
        return { 
            content: [{ 
                type: 'text' as const, 
                text: JSON.stringify({ 
                    data: null, 
                    meta: { 
                        ok: false, 
                        code: 'DB_ERROR', 
                        message: `Error managing artifact: ${e.message}` 
                    } 
                }, null, 2) 
            }] 
        };
    }
}