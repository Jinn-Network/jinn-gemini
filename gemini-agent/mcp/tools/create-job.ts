import { supabase } from './shared/supabase.js';
import { CreateJobInputSchema, type CreateJobInput } from './shared/types.js';
import { getRegisteredToolNames } from './shared/tool-registry.js';
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

// Helper function to check if a job name already exists
// This prevents duplicate active jobs with the same name, which would cause
// the duplicate job dispatching issue in the universal_job_dispatcher
async function checkExistingJob(name: string) {
    const { data: existingJob, error } = await supabase
        .from('jobs')
        .select('id, job_id, version, is_active, description, created_at')
        .eq('name', name)
        .eq('is_active', true)
        .maybeSingle();
    
    if (error) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ 
                    data: null, 
                    meta: { 
                        ok: false, 
                        code: 'DB_ERROR', 
                        message: `Failed to check for existing job: ${error.message}` 
                    } 
                }, null, 2)
            }]
        };
    }
    
    return existingJob;
}

export const createJobParams = CreateJobInputSchema;
export type CreateJobParams = CreateJobInput;

export const createJobSchema = {
    description: `Creates a new job definition or a new version of an existing job.

IMPORTANT: If a job with the same name already exists and is active, this tool will return an error. To update an existing job, pass existing_job_id to create a new version.

Scheduling: set schedule_on to an event type (e.g., "artifact.created", "job.completed") or to "manual". If omitted, it defaults to running after the current job completes (alias: "after_this_job"). When scheduling on "job.completed" without a filter.job_id, the tool auto-binds to the current job id when available; if not available, it falls back to manual. To associate the job to a project, pass project_definition_id.

Manual jobs are automatically dispatched once when created, then require manual re-enqueueing for future runs. Manual jobs inherit the project context from the current job execution and will fail if created outside of a job context.

Returns: Complete job information including id (database primary key), job_id (shared UUID across versions), description, prompt_content, enabled_tools, schedule_config, and other metadata. This eliminates the need for additional read_records calls to get job details.`,
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
            project_definition_id,
            parent_job_definition_id
        } = validatedParams as any;

        // Validate enabled_tools against registry
        const allowed = new Set(getRegisteredToolNames());
        const invalid = (enabled_tools || []).filter((t: string) => !allowed.has(t));
        if (invalid.length > 0) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ data: null, meta: { ok: false, code: 'UNKNOWN_TOOLS', message: `Unknown tools: ${invalid.join(', ')}`, allowed_tools: Array.from(allowed).sort() } }, null, 2)
                }]
            };
        }

        // Resolve current job context for default/auto-binding behaviors
        const { jobId: currentJobId, jobDefinitionId: currentJobDefinitionId } = getCurrentJobContext();

        // IMPORTANT: Prevent duplicate active jobs with the same name
        // This check prevents the duplicate job dispatching issue by ensuring
        // only one active job definition exists per job name
        // Check for existing active job with the same name (unless we're creating a new version)
        if (!existing_job_id) {
            const existingActiveJobResult = await checkExistingJob(name);
            
            // Check if checkExistingJob returned an error
            if (existingActiveJobResult && 'content' in existingActiveJobResult) {
                return existingActiveJobResult; // Return the error response
            }

            if (existingActiveJobResult && !('content' in existingActiveJobResult)) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'DUPLICATE_JOB_NAME', 
                                message: `Job name "${name}" already exists and is active. Please review the existing job before updating. If you decide to update, create a new version by passing existing_job_id: "${existingActiveJobResult.job_id}".`,
                                // Surface identifiers for quick programmatic handling
                                id: existingActiveJobResult.id,
                                job_id: existingActiveJobResult.job_id,
                                // Operator guidance
                                hint: 'Use get_details to read the existing job by job_id before updating to check if an update is actually needed.'
                            },
                            existing_job: {
                                id: existingActiveJobResult.id,
                                job_id: existingActiveJobResult.job_id,
                                version: existingActiveJobResult.version,
                                description: existingActiveJobResult.description,
                                created_at: existingActiveJobResult.created_at
                            }
                        }, null, 2)
                    }]
                };
            }
        }

        // Normalize simplified scheduling to internal schedule_config
        let schedule_config: any = undefined;
        const hasScheduleOn = typeof schedule_on === 'string' && schedule_on.trim().length > 0;

        if (!hasScheduleOn) {
            // Default: schedule after this job completes if we have a current job definition id; else fallback to manual
            if (currentJobDefinitionId) {
                schedule_config = { trigger: 'on_new_event', filters: { event_type: 'job.completed', payload: { job_definition_id: currentJobDefinitionId } } };
            } else {
                schedule_config = { trigger: 'manual', filters: {} };
            }
        } else {
            const normalized = schedule_on as string;
            if (normalized === 'manual') {
                schedule_config = { trigger: 'manual', filters: {} };
            } else if (normalized === 'after_this_job') {
                if (currentJobDefinitionId) {
                    schedule_config = { trigger: 'on_new_event', filters: { event_type: 'job.completed', payload: { job_definition_id: currentJobDefinitionId } } };
                } else {
                    schedule_config = { trigger: 'manual', filters: {} };
                }
            } else if (normalized === 'job.completed') {
                // Auto-bind to current job definition via payload if no explicit payload.job_definition_id provided
                const baseFilters: any = { event_type: 'job.completed' };
                const providedRaw = (filter && typeof filter === 'object') ? { ...filter } : {};
                // Normalize provided filter to use payload object exclusively
                const payloadObj: any = { ...(providedRaw.payload || {}) };
                if ('job_definition_id' in providedRaw && typeof providedRaw.job_definition_id === 'string') {
                    payloadObj.job_definition_id = providedRaw.job_definition_id;
                    delete (providedRaw as any).job_definition_id;
                }
                if ('job_id' in providedRaw && typeof providedRaw.job_id === 'string') {
                    payloadObj.job_id = providedRaw.job_id;
                    delete (providedRaw as any).job_id;
                }
                // If still no discriminator, auto-bind to current
                if (!('job_definition_id' in payloadObj) && !('job_id' in payloadObj)) {
                    if (currentJobDefinitionId) {
                        payloadObj.job_definition_id = currentJobDefinitionId;
                    } else {
                        // No context to bind to; fallback to manual to avoid over-broad dispatch
                        schedule_config = { trigger: 'manual', filters: {} };
                    }
                }
                if (!schedule_config) {
                    const normalizedFilters: any = { ...baseFilters };
                    if (Object.keys(providedRaw).length > 0) {
                        // Merge any remaining simple filters (e.g., event_type overrides should not be here)
                        for (const [k, v] of Object.entries(providedRaw)) {
                            if (k !== 'payload') {
                                (normalizedFilters as any)[k] = v as any;
                            }
                        }
                    }
                    normalizedFilters.payload = payloadObj;
                    schedule_config = { trigger: 'on_new_event', filters: normalizedFilters };
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
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'DB_ERROR', 
                                message: `Failed to check existing versions: ${versionError.message}` 
                            } 
                        }, null, 2)
                    }]
                };
            }

            if (!existingVersions || existingVersions.length === 0) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'JOB_NOT_FOUND', 
                                message: `No existing job found with job_id: ${existing_job_id}` 
                            } 
                        }, null, 2)
                    }]
                };
            }

            version = existingVersions[0].version + 1;
            is_active = true; // New version becomes active

            // Set all previous versions to inactive
            const { error: deactivateError } = await supabase
                .from('jobs')
                .update({ is_active: false })
                .eq('job_id', job_id);

            if (deactivateError) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'DB_ERROR', 
                                message: `Failed to deactivate previous versions: ${deactivateError.message}` 
                            } 
                        }, null, 2)
                    }]
                };
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
                parent_job_definition_id: parent_job_definition_id || currentJobDefinitionId || null
            })
            .select()
            .single();

        if (insertError) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ 
                        data: null, 
                        meta: { 
                            ok: false, 
                            code: 'DB_ERROR', 
                            message: `Failed to create job: ${insertError.message}` 
                        } 
                    }, null, 2)
                }]
            };
        }

        // Auto-dispatch manual jobs by creating a job_board entry directly
        if (schedule_config.trigger === 'manual') {
            try {
                // For manual jobs, directly create a job_board entry to dispatch immediately
                // Manual jobs should inherit the project context from the current job
                const { projectRunId: currentProjectRunId, projectDefinitionId: currentProjectDefinitionId } = getCurrentJobContext();
                
                if (!currentProjectRunId) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ 
                                data: null, 
                                meta: { 
                                    ok: false, 
                                    code: 'NO_PROJECT_CONTEXT', 
                                    message: `Cannot create manual job: no project run context available. Manual jobs must be created within an existing job execution context.` 
                                } 
                            }, null, 2)
                        }]
                    };
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
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ 
                                data: null, 
                                meta: { 
                                    ok: false, 
                                    code: 'DB_ERROR', 
                                    message: `Failed to create manual dispatch event: ${eventError.message}` 
                                } 
                            }, null, 2)
                        }]
                    };
                }
                
                // Now directly insert into job_board to dispatch the job
                const { error: jobBoardError } = await supabase
                    .from('job_board')
                    .insert({
                        parent_job_definition_id: currentJobDefinitionId || null,
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
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ 
                                data: null, 
                                meta: { 
                                    ok: false, 
                                    code: 'DB_ERROR', 
                                    message: `Failed to dispatch manual job to job_board: ${jobBoardError.message}` 
                                } 
                            }, null, 2)
                        }]
                    };
                }
                
            } catch (dispatchError: any) {
                // For manual jobs, dispatch failure should fail the job creation
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ 
                            data: null, 
                            meta: { 
                                ok: false, 
                                code: 'DISPATCH_ERROR', 
                                message: `Failed to create manual job: ${dispatchError.message}` 
                            } 
                        }, null, 2)
                    }]
                };
            }
        }

        // Return comprehensive job information to eliminate need for additional read_records calls
        // id: database primary key for this specific job version
        // job_id: shared UUID across all versions of this job
        const result = {
            id: newJob.id,
            job_id: newJob.job_id,
            version: newJob.version,
            name: newJob.name,
            description: newJob.description,
            prompt_content: newJob.prompt_content,
            enabled_tools: newJob.enabled_tools,
            schedule_config: newJob.schedule_config,
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