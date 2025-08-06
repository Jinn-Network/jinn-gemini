import { supabase } from './shared/supabase.js';
import { z } from 'zod';

export const createJobParams = z.object({
    job_name: z.string().describe("The unique name for the job definition."),
    job_description: z.string().optional().describe("A brief explanation of what the job does."),
    prompt_content: z.string().describe('The prompt content for this job.'),
    schedule_dispatch_trigger: z.enum([
        'on_new_artifact',
        'on_artifact_status_change',
        'on_job_status_change',
        'one-off',
        'on_new_research_thread',
        'on_research_thread_update',
        'on_processing_time_update'
    ]).describe("The event that will trigger this job."),
    schedule_trigger_filter: z.record(z.any()).optional().describe(`Filter conditions for trigger matching. Examples:
- Artifact topic: {"topic": "market_analysis"}
- Artifact source: {"source": "analyst"}  
- Status change: {"old_status": "PENDING", "new_status": "COMPLETED"}
- Processing time: {"threshold_seconds": 300}
- Multiple conditions: {"topic": "analysis", "source": "researcher"}
Use direct field matching - no nested objects needed.`),
    schedule_trigger_context_key: z.string().optional().describe(`Label to prefix the triggering record's ID in job context. Examples:
- "artifact_id" - context becomes "artifact_id:abc-123-def" 
- "thread_id" - context becomes "thread_id:xyz-789-ghi"
- "source_job" - context becomes "source_job:completed-job-id"
Leave empty to pass just the record ID without a label.`),
    model_settings: z.record(z.any()).optional().describe("JSON object with specific model settings."),
    enabled_tools: z.array(z.string()).optional().describe("A list of other tools this job can use."),
});

export type CreateJobParams = z.infer<typeof createJobParams>;

export const createJobSchema = {
    description: 'Creates a new prompt, a job definition, and a schedule in a single operation.',
    inputSchema: createJobParams.shape,
};

export async function createJob(params: CreateJobParams) {
    try {
        const validatedParams = createJobParams.parse(params);
        const {
            job_name,
            job_description,
            prompt_content,
            schedule_dispatch_trigger,
            schedule_trigger_filter,
            schedule_trigger_context_key,
            model_settings,
            enabled_tools
        } = validatedParams;

        // 1. Create prompt in library using clean job name
        const cleanJobName = job_name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        
        const { data: newPromptId, error: promptError } = await supabase.rpc('create_record', {
            p_table_name: 'prompt_library',
            p_data: { name: cleanJobName, content: prompt_content, version: 1 },
        });

        if (promptError) {
            throw new Error(`Failed to create prompt: ${promptError.message}`);
        }

        // 2. Create Job Definition with simple prompt_ref format
        const { data: newJobDefId, error: jobDefError } = await supabase.rpc('create_record', {
            p_table_name: 'job_definitions',
            p_data: {
                name: job_name,
                description: job_description,
                prompt_ref: `${cleanJobName}@1`,
                model_settings: model_settings || {},
                enabled_tools: enabled_tools || [],
            },
        });

        if (jobDefError) {
            throw new Error(`Failed to create job definition: ${jobDefError.message}`);
        }

        // 3. Create Job Schedule
        const { data: newJobScheduleId, error: jobScheduleError } = await supabase.rpc('create_record', {
            p_table_name: 'job_schedules',
            p_data: {
                job_definition_id: newJobDefId,
                dispatch_trigger: schedule_dispatch_trigger,
                trigger_filter: schedule_trigger_filter || {},
                trigger_context_key: schedule_trigger_context_key,
                job_name: job_name,
            },
        });

        if (jobScheduleError) {
            throw new Error(`Failed to create job schedule: ${jobScheduleError.message}`);
        }

        const result = {
            promptId: newPromptId,
            jobDefinitionId: newJobDefId,
            jobScheduleId: newJobScheduleId,
        };

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify(result, null, 2)
            }]
        };
    } catch (e: any) {
        return {
            content: [
                { type: 'text' as const, text: `Error creating job: ${e.message}` },
            ],
        };
    }
} 