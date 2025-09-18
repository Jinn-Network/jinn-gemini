import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { tableNameSchema } from './shared/types.js';

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
    return `\n\nSCHEMA HELP: Unable to fetch schema information: ${e.message}`;
  }
}

export const deleteRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.string(), z.any()).refine(obj => Object.keys(obj).length > 0, {
    message: "Filter cannot be empty - must specify at least one condition to prevent accidental deletion of all records"
  }).describe('A JSON object to identify the row(s) to delete. Cannot be empty.'),
});

export const deleteRecordsSchema = {
  description: 'Deletes are disabled for on-chain workflows. Use Control API managed lifecycles.',
  inputSchema: deleteRecordsParams.shape,
};

export async function deleteRecords(params: z.infer<typeof deleteRecordsParams>) {
  let table_name: string = '';
  try {
    const parseResult = deleteRecordsParams.safeParse(params);
    if (!parseResult.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined } })
        }]
      };
    }
    const { table_name: tn, filter } = parseResult.data;
    table_name = tn;

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'UNSUPPORTED', message: 'Deletes are disabled. Use Control API lifecycles.' } }) }] };
  } catch (e: any) {
    // Get schema help for schema-related errors
    const schemaHelp = await getSchemaHelp(table_name, e);
    const errorMessage = `Error deleting records: ${e.message}${schemaHelp}`;
    
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: errorMessage } }) },
      ],
    };
  }
} 