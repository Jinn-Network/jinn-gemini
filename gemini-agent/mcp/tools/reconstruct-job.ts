import { supabase } from './shared/supabase.js';
import { reconstructJobParams, ReconstructJobParams } from './shared/types.js';

export const reconstructJobSchema = {
  description: 'Reconstructs the full context and impact of a single job. Provides the job report, identifies its source schedule, and lists all records created or modified by it.',
  inputSchema: reconstructJobParams.shape,
};

export async function reconstructJob(params: ReconstructJobParams) {
  try {
    // Use safeParse to avoid throwing exceptions on validation errors
    const parseResult = reconstructJobParams.safeParse(params);
    if (!parseResult.success) {
      return { content: [{ type: 'text' as const, text: `Invalid parameters: ${parseResult.error.message}` }] };
    }
    const { job_id } = parseResult.data;
    const { data, error } = await supabase.rpc('get_job_impact', { p_job_id: job_id });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `Error reconstructing job: ${e.message}` }] };
  }
}