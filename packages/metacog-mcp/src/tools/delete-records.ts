import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

export const deleteRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.any()).describe('A JSON object to identify the row(s) to delete. Cannot be empty.'),
});

export const deleteRecordsSchema = {
  description: 'Deletes rows from a table that match a filter.',
  inputSchema: deleteRecordsParams.shape,
};

export async function deleteRecords({ table_name, filter }: z.infer<typeof deleteRecordsParams>) {
  try {
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