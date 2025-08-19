import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { getCurrentJobContext } from './shared/context.js';
import { createJob, CreateJobParams } from './create-job.js';

// Individual job definition for batch creation
const JobDefinitionSchema = z.object({
  name: z.string().describe('The name of the job'),
  description: z.string().optional().describe('Optional description of the job purpose'),
  prompt_content: z.string().describe('The full prompt content for this job'),
  enabled_tools: z.array(z.string()).describe('Array of tool names this job can use'),
});

export const CreateJobBatchInputSchema = z.object({
  jobs: z.array(JobDefinitionSchema).min(1).describe('Array of job definitions to create. Each job needs name, prompt_content, and enabled_tools.'),
  sequence: z.enum(['parallel', 'serial']).describe('Execution sequence: "parallel" for simultaneous execution (independent work), "serial" for sequential execution (dependent workflow)'),
  project_definition_id: z.string().uuid().optional().describe('Optional. Link all job definitions to a specific project definition for organizational grouping.'),
});

export type CreateJobBatchParams = z.infer<typeof CreateJobBatchInputSchema>;
export type JobDefinition = z.infer<typeof JobDefinitionSchema>;

export const createJobBatchSchema = {
  description: `Creates multiple job definitions with specified sequencing (parallel or serial execution).

PARALLEL SEQUENCING: All jobs are triggered when the current job completes. They run simultaneously.
- Use cases: Independent work streams (multiple marketing campaigns, different feature tracks)
- Performance: Faster overall completion since jobs run concurrently
- Example: Social media campaign, email campaign, and content creation can all run in parallel

SERIAL SEQUENCING: Jobs are chained so Job 1 triggers when current job completes, Job 2 triggers when Job 1 completes, Job 3 triggers when Job 2 completes, etc.
- Use cases: Dependent workflows where later jobs need outputs from earlier ones
- Performance: Sequential execution ensures proper dependency management
- Example: Data collection → analysis → reporting must run in order

This tool leverages the existing job creation infrastructure and event-driven scheduling system. Each job inherits project context from the current job execution.

Note: For fine-grained control over individual job triggers and scheduling, use the update_job tool after batch creation.

Returns: Array of complete job information for all created jobs, including job_id (shared UUID), version, schedule_config, and execution metadata.`,
  inputSchema: CreateJobBatchInputSchema.shape,
};

export async function createJobBatch(params: CreateJobBatchParams) {
  try {
    // Validate input parameters
    const parseResult = CreateJobBatchInputSchema.safeParse(params);
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
    const { jobs, sequence, project_definition_id } = validatedParams;

    // Get current job context for sequencing
    const { jobDefinitionId: currentJobDefinitionId } = getCurrentJobContext();

    if (!currentJobDefinitionId) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'NO_JOB_CONTEXT',
              message: 'Cannot create job batch: no current job context available. Job batch creation must be called within an existing job execution context.'
            }
          }, null, 2)
        }]
      };
    }

    const createdJobs: any[] = [];
    const errors: any[] = [];
    let previousJobId: string | null = null;

    // Create jobs with appropriate sequencing
    for (let i = 0; i < jobs.length; i++) {
      const jobDef = jobs[i];
      
      let scheduleConfig: any;
      let filterConfig: Record<string, any> = {};

      if (sequence === 'parallel') {
        // All jobs trigger when current job completes
        scheduleConfig = 'job.completed';
        filterConfig = { parent_job_definition_id: currentJobDefinitionId };
      } else {
        // Serial: first job triggers on current job, subsequent jobs chain
        if (i === 0) {
          scheduleConfig = 'job.completed';
          filterConfig = { parent_job_definition_id: currentJobDefinitionId };
        } else {
          scheduleConfig = 'job.completed';
          filterConfig = { parent_job_definition_id: previousJobId };
        }
      }

      // Prepare parameters for create_job
      const createJobParams: CreateJobParams = {
        name: jobDef.name,
        description: jobDef.description,
        prompt_content: jobDef.prompt_content,
        enabled_tools: jobDef.enabled_tools,
        schedule_on: scheduleConfig,
        filter: filterConfig,
        project_definition_id: project_definition_id,
      };

      try {
        // Call the existing create_job function
        const result = await createJob(createJobParams);
        
        // Parse the result to check for success
        const resultContent = result.content[0];
        if (resultContent?.type === 'text') {
          const parsedResult = JSON.parse(resultContent.text);
          if (parsedResult.meta?.ok) {
            createdJobs.push({
              ...parsedResult.data,
              sequence_position: i + 1,
              sequence_type: sequence
            });
            // Store the job_id for chaining (use the stable job_id, not the version-specific id)
            previousJobId = parsedResult.data.id; // This is the job definition ID we need for filtering
          } else {
            errors.push({
              job_index: i + 1,
              job_name: jobDef.name,
              error: parsedResult.meta
            });
            // Stop processing on error to maintain consistency
            break;
          }
        } else {
          errors.push({
            job_index: i + 1,
            job_name: jobDef.name,
            error: { code: 'PARSE_ERROR', message: 'Failed to parse create_job result' }
          });
          break;
        }
      } catch (error: any) {
        errors.push({
          job_index: i + 1,
          job_name: jobDef.name,
          error: { code: 'EXECUTION_ERROR', message: error.message }
        });
        break;
      }
    }

    // Return results
    if (errors.length > 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: {
              created_jobs: createdJobs,
              errors: errors,
              partial_success: createdJobs.length > 0
            },
            meta: {
              ok: false,
              code: 'BATCH_PARTIAL_FAILURE',
              message: `Created ${createdJobs.length} of ${jobs.length} jobs. ${errors.length} jobs failed.`
            }
          }, null, 2)
        }]
      };
    }

    const jobIds = createdJobs.map(job => job.id);
    const successMessage = `Successfully created ${createdJobs.length} jobs with ${sequence} sequencing. Job IDs: [${jobIds.join(', ')}]`;

    return {
      content: [{
        type: 'text' as const,
        text: successMessage
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
            code: 'BATCH_ERROR',
            message: `Error creating job batch: ${error.message}`
          }
        }, null, 2)
      }]
    };
  }
}