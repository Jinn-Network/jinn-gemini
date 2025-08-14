import { supabase } from './shared/supabase.js';
import { CreateJobInputSchema, type CreateJobInput } from './shared/types.js';
import { randomUUID } from 'crypto';
import { getCurrentJobContext } from './shared/context.js';

// Helper function to normalize simplified schedule config to internal format
function normalizeScheduleConfig(config: any): any {
    // Handle legacy format and string shortcuts
    if (typeof config === 'string') {
        if (config === 'manual') {
            return { trigger: 'manual', filters: {} };
        }
        // String event name like "artifact.created"
        return { trigger: 'on_new_event', filters: { event_type: config } };
    }

    // Handle simplified object format with "on" property
    if (config && typeof config === 'object' && config.on) {
        const { on, ...payloadFilters } = config;
        
        if (on === 'manual') {
            return { trigger: 'manual', filters: {} };
        }
        
        // Build filters object
        const filters: any = { event_type: on };
        
        // Add payload filters if any additional properties exist
        if (Object.keys(payloadFilters).length > 0) {
            filters.payload = payloadFilters;
        }
        
        return { trigger: 'on_new_event', filters };
    }

    // Return as-is for already normalized format or manual
    return config;
}

export const createJobParams = CreateJobInputSchema;
export type CreateJobParams = CreateJobInput;

export const createJobSchema = {
    description: 'Creates a new job definition or a new version of an existing job.\n\nScheduling: set schedule_on to an event type (e.g., "artifact.created", "job.completed") or to "manual". If omitted, it defaults to running after the current job completes (alias: "after_this_job"). When scheduling on "job.completed" without a filter.job_id, the tool auto-binds to the current job id when available; if not available, it falls back to manual. To associate the job to a project, pass project_definition_id.\n\nManual jobs are automatically dispatched once when created, then require manual re-enqueueing for future runs. Manual jobs inherit the project context from the current job execution and will fail if created outside of a job context.',
    inputSchema: createJobParams.shape,
};

export async function createJob(params: CreateJobParams) {
    try {
        // Use safeParse to avoid throwing exceptions on validation errors
        const parseResult = createJobParams.safeParse(params);
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
        const validatedParams = parseResult.data;
        let {
            name,
            description,
            prompt_content,
            enabled_tools,
            schedule_on,
            filter,
            existing_job_id,
            project_definition_id
        } = validatedParams as any;

        // Resolve current job context for default/auto-binding behaviors
        const { jobId: currentJobId, jobDefinitionId: currentJobDefinitionId } = getCurrentJobContext();

        // Normalize simplified scheduling to internal schedule_config
        let schedule_config: any = undefined;
        const hasScheduleOn = typeof schedule_on === 'string' && schedule_on.trim().length > 0;

        if (!hasScheduleOn) {
            // Default: schedule after this job completes if we have a current job definition id; else fallback to manual
            if (currentJobDefinitionId) {
                schedule_config = { trigger: 'on_new_event', filters: { event_type: 'job.completed', job_definition_id: currentJobDefinitionId } };
            } else {
                schedule_config = { trigger: 'manual', filters: {} };
            }
        } else {
            const normalized = schedule_on as string;
            if (normalized === 'manual') {
                schedule_config = { trigger: 'manual', filters: {} };
            } else if (normalized === 'after_this_job') {
                if (currentJobDefinitionId) {
                    schedule_config = { trigger: 'on_new_event', filters: { event_type: 'job.completed', job_definition_id: currentJobDefinitionId } };
                } else {
                    schedule_config = { trigger: 'manual', filters: {} };
                }
            } else if (normalized === 'job.completed') {
                // Auto-bind to current job definition if no explicit job_definition_id provided
                const baseFilters: any = { event_type: 'job.completed' };
                const provided = (filter && typeof filter === 'object') ? { ...filter } : {};
                if (!('job_definition_id' in provided) && !('job_id' in provided)) {
                    if (currentJobDefinitionId) {
                        provided.job_definition_id = currentJobDefinitionId;
                    } else {
                        // No context to bind to; fallback to manual to avoid over-broad dispatch
                        schedule_config = { trigger: 'manual', filters: {} };
                    }
                }
                if (!schedule_config) {
                    schedule_config = { trigger: 'on_new_event', filters: { ...baseFilters, ...provided } };
                }
            } else {
                // Generic event subscription with optional filters
                schedule_config = { trigger: 'on_new_event', filters: { event_type: normalized } };
                if (filter && typeof filter === 'object') {
                    for (const [k, v] of Object.entries(filter)) {
                        (schedule_config.filters as any)[k] = v as any;
                    }
                }
            }
        }

        let job_id: string;
        let version: number;
        let is_active: boolean;

        if (existing_job_id) {
            // Creating a new version of an existing job
            job_id = existing_job_id;
            
            // Get the highest version number for this job_id
            const { data: existingVersions, error: versionError } = await supabase
                .from('jobs')
                .select('version')
                .eq('job_id', job_id)
                .order('version', { ascending: false })
                .limit(1);

            if (versionError) {
                throw new Error(`Failed to check existing versions: ${versionError.message}`);
            }

            if (!existingVersions || existingVersions.length === 0) {
                throw new Error(`No existing job found with job_id: ${existing_job_id}`);
            }

            version = existingVersions[0].version + 1;
            is_active = true; // New version becomes active

            // Set all previous versions to inactive
            const { error: deactivateError } = await supabase
                .from('jobs')
                .update({ is_active: false })
                .eq('job_id', job_id);

            if (deactivateError) {
                throw new Error(`Failed to deactivate previous versions: ${deactivateError.message}`);
            }

        } else {
            // Creating a brand new job
            job_id = randomUUID();
            version = 1;
            is_active = true;
        }

        // Insert the new job record
        const { data: newJob, error: insertError } = await supabase
            .from('jobs')
            .insert({
                job_id,
                version,
                name,
                description,
                prompt_content,
                enabled_tools: enabled_tools || [],
                schedule_config,
                is_active,
                project_definition_id: project_definition_id || null
            })
            .select()
            .single();

        if (insertError) {
            throw new Error(`Failed to create job: ${insertError.message}`);
        }

        // Auto-dispatch manual jobs by creating a job_board entry directly
        if (schedule_config.trigger === 'manual') {
            try {
                // For manual jobs, directly create a job_board entry to dispatch immediately
                // Manual jobs should inherit the project context from the current job
                const { projectRunId: currentProjectRunId, projectDefinitionId: currentProjectDefinitionId } = getCurrentJobContext();
                
                if (!currentProjectRunId) {
                    throw new Error(`Cannot create manual job: no project run context available. Manual jobs must be created within an existing job execution context.`);
                }
                
                // Create a system event to serve as the source for the job
                const { data: eventData, error: eventError } = await supabase
                    .from('events')
                    .insert({
                        event_type: 'system.job.manual_dispatch',
                        payload: { 
                            job_definition_id: newJob.id,
                            job_name: newJob.name,
                            reason: 'auto_dispatch_on_creation',
                            inherited_from_job_id: currentJobId,
                            inherited_project_run_id: currentProjectRunId
                        },
                        source_table: 'jobs',
                        source_id: newJob.id,
                        project_run_id: currentProjectRunId
                    })
                    .select('id')
                    .single();

                if (eventError) {
                    throw new Error(`Failed to create manual dispatch event: ${eventError.message}`);
                }
                
                // Now directly insert into job_board to dispatch the job
                const { error: jobBoardError } = await supabase
                    .from('job_board')
                    .insert({
                        job_definition_id: newJob.id,
                        job_name: newJob.name,
                        enabled_tools: newJob.enabled_tools || [],
                        model_settings: newJob.model_settings || {},
                        input: newJob.prompt_content,
                        status: 'PENDING',
                        source_event_id: eventData.id,
                        project_run_id: currentProjectRunId,
                        project_definition_id: currentProjectDefinitionId || project_definition_id || null,
                        inbox: []
                    });

                if (jobBoardError) {
                    throw new Error(`Failed to dispatch manual job to job_board: ${jobBoardError.message}`);
                }
                
            } catch (dispatchError: any) {
                // For manual jobs, dispatch failure should fail the job creation
                throw new Error(`Failed to create manual job: ${dispatchError.message}`);
            }
        }

        const result = {
            id: newJob.id,
            job_id: newJob.job_id,
            version: newJob.version,
            name: newJob.name,
            is_active: newJob.is_active,
            created_at: newJob.created_at,
            auto_dispatched: schedule_config.trigger === 'manual'
        };

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ data: result, meta: { ok: true } })
            }]
        };
    } catch (e: any) {
        return {
            content: [
                { type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error creating job: ${e.message}` } }) },
            ],
        };
    }
} 