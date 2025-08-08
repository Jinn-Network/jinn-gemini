import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

export const deleteRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.any()).refine(obj => Object.keys(obj).length > 0, {
    message: "Filter cannot be empty - must specify at least one condition to prevent accidental deletion of all records"
  }).describe('A JSON object to identify the row(s) to delete. Cannot be empty.'),
});

export const deleteRecordsSchema = {
  description: 'Deletes rows from a table that match a filter. Note: system_state table is read-only and cannot be modified.',
  inputSchema: deleteRecordsParams.shape,
};

export async function deleteRecords(params: z.infer<typeof deleteRecordsParams>) {
  try {
    const parseResult = deleteRecordsParams.safeParse(params);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
        }]
      };
    }
    const { table_name, filter } = parseResult.data;

    const { data: deletedCount, error } = await supabase.rpc('delete_records', {
      p_table_name: table_name,
      p_filter: filter,
    });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: `Successfully deleted ${deletedCount} record(s).` }] };
  } catch (e: any) {
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: JSON.stringify({ ok: false, code: 'DB_ERROR', message: `Error deleting records: ${e.message}` }, null, 2) },
      ],
    };
  }
} 