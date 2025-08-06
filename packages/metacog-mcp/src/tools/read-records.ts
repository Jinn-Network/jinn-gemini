import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';
import { exceedsSizeLimit, getDataSizeMB, DEFAULT_SIZE_LIMIT_MB } from './shared/data-size-limiter.js';

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

    // Check if data exceeds size limit
    if (exceedsSizeLimit(data)) {
      const dataSizeMB = getDataSizeMB(data);
      
      // Limit number of records to fit within size limit
      let finalData = data;
      let reduction = 2;
      
      while (exceedsSizeLimit(finalData) && finalData.length > 1) {
        const maxRecords = Math.max(1, Math.floor(data.length / reduction));
        finalData = data.slice(0, maxRecords);
        reduction *= 2;
      }

      return { 
        content: [{ 
          type: 'text' as const, 
          text: JSON.stringify({
            warning: `Data limited due to size constraint (${DEFAULT_SIZE_LIMIT_MB}MB). Original: ${data.length} records, Returned: ${finalData.length} records`,
            data: finalData
          }, null, 2) 
        }] 
      };
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: `Error reading records: ${e.message}` },
      ],
    };
  }
} 