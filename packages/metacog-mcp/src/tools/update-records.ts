import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

export const updateRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.any()).describe('A JSON object to identify the row(s) to update. Cannot be empty.'),
  updates: z.record(z.any()).describe('A JSON object of columns and their new values.'),
});

export const updateRecordsSchema = {
  description: 'Modifies existing rows in a table that match a filter.',
  inputSchema: updateRecordsParams.shape,
};

export async function updateRecords({ table_name, filter, updates }: z.infer<typeof updateRecordsParams>) {
  try {
    const { data: updatedCount, error } = await supabase.rpc('update_records', {
      p_table_name: table_name,
      p_filter: filter,
      p_updates: updates,
    });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: `Successfully updated ${updatedCount} record(s).` }] };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: `Error updating records: ${e.message}` },
      ],
    };
  }
} 