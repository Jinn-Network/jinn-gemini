import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { tableNameSchema } from './shared/types.js';

export const createRecordParams = z.object({
  table_name: tableNameSchema,
  data: z.record(z.any()).describe('A JSON object where keys are column names and values are the data to insert.'),
});

export const createRecordSchema = {
  description: 'Inserts a new row into a specified table. It automatically adds source_job_id, source_job_name, and thread_id from the current job context. Note: system_state table is read-only and cannot be modified.',
  inputSchema: createRecordParams.shape,
};

export async function createRecord(params: z.infer<typeof createRecordParams>) {
  try {
    const parseResult = createRecordParams.safeParse(params);
    if (!parseResult.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined } })
        }]
      };
    }
    const { table_name, data } = parseResult.data;
    const { jobId, jobDefinitionId, jobName, projectRunId, sourceEventId } = getCurrentJobContext();
    
    // Only inject context into tables designed to carry lineage fields
    const tablesWithLineage = new Set(['artifacts', 'job_reports', 'memories', 'messages', 'threads']);
    const enrichedData = tablesWithLineage.has(table_name as string)
      ? {
          ...data,
          source_job_id: jobId,
          source_job_name: jobName,
          project_run_id: projectRunId,
          source_event_id: sourceEventId,
          job_definition_id: jobDefinitionId,
        }
      : data;

    const { data: newId, error } = await supabase.rpc('create_record', {
      p_table_name: table_name,
      p_data: enrichedData,
    });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: { id: newId }, meta: { ok: true } }) }] };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error creating record: ${e.message}` } }) },
      ],
    };
  }
} 