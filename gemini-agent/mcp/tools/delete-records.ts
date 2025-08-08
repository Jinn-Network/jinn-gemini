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
      return { content: [{ type: 'text' as const, text: `Invalid parameters: ${parseResult.error.message}` }] };
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
      content: [
        { type: 'text' as const, text: `Error deleting records: ${e.message}` },
      ],
    };
  }
} 