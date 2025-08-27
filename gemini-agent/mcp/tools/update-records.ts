import { z } from 'zod';
import { supabase, getCurrentJobContext } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

export const updateRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.string(), z.any()).refine(obj => Object.keys(obj).length > 0, {
    message: "Filter cannot be empty - must specify at least one condition to prevent accidental update of all records"
  }).describe('A JSON object to identify the row(s) to update. Cannot be empty.'),
  updates: z.record(z.string(), z.any()).refine(obj => Object.keys(obj).length > 0, {
    message: "Updates cannot be empty - must specify at least one field to update"
  }).describe('A JSON object of columns and their new values.'),
});

export const updateRecordsSchema = {
  description: 'Modifies existing rows in a table that match a filter. It automatically updates source_job_id and source_job_name. Note: system_state table is read-only and cannot be modified.',
  inputSchema: updateRecordsParams.shape,
};

export async function updateRecords(params: z.infer<typeof updateRecordsParams>) {
  try {
    const parseResult = updateRecordsParams.safeParse(params);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
        }]
      };
    }
    const { table_name, filter, updates } = parseResult.data;
    const { jobId, jobName } = getCurrentJobContext();

    // Automatically inject context and updated_at into the updates payload
    // The database function will now skip any columns that don't exist in the target table
    // We don't update thread_id here, as an update shouldn't change the thread a record belongs to.
    const enrichedUpdates = {
      ...updates,
      source_job_id: jobId,
      source_job_name: jobName,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedCount, error } = await supabase.rpc('update_records', {
      p_table_name: table_name,
      p_filter: filter,
      p_updates: enrichedUpdates,
    });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: `Successfully updated ${updatedCount} record(s).` }] };
  } catch (e: any) {
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: JSON.stringify({ ok: false, code: 'DB_ERROR', message: `Error updating records: ${e.message}` }, null, 2) },
      ],
    };
  }
} 