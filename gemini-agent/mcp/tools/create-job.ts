import { supabase } from './shared/supabase.js';
import { CreateJobInputSchema, type CreateJobInput } from './shared/types.js';
import { randomUUID } from 'crypto';

export const createJobParams = CreateJobInputSchema;
export type CreateJobParams = CreateJobInput;

export const createJobSchema = {
    description: 'Creates a new job definition in the unified jobs table. Can create new jobs or new versions of existing jobs.',
    inputSchema: createJobParams.shape,
};

export async function createJob(params: CreateJobParams) {
    try {
        const validatedParams = createJobParams.parse(params);
        const {
            name,
            description,
            prompt_content,
            enabled_tools,
            schedule_config,
            existing_job_id
        } = validatedParams;

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
                is_active
            })
            .select()
            .single();

        if (insertError) {
            throw new Error(`Failed to create job: ${insertError.message}`);
        }

        const result = {
            id: newJob.id,
            job_id: newJob.job_id,
            version: newJob.version,
            name: newJob.name,
            is_active: newJob.is_active,
            created_at: newJob.created_at
        };

        return {
            content: [{
                type: 'text' as const,
                text: `Job created successfully:\n${JSON.stringify(result, null, 2)}`
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