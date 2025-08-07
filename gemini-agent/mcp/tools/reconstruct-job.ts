import { supabase } from './shared/supabase.js';
import { reconstructJobParams, ReconstructJobParams } from './shared/types.js';

export const reconstructJobSchema = {
  description: 'Reconstructs the full context and impact of a single job. Provides the job report, identifies its source schedule, and lists all records created or modified by it.',
  inputSchema: reconstructJobParams.shape,
};

export async function reconstructJob(params: ReconstructJobParams) {
  const { job_id } = reconstructJobParams.parse(params);
  try {
    const { data, error } = await supabase.rpc('get_job_impact', { p_job_id: job_id });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `Error reconstructing job: ${e.message}` }] };
  }
}