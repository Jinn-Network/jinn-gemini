import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

export const readRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.any()).optional().describe('A JSON object for WHERE clauses (e.g., `{"status": "COMPLETED"}`). An empty filter retrieves all records.'),
});

export const readRecordsSchema = {
  description: 'Retrieves one or more rows from a table based on filters.',
  inputSchema: readRecordsParams.shape,
};

export async function readRecords({ table_name, filter }: z.infer<typeof readRecordsParams>) {
  try {
    const { data, error } = await supabase.rpc('read_records', {
      p_table_name: table_name,
      p_filter: filter || {},
    });
    if (error) throw error;
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: `Error reading records: ${e.message}` },
      ],
    };
  }
} 