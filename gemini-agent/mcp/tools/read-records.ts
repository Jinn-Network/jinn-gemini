import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';
import { exceedsSizeLimit, getDataSizeMB, DEFAULT_SIZE_LIMIT_MB } from './shared/data-size-limiter.js';

export const readRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.any()).optional().describe('A JSON object for WHERE clauses (e.g., `{"status": "COMPLETED"}`). An empty filter retrieves all records.'),
  limit: z.number().int().positive().max(1000).optional().describe('Maximum number of records to return (default: 100, max: 1000). Use with caution for large datasets.'),
  hours_back: z.number().int().positive().optional().describe('Filter records from the last N hours based on the `created_at` column. Cannot be used with `filter`.'),
});

export const readRecordsSchema = {
  description: 'Retrieves one or more rows from a table based on filters. DEFAULT LIMIT: 100 records (to prevent timeouts on large tables). For large datasets, use specific filters or increase limit cautiously. Supports basic key-value filtering OR time-based filtering on the `created_at` column. Note: system_state table is read-only and can only be read, not modified.',
  inputSchema: readRecordsParams.shape,
};

export async function readRecords({ table_name, filter, limit = 100, hours_back }: z.infer<typeof readRecordsParams>) {
  try {
    if (filter && hours_back) {
      throw new Error("You cannot use both 'filter' and 'hours_back' at the same time. Please use one or the other.");
    }

    let finalFilter = filter || {};

    // If hours_back is specified, we'll use a separate database function parameter for time filtering
    // This avoids the complex nested object structure that caused issues
    let timeFilter = null;
    if (hours_back) {
      timeFilter = new Date(Date.now() - hours_back * 60 * 60 * 1000).toISOString();
      // Use empty filter for basic equality checks
      finalFilter = {};
    }

    const { data, error } = await supabase.rpc('read_records_with_time', {
      p_table_name: table_name,
      p_filter: finalFilter,
      p_limit: limit,
      p_time_filter: timeFilter,
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
            warning: `Data limited due to size constraint (${DEFAULT_SIZE_LIMIT_MB}MB). Original: ${data.length} records, Returned: ${finalData.length} records. Consider using more specific filters or get_context_snapshot for large datasets.`,
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
