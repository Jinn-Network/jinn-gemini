import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

export const getSchemaParams = z.object({
  table_name: tableNameSchema.optional().describe('The specific table you want to know about.'),
});

export const getSchemaSchema = {
  description: 'Describes the database structure. If table_name is provided, it returns the detailed schema for that table. If table_name is omitted, it returns a list of all table names in the public schema. Note: system_state table is read-only and cannot be modified.',
  inputSchema: getSchemaParams.shape,
};

export async function getSchema(params: z.infer<typeof getSchemaParams>) {
  try {
    const parseResult = getSchemaParams.safeParse(params);
    if (!parseResult.success) {
      return { content: [{ type: 'text' as const, text: `Invalid parameters: ${parseResult.error.message}` }] };
    }
    const { table_name } = parseResult.data;
    if (table_name) {
      // This is a simplified RPC call to a Supabase function
      // that would query pg_catalog for the detailed schema.
      const { data, error } = await supabase.rpc('get_table_schema', {
        p_table_name: table_name,
      });
      if (error) throw error;
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } else {
      const { data, error } = await supabase.rpc('get_all_tables');
      if (error) throw error;
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: `Error fetching schema: ${e.message}` },
      ],
    };
  }
} 