import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { getCurrentJobContext } from './shared/context.js';

// Schema for the dispatch job parameters
export const dispatchJobParams = z.object({
  job_definition_ids: z.array(z.string().uuid()).describe('Array of job definition IDs to dispatch'),
  reason: z.string().optional().describe('Optional reason for dispatching these jobs (for audit trail)')
});

export type DispatchJobParams = z.infer<typeof dispatchJobParams>;

export const dispatchJobSchema = {
  description: 'Dispatches EXISTING jobs to the job board for immediate execution. Jobs inherit the project context from the current job execution. This tool is ONLY for re-running existing jobs or manually triggering jobs that were previously created. For creating job pipelines and workflows, use create_job with event-based scheduling instead.',
  inputSchema: dispatchJobParams.shape,
};

export async function dispatchJob(params: DispatchJobParams) {
  try {
    // Validate input parameters
    const parseResult = dispatchJobParams.safeParse(params);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            ok: false, 
            code: 'VALIDATION_ERROR', 
            message: `Invalid parameters: ${parseResult.error.message}`, 
            details: parseResult.error.flatten?.() ?? undefined 
          }, null, 2)
        }]
      };
    }

    const { job_definition_ids, reason } = parseResult.data;

    // Get current job context for inheritance
    const { 
      jobId: currentJobId, 
      projectRunId: currentProjectRunId, 
      projectDefinitionId: currentProjectDefinitionId 
    } = getCurrentJobContext();

    if (!currentProjectRunId) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            ok: false, 
            code: 'NO_PROJECT_CONTEXT', 
            message: 'Cannot dispatch jobs: no project run context available. Jobs must be dispatched within an existing job execution context.' 
          }, null, 2)
        }]
      };
    }

    // Fetch the job definitions to validate they exist and get their details
    const { data: jobDefinitions, error: fetchError } = await supabase
      .from('jobs')
      .select('id, name, prompt_content, enabled_tools, model_settings, is_active')
      .in('id', job_definition_ids)
      .eq('is_active', true);

            if (fetchError) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ 
                        data: null, 
                        meta: { 
                            ok: false, 
                            code: 'DB_ERROR', 
                            message: `Failed to fetch job definitions: ${fetchError.message}` 
                        } 
                    }, null, 2)
                }]
            };
        }

    if (!jobDefinitions || jobDefinitions.length === 0) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            ok: false, 
            code: 'NO_JOBS_FOUND', 
            message: 'No active jobs found with the provided IDs' 
          }, null, 2)
        }]
      };
    }

    // Check if all requested jobs were found
    const foundIds = jobDefinitions.map(j => j.id);
    const missingIds = job_definition_ids.filter(id => !foundIds.includes(id));
    
    const dispatchResults = [];
    const errors = [];

    // Dispatch each job
    for (const jobDef of jobDefinitions) {
      try {
        // Create a dispatch event for audit trail
        const { data: eventData, error: eventError } = await supabase
          .from('events')
          .insert({
            event_type: 'system.job.manual_dispatch',
            payload: { 
              job_definition_id: jobDef.id,
              job_name: jobDef.name,
              reason: reason || 'manual_dispatch_via_tool',
              dispatched_by_job_id: currentJobId,
              inherited_project_run_id: currentProjectRunId
            },
            source_table: 'jobs',
            source_id: jobDef.id,
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
                            message: `Failed to create dispatch event: ${eventError.message}` 
                        } 
                    }, null, 2)
                }]
            };
        }

        // Insert into job_board to dispatch the job
        const { error: jobBoardError } = await supabase
          .from('job_board')
          .insert({
            job_definition_id: jobDef.id,
            job_name: jobDef.name,
            enabled_tools: jobDef.enabled_tools || [],
            model_settings: jobDef.model_settings || {},
            input: jobDef.prompt_content,
            status: 'PENDING',
            source_event_id: eventData.id,
            project_run_id: currentProjectRunId,
            project_definition_id: currentProjectDefinitionId || null,
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
                            message: `Failed to dispatch to job_board: ${jobBoardError.message}` 
                        } 
                    }, null, 2)
                }]
            };
        }

        dispatchResults.push({
          job_definition_id: jobDef.id,
          job_name: jobDef.name,
          status: 'dispatched',
          event_id: eventData.id
        });

      } catch (jobError: any) {
        errors.push({
          job_definition_id: jobDef.id,
          job_name: jobDef.name,
          error: jobError.message
        });
      }
    }

    // Prepare response
    const result = {
      dispatched: dispatchResults,
      errors: errors,
      summary: {
        total_requested: job_definition_ids.length,
        successfully_dispatched: dispatchResults.length,
        failed: errors.length,
        project_run_id: currentProjectRunId,
        dispatched_by_job_id: currentJobId
      },
      guidance: {
        tool_purpose: 'dispatch_job is for re-running existing jobs only',
        for_pipelines: 'Use create_job with event-based scheduling (e.g., "job.completed") for creating job pipelines',
        examples: {
          good_use: 'Re-running a failed job, manually triggering a specific job',
          avoid: 'Creating multi-step workflows, job chains, or complex pipelines'
        }
      }
    };

    if (errors.length > 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: result, 
            meta: { 
              ok: true, 
              warnings: [`${errors.length} jobs failed to dispatch`] 
            } 
          }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ data: result, meta: { ok: true } }, null, 2)
      }]
    };

  } catch (e: any) {
    return {
      content: [
        { 
          type: 'text' as const, 
          text: JSON.stringify({ 
            data: null, 
            meta: { 
              ok: false, 
              code: 'DISPATCH_ERROR', 
              message: `Error dispatching jobs: ${e.message}` 
            } 
          }, null, 2) 
        },
      ],
    };
  }
}
