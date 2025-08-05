import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

export const createRecordParams = z.object({
  table_name: tableNameSchema,
  data: z.record(z.any()).describe('A JSON object where keys are column names and values are the data to insert.'),
});

export const createRecordSchema = {
  description: 'Inserts a new row into a specified table.',
  inputSchema: createRecordParams.shape,
};

export async function createRecord({ table_name, data }: z.infer<typeof createRecordParams>) {
  try {
    const { data: newId, error } = await supabase.rpc('create_record', {
      p_table_name: table_name,
      p_data: data,
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