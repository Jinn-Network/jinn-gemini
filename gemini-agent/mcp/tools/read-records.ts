import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

// Helper function to get schema information when errors occur
async function getSchemaHelp(tableName: string, error: any): Promise<string> {
  try {
    // If it's a table-related error, provide helpful guidance
    // Always try to provide schema help for database errors
    if (error.message) {
      // Try to get actual schema information
      try {
        const { data: schemaData, error: schemaError } = await supabase.rpc('get_table_schema', {
          p_table_name: tableName,
        });
        
        if (!schemaError && schemaData && Array.isArray(schemaData) && schemaData.length > 0) {
          return `\n\nSCHEMA HELP for table '${tableName}':\n${JSON.stringify(schemaData, null, 2)}`;
        }
      } catch (schemaCallError) {
        // Schema call failed, fall back to basic info
      }
      
      // Fallback: get list of all tables
      try {
        const { data: allTablesData, error: allTablesError } = await supabase.rpc('get_all_tables');
        
        if (!allTablesError && allTablesData) {
          return `\n\nSCHEMA HELP: Table '${tableName}' not found. Available tables:\n${JSON.stringify(allTablesData, null, 2)}`;
        }
      } catch (allTablesCallError) {
        // All tables call failed, fall back to hardcoded list
      }
      
      // Final fallback: hardcoded table list (based on actual database)
      return `\n\nSCHEMA HELP: 
- Table: '${tableName}'
- Error: ${error.message}
- Available tables: artifacts, job_board, jobs, job_reports, memories, messages, project_runs, project_definitions, system_state, events
- Use 'get_schema' tool to see detailed table structure
- Use 'get_schema' without table_name to see all available tables`;
    }
    
    return '';
  } catch (e: any) {
    // If even the schema help fails, return a minimal message
    return `\n\nSCHEMA HELP: Error occurred while trying to provide schema help.`;
  }
}

export const readRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.any()).optional().describe('A JSON object for WHERE clauses (e.g., `{"status": "COMPLETED"}`). An empty filter retrieves all records.'),
  limit: z.number().int().positive().optional().describe('Maximum number of records to return (default: 100). Use with caution for large datasets.'),
  hours_back: z.number().int().positive().optional().describe('Filter records from the last N hours based on the `created_at` column. Cannot be used with `filter`.'),
  cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
});

export const readRecordsSchema = {
  description: 'Retrieves one or more rows from a table based on filters. DEFAULT LIMIT: 100 records (to prevent timeouts on large tables). For large datasets, use specific filters or increase limit cautiously. Supports basic key-value filtering OR time-based filtering on the `created_at` column. Note: system_state table is read-only and can only be read, not modified.',
  inputSchema: readRecordsParams.shape,
};

export async function readRecords(params: z.infer<typeof readRecordsParams>) {
  let table_name: string = '';
  try {
    const parseResult = readRecordsParams.safeParse(params);
    if (!parseResult.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined } })
        }]
      };
    }
    const { table_name: tn, filter, limit = 100, hours_back, cursor } = parseResult.data;
    table_name = tn;
    if (filter && hours_back) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: "You cannot use both 'filter' and 'hours_back' at the same time. Please use one or the other." } })
        }]
      };
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
    if (error) {
      // Get schema help for schema-related errors
      const schemaHelp = await getSchemaHelp(table_name, error);
      const errorMessage = `Error reading records: ${error.message}${schemaHelp}`;
      
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: null, 
            meta: { 
              ok: false, 
              code: 'DB_ERROR', 
              message: errorMessage 
            } 
          }, null, 2)
        }]
      };
    }

    const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };
    const composed = composeSinglePageResponse(data, {
      startOffset: keyset.offset,
      truncationPolicy: { output: 500, content: 200 },
      requestedMeta: { cursor, table_name, limit, hours_back },
    });

    // meta first, then data
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }) }] };
  } catch (e: any) {
    // Get schema help for schema-related errors
    const schemaHelp = await getSchemaHelp(table_name, e);
    const errorMessage = `Error reading records: ${e.message}${schemaHelp}`;
    
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: errorMessage } }) },
      ],
    };
  }
}
