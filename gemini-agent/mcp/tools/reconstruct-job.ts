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
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
        }]
      };
    }
    const { job_id } = parseResult.data;
    const { data, error } = await supabase.rpc('get_job_impact', { p_job_id: job_id });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e: any) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: 'DB_ERROR', message: `Error reconstructing job: ${e.message}` }, null, 2) }]
    };
  }
}