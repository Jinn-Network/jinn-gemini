import { z } from 'zod';
import { supabase, getCurrentJobContext } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

export const createRecordParams = z.object({
  table_name: tableNameSchema,
  data: z.record(z.any()).describe('A JSON object where keys are column names and values are the data to insert.'),
});

export const createRecordSchema = {
  description: 'Inserts a new row into a specified table. It automatically adds source_job_id, source_job_name, and thread_id from the current job context. Note: system_state table is read-only and cannot be modified.',
  inputSchema: createRecordParams.shape,
};

export async function createRecord({ table_name, data }: z.infer<typeof createRecordParams>) {
  try {
    const { jobId, jobName, threadId } = getCurrentJobContext();
    
    // Automatically inject the universal context into the data payload
    // The database function will now skip any columns that don't exist in the target table
    const enrichedData = {
      ...data,
      source_job_id: jobId,
      source_job_name: jobName,
      thread_id: threadId,
    };

    const { data: newId, error } = await supabase.rpc('create_record', {
      p_table_name: table_name,
      p_data: enrichedData,
    });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: `Successfully created record with ID: ${newId}` }] };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: `Error creating record: ${e.message}` },
      ],
    };
  }
} 