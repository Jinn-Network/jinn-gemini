import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { getCurrentJobContext } from './shared/context.js';

export const UpdateJobInputSchema = z.object({
  job_id: z.string().uuid().describe('The stable job_id (UUID) of the job to update. This creates a new version.'),
  updates: z.object({
    description: z.string().optional().describe('Updated description of the job purpose'),
    prompt_content: z.string().optional().describe('Updated prompt content for the job'),
    enabled_tools: z.array(z.string()).optional().describe('Updated array of tool names this job can use'),
    schedule_on: z.string().optional().describe('Updated schedule configuration - same format as create_job'),
    filter: z.record(z.string()).optional().describe('Updated filter configuration for event routing'),
    project_definition_id: z.string().uuid().optional().describe('Updated project definition link'),
  }).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided in updates object' }
  ).describe('Object containing the fields to update. At least one field is required.'),
});

export type UpdateJobParams = z.infer<typeof UpdateJobInputSchema>;

export const updateJobSchema = {
  description: `Updates an existing job definition by creating a new version. The job is identified by its stable job_id (UUID shared across all versions).

This operation:
1. Finds the current active version of the specified job
2. Sets the current version to inactive (is_active = false)  
3. Creates a new version with incremented version number and provided updates
4. Sets the new version as active (is_active = true)

Only the fields specified in the 'updates' object will be changed. All other fields (name, enabled_tools, etc.) will be copied from the current active version.

The schedule_on and filter parameters work the same as in create_job, with the same auto-binding and normalization logic.

Returns: Complete information about the newly created job version, including the new version number and all job metadata.`,
  inputSchema: UpdateJobInputSchema.shape,
};

export async function updateJob(params: UpdateJobParams) {
  try {
    // Validate input parameters
    const parseResult = UpdateJobInputSchema.safeParse(params);
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
    const { job_id, updates } = validatedParams;

    // Find the current active version of the job
    const { data: currentJob, error: findError } = await supabase
      .from('jobs')
      .select('*')
      .eq('job_id', job_id)
      .eq('is_active', true)
      .maybeSingle();

    if (findError) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'DB_ERROR',
              message: `Failed to find current job version: ${findError.message}`
            }
          }, null, 2)
        }]
      };
    }

    if (!currentJob) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'JOB_NOT_FOUND',
              message: `No active job found with job_id: ${job_id}`
            }
          }, null, 2)
        }]
      };
    }

    // Process schedule configuration if provided
    let schedule_config = currentJob.schedule_config;
    if (updates.schedule_on !== undefined || updates.filter !== undefined) {
      // Normalize the schedule configuration using similar logic to create_job
      const { jobDefinitionId: currentJobDefinitionId } = getCurrentJobContext();
      
      const schedule_on = updates.schedule_on || 'after_this_job';
      const filter = updates.filter || {};

      if (schedule_on === 'manual') {
        schedule_config = { trigger: 'manual', filters: {} };
      } else if (schedule_on === 'after_this_job') {
        // Only auto-bind when explicitly using 'after_this_job' 
        const baseFilters: any = { event_type: 'job.completed' };
        if (currentJobDefinitionId) {
          filter.job_definition_id = currentJobDefinitionId;
          schedule_config = { trigger: 'on_new_event', filters: { ...baseFilters, ...filter } };
        } else {
          schedule_config = { trigger: 'manual', filters: {} };
        }
      } else if (schedule_on === 'job.completed') {
        // For explicit 'job.completed', don't auto-bind - use the filter as provided
        const baseFilters: any = { event_type: 'job.completed' };
        schedule_config = { trigger: 'on_new_event', filters: { ...baseFilters, ...filter } };
      } else {
        // Generic event subscription
        schedule_config = { trigger: 'on_new_event', filters: { event_type: schedule_on, ...filter } };
      }
    }

    // Deactivate the current version
    const { error: deactivateError } = await supabase
      .from('jobs')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('job_id', job_id)
      .eq('is_active', true);

    if (deactivateError) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'DB_ERROR',
              message: `Failed to deactivate current version: ${deactivateError.message}`
            }
          }, null, 2)
        }]
      };
    }

    // Create the new version with updates
    const newVersion = currentJob.version + 1;
    const newJobData = {
      job_id: job_id,
      version: newVersion,
      name: currentJob.name, // name cannot be updated to maintain job identity
      description: updates.description ?? currentJob.description,
      prompt_content: updates.prompt_content ?? currentJob.prompt_content,
      enabled_tools: updates.enabled_tools ?? currentJob.enabled_tools,
      schedule_config: schedule_config,
      project_definition_id: updates.project_definition_id ?? currentJob.project_definition_id,
      is_active: true,
      model_settings: currentJob.model_settings,
      project_run_id: currentJob.project_run_id,
      parent_job_definition_id: currentJob.parent_job_definition_id,
    };

    const { data: newJob, error: insertError } = await supabase
      .from('jobs')
      .insert(newJobData)
      .select()
      .single();

    if (insertError) {
      // Rollback: reactivate the previous version
      await supabase
        .from('jobs')
        .update({ is_active: true })
        .eq('id', currentJob.id);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'DB_ERROR',
              message: `Failed to create new job version: ${insertError.message}`
            }
          }, null, 2)
        }]
      };
    }

    // Return comprehensive job information
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
      updated_at: newJob.updated_at,
      project_definition_id: newJob.project_definition_id,
      update_summary: {
        previous_version: currentJob.version,
        new_version: newJob.version,
        updated_fields: Object.keys(updates),
        version_created_at: newJob.created_at
      }
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: result,
          meta: {
            ok: true,
            code: 'UPDATE_SUCCESS',
            message: `Successfully updated job "${newJob.name}" to version ${newJob.version}`
          }
        }, null, 2)
      }]
    };

  } catch (error: any) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: null,
          meta: {
            ok: false,
            code: 'UPDATE_ERROR',
            message: `Error updating job: ${error.message}`
          }
        }, null, 2)
      }]
    };
  }
}